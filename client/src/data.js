// Static reference content: the evaluation criteria, role scripts, checklist, timer cards.
export const CRIT = [
  ['Clarity', 'Spoken language is clear and is easily understood', ['Unclear or not easily understood', 'Somewhat unclear or challenging to follow', 'Clear and easily understood', 'Excels at communicating with the spoken word', 'Exemplary speaker who is always understood']],
  ['Vocal Variety', 'Uses tone, speed, and volume as tools', ['Ineffective use of tone, speed and volume', 'Use of tone, speed and volume needs practice', 'Uses tone, speed and volume as tools', 'Excels at using tone, speed and volume', 'Uses tone, speed and volume to perfection']],
  ['Eye Contact', 'Effectively uses eye contact to engage audience', ['Little or no eye contact', 'Eye contact needs improvement', 'Effectively engages the audience', 'Gauges audience reaction through eye contact', 'Conveys emotion and draws a response']],
  ['Gestures', 'Uses physical gestures effectively', ['Very distracting gestures, or none', 'Limited or somewhat distracting gestures', 'Uses gestures effectively', 'Uses gestures to enhance the speech', 'Gestures fully integrated with content']],
  ['Audience Awareness', 'Demonstrates awareness of audience engagement and needs', ['Little or no attempt to engage', 'Awareness of audience needs more practice', 'Aware of audience engagement and needs', 'Fully aware and responds effectively', 'Engages completely and anticipates needs']],
  ['Comfort Level', 'Appears comfortable with the audience', ['Highly uncomfortable', 'Uncomfortable', 'Comfortable', 'Fully at ease', 'Completely self-assured']],
  ['Interest', 'Engages audience with interesting, well-constructed content', ['Neither interesting nor well constructed', 'Interesting or well constructed, not both', 'Interesting, well-constructed content', 'Highly compelling, well-constructed content', 'Exemplary, well-constructed content']],
];
export const LEVELN = { 5: 'Exemplary', 4: 'Excels', 3: 'Accomplished', 2: 'Emerging', 1: 'Developing' };
export const DEFAULT_FILLERS = [['ah', 'Ah'], ['um', 'Um'], ['er', 'Er'], ['well', 'Well'], ['so', 'So'], ['like', 'Like'], ['but', 'But'], ['repeats', 'Repeats'], ['other', 'Other']];
export const TIMER = { Speaker: [300, 360, 420], 'Table Topics': [60, 90, 120], Evaluator: [120, 150, 180] };
export const CARDTXT = { under: 'Under time', green: 'Green card', yellow: 'Yellow card', red: 'Red card · over' };

export const secs = (t) => { const m = /^(\d+):(\d{1,2})$/.exec((t || '').trim()); return m ? +m[1] * 60 + +m[2] : null; };
export const mmss = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
export const cardOf = (s, [g, y, r]) => (s == null ? null : s >= r ? 'red' : s >= y ? 'yellow' : s >= g ? 'green' : 'under');
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const sum = (c, keys) => Object.entries(c || {}).reduce((a, [k, v]) => a + (!keys || keys.includes(k) ? +v || 0 : 0), 0);
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export const fmtDate = (iso, opt = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', opt).replace(',', '');
export const longDate = (iso) => fmtDate(iso, { day: 'numeric', month: 'short', year: 'numeric' });

export const ROLE_META = {
  grammarian: { name: 'Grammarian', blurb: 'Introduce the word of the day, then log language you liked and language to polish, person by person.' },
  ah_counter: { name: 'Ah Counter', blurb: 'Tap to count filler words as you hear them, and add any of your own.' },
  timer: { name: 'Timer', blurb: 'Start the timer for each person. The screen turns green, yellow, then red by itself.' },
  topicsmaster: { name: 'Topicsmaster', blurb: 'Your script, the theme, and a log of who spoke on which topic.' },
  evaluator: { name: 'Speech Evaluator', blurb: 'Your speaker’s project, objectives and the evaluation form, in one place.' },
  general_evaluator: { name: 'General Evaluator', blurb: 'Your script and the meeting checklist, section by section.' },
  toastmaster: { name: 'Toastmaster', blurb: '' },
  speaker: { name: 'Speaker', blurb: '' },
};
export const FEEDBACK_ROLES = ['grammarian', 'ah_counter', 'timer', 'topicsmaster', 'evaluator', 'general_evaluator'];

/* scripts: [label, text]. {w} word, {m} meaning, {x} example, {s} speaker, {t} title */
export const SCRIPTS = {
  grammarian: [['When introduced by the Toastmaster', '“Mr./Madam Toastmaster, fellow Toastmasters, and guests. As Grammarian, it is my responsibility to pay close attention to all speakers, listening carefully to their language usage. I’ll take note of any misuses of the English language, as well as any outstanding words, quotes, sayings, or thoughts. As Grammarian, it is also my duty to introduce the Word of the Day. For today’s meeting, the Word is {w}, which means {m}. [Display the Word of the Day at the front of the room.] An example of using the word is: {x}. Each speaker is encouraged to use the Word of the Day. I will give a Word of the Day report and grammatical usage report when called upon during the meeting. Thank you, Mr./Madam Toastmaster.”']],
  ah_counter: [['When introduced by the Toastmaster', '“Greetings Mr./Madam Toastmaster, fellow Toastmasters, and guests. The purpose of the Ah-Counter is to note words and sounds that are used as a “crutch” or “pause filler” by anyone who speaks. During the meeting, I will listen for overused words, including and, well, but, so, and you know. I will also listen for filler sounds, including ah, um, and er. I will also note when a speaker repeats a word or phrase, such as “I, I” or “This means, this means.” At the end of the meeting, I will report the number of times that each speaker used these expressions. Thank you, Mr./Madam Toastmaster.”']],
  timer: [['When introduced by the Toastmaster', '“Greetings Mr./Madam Toastmaster, fellow Toastmasters, and guests. As Timer, I will time the Table Topics speakers, formal speeches, and the evaluations. I will also alert each speaker of the time they have left, using the green, yellow, and red cards, which denote specific times remaining.”'],
    ['Table Topics', 'Speakers should limit their remarks to no more than 2 minutes. At 1 minute, I will raise the green card. At 1 minute and 30 seconds, the yellow card. At 2 minutes, the red card.'],
    ['Speeches', 'Ice Breaker speeches should be 4 to 6 minutes: green at 4, yellow at 5, red at 6. Most other speeches should be 5 to 7 minutes: green at 5, yellow at 6, red at 7.'],
    ['Evaluations', 'Individual evaluations should be between 2 and 3 minutes. At 2 minutes, I will raise the green card. At 2 minutes and 30 seconds, the yellow card. At 3 minutes, the red card. Thank you Mr./Madam Toastmaster.']],
  topicsmaster: [['When introduced by the Toastmaster', '“Greetings Mr./Madam Toastmaster, fellow Toastmasters, and guests. The purpose of the Topicsmaster is to facilitate Table Topics, where guests and members will have the opportunity to practice their impromptu speaking. I will introduce a topic and call on speakers, who will be given two minutes to speak on the subject. Thank you Mr./Madam Toastmaster.”']],
  evaluator: [['When introduced by the Toastmaster', '“Greetings Mr./Madam Toastmaster, fellow Toastmasters, and guests. The purpose of the Speech Evaluator is to give a speaker positive, constructive feedback that helps them grow. I will be evaluating {s}, for the speech “{t}”. I will share what worked, one or two things to work on, and a way to challenge themselves. Thank you, Mr./Madam Toastmaster.”']],
  general_evaluator: [['When introduced by the Toastmaster', '“Greetings Mr./Madam Toastmaster, fellow Toastmasters, and guests. The purpose of the General Evaluator is to evaluate everything that takes place throughout the meeting. During the meeting, I will take notes on everything that happens and doesn’t happen. I will evaluate each participant on the meeting program and look for good examples of preparation, organization, delivery, enthusiasm, observation, and performance of duties. At the end of the meeting, I will give my report. Thank you, Mr./Madam Toastmaster.”']],
};

export const GE_SECTIONS = [
  ['Before the meeting', ['Was the room and equipment set up on time?', 'Were guests welcomed upon arrival?', 'Were guests informed about Toastmasters and the meeting format?']],
  ['Meeting opening', ['Was the presiding officer prepared and organized?', 'Did the meeting start on time?', 'Was everyone properly introduced?', 'Was the Toastmaster properly introduced?']],
  ['Toastmaster', ['Did the Toastmaster fill all roles prior to the meeting starting?', 'Did the Toastmaster introduce and explain the meeting’s theme?', 'Did the Toastmaster introduce the General Evaluator?', 'Did the Toastmaster properly introduce the Topicsmaster?']],
  ['General Evaluator', ['Did the General Evaluator properly introduce the Grammarian?', 'Was the Grammarian prepared and did they introduce their role within the allotted time?', 'Did the Grammarian properly introduce the Word of the Day?', 'Was the Word of the Day challenging, appropriate, and fitting for the theme of the meeting?', 'Did the General Evaluator properly introduce the Timer?', 'Was the Timer prepared and did they introduce their role within the allotted time?', 'Did the General Evaluator properly introduce the Ah-Counter?', 'Was the Ah-Counter prepared and did they introduce their role within the allotted time?', 'Was the General Evaluator’s report given?']],
  ['Topicsmaster', ['Was the purpose and timing of Table Topics properly explained?', 'Was the topic selected appropriate and did it fit the meeting theme?', 'Did the Topicsmaster call on people who did not have a meeting role first during Table Topics?', 'Were guests invited to participate?', 'Did the Topicsmaster track time to ensure the meeting stayed on schedule?', 'Was control properly returned to the Toastmaster?']],
];
