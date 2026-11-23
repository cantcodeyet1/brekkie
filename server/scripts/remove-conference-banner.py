# Takes the "CALLING ALL CHAMPIONS" conference banner (blue box, text and QR code) off the Champions pages, agenda-base-N.pdf.
# The plain pages never had it. Run once: python server/scripts/remove-conference-banner.py
import os, pymupdf
here = os.path.dirname(os.path.abspath(__file__))
tpl = os.path.join(here, '..', 'templates')
for n in range(3):
    path = os.path.join(tpl, f'agenda-base-{n}.pdf')
    d = pymupdf.open(path); p = d[0]
    hits = p.search_for('CALLING ALL CHAMPIONS')
    if not hits: print(n, 'already clean'); continue
    ty = hits[0].y0
    p.add_redact_annot(pymupdf.Rect(172, ty - 24, 574, ty + 62), fill=False)
    p.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_REMOVE, graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED)
    for l in p.get_links(): p.delete_link(l)
    d.save(path + '.tmp', garbage=3, deflate=True); d.close(); os.replace(path + '.tmp', path)
    print(n, 'banner removed at', round(ty, 1))
