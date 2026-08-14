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

- The clock is an 11x16 LED matrix in neon cyan, every stroke four cells thick,
  glowing over a faint Tron grid. It always fills the screen — there is no panel to
  hide.
- Format is `MM:SS`, switching to `H:MM:SS` past an hour.
- The digits turn **hot pink for the last 10%** of the run.
- At zero the **whole screen strobes 5 times** — hard on/off, no fade. No sound, ever.
- Remaining time mirrors into the tab title.
- Requests a screen wake lock while running, where the browser supports it.

## Controls

One row under the clock: **50 MIN**, **10 MIN**, **START/PAUSE**, **RESET**. Nothing is
saved or persisted — reload and you're back to 50 minutes.

## Keys

| Key | Action |
| --- | --- |
| `Space` | Start / pause |
| `R` | Reset |
| `F` | Fullscreen |

## Version

A tiny faint version number sits in the bottom-right of the page. Bump it in
`index.html` (`.version`) with every update.

## Layout

| File | Role |
| --- | --- |
| `index.html` | Markup — full-bleed clock, control row, version stamp |
| `styles.css` | Neon palette, grid background, button styles |
| `app.js` | Pixel font, timer, canvas renderer, strobe, shortcuts |
| `favicon.svg` | Pixel "BF" mark |
