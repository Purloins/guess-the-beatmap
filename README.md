# Guess the Beatmap

A live audience quiz for PIT. The projector shows hints in stages and players type the song title on their phones after signing in with osu!.

- **`/`**: the player page (phones). Sign in with osu!, then type guesses.
- **`/screen`**: the projector. A QR code to join, staged hints, a live "who got it" feed, the reveal and the leaderboard.
- **`/host`**: the control panel. Add maps, start/next/reveal, settings and live answers. It can run from your phone or laptop.

## Round types

Pick a type per map in the host panel, or use **Mix round types** to rotate them through the list.

- **🎧 Audio:** the song plus the blurred background (the table below).
- **🎮 Replay:** autoplay gameplay drawn live on the projector, with no audio and no background. It starts from the map's kiai section. The server sends the projector the map's `.osu` file with the title, artist, mapper, tags, background and audio filename stripped out.
- **🏆 Score screen:** the map's #1 leaderboard score as an osu!-style results screen: grade, score, accuracy, combo out of max combo, 300/100/50/miss, mods, pp, player and date. It's fetched when you add the map; maps without a score can't use this type.

Hints 2 and 3 (stats, then mapper and title shape) are the same for every type. Every type ends with the full reveal: the background, the song and the title.

## How a question works (audio round)

| Time (default) | Projector shows |
|---|---|
| 0s: Hint 1 | 4s of the song preview, background heavily blurred |
| 15s: Hint 2 | 8s of audio, less blur, map stats (BPM, length, SR, CS/AR/OD) |
| 30s: Hint 3 | Full preview on loop, light blur, mapper, first letter of the artist, title shape (`H _ _ _ _ _ _ _ _   C _ _ _ _ _`) |
| 45s | Time's up, then the answer is revealed automatically |

- Each player gets 3 guesses per question.
- Points start at 1000 and fall to 400 at the buzzer, so faster answers score more.
- Answers are forgiving. They ignore case, spaces, punctuation and accents. "(TV Size)", "(Sped Up Ver.)", "feat. …" and a leading "The" are optional. Small typos are accepted on longer titles, and the Japanese title works too. A near miss gets "So close!".
- You can add extra accepted answers per map in the host panel ("Also accept").
- All timings, guesses and points can be changed in the host panel's Settings.

The answer and the map ID never reach players' phones. The projector loads the audio and background through `/api/hint`, which only hosts can use, so nobody can look the answer up from the page source.

## Setup (about 15 minutes)

1. **osu! OAuth app.** Go to <https://osu.ppy.sh/home/account/edit>, then **OAuth**, then **New OAuth Application**.
   - Name: `Guess the Beatmap`
   - Callback URL: `https://YOUR-APP.vercel.app/api/auth/callback` (fill in your real domain once Vercel gives you one; you can edit it later)
   - Copy the **Client ID** and **Client Secret**.
2. **Vercel project.** Push this folder to a GitHub repo, then **Import** it in Vercel. Set the framework preset to **Other**, with no build command.
3. **Redis.** In the Vercel project, go to **Storage**, then **Create / Connect**, then **Upstash Redis** (from the Marketplace). This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. The free tier is plenty: phones read a CDN-cached state, so 100+ players cost about 1 Redis read per second.
4. **Environment variables** (Settings, then Environment Variables):

   | Name | Value |
   |---|---|
   | `OSU_CLIENT_ID` | from step 1 |
   | `OSU_CLIENT_SECRET` | from step 1 |
   | `SESSION_SECRET` | any random string of 32+ characters |
   | `HOST_OSU_IDS` | osu! user IDs allowed to host, comma separated, e.g. `19350047` (add ellyn's) |

5. **Redeploy** so the variables take effect, then make sure the osu! callback URL matches your domain exactly.

## Running it at the event

1. Open **`/host`** and sign in with your osu! account.
2. Click **Fill with famous maps**, then **Look up & add**. Search text picks the most-played ranked match, so check the list and remove or replace any that picked the wrong map. You can also paste set IDs or osu! links. **Shuffle**, then **Save changes**.
3. On the projector laptop, open **`/screen`** (signed in as a host) and click once to enable audio. Turn the volume up.
4. Players scan the QR code and sign in. Avatars appear on the screen as they join.
5. Press **Start game**. Each question reveals itself when time runs out. Then press **Show leaderboard** if you want it, then **Next question**. After the last question, the button shows the final results.
6. **Reset game** wipes scores and answers but keeps the map list, so it's fine for a dry run before the real thing.

## Local testing

`npm run dev` with `MOCK=1` runs everything offline. It uses an in-memory Redis and a fake osu! login. Pick which account you sign in as with a `mock_user` cookie.

```bash
MOCK=1 SESSION_SECRET=devsecretdevsecret npm run dev
# http://localhost:3000/host  (signs in as Purl by default)
```

Fixtures for a few PIT Finals maps are in `dev/fixtures/`.

## Files

```
api/
  auth/login.js, callback.js, logout.js   osu! OAuth
  state.js     public game state (CDN-cached 1s)
  me.js        your score / rank / current answer
  answer.js    submit a guess
  hint.js      host-only background/audio proxy
  host/questions.js  add / edit / reorder maps
  host/control.js    start, next, reveal, leaderboard, end, reset, settings
  host/live.js       everything the screen and host panel need
lib/      redis (Upstash REST), http (sessions), osu (API), match (answer checking), game (state/scoring)
public/   index.html (phone), screen.html (projector), host.html (control), style.css, fonts
dev/      local server with mocks
```
