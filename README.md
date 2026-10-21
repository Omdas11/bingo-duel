# Bingo Duel

1v1 75-ball bingo in the browser. Two players join a room with a 4-letter
code, each gets their own 5x5 card, numbers are drawn on a shared timer, and
the first to 5-in-a-row wins. Google + Email/Password sign-in; per-player
stats (wins, losses, streaks) saved in Firestore.

Static site (no build step) + Firebase backend. See `DESIGN.md` for the full
protocol.

## Run locally

```bash
cd bingo-duel
python3 -m http.server 8000
# open http://localhost:8000
```

## Firebase setup (project `studio-5006354319-33e06`, shared with missile.io)

1. **Web app config** — `js/config.js` already holds the project's web config.
2. **Auth providers** — in the Firebase console (Authentication > Sign-in
   method), enable *Email/Password* (Google is already on).
3. **Firestore** — already live (used by missile.io). Deploy `firestore.rules`
   so `bingo_rooms` and `bingo_stats` are accessible:
   `firebase deploy --only firestore:rules` (from this directory with
   `firebase.json` present), or paste the file into the console rules editor.

## Deploy

Push to GitHub (`Omdas11/bingo-duel`) and import in Vercel as a static site.
No build command, output directory = repo root.
