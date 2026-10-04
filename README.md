# javier-alvarez.github.io

Personal website, served by GitHub Pages at https://javier-alvarez.github.io.

Plain HTML, CSS and JavaScript with no build step:

- `index.html` holds all the content.
- `assets/styles.css` has two themes: brightfield (light) and fluorescence (dark).
- `assets/mosaic.js` draws the hero: a toy simulation of somatic evolution with
  driver, protective and passenger mutations.
- `assets/site.js` handles the theme toggle and assembles the email link.
- `assets/figures.js` draws the illustrative figures in the work sections
  (chest X-ray report, CT contours, attention map, agent loop, event
  stream), driven by the SVG and `fig__*` markup in `index.html`.
- `assets/lib.js` holds helpers shared by `mosaic.js` and `figures.js`;
  load it before both.

## Preview locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Publishing safely

This repo is public, history included, so a pre-push guard checks every
commit before it leaves your machine: terms from a private denylist,
secrets, commit emails, file types and image metadata. Enable it once per
clone, pointing at the denylist (kept outside this repo):

```bash
git config core.hooksPath .githooks
git config siteguard.denylist /path/to/denylist.txt
```

GitHub Actions (`.github/workflows/site-checks.yml`) then runs checks that
are safe in public: the guard's tests, local resources and contrast
(`scripts/check_site.py`), HTML validation, accessibility and links.

## Licence

The code is MIT-licensed. The text and images are © Javier Alvarez-Valle, all
rights reserved. The fonts are under the SIL Open Font License. See `LICENSE`.
