# Makes agenda-plain-N.pdf from agenda-base-N.pdf: the same pages with everything that belongs to one club taken out
# (club name, number and area line in the banner, the mission, the officers, and the conference banner at the bottom),
# so any club's own details can be drawn on them. Needs PyMuPDF:  python server/scripts/make-plain-bases.py
import pymupdf, os
here = os.path.dirname(os.path.abspath(__file__))
tpl = os.path.join(here, '..', 'templates')
for n in range(3):
    d = pymupdf.open(os.path.join(tpl, f'agenda-base-{n}.pdf')); p = d[0]
    hit = p.search_for('CALLING ALL CHAMPIONS')[0]
    ty = hit.y0
    # the left column stops short of the role table, which starts at x=183
    for b in [(196, 3, 590, 34), (455, 33, 590, 46), (420, 46, 590, 59), (10, 164.5, 180, 273), (10, 288, 180, 582)]: p.add_redact_annot(pymupdf.Rect(*b), fill=False)
    p.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED)
    # the conference banner: its blue box and QR code go too
    p.add_redact_annot(pymupdf.Rect(172, ty - 24, 574, ty + 62), fill=False)
    p.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_REMOVE, graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED)
    for l in p.get_links(): p.delete_link(l)
    d.save(os.path.join(tpl, f'agenda-plain-{n}.pdf'), garbage=3, deflate=True)
    print(n, 'banner text at', round(ty, 1))
# where the text sits, for drawing: baselines of the first mission line and each officer heading
d = pymupdf.open(os.path.join(tpl, 'agenda-base-0.pdf')); p = d[0]
for b in p.get_text('dict')['blocks']:
    for l in b.get('lines', []):
        s = l['spans'][0]
        if s['text'].strip() in ('We provide a supportive and', 'President', 'Arise Madzirerusa', '+263 772 948 938', 'VP Education', 'Champions Toastmasters Club'): print(repr(s['text']), 'baseline from top', round(s['origin'][1], 1), 'x', round(s['origin'][0], 1))
