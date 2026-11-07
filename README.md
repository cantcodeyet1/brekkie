# Brekkie

*Feedback is the breakfast of Champions.* A feedback portal for Champions Toastmasters Club.

Role players log notes during the meeting. Members open Brekkie afterwards and find their feedback waiting, per role and per speech, with the evaluation as a downloadable PDF that follows the Pathways form. The VPE runs the club from the same app.

**Stack:** React (Vite) · Express · Postgres on Neon.

```
client/      React app (phone and desktop layouts from one codebase)
server/      Express API, schema.sql, demo seed
prototype/   The original clickable artboards, kept for reference
```

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:5174. With no `DATABASE_URL`, the API uses an embedded Postgres stored in `server/.pglite` and loads fake data for Champions on first start, so it works with nothing else set up. The sign-in page lists demo people and role links to try.

Reset the demo data at any time with `npm run seed` (stop the API first).

## Use Neon

1. Create a Neon project and copy its connection string.
2. `cp .env.example .env` and set `DATABASE_URL=postgres://...`.
3. Start the app. The schema is created automatically (`server/src/schema.sql` is idempotent).
4. Optional: load the demo data into Neon with `npm run seed`. For real use set `DEMO_MODE=false`, which turns off the demo picker and auto-seeding.

## Production

```bash
npm run build     # builds client/dist
npm start         # Express serves the API and the built client on PORT (default 3001)
```

## How people get in

There are no passwords. Everyone arrives through a link the VPE shares:

| Who | Link | Gives access to |
| --- | --- | --- |
| Member | `/s/<token>` (VPE copies it from People) | Their own history and evaluations |
| VPE | `/s/<token>` | Everything below, plus meetings, roles, people |
| Role player | `/r/<token>` (one per role per meeting, from Meetings, Links) | That one role's sheet for that one meeting |

Reassigning a role issues a new link and the previous one stops working. Role links work for visitors too.

## Feedback beyond the sheets

- **Simple member area.** Three places only: Home, Meetings, Speeches. Home shows one thing to work on, the latest meeting, and big tiles to look back. Each meeting page gathers everything from that evening in plain language.
- **General Evaluator comments on every role.** The GE sheet has a card per role player (Toastmaster, Grammarian, Ah Counter, Timer, Topicsmaster, Speech Evaluators). Each person sees it under the role they played.
- **Room feedback by QR code.** Each meeting has a QR code and link (VPE: Meetings, open a meeting, Received tab on a phone or the Room feedback section on desktop). Anyone scans it, optionally gives a name, taps the people they want to write to, and writes what went well and what to try. Recipients see it under that meeting and in From the room. The VPE can hide a comment, and print a poster. When the VPE is on `localhost`, the QR uses the computer's network address so phones can reach it.

## Agenda

The VPE opens a meeting and taps **Create the agenda**. Brekkie fills the club's own Word template (`server/templates/agenda.docx`) with that meeting's date, theme and quotation, word of the day, role takers, prepared speeches (project, title, length, evaluator) and running order, then downloads it as a **PDF** (or the editable `.docx`). The PDF is made by converting the filled Word file, so it keeps the template's exact layout. This needs LibreOffice on the server (set `SOFFICE_PATH` if it is not on the PATH), or Microsoft Word on a Windows machine; without either, the Word download still works.

- Everything is editable on the Agenda page. Roles, speakers and evaluators flow in from the meeting and stay in step unless the VPE overrides them. Only the changes are stored.
- Changing the start time moves the whole running order. **Recalculate times** puts times back in step after manual edits.
- The club mission, officers and the banner stay exactly as they are in the template. To change them, edit the template file. The agenda title shown after a name (TM, DTM) is set per person.
- The project codes (L2P2 and so on) are stored on each project and can be overridden per speech on the Agenda page.

## Visitors (non-members as role players)

Anyone outside the club can take a role. They are stored as **visitors**: `kind = guest`, `status = temporary`, with the same `club_id` as every member, so everything they record (and everything recorded about them) is housed under Champions.

- The VPE adds a visitor from **People**, or straight from any role dropdown (**+ Add a visitor**).
- Role players can add a visitor from inside their own sheet when they need to log someone who is not listed. These are flagged "Added from a sheet" so the VPE can review them.
- Visitors get temporary access (30 days, extendable). The VPE can **Make member**, **Extend**, or **Archive**. Archiving hides them from dropdowns but never deletes data.
- Converting a visitor to a member keeps all of their history.

## Data model

`clubs` → `people` (member or visitor) and `meetings` → `meeting_roles` (one per role per meeting, each with its own link token). Role sheets are normalised into `gram_notes`, `filler_counts`, `timings` and `evaluations`, which is what members and the VPE read their history from. `projects` holds the Pathways projects with purpose, evaluator notes and timer cards.

## Brand

Loyal Blue `#004165`, True Maroon `#772432`, Happy Yellow `#F2DF74`, Cool Gray `#A9B2B1`, in Montserrat and Source Sans 3. Dropdowns are a custom component (`client/src/ui.jsx`, `Select` and `PersonSelect`); there are no native `<select>` elements.
