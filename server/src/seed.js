// Fake data for Champions Toastmasters Club. Run with `npm run seed` (wipes and reloads) or auto-runs on an empty dev database.
import crypto from 'node:crypto';
import { initDb, q, tx } from './db.js';
import { applySchedule } from './schedule.js';
import { importPathways } from './pathways.js';

const token = () => crypto.randomBytes(15).toString('base64url');
const G57 = [300, 360, 420];
const PROJECTS = [
  ['Ice Breaker', 1, 'Ice Breaker', '4–6 minutes', [240, 300, 360],
    ['Introduce yourself to the club and learn the basic structure of a speech.', 'The speaker presents a first speech and receives feedback from the evaluator.'],
    'This is the speaker’s very first speech. Keep it kind and specific, and speak with them beforehand about what they hope to hear.',
    ['A short speech about the speaker, on any angle they choose', 'Look for a clear opening, body and close', 'Suggest one or two improvements they can apply next time']],
  ['Evaluation and Feedback', 1, 'Evaluation and Feedback, First Speech', '5–7 minutes', G57,
    ['The purpose of this project is to practise applying feedback and to serve as a speech evaluator during a club meeting.', 'The purpose of this speech is for the member to present a speech and receive feedback from the evaluator.'],
    'If you know ahead of the meeting that you will be the evaluator, talk to the speaker about their goals for this speech. Set aside time after the speech to go through your evaluation and answer questions.',
    ['The member delivers a well-organised speech on any topic', 'Focus on speaking style, and recommend improvements the member can apply to the next speech', 'The speech may be humorous, informational, or any style the member chooses', 'The member will ask you to evaluate their second speech at a future meeting']],
  ['Researching and Presenting', 1, 'Researching and Presenting', '5–7 minutes', G57,
    ['Research a topic from credible sources and present it clearly.', 'The speaker practises organising findings and naming where they came from.'],
    'Check whether sources were named in the speech or in a hand-out. Comment on how well the content was structured, not only on delivery.',
    ['A researched topic of the speaker’s choice', 'Look for a clear structure and named sources', 'Suggest how to make dense material easier to follow']],
  ['Understanding Your Communication Style', 2, 'Understanding Your Communication Style', '5–7 minutes', G57,
    ['Learn how your own style shapes the way you speak and listen.', 'The speaker practises adapting delivery to different styles.'],
    'Look for self-awareness and for how well the speaker adapted to the audience.',
    ['Identify the speaker’s own communication style', 'Look for a deliberate change of approach', 'Suggest how to apply it next time']],
  ['Effective Body Language', 2, 'Effective Body Language', '5–7 minutes', G57,
    ['Use movement, gesture and expression to carry a message.', 'The speaker practises matching body language to the words.'],
    'Watch more than you listen. Note where movement helped, and where it distracted.',
    ['Look for gestures that reinforce the message', 'Look for purposeful movement around the stage', 'Check that facial expression and eye contact match the content']],
  ['Understanding Vocal Variety', 2, 'Understanding Vocal Variety', '5–7 minutes', G57,
    ['Explore pace, pitch, volume and pause to bring a speech to life.', 'The speaker practises using the voice as a deliberate tool.'],
    'Listen for contrast. A voice that never changes is the most common thing to flag; so are pauses that work well.',
    ['Look for deliberate changes in pace, pitch and volume', 'Notice where pauses were used for effect', 'Check the voice matched the emotion of the story']],
];
const PORDER = ['Ice Breaker', 'Evaluation and Feedback', 'Researching and Presenting', 'Effective Body Language', 'Understanding Vocal Variety'];
const CODES = { 'Ice Breaker': 'L1P1', 'Evaluation and Feedback': 'L1P2', 'Researching and Presenting': 'L1P3', 'Understanding Your Communication Style': 'L2P1', 'Effective Body Language': 'L2P2', 'Understanding Vocal Variety': 'L2P3' };

const MEMBERS = ['Aisha Bello', 'Devon Park', 'Grace Liu', 'Hannah Doyle', 'Jonah Adeyemi', 'Lena Fischer', 'Marcus Cole', 'Omar Haddad', 'Priya Raman', 'Ravi Menon', 'Sofia Marquez', 'Tom Whitfield'];
const email = (n) => n.toLowerCase().replace(/\s+/g, '.') + '@mail.com';

// Meeting 144 is the coming Thursday (today counts), every other meeting is a week apart, so the demo always has a "next" meeting.
const iso = (d) => d.toISOString().slice(0, 10);
const THU = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7)); return d; })();
const D = (n, plus = 0) => { const d = new Date(THU); d.setDate(d.getDate() + (n - 144) * 7 + plus); return iso(d); };
const WORD = (word, pos, pron, meaning, example, synonyms) => ({ word, pos, pron, meaning, example, synonyms });
const MEETINGS = [
  [139, D(139), 'Fresh Eyes', WORD('Tenacity', 'noun', 'tuh-NASS-ih-tee', 'Holding firmly to a goal despite difficulty.', 'Her tenacity carried the speech through a lost slide.', 'Persistence, Grit, Resolve')],
  [140, D(140), 'Small Wins', WORD('Rapport', 'noun', 'ra-POR', 'A comfortable, trusting connection between people.', 'He built rapport with the room in his first sentence.', 'Bond, Connection, Understanding')],
  [141, D(141), 'Do Your Homework', WORD('Momentum', 'noun', 'moh-MEN-tum', 'The force that keeps something moving once it has started.', 'Each rehearsal added momentum to the final speech.', 'Drive, Impetus, Progress')],
  [142, D(142), 'Know Yourself', WORD('Candid', 'adj.', 'KAN-did', 'Honest and direct, without hiding anything.', 'A candid evaluation is kind and specific.', 'Frank, Open, Straightforward')],
  [143, D(143), 'Standing Tall', WORD('Anchor', 'noun', 'ANG-ker', 'Something that keeps you steady and grounded.', 'Her opening story was the anchor for the whole speech.', 'Foundation, Mainstay, Support')],
  [144, D(144), 'Boundless Learning', WORD('Assiduous', 'adj.', 'uh-SIJ-oo-us', 'Showing steady, careful and persistent effort.', 'An assiduous speaker rehearses, welcomes feedback and returns to the lectern better each time.', 'Diligent, Studious, Persevering')],
  [145, D(145), 'Second Chances', WORD('Resilient', 'adj.', 'rih-ZIL-yent', 'Able to recover quickly after a setback.', 'A resilient speaker loses their place, smiles, and carries on.', 'Tough, Adaptable, Buoyant')],
  [146, D(146), 'Open Doors', WORD('', '', '', '', '', '')],
  [147, D(147), '', WORD('', '', '', '', '', '')],
];

const ROLE_DEFS = [
  ['toastmaster', 'Toastmaster of the Day'], ['grammarian', 'Grammarian'], ['ah_counter', 'Ah Counter'], ['timer', 'Timer'],
  ['topicsmaster', 'Topicsmaster'], ['speaker', 'Speaker 1'], ['speaker', 'Speaker 2'], ['speaker', 'Speaker 3'],
  ['general_evaluator', 'General Evaluator'], ['evaluator', 'Speech Evaluator 1'], ['evaluator', 'Speech Evaluator 2'], ['evaluator', 'Speech Evaluator 3'],
];
// [TM, Gram, Ah, Timer, TTM, S1, S2, S3, GE, E1, E2, E3]
const ASSIGN = {
  139: ['Omar Haddad', 'Marcus Cole', 'Jonah Adeyemi', 'Devon Park', 'Hannah Doyle', 'Aisha Bello', 'Tom Whitfield', '', 'Priya Raman', 'Marcus Cole', 'Ravi Menon', ''],
  140: ['Tom Whitfield', 'Aisha Bello', 'Devon Park', 'Hannah Doyle', 'Priya Raman', 'Marcus Cole', 'Omar Haddad', '', 'Jonah Adeyemi', 'Grace Liu', 'Lena Fischer', ''],
  141: ['Marcus Cole', 'Devon Park', 'Hannah Doyle', 'Lena Fischer', 'Omar Haddad', 'Aisha Bello', 'Priya Raman', '', 'Grace Liu', 'Tom Whitfield', 'Ravi Menon', ''],
  142: ['Priya Raman', 'Tom Whitfield', 'Ravi Menon', 'Omar Haddad', 'Grace Liu', 'Aisha Bello', 'Lena Fischer', '', 'Marcus Cole', 'Hannah Doyle', 'Sofia Marquez', ''],
  143: ['Omar Haddad', 'Priya Raman', 'Grace Liu', 'Sofia Marquez', 'Ravi Menon', 'Aisha Bello', 'Jonah Adeyemi', '', 'Lena Fischer', 'Devon Park', 'Hannah Doyle', ''],
  144: ['Devon Park', 'Priya Raman', 'Grace Liu', 'Ravi Menon', 'Hannah Doyle', 'Sofia Marquez', 'Jonah Adeyemi', 'Aisha Bello', 'Tom Whitfield', 'Marcus Cole', 'Lena Fischer', 'Jordan Ellis'],
};
const UPCOMING_SPEECH = { 144: [['Ice Breaker', 'The Long Way Round'], ['Researching and Presenting', 'Why Bees Need Weeds, Again'], ['Understanding Vocal Variety', 'Say It Louder']] };

// Aisha's real-looking history, per meeting
const AISHA = {
  139: { project: 'Ice Breaker', title: 'Three Doors', secs: 271,
    gram: [true, 'Warm, confident introduction.', '“Gonna” crept in twice', '“Going to” sounds sharper here.'],
    ah: [{ um: 7, ah: 2, so: 4, like: 2, but: 3, 'you know': 1 }, 'Plenty of ums while you were thinking. Pausing instead will help.'],
    time: 'Comfortably inside the Ice Breaker window.',
    ev: { r: [4, 3, 3, 2, 3, 2, 5], c: ['Easy to follow thanks to the three-doors structure.', '', '', 'Hands stayed clasped for most of it.', '', 'Nervous at the start, steadier by the second door.', 'The line about the stuck lift got the whole room.'],
      excelled: 'The three-doors structure made your story easy to follow, and the line about the stuck lift got the whole room.', work: 'Hands stayed clasped for most of the speech. Let them move when you describe something big.', challenge: 'Open with the moment itself, then step back to explain.' } },
  141: { project: 'Evaluation and Feedback', title: 'The Quiet Planner', secs: 441,
    gram: [false, 'Clear, plain language the whole way through.', 'The word of the day was not used', 'The word was available, so try slipping it in.'],
    ah: [{ um: 5, ah: 2, so: 3, like: 1, but: 2 }, 'Most fillers came in the first minute.'],
    time: 'Over by 21 seconds; the second example could go.',
    ev: { r: [3, 3, 4, 3, 3, 4, 4], c: ['', 'Even pace all the way; slow down before key lines.', 'Good with the left side, less with the right.', '', '', 'Settled quickly after the first minute.', 'The missed-train story did the heavy lifting.'],
      excelled: 'Honest, specific self-reflection. The story about the missed train showed your style better than any label could.', work: 'You ran 21 seconds over. Trim one example and slow down before the key line.', challenge: 'Speak to a style you find difficult, then tell us how it felt.' } },
  142: { project: 'Researching and Presenting', title: 'Why Bees Need Weeds', secs: 348,
    gram: [true, 'Strong opening metaphor about the kitchen table.', '“Less people”', '“Fewer people”'],
    ah: [{ um: 4, ah: 1, so: 2, like: 0, but: 0 }, 'Ums dropped by half. Try a silent pause before the story.'],
    time: 'Right in the green window the whole way.',
    ev: { r: [4, 3, 4, 3, 4, 3, 5], c: ['Sources named out loud made every claim land.', '', 'Eyes across the whole room, not just the front.', '', 'Slowed down when the room looked lost.', '', 'A surprising opening and a tidy close.'],
      excelled: 'Three sources, all named out loud, which made the claims land. Great eye contact across the whole room.', work: 'The middle section was dense. Cut the second statistic; it repeated the first.', challenge: 'Try one slide or a hand-out listing the sources.' } },
  143: { project: 'Effective Body Language', title: 'Standing Tall', secs: 372,
    gram: [true, '“Rooted in what you couldn’t control” is a lovely turn of phrase.', '“Me and my team was”', '“My team and I were”'],
    ah: [{ um: 2, ah: 0, so: 3, like: 0, but: 1, mmm: 1 }, 'Almost no ums in the opening. “So” crept in each time you changed topic.'],
    time: 'Landed in yellow, with the close well timed.',
    ev: { r: [4, 5, 5, 5, 3, 5, 4], c: ['', 'Pace and volume built to the ending.', 'Held each side of the room in turn.', 'Big and deliberate, never looked rehearsed.', 'Missed a few cues from the room while checking notes.', '', ''],
      excelled: 'Deliberate stage movement: you walked to a new spot each time the topic changed. Gestures were big and never looked rehearsed.', work: 'Your weight shifted foot to foot when you lost your place around the three-minute mark. A pause would have hidden it.', challenge: 'Deliver your next speech without notes and away from the lectern.' } },
};

// small deterministic RNG so the demo data is stable
const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const POOL_WORK = ['Slow down and let key sentences land.', 'Vary pace and volume, especially in the middle.', 'Look at the far side of the room more often.', 'Let your hands move when describing something big.', 'Check in with the room and pause for reactions.', 'Settle sooner; the first minute felt rushed.', 'Tighten the opening so the point arrives sooner.'];
const POOL_GOOD = ['A clear, memorable opening.', 'Strong variety in pace and tone.', 'Warm, steady eye contact.', 'Natural, confident gestures.', 'Read the room well.', 'Looked relaxed on stage.', 'The story kept everyone listening.'];
const POOL_GRAM = [['“Less”', '“Fewer”'], ['Tense shifted mid-story', 'Keep one tense through the story'], ['“Gonna” and “wanna”', 'Say “going to” and “want to”'], ['A run-on in the close', 'Break it into two sentences'], ['“Me and him”', '“He and I”']];
const TITLES = ['First Steps', 'The Garden Plan', 'Third Shift', 'Lost in Translation', 'Small Rooms', 'Second Wind', 'The Last Bus'];
const PORDER_INDEX = {};

export async function seedDemo() {
  await tx(async (t) => {
    await t('truncate peer_feedback, role_feedback, evaluations, timings, filler_counts, gram_notes, meeting_roles, meetings, projects, people, clubs restart identity cascade');
    const [club] = await t('insert into clubs(name) values ($1) returning id', ['Champions Toastmasters Club']);
    const proj = {};
    for (const p of PROJECTS) {
      const [r] = await t('insert into projects(name,level,path,form_title,length_text,green,yellow,red,purpose,notes,about,code) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id',
        [p[0], p[1], 'Presentation Mastery', p[2], p[3], p[4][0], p[4][1], p[4][2], JSON.stringify(p[5]), p[6], JSON.stringify(p[7]), CODES[p[0]] || '']);
      proj[p[0]] = { id: r.id, g: p[4] };
    }
    const person = {};
    const addPerson = async (name, kind, status, extra = {}) => {
      const [r] = await t('insert into people(club_id,name,email,kind,status,is_vpe,token,created_via,temp_until,credential) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id',
        [club.id, name, extra.email ?? email(name), kind, status, !!extra.vpe, token(), extra.via || 'seed', extra.until || null, kind === 'member' ? 'TM' : '']);
      person[name] = r.id; return r.id;
    };
    for (const m of MEMBERS) await addPerson(m, 'member', 'active', { vpe: m === 'Devon Park' });
    await addPerson('Jordan Ellis', 'guest', 'temporary', { email: 'jordan.ellis@mail.com', until: D(144, 30) });

    const mtg = {}, roles = {};
    for (const [n, date, theme, w] of MEETINGS) {
      const [m] = await t('insert into meetings(club_id,number,date,theme,word,pos,pron,meaning,example,synonyms,feedback_code,theme_quote,theme_quote_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id',
        [club.id, n, date, theme, w.word, w.pos, w.pron, w.meaning, w.example, w.synonyms, token().slice(0, 10), n === 144 ? 'There’s no end to educating oneself.' : '', n === 144 ? 'Navi Pillay' : '']);
      mtg[n] = m.id; roles[n] = [];
      for (let i = 0; i < ROLE_DEFS.length; i++) {
        const [key, label] = ROLE_DEFS[i];
        const who = (ASSIGN[n] || [])[i] || null;
        const up = UPCOMING_SPEECH[n]?.[i - 5];
        const past = n < 144;
        let project = null, title = '', kIdx = 0;
        if (key === 'speaker' && who) {
          if (up) { project = proj[up[0]].id; title = up[1]; }
          else if (past) {
            const a = who === 'Aisha Bello' ? AISHA[n] : null;
            if (a) { project = proj[a.project].id; title = a.title; }
            else {
              const k = (PORDER_INDEX[who] = (PORDER_INDEX[who] ?? -1) + 1); kIdx = k;
              project = proj[PORDER[Math.min(k, 4)]].id; title = TITLES[(k + n) % TITLES.length];
            }
          }
        }
        const [r] = await t('insert into meeting_roles(meeting_id,role_key,label,position,person_id,project_id,speech_title,token) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id',
          [m.id, key, label, i, who ? person[who] : null, project, title, token()]);
        roles[n].push({ id: r.id, key, label, who, project, idx: kIdx });
      }
      // evaluators target speakers
      const R = roles[n];
      const tgt = [[9, 5], [10, 6], [11, 7]];
      for (const [e, s] of tgt) await t('update meeting_roles set target_role_id=$1 where id=$2', [R[s].id, R[e].id]);
    }

    // ---- history for past meetings ----
    for (const [n] of MEETINGS.filter((m) => m[0] < 144)) {
      const R = roles[n], M = mtg[n], gram = R[1], ah = R[2], timer = R[3];
      const speakers = [R[5], R[6]].filter((r) => r.who);
      for (const sp of speakers) {
        const subject = person[sp.who];
        const aisha = sp.who === 'Aisha Bello' ? AISHA[n] : null;
        const R2 = rng(subject * 97 + n * 13);
        const idx = sp.idx;
        const base = 2.7 + Math.min(idx, 4) * 0.25 + R2() * 0.7, weak = Math.floor(R2() * 7), strong = (weak + 3) % 7;
        const ratings = aisha ? aisha.ev.r : Array.from({ length: 7 }, (_, k) => Math.max(1, Math.min(5, Math.round(base + (R2() - 0.5) * 1.4 - (k === weak ? 1.1 : 0) + (k === strong ? 0.7 : 0)))));
        const comments = aisha ? aisha.ev.c : ratings.map((v, k) => (k === weak && v <= 3 ? POOL_WORK[k] : v >= 5 ? POOL_GOOD[k] : ''));
        const pj = PROJECTS.find((p) => proj[p[0]].id === sp.project) || PROJECTS[0];
        const gtriple = aisha ? aisha.gram : (() => { const g = POOL_GRAM[Math.floor(R2() * 5)]; return [R2() > 0.5, POOL_GOOD[strong], g[0], g[1]]; })();
        await t('insert into gram_notes(role_id,meeting_id,subject_id,used_word,liked,improper,suggestion) values ($1,$2,$3,$4,$5,$6,$7)', [gram.id, M, subject, gtriple[0], gtriple[1], gtriple[2], gtriple[3]]);
        const tot = Math.max(2, Math.round((14 - Math.min(idx, 4) * 2.5) * (0.7 + R2() * 0.6)));
        const counts = aisha ? aisha.ah[0] : { um: Math.round(tot * 0.5), ah: Math.round(tot * 0.2), so: Math.round(tot * 0.2), like: Math.round(tot * 0.1) };
        await t('insert into filler_counts(role_id,meeting_id,subject_id,counts,comment) values ($1,$2,$3,$4,$5)', [ah.id, M, subject, JSON.stringify(counts), aisha ? aisha.ah[1] : '']);
        const secs = aisha ? aisha.secs : Math.round(300 + (R2() - 0.35) * 160);
        const g = pj[4];
        if (!(n === 143 && timer.who)) {
          await t('insert into timings(role_id,meeting_id,subject_id,kind,label,seconds,green,yellow,red,project_id,comment) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
            [timer.id, M, subject, 'Speaker', sp.label, secs, g[0], g[1], g[2], sp.project, aisha ? aisha.time : '']);
        }
        const ev = R[sp.label === 'Speaker 1' ? 9 : 10];
        const e = aisha ? aisha.ev : { excelled: POOL_GOOD[strong], work: POOL_WORK[weak], challenge: 'Try the same speech with one less note card.' };
        await t('insert into evaluations(role_id,meeting_id,speaker_id,project_id,title,ratings,comments,excelled,work,challenge,seconds) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [ev.id, M, subject, sp.project, aisha ? aisha.title : (TITLES[(sp.idx + n) % TITLES.length]), JSON.stringify(ratings), JSON.stringify(comments), e.excelled, e.work, e.challenge, secs]);
      }
      // the General Evaluator comments on each role player
      const ge = R[8];
      if (ge.who) {
        const target = [[1, 'Introduced the word with energy and gave specific examples.', 'Give the grammar report a little sooner.'],
          [2, 'Clear explanation of what counts as a filler.', 'Keep the report to under a minute.'],
          [3, 'Cards were raised on time and held up clearly.', 'Explain the card colours more slowly for visitors.'],
          [4, 'Called on people without a role first, as good practice.', 'Give visitors a gentler topic to start.'],
          [9, 'Opened with a warm thank you and a clear structure.', 'Finish inside the three minutes.'],
          [0, 'Set the theme well and kept the energy up.', 'Introduce the next role player by name sooner.']];
        for (const [idx, well, improve] of target) if (R[idx].who) await t('insert into role_feedback(meeting_id,author_role_id,target_role_id,well,improve) values ($1,$2,$3,$4,$5)', [M, ge.id, R[idx].id, well, improve]);
      }
      // room feedback from the QR code
      const ROOM = [['Hannah', 'You made the opening feel like a conversation.', 'Slow down a little in the middle.'], ['A visitor', 'I remembered the story a day later.', ''], ['Omar', 'Great energy and clear structure.', 'Look at the back of the room more.']];
      let k = 0;
      for (const sp of speakers) for (const [from, well, improve] of ROOM.slice(0, 2 + (k++ % 2))) await t('insert into peer_feedback(meeting_id,to_person_id,from_name,well,improve) values ($1,$2,$3,$4,$5)', [M, person[sp.who], from, well, improve]);
      // everyone with a feedback role has submitted, apart from the 143 timer
      for (const r of R) {
        if (!r.who || !['grammarian', 'ah_counter', 'timer', 'topicsmaster', 'general_evaluator', 'evaluator'].includes(r.key)) continue;
        if (n === 143 && r.key === 'timer') continue;
        await t('update meeting_roles set submitted_at = now() - interval \'3 days\' where id=$1', [r.id]);
      }
    }
  });
}

export async function seedWithSchedule() { await seedDemo(); await applySchedule(); await importPathways(); }

export async function seedIfEmpty() {
  const [r] = await q('select count(*)::int as n from clubs');
  if (!r.n) { await seedWithSchedule(); return true; }
  return false;
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const kind = await initDb();
  await seedWithSchedule();
  console.log(`Seeded demo data into ${kind}.`);
  process.exit(0);
}
