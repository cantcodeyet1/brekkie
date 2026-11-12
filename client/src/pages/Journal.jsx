import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, useApi } from '../api.js';
import { longDate } from '../data.js';
import { Md } from '../md.jsx';
import { Btn, DatePick, ErrorMsg, I, Page, SkPage, useDesk, useToast } from '../ui.jsx';

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* quick markdown: wraps the selection, or puts a mark at the start of the line */
function Editor({ init, onSave, onCancel, busy, cta }) {
  const [date, setDate] = useState(init.date);
  const [body, setBody] = useState(init.body);
  const ta = useRef(null);
  const edit = (fn) => {
    const el = ta.current, a = el.selectionStart, b = el.selectionEnd;
    const [next, from, to] = fn(body, a, b);
    setBody(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(from, to); });
  };
  const wrap = (mark) => edit((t, a, b) => [t.slice(0, a) + mark + t.slice(a, b) + mark + t.slice(b), a + mark.length, b + mark.length]);
  const line = (mark) => edit((t, a, b) => { const s = t.lastIndexOf('\n', a - 1) + 1; return [t.slice(0, s) + mark + t.slice(s), a + mark.length, b + mark.length]; });
  return (
    <div className="jed">
      <div className="jtool" role="toolbar" aria-label="Formatting">
        <button type="button" title="Heading (# )" onClick={() => line('# ')}><b className="g">H</b><span>Heading</span></button>
        <button type="button" title="Bold (**text**)" onClick={() => wrap('**')}><b className="g">B</b><span>Bold</span></button>
        <button type="button" title="Italic (*text*)" onClick={() => wrap('*')}><i className="g">I</i><span>Italic</span></button>
        <button type="button" title="Quote (> )" onClick={() => line('> ')}><b className="g q">&ldquo;</b><span>Quote</span></button>
        <button type="button" title="List (- )" onClick={() => line('- ')}><b className="g">&bull;</b><span>List</span></button>
      </div>
      <textarea ref={ta} className="inp jbody" rows={6} value={body} maxLength={8000} autoFocus={!!init.id} placeholder="Write a note. # Heading, > quote, **bold**" onChange={(e) => setBody(e.target.value)} />
      <div className="jrow">
        <DatePick sm value={date} onChange={setDate} />
        <span className="jgrow" />
        {onCancel && <Btn kind="ghost" sm onClick={onCancel}>Cancel</Btn>}
        <Btn sm disabled={busy || !body.trim()} onClick={() => onSave({ date, body: body.trim() })}>{cta}</Btn>
      </div>
    </div>
  );
}

/* one member's journal on its own page: dated notes from catch-ups, newest first, written in markdown */
export default function JournalPage() {
  const { id } = useParams();
  const desk = useDesk();
  const prof = useApi(`/vpe/people/${id}/profile`);
  const { data, error, reload } = useApi(`/vpe/people/${id}/journal`);
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(0);
  useEffect(() => { document.querySelector('.scroll')?.scrollTo({ top: 0 }); }, []);
  const back = `/v/members/${id}`;
  if (error || prof.error) return <Page title="Journal" back={back}><ErrorMsg error={error || prof.error} /></Page>;
  if (!data || !prof.data) return <Page title="Journal" wide={desk} back={back}><SkPage plain rows={6} pill={false} /></Page>;
  const notes = data;
  const run = async (fn, msg) => {
    setBusy(true);
    try { await fn(); toast(msg); reload(); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const add = (v) => run(async () => { await api(`/vpe/people/${id}/journal`, { method: 'POST', body: v }); setFresh((n) => n + 1); }, 'Note saved');
  const save = (nid) => (v) => run(async () => { await api(`/vpe/journal/${nid}`, { method: 'PATCH', body: v }); setEditing(null); }, 'Note updated');
  const remove = (n) => { if (window.confirm('Delete this note?')) run(() => api(`/vpe/journal/${n.id}`, { method: 'DELETE' }), 'Note deleted'); };

  return (
    <Page title="Journal" wide={desk} back={back}>
      <h1 className="pg sm">{prof.data.person.name}</h1>
      <p className="fine" style={{ margin: '-4px 0 14px' }}>Your private notes. Only you and other VPEs can see these.</p>
      <div className="jcols">
        <div className="pcard jnew">
          <div className="lab" style={{ marginTop: 0 }}>New note</div>
          <Editor key={fresh} init={{ date: todayIso(), body: '' }} busy={busy} cta="Save note" onSave={add} />
        </div>

        <div className="jnotes">
          <div className="lab" style={{ margin: '4px 4px 0' }}>Notes<span className="cnt2">{notes.length}</span></div>
          {!notes.length && <p className="empty tight">No notes yet. Write one after your next catch-up. Start a line with # for a heading such as Why or Goals.</p>}
          <ul className="jlist">
            {notes.map((n) => (
              <li key={n.id}>
                {editing === n.id ? (
                  <Editor init={n} busy={busy} cta="Save" onCancel={() => setEditing(null)} onSave={save(n.id)} />
                ) : (
                  <>
                    <div className="jmeta">
                      <time>{longDate(n.date)}</time>
                      <span className="jgrow" />
                      <button type="button" className="jact" onClick={() => setEditing(n.id)}>{I.pencil}<span>Edit</span></button>
                      <button type="button" className="jact del" onClick={() => remove(n)}>{I.bin}<span>Delete</span></button>
                    </div>
                    <Md text={n.body} />
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Page>
  );
}
