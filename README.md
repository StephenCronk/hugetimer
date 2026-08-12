# BFTIMER

A giant, blocky pixel countdown timer that runs in the browser. Static site — no build
step, no dependencies, no framework.

## Run locally

Open `index.html` directly, or serve it:

```sh
python3 -m http.server 8000
# → http://localhost:8000
```

## Deploy to GitHub Pages

The repo root *is* the site, so either Pages source works:

**Deploy from a branch** — Settings → Pages → Source: `Deploy from a branch`,
branch `main`, folder `/ (root)`.

**GitHub Actions** — Settings → Pages → Source: `GitHub Actions`. The included
`.github/workflows/pages.yml` publishes the root on every push to `main`.

`.nojekyll` is present so Pages serves the files as-is.

## Behaviour

- The clock is an 11x16 LED matrix in muted yellow, every stroke four cells thick.
  It scales to fill the stage — hide the sidebar or go fullscreen and it owns the
  whole screen.
- Format is `MM:SS`, switching to `H:MM:SS` past an hour.
- The digits turn **red for the last 10%** of the run.
- At zero the **whole screen flashes red 3 times**. No sound, ever.
- Remaining time mirrors into the tab title.
- Requests a screen wake lock while running, where the browser supports it.

## Presets

The right column holds named lengths (`art pass` / `50:00`, `break` / `15:00`, …).
Click one to load it. Add via the **NEW PRESET** fields — the length box accepts
`50` (minutes), `50:00`, or `1:30:00`. Delete with the `✕` on hover. Presets persist
in `localStorage` under `bftimer.presets.v1`.

## Keys

| Key | Action |
| --- | --- |
| `Space` | Start / pause |
| `R` | Reset |
| `F` | Fullscreen |
| `\` | Toggle sidebar |

Shortcuts stand down while a text field has focus.

## Layout

| File | Role |
| --- | --- |
| `index.html` | Markup — stage on the left, sidebar on the right |
| `styles.css` | One Dark Pro palette, layout, button styles |
| `app.js` | Pixel font, timer, canvas renderer, presets, shortcuts |
| `favicon.svg` | Pixel "BF" mark |
