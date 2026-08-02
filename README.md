# Reception Seating Chart (Live, Collaborative)

A drag-and-drop seating chart you and your fiancé can both open on your own
computers and edit **at the same time** — changes sync instantly, and you
can each see who's online and which guest the other person is currently
moving.

It's a static site (just HTML/CSS/JS), so it's free to host on GitHub Pages.
The realtime sync and storage is powered by Firebase's free tier.

---

## 1. Create a free Firebase project (~5 minutes)

1. Go to **console.firebase.google.com** and sign in with any Google account.
2. Click **Add project**, give it any name (e.g. "our-wedding-seating"), and finish the wizard (you can decline Google Analytics).
3. Once inside the project, click the **`</>`** (web app) icon on the project overview page to register a web app. Give it any nickname.
4. Firebase will show you a code block that looks like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "our-wedding-seating.firebaseapp.com",
     ...
   };
   ```
   Copy those values into **`firebase-config.js`** in this project, replacing the placeholder text.
5. In the left sidebar, go to **Build → Realtime Database → Create Database**. Pick any region close to you. When asked about rules, choose **Start in test mode** for now (this lets the app read/write without you setting up logins — fine for a private link only the two of you have).
6. Copy the **database URL** shown at the top (looks like `https://our-wedding-seating-default-rtdb.firebaseio.com`) into the `databaseURL` field in `firebase-config.js` if it isn't already filled in.

Test mode rules expire after 30 days. Before then (or right away), go to
**Realtime Database → Rules** and replace them with:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

then hit **Publish**. Anyone with your database URL could technically read/write it, but since it's not linked anywhere public, this is a reasonable tradeoff for a two-person wedding planning tool. If you want it locked down further later, Firebase supports email/password auth — ask and this can be added.

---

## 2. Put it on GitHub Pages

1. Create a new **public or private** GitHub repository (private works fine, as long as GitHub Pages is enabled for your account tier — public is simplest if you're on a free personal account).
2. Push all the files in this folder to that repository (`index.html`, `style.css`, `app.js`, `guests.js`, `firebase-config.js` with your real keys filled in, `README.md`).
3. In the repo, go to **Settings → Pages**. Under "Build and deployment," set **Source: Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
4. GitHub will give you a URL like `https://yourusername.github.io/your-repo-name/`. That's the site — share it with your fiancé.

That's it. Whenever either of you opens the link, you'll be asked for a first name once (remembered after that), then you'll both see the same live board.

---

## 3. Using it

- **Add table** creates a new empty table.
- Drag any guest card between the **Unassigned** pool and any table, or between tables.
- **Seats per table** controls the capacity shown on each table's badge (10 by default) — it's just a visual cap, you can still overfill if you need to.
- **Auto-fill empty seats** drops remaining unassigned guests into open seats, adding new tables if needed.
- **Reset to unassigned** empties every table (keeps table names) — there's a confirmation before this happens.
- The **Online** bar up top shows who's currently on the page. If someone is mid-drag with a guest, you'll see a colored outline and their name on that guest's card in real time.
- The **Recent activity** panel (bottom right) logs moves, renames, and table changes as they happen, so you can see what your partner did while you were away.

## 4. Updating the guest list later

When a new RSVP export comes in, the easiest path is to come back to Claude with the new file and ask it to update `guests.js` the same way it was built the first time, then push that one file to GitHub. Existing table assignments are untouched — new names just show up in the Unassigned pool automatically, since the app always computes "unassigned" as *everyone in `guests.js` minus everyone currently seated*.

## 5. Importing your old single-device layout

If you had a seating layout in the older, non-collaborative version of this tool, you can bring it over:

1. Open that old version in your browser.
2. Right-click on the chart → **Inspect** → **Console** tab.
3. Paste this and press Enter:
   ```js
   window.storage.get('seating-chart-v2', false).then(r => copy(r.value))
   ```
   This copies your saved layout to your clipboard.
4. In the new collaborative app, click **Import old layout…** in the toolbar, paste it in, and click Import.
