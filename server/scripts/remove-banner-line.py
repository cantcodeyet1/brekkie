# The Word template leaves a one point white strip across the page just under the banner (a table border), and it is drawn on top of
# the bottom of the Toastmasters globe, so the logo looks cut in two. This takes that strip out of every blank page in templates/.
# Run it again after remaking the pages with make-agenda-base.mjs / make-plain-bases.py.   python server/scripts/remove-banner-line.py
import glob, os
import pymupdf

here = os.path.dirname(os.path.abspath(__file__))
for path in sorted(glob.glob(os.path.join(here, '..', 'templates', 'agenda-*.pdf'))):
    d = pymupdf.open(path); p = d[0]
    # only the white one point strips that sit on the banner are inside this box; the banner picture itself is left alone
    box = pymupdf.Rect(5, 114.2, 600, 116.2)
    before = sum(1 for g in p.get_drawings() if g['rect'].y0 >= 114.2 and g['rect'].y1 <= 116.2 and g.get('fill') == (1.0, 1.0, 1.0))
    p.add_redact_annot(box, fill=False)
    p.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED, text=pymupdf.PDF_REDACT_TEXT_NONE)
    tmp = path + '.tmp'
    d.save(tmp, garbage=3, deflate=True); d.close()
    os.replace(tmp, path)
    print(os.path.basename(path), 'white strips removed:', before)
