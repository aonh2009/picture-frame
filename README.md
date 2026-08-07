# Picture Frame — Chromebook edition

The web version of the desktop Picture Frame app. Runs in Chrome on a
Chromebook (or any computer) — no installation, no Python, nothing to build.
Same features as the Windows app:

- Fullscreen slideshow of a folder's pictures, advancing every 3 minutes
  (configurable).
- Rescans the folder every 10 minutes; **newly added pictures are shown
  first**. Deleted files drop out automatically.
- Plays videos (mp4/webm/mov, muted) to the end, then moves on.
- Orientation (landscape / portrait / portrait-flipped), fit mode
  (letterbox / crop-to-fill), filler: white, black, **auto** (samples the
  edges of each picture and colors the bars to match), or **blur** (a
  softly blurred copy of the picture fills the whole screen behind it,
  like TV ambient modes).
- Settings popup (`E`), controls tooltip on mouse move, mouse cursor
  auto-hides after 5 s.
- **Kiosk behavior:** goes fullscreen on start and holds a *screen wake
  lock* so the display never sleeps while the frame is running.

## Get it onto the Chromebook

**Quick way (works immediately):**

1. Copy this folder to the Chromebook (Downloads, SD card, or Google Drive).
2. In the **Files** app, double-click `index.html` — it opens in Chrome.
3. Click **Choose photos folder…** and pick the folder with your pictures.
   The show starts fullscreen immediately.

One limitation in this mode: pages opened straight from disk aren't allowed
to keep live access to a folder (a Chrome security rule), so the folder is
loaded **once** — newly added pictures appear after you re-choose the
folder, and the folder has to be chosen again after each restart. Settings
(timings, orientation, colors) do persist.

**Full-features way (recommended for a permanent kiosk):** open the app
from a real web address instead of a local file. From a real address the
app gets the live folder API: the chosen folder is **remembered** (no
re-picking every time), one-click **Resume** after a reboot, and the
10-minute rescan picks up newly added pictures automatically. The photos
never leave the Chromebook either way — the address only serves the app
itself. Two ways to get an address:

*Option A — GitHub Pages (free, ~5 minutes, no code tools needed):*

1. On github.com (logged in): click **+** → **New repository** → name it
   `picture-frame` → Public → Create.
2. On the new repo page: **uploading an existing file** → drag in the
   contents of `picture-frame-chromebook-upload.zip` (unzipped) →
   **Commit changes**.
3. Repo **Settings → Pages** → under *Branch* pick `main` and `/ (root)` →
   **Save**. After a minute the page shows your address, e.g.
   `https://<your-name>.github.io/picture-frame/`.
4. Open that address on the Chromebook, choose the folder once — done.
   Bookmark it / set it as the startup page.

*Option B — fully offline, using the Chromebook's Linux mode:*

1. ChromeOS Settings → **About ChromeOS → Linux development environment**
   → Turn on (one-time, ~2 GB).
2. Copy this folder into the **Linux files** section of the Files app.
3. In the Terminal app: `bash picture-frame-chromebook/serve-on-chromebook.sh`
4. Open `http://localhost:8321` in Chrome — localhost counts as a secure
   origin, so all features work. (Keep the terminal running; it must be
   restarted after a reboot, or added to Linux autostart.)

## Touch controls

Tap the screen and a control bar appears at the bottom — big buttons for
previous / pause / next, fullscreen, orientation, fit mode, filler color,
and settings. It hides itself after 5 seconds. You can also **swipe left /
right** anywhere on the picture to go to the next / previous one.

## iPad / iPhone

Safari has no folder access at all (the folder APIs are Chromium-only), so
on Apple devices the frame asks you to pick the **pictures** instead of a
folder:

1. Open `https://frame.aonhassan.com` in Safari.
2. Tap **Choose pictures…**, then **Select All** in the picker (Photos or
   Files both work). HEIC photos are supported.
3. The slideshow starts; tap once to go fullscreen.

For a proper frame, add it to the Home Screen — **Share → Add to Home
Screen**. Launched from that icon it runs without any Safari toolbars.
Pair it with **Settings → Accessibility → Guided Access** to lock the iPad
into the frame, and **Settings → Display & Brightness → Auto-Lock: Never**
so the screen stays on.

Limitation: iOS cannot remember the selection between launches, so the
pictures must be chosen again each time the app is reopened, and newly
added pictures appear only after choosing again. Chromebooks and Windows
(Chrome) keep the folder and detect new pictures automatically.

## Verses under the pictures

A verse appears in the filler area beneath each picture, changing with every
slide. The 33 verses are **built into the app** (`quotes.js`) — nothing to
connect, works offline.

- `Q` or the ❝ button turns them on/off.
- Settings (`E`) has **Show verses under pictures** and a text size
  (small / medium / large).
- When the picture leaves a letterbox band, the verse sits in it using the
  filler colour. When there's no band (fill/blur modes, or a tall photo),
  it floats over the picture in white with a shadow so it stays readable.

The verses are set in **Cormorant Garamond**, self-hosted in `fonts/` (the
page's security policy only allows same-origin resources, so a Google Fonts
link would be blocked — and self-hosting keeps the frame working offline).
Licence: SIL Open Font License 1.1, included as `fonts/OFL.txt`.

To change the list, edit `quotes.js` — each entry is `{ text, ref }`. The
full 76-verse source list (with the ones that were too long or read as
fragments) lives in the `picture-frame-quotes` folder as a spreadsheet.

## Keys

| Key | Action |
|---|---|
| `Space` | Pause / resume |
| `→` / `←` | Next / previous |
| `F` | Toggle fullscreen |
| `R` | Cycle orientation |
| `M` | Toggle fit mode (fit ↔ fill) |
| `C` | Cycle filler (white → black → auto → blur) |
| `Q` | Show / hide verses |
| `E` | Settings popup |
| `F11` | Leave (or enter) fullscreen |

## Zero-click start (recommended on the frame device)

Two one-time choices make the frame start completely by itself — no Resume
click, already fullscreen:

1. **Persist the folder permission:** open the frame page, click *Choose
   photos folder* / *Resume*, and when Chrome asks for access pick
   **“Allow on every visit”** (not “Allow this time”). From then on the
   app detects the standing permission at load and starts the show
   immediately.
2. **Install it as an app:** Chrome ⋮ menu → *Cast, save and share* →
   **Install page as app** (wording varies; on ChromeOS it may just say
   *Install Picture Frame*). Launched from its own icon, the app opens
   **fullscreen automatically** — no F-key or click needed.

Combined with ChromeOS **Settings → Apps → Restore apps on startup**, the
Chromebook boots (after sign-in) straight into the running fullscreen
slideshow.

## Start automatically after a reboot (simple kiosk)

1. With `index.html` open, copy the address from Chrome's address bar.
2. Chrome → ⋮ → **Settings → On startup** → *Open a specific page or set of
   pages* → paste the address.
3. ChromeOS **Settings → Apps** → turn on **Restore apps on startup**.

After a reboot, the frame page opens by itself showing a **Resume last
folder** button — one tap/click resumes the show (a browser security rule
requires one user gesture to re-grant folder access and fullscreen; there is
no way around this on an unmanaged Chromebook).

Also set ChromeOS **Settings → Device → Power** → *While charging: Keep
display on* as a belt-and-braces backup to the app's wake lock.

## True kiosk mode (managed Chromebooks)

Real ChromeOS kiosk mode — device boots straight into the app, no sign-in,
no way for passers-by to leave it — requires the device to be enrolled in a
Google Admin console (Chrome Enterprise / Education / the Kiosk & Signage
license):

1. Host this folder on any static web host (GitHub Pages works) so it has an
   `https://` address. The included `manifest.json` makes it an installable
   PWA, which is what ChromeOS kiosks run.
2. Admin console → **Devices → Chrome → Apps & extensions → Kiosks** →
   add by URL → set **Installation policy: auto-launch**.
3. The device now boots directly into the frame fullscreen.

For a home/personal Chromebook, the "Start automatically" section above is
the practical option.

## Notes

- Requires Chrome or Edge (the folder-access API). The page tells you if the
  browser can't do it.
- Videos that ChromeOS can't decode (some `.avi`/`.mkv` codecs) are skipped
  automatically after a second; stick to mp4/webm for reliability.
- Nothing ever leaves the device — photos are read straight from the folder
  by the browser; there is no server and no upload.
