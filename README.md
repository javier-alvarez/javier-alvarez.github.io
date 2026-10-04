# javier-alvarez.github.io

Personal website, served by GitHub Pages at https://javier-alvarez.github.io.

Plain HTML, CSS and JavaScript with no build step:

- `index.html` holds all the content.
- `assets/styles.css` has two themes: brightfield (light) and fluorescence (dark).
- `assets/mosaic.js` draws the hero: a toy simulation of somatic evolution with
  driver, protective and passenger mutations.
- `assets/site.js` handles the theme toggle.

## Preview locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Licence

The code is MIT-licensed. The text and images are © Javier Alvarez-Valle, all
rights reserved. The fonts are under the SIL Open Font License. See `LICENSE`.
