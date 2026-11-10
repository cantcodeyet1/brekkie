"""Reads the official evaluation forms in server/templates/eval-forms/ and writes server/data/project-parts.json:
for each project its purpose statement, evaluator notes and "about this speech" text, and (for projects with
several forms) one entry per part. Needs `pdftotext` (poppler). Run: python server/scripts/extract-eval-forms.py"""
import json, os, re, subprocess

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
FORMS = os.path.join(ROOT, 'server', 'templates', 'eval-forms')
RES = json.load(open(os.path.join(ROOT, 'server', 'data', 'evaluation-resources.json'), encoding='utf8'))
BULLET = '•'


def text(f):
    t = subprocess.run(['pdftotext', '-enc', 'UTF-8', os.path.join(FORMS, f), '-'], capture_output=True, text=True, encoding='utf8').stdout
    t = t.replace('\r', '').replace('­', '').replace('\x0c', '\n').replace('\x17', ' ' + BULLET + ' ')
    t = re.sub(r'[   ]', ' ', t).replace('�', "'").replace('’', "'")
    return re.sub(r'Page \d+ of \d+', '', t)


def squash(s):
    return re.sub(r'\s+', ' ', s).strip()


def between(t, start, ends):
    m = re.search(start, t, re.I)
    if not m:
        return ''
    rest = t[m.end():]
    cut = len(rest)
    for e in ends:
        k = re.search(e, rest, re.I)
        if k:
            cut = min(cut, k.start())
    return rest[:cut]


def sentences(s):
    out = []
    for chunk in squash(s).split(BULLET):
        out += [x.strip() for x in re.split(r'(?<=[.!?])\s+(?=[A-Z])', chunk.strip()) if x.strip()]
    return out


def parse(f):
    t = text(f)
    lines = [l.strip() for l in t.split('\n') if l.strip()]
    title = next((l for l in lines if l.lower() != 'evaluation form'), '')
    sep = re.search(r'--|—', title)
    part = title[sep.end():].strip() if sep else ''
    m = re.search(r'Speech Length:?\s*(\d+)\s*[-–]\s*(\d+)\s*minutes', t, re.I)
    mn, mx = (int(m.group(1)), int(m.group(2))) if m else (None, None)
    raw = re.search(r'Speech Length:?\s*([^\n]+)', t, re.I)
    purpose = sentences(between(t, r'Purpose Statements?', [r'Speaker identified feedback', r'Notes for (the )?Evaluator', r'General Comments']))
    notes = squash(between(t, r'Notes for (the )?Evaluator', [r'About this speech', r'General Comments', r'For the evaluator:']))
    about = sentences(between(t, r'About this speech:?', [r'General Comments', r'For the evaluator:']))
    proj = [p for p in purpose if re.match(r'The purpose of this project', p)]
    sp = [p for p in purpose if not re.match(r'The purpose of this project', p)]
    return dict(part=part, min=mn, max=mx, length_text=squash(raw.group(1)) if raw else '', project_purpose=proj, purpose=sp, notes=notes, about=about)


out = {}
for name, v in RES.items():
    forms = v.get('forms') or []
    if not forms:
        continue
    parsed = [parse(os.path.basename(f)) for f in forms]
    first = parsed[0]
    entry = dict(purpose=first['project_purpose'] or first['purpose'], notes=first['notes'], about=first['about'])
    if len(forms) > 1:
        entry['parts'] = [
            dict(n=i + 1, label=p['part'] or 'Part %d' % (i + 1), kind='evaluator' if re.search(r'evaluator', p['part'], re.I) else 'speech',
                 min=p['min'], max=p['max'], length_text=p['length_text'], purpose=p['purpose'], notes=p['notes'], about=p['about'], form=forms[i])
            for i, p in enumerate(parsed)]
    else:
        entry['min'], entry['max'], entry['length_text'] = first['min'], first['max'], first['length_text']
    out[name] = entry
json.dump(out, open(os.path.join(ROOT, 'server', 'data', 'project-parts.json'), 'w', encoding='utf8'), indent=1, ensure_ascii=False)
print(len(out), 'projects;', sum(1 for e in out.values() if 'parts' in e), 'multi-part')
