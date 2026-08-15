# BFTIMER

A giant, blocky pixel countdown timer that runs in the browser. Static site — no build
step, no dependencies, no framework.

## Run locally

Open `index.html` directly, or serve it:

```sh
python3 -m http.server 8000
# → http://localhost:8000
```

## Deploy

Live at **https://stephencronk.github.io/hugetimer/**

The repo root *is* the site — there's no build step, so Pages serves it directly
(Settings → Pages → Source: `Deploy from a branch`, branch `main`, folder `/ (root)`).
`.nojekyll` is present so the files are served as-is.

Publishing a change is just:

```sh
git push
```

## Behaviour

- The clock is an 11x16 LED matrix glowing in the theme colour, every stroke four
  cells thick, over a faint Tron grid of the same colour. It always fills the
  screen — there is no panel to hide.
- Format is `MM:SS`, switching to `H:MM:SS` past an hour.
- The digits turn **hot pink for the last 10%** of the run. That colour is fixed and
  does *not* follow the theme — it has to keep meaning "nearly out of time".
- At zero the **whole screen strobes 5 times** — hard on/off, no fade.
- Remaining time mirrors into the tab title.
- Requests a screen wake lock while running, where the browser supports it.

## Controls

One row under the clock: **theme swatch**, **50 MIN**, **10 MIN**, **START/PAUSE**,
**RESET**, **mute**. Timer lengths aren't saved — reload and you're back to 50
minutes — but the theme colour and the mute setting are (see below).

### Theme colour

The swatch on the left opens an HSV wheel: hue around the rim, saturation out from
the centre, brightness on the slider under it. It retints everything live — clock,
glow, grid, chips — and the hex is shown as you drag. Click anywhere outside the
wheel, or press `Esc`, to dismiss it.

The colour drives one CSS variable, `--lit-rgb`, so anything tinted by it has to be
written `rgba(var(--lit-rgb), a)` rather than a baked hex. `applyTheme()` in `app.js`
rewrites that variable and the canvas `PALETTE` in the same pass.

### Sound

- **Start / resume** — `lockon.wav`
- **Zero** — `bus.wav`

The chip on the right mutes both. Safari won't let a clip play from a timer unless
that element has already played during a user gesture, so both files get a silent
play/pause on the first click the page ever sees; without that priming the finish
sound is silently dropped.

Theme and mute persist in `localStorage` (`bftimer.theme`, `bftimer.muted`).

## Keys

| Key | Action |
| --- | --- |
| `Space` | Start / pause |
| `R` | Reset |
| `F` | Fullscreen |
| `Esc` | Close the colour picker |

## Version

A tiny grey version number sits in the bottom-right of the page — off-palette on
purpose, so it reads as a build stamp rather than part of the UI.

Bump it with every update, using the script rather than by hand:

```sh
./bump 1.8
```

That rewrites the stamp *and* the `?v=` on `styles.css`, `app.js` and
`favicon.svg` in `index.html`. The query strings matter: Pages revalidates
`index.html` but lets browsers sit on a cached stylesheet indefinitely, so
without a fresh URL you ship CSS that Safari never fetches — the page looks
unchanged apart from the version number, which is the tell.

## Layout

| File | Role |
| --- | --- |
| `index.html` | Markup — full-bleed clock, control row, picker, version stamp |
| `bump` | Version bump + cache-buster rewrite |
| `styles.css` | Neon palette, grid background, button and picker styles |
| `app.js` | Pixel font, timer, canvas renderer, strobe, wheel, sound, shortcuts |
| `favicon.svg` | Pixel "BF" mark |
| `lockon.wav` | Start sound |
| `bus.wav` | Finish sound |
