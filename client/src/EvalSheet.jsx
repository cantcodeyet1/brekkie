import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CRIT, LEVELN, longDate } from './data.js';

const CLUB = 'Champions Toastmasters Club';

/* Three Letter pages laid out like the Pathways evaluation form. */
export function EvalSheet({ e }) {
  const Foot = ({ n }) => <div className="pf"><span><b>Brekkie<i /></b> · {CLUB}</span><span>Page {n} of 3</span></div>;
  const Head = () => <div className="ph sm"><i className="g" /><div className="hb"><b>EVALUATION FORM –</b> {e.form_title}</div></div>;
  return (
    <div className="doc">
      <div className="page">
        <div className="ph"><i className="m" /><i className="g" /><div className="hb"><h1>Evaluation Form</h1><p>{e.form_title}</p></div></div>
        <div className="pbody">
          <div className="frow"><div className="fld"><span>Member Name</span><u>{e.member}</u></div><div className="fld"><span>Date</span><u>{longDate(e.date)}</u></div></div>
          <div className="frow"><div className="fld"><span>Evaluator</span><u>{e.by}</u></div><div className="fld"><span>Speech Length: <b style={{ fontWeight: 600 }}>{e.length_text}</b></span></div></div>
          <div className="fld"><span>Speech Title</span><u>{e.title}</u></div>
          <h4>Purpose Statements</h4><ul className="tri">{(e.purpose || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
          <h4>Notes for the Evaluator</h4><p>{e.notes}</p><p>About this speech:</p>
          <ul className="tri">{(e.about || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
          <h4>General Comments</h4>
          <div className="gc"><span>You excelled at:</span>{e.excelled}</div>
          <div className="gc"><span>You may want to work on:</span>{e.work}</div>
          <div className="gc"><span>To challenge yourself:</span>{e.challenge}</div>
        </div>
        <Foot n={1} />
      </div>
      <div className="page">
        <Head />
        <div className="pbody" style={{ paddingTop: 34 }}>
          <p>For the evaluator: In addition to your verbal evaluation, please complete this form.</p>
          <div className="sc">{[5, 4, 3, 2, 1].map((v) => <div key={v}>{v}<small>{LEVELN[v].toUpperCase()}</small></div>)}</div>
          {CRIT.map(([cn, d], i) => (
            <div className="cr" key={cn}>
              <div className="l"><b>{cn}:</b> {d}<div className="n">{[5, 4, 3, 2, 1].map((v) => <s key={v} className={e.ratings?.[i] === v ? 'on' : ''}>{v}</s>)}</div></div>
              <div className="c"><span>Comment:</span>{e.comments?.[i]}</div>
            </div>
          ))}
        </div>
        <Foot n={2} />
      </div>
      <div className="page">
        <Head />
        <div className="pbody" style={{ paddingTop: 34 }}>
          <p>This criteria lists the specific goals and expectations for the speech. Review each level to help you complete the evaluation.</p>
          <div className="rub">{CRIT.map(([cn, , lv]) => <div key={cn}><b>{cn}</b>{[5, 4, 3, 2, 1].map((v) => <p key={v}><i>{v} –</i>{lv[v - 1]}</p>)}</div>)}</div>
        </div>
        <Foot n={3} />
      </div>
    </div>
  );
}

/* Mounted once. printEval(e) renders the sheet into #print-root and opens the browser print dialog (Save as PDF). */
export const printEval = (e) => window.dispatchEvent(new CustomEvent('brekkie:print', { detail: e }));
export const printReport = (title, node) => window.dispatchEvent(new CustomEvent('brekkie:print', { detail: { report: { title, node } } }));
export const printPoster = (poster) => window.dispatchEvent(new CustomEvent('brekkie:print', { detail: { poster } }));

function Poster({ p }) {
  return (
    <div className="poster">
      <span className="wm">Brekkie<i /></span>
      <h1>Tell people how they did</h1>
      <p>Scan to give feedback on tonight’s meeting, {p.when}.</p>
      <img src={p.src} alt="QR code" />
      <div className="url">{p.url}</div>
    </div>
  );
}
export function PrintHost() {
  const [e, setE] = useState(null);
  useEffect(() => { const f = (ev) => setE(ev.detail); window.addEventListener('brekkie:print', f); return () => window.removeEventListener('brekkie:print', f); }, []);
  useEffect(() => {
    if (!e) return;
    const prev = document.title; document.title = e.poster ? `Brekkie feedback poster` : e.report ? e.report.title : `Evaluation - ${e.project} - ${e.date}`;
    const t = setTimeout(() => { window.print(); document.title = prev; setE(null); }, 250);
    return () => clearTimeout(t);
  }, [e]);
  const host = document.getElementById('print-root');
  return e && host ? createPortal(e.poster ? <Poster p={e.poster} /> : e.report ? <div className="reportdoc"><span className="wm">Brekkie<i /></span><h1>{e.report.title}</h1>{e.report.node}</div> : <EvalSheet e={e} />, host) : null;
}
