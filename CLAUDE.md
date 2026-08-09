# Instructions for Claude — Reception Seating Chart Deployment

You're being handed a finished, working project folder. Your job is to help
the human finish deploying it — **not** to redesign, rewrite, or "improve"
the app itself. If something looks unusual (inline event listeners, a
single-file structure, etc.), that's intentional; leave the app code as-is
unless the human explicitly asks you to change it.

## What this project is

A collaborative, realtime wedding reception seating chart. Two people (this
human and their fiancé) drag guest names into tables and see each other's
changes live. It's a static site (`index.html` + `app.js` + `style.css` +
`guests.js`) backed by Firebase Realtime Database, meant to be hosted for
free on GitHub Pages.

Files in this folder:
- `index.html` — page structure
- `style.css` — styling
- `app.js` — all app logic (drag/drop, Firebase sync, presence, activity feed)
- `guests.js` — the 322-person reception guest list with meal choices
- `firebase-config.js` — **placeholder keys**, needs real ones (see below)
- `README.md` — full human-readable setup guide (read this too)

## What is already done

- All app code is complete and tested (syntax-checked, logic reviewed).
- Nothing needs to be coded. This is a deployment task, not a dev task.

## What is NOT done yet (you need to help with this)

1. **A Firebase project needs to exist**, and `firebase-config.js` needs real
   keys in it. Creating the Firebase project itself requires a human to sign
   into console.firebase.google.com with a Google account — you can't do
   this step for them. Walk them through README.md section 1 interactively:
   tell them exactly what to click, and when they paste back the config
   object Firebase gives them, edit `firebase-config.js` to insert the real
   values in place of the `PASTE_YOUR_...` placeholders.

2. **Realtime Database rules** need to be set to test mode initially, then
   ideally updated to the explicit `{ ".read": true, ".write": true }` rule
   shown in README.md section 1 (test mode auto-expires after 30 days —
   the explicit rule doesn't). Remind them of this; you can't do it for them
   since it's inside the Firebase console UI.

3. **Push this folder to a new GitHub repository.** If `git` and `gh` (GitHub
   CLI) are available and the human is authenticated, you can likely do this
   whole step yourself:
   ```bash
   cd <this folder>
   git init
   git add .
   git commit -m "Initial seating chart app"
   gh repo create <name-they-choose> --private --source=. --push
   ```
   If `gh` isn't installed or they're not authenticated, guide them through
   creating the repo manually on github.com and give them the `git remote
   add` + `git push` commands instead. Ask them whether they want the repo
   public or private before running this — private is safer since
   `firebase-config.js` will contain their real (if low-stakes) API keys.

4. **Enable GitHub Pages.** If you have `gh` available:
   ```bash
   gh api repos/<owner>/<repo>/pages -X POST -f "source[branch]=main" -f "source[path]=/"
   ```
   Otherwise tell them: repo → Settings → Pages → Source: Deploy from a
   branch → `main` → `/ (root)` → Save. Then give them the resulting
   `https://<username>.github.io/<repo>/` URL — that's the link both of
   them will use.

5. **Sanity check before handing back the URL.** Open the deployed URL
   yourself if you have browser/fetch access, or ask the human to open it
   and confirm: the name prompt appears, and after entering a name the
   board loads with an "Unassigned Guests" count near 322 (or the current
   total). If it instead shows the "One setup step left" message, the
   Firebase keys weren't saved correctly — double check `firebase-config.js`
   was actually committed and pushed (not still holding placeholder text).

## Guardrails

- Don't regenerate `guests.js` from scratch — if the guest list needs
  updating later, that's a separate task the human will bring a new RSVP
  export for.
- Don't change the Firebase data model (`seatingChart/tables/{id}`,
  `presence/{clientId}`, `activity/{pushId}`) — the app's read/write logic
  in `app.js` depends on these exact paths.
- If asked to add features, that's fine — just don't silently refactor
  working code while doing routine deployment.

---

## The room map (added in v21)

`floorplan.js` draws the real venue floor plan — room outline, walls, bars,
columns, doors, stairs — traced from the venue's Room Viewer PDF. It is the
same geometry the reception-plan app uses (christal-yesudasan-reception.web.app),
copied rather than imported because this app has no build step.

- `tablePos/{id}` holds positions in SVG user units, ~4.66 per foot. The older
  `tableMap/{id}` (0–1 fractions of the previous sketch canvas) is dead but
  kept as a backup — **the two are not interchangeable.**
- `floorplan.js` touches no Firebase and no app state on purpose: `draw()`
  takes a plain array and reports changes through callbacks. Keep it that way
  so the geometry can stay shared with the other app instead of forking.
- Table numbers now follow the room (top to bottom, left to right) rather than
  the order tables were created in. That number feeds the list view, the
  meal-count download and the guest-list export, so they all agree.
- Numbers are derived on every render, never stored, so two tables cannot end
  up sharing one. The duplicate check in `floorplan.js` is there for the day a
  number becomes hand-editable.
