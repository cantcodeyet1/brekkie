-- Brekkie schema. Idempotent: safe to run on every start.
-- Every row hangs off a club, so a guest's data is housed under Champions like everyone else's.

create table if not exists clubs (
  id serial primary key,
  name text not null
);

create table if not exists people (
  id serial primary key,
  club_id int not null references clubs(id),
  name text not null,
  email text,
  kind text not null default 'member' check (kind in ('member','guest')),
  status text not null default 'active' check (status in ('active','temporary','inactive')),
  is_vpe boolean not null default false,
  token text not null unique,
  created_via text not null default 'vpe',      -- vpe | role_sheet | seed
  temp_until date,                               -- guests: when the temporary status lapses
  note text,
  created_at timestamptz not null default now(),
  converted_at timestamptz
);
create index if not exists people_club_idx on people(club_id, kind, status);

create table if not exists projects (
  id serial primary key,
  name text not null unique,
  level int not null,
  path text not null,
  form_title text not null,
  length_text text not null,
  green int not null, yellow int not null, red int not null,
  purpose jsonb not null default '[]',
  notes text not null default '',
  about jsonb not null default '[]'
);

create table if not exists meetings (
  id serial primary key,
  club_id int not null references clubs(id),
  number int not null,
  date date not null,
  theme text not null default '',
  word text not null default '',
  pos text not null default '',
  pron text not null default '',
  meaning text not null default '',
  example text not null default '',
  synonyms text not null default '',
  unique (club_id, number)
);

create table if not exists meeting_roles (
  id serial primary key,
  meeting_id int not null references meetings(id) on delete cascade,
  role_key text not null,
  label text not null,
  position int not null,
  person_id int references people(id),
  project_id int references projects(id),
  speech_title text not null default '',
  target_role_id int references meeting_roles(id) on delete set null,   -- evaluators: which speaker
  token text not null unique,
  sheet jsonb not null default '{}',
  submitted_at timestamptz
);
create index if not exists roles_meeting_idx on meeting_roles(meeting_id);
create index if not exists roles_person_idx on meeting_roles(person_id);

create table if not exists gram_notes (
  id serial primary key,
  role_id int not null references meeting_roles(id) on delete cascade,
  meeting_id int not null references meetings(id) on delete cascade,
  subject_id int not null references people(id),
  used_word boolean not null default false,
  liked text not null default '',
  improper text not null default '',
  suggestion text not null default ''
);
create index if not exists gram_subject_idx on gram_notes(subject_id);

create table if not exists filler_counts (
  id serial primary key,
  role_id int not null references meeting_roles(id) on delete cascade,
  meeting_id int not null references meetings(id) on delete cascade,
  subject_id int not null references people(id),
  counts jsonb not null default '{}',
  comment text not null default ''
);
create index if not exists filler_subject_idx on filler_counts(subject_id);

create table if not exists timings (
  id serial primary key,
  role_id int not null references meeting_roles(id) on delete cascade,
  meeting_id int not null references meetings(id) on delete cascade,
  subject_id int not null references people(id),
  kind text not null,                  -- Speaker | Table Topics | Evaluator | Other
  label text not null default '',
  seconds int,
  green int not null, yellow int not null, red int not null,
  project_id int references projects(id),
  comment text not null default ''
);
create index if not exists timings_subject_idx on timings(subject_id);

create table if not exists evaluations (
  id serial primary key,
  role_id int not null references meeting_roles(id) on delete cascade,
  meeting_id int not null references meetings(id) on delete cascade,
  speaker_id int not null references people(id),
  project_id int not null references projects(id),
  title text not null default '',
  ratings jsonb not null default '[]',
  comments jsonb not null default '[]',
  excelled text not null default '',
  work text not null default '',
  challenge text not null default '',
  seconds int
);
create index if not exists eval_speaker_idx on evaluations(speaker_id);

-- General Evaluator comments on each role player at a meeting
create table if not exists role_feedback (
  id serial primary key,
  meeting_id int not null references meetings(id) on delete cascade,
  author_role_id int not null references meeting_roles(id) on delete cascade,
  target_role_id int not null references meeting_roles(id) on delete cascade,
  well text not null default '',
  improve text not null default ''
);
create index if not exists rolefb_target_idx on role_feedback(target_role_id);

-- Room feedback: anyone at the meeting scans the QR code and writes to the people they choose
alter table meetings add column if not exists feedback_code text;
update meetings set feedback_code = substr(md5(random()::text || id::text), 1, 10) where feedback_code is null;
create unique index if not exists meetings_code_idx on meetings(feedback_code);

create table if not exists peer_feedback (
  id serial primary key,
  meeting_id int not null references meetings(id) on delete cascade,
  to_person_id int not null references people(id),
  from_name text not null default '',
  well text not null default '',
  improve text not null default '',
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists peer_to_idx on peer_feedback(to_person_id);

-- Agenda creation: the club's Word template is filled from these
alter table meetings add column if not exists theme_quote text not null default '';
alter table meetings add column if not exists theme_quote_by text not null default '';
alter table meetings add column if not exists agenda jsonb not null default '{}';
alter table people add column if not exists credential text not null default '';
alter table projects add column if not exists code text not null default '';
insert into projects(name,level,path,form_title,length_text,green,yellow,red,purpose,notes,about) values
 ('Understanding Your Communication Style',2,'Presentation Mastery','Understanding Your Communication Style','5–7 minutes',300,360,420,
  '["Learn how your own style shapes the way you speak and listen.","The speaker practises adapting delivery to different styles."]',
  'Look for self-awareness and for how well the speaker adapted to the audience.',
  '["Identify the speaker''s own communication style","Look for a deliberate change of approach","Suggest how to apply it next time"]')
 on conflict (name) do nothing;
update projects set code='L1P1' where name='Ice Breaker' and code='';
update projects set code='L1P2' where name='Evaluation and Feedback' and code='';
update projects set code='L1P3' where name='Researching and Presenting' and code='';
update projects set code='L2P1' where name='Understanding Your Communication Style' and code='';
update projects set code='L2P2' where name='Effective Body Language' and code='';
update projects set code='L2P3' where name='Introduction to Vocal Variety' and code='';

-- Meeting roster: attendance is recorded per meeting
alter table meetings add column if not exists attendance int;

-- Pathways catalog: which projects sit in which path and level
alter table projects add column if not exists overview text not null default '';
alter table projects add column if not exists description text not null default '';
create table if not exists path_projects (
  id serial primary key,
  path text not null,
  level int not null,
  level_title text not null default '',
  kind text not null default 'required',     -- required | elective
  pos int not null,                           -- position within the level: L2P2 means level 2, position 2
  choose int not null default 0,              -- how many electives the level asks for
  project_id int not null references projects(id) on delete cascade,
  unique (path, level, project_id)
);
create index if not exists path_projects_idx on path_projects(path, level);
alter table meeting_roles add column if not exists path_name text;
alter table meeting_roles add column if not exists path_level int;
alter table evaluations add column if not exists path_name text;
alter table evaluations add column if not exists path_level int;

-- accounts and many clubs: each club has a join code and a meeting pattern; people can sign in with email and password
alter table clubs add column if not exists pattern jsonb;
alter table clubs add column if not exists join_code text;
alter table clubs add column if not exists created_at timestamptz not null default now();
create unique index if not exists clubs_join_code_idx on clubs(join_code) where join_code is not null;
alter table people add column if not exists password_hash text;
create index if not exists people_email_idx on people(lower(email));

-- word of the day origin (etymology)
alter table meetings add column if not exists origin text not null default '';

-- a member's Pathways path and level, used to fill in their speaker slots
alter table people add column if not exists path_name text;
alter table people add column if not exists path_level int;

-- a guest who asked to join the club
alter table people add column if not exists join_requested_at timestamptz;

-- the role is Toastmaster of the Day
update meeting_roles set label='Toastmaster of the Day' where role_key='toastmaster' and label='Toastmaster';

-- projects a member has finished, marked by the VPE (a speech on the agenda is not always delivered)
create table if not exists member_projects (
  person_id int not null references people(id) on delete cascade,
  project_id int not null references projects(id) on delete cascade,
  done_at date not null default current_date,
  primary key (person_id, project_id)
);

alter table people add column if not exists phone text;
-- the electives a member has chosen for their level (they pick as many as the level asks for)
create table if not exists member_electives (
  person_id int not null references people(id) on delete cascade,
  project_id int not null references projects(id) on delete cascade,
  primary key (person_id, project_id)
);

-- club settings: how long a guest keeps access, where and when the club meets
alter table clubs add column if not exists guest_days int not null default 30;
alter table clubs add column if not exists venue text not null default '';
alter table clubs add column if not exists meeting_time text not null default '';

-- how many times the word of the day was used
alter table gram_notes add column if not exists word_uses int not null default 0;

-- speeches a member plans to give, at this club or another (empty venue means this club)
create table if not exists speech_plans (
  id serial primary key,
  club_id int not null references clubs(id) on delete cascade,
  person_id int not null references people(id) on delete cascade,
  project_id int references projects(id) on delete set null,
  title text not null default '',
  date date not null,
  venue text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists speech_plans_idx on speech_plans(club_id, date);

-- where a manually finished project was given (empty means at this club)
alter table member_projects add column if not exists venue text not null default '';

-- a planned speech that has been marked done stays on the calendar, shown as done
alter table speech_plans add column if not exists done boolean not null default false;
alter table people add column if not exists reset_token text;
alter table people add column if not exists reset_expires timestamptz;
alter table clubs add column if not exists tm_number text;
create unique index if not exists clubs_tm_number_idx on clubs(tm_number) where tm_number is not null;
alter table people add column if not exists invited_at timestamptz;
alter table people add column if not exists last_login_at timestamptz;
