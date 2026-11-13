# Celience Adapt · prototype

Interactive mobile prototype (390 × 844) for the Celience Adapt ECAL project.

## Open it

The prototype reads its content from `data/content.json`, so the browser needs a small local server (opening `index.html` by double-click blocks the JSON file):

- **VS Code**: right-click `index.html` → *Open with Live Server*
- **Terminal**, in this folder: `npx serve` or `python3 -m http.server`, then open the address it prints

## Folder

```
index.html          structure of every screen (one phone frame)
css/fonts.css       Inter @font-face
css/style.css       design tokens (colours, 24px margins, 8px rhythm), layout, which screen is visible
js/app.js           navigation, dot physics, loader, quizzes, protocol logic
data/content.json   all texts, colours, dot positions, quizzes, events, products
assets/             logo + the two map buttons (SVG)
fonts/              Inter 400 / 500 / 600 (woff2) + licence
```

## Editing

- **Texts, colours, products, quiz questions**: `data/content.json` only.
  - `clusters[].todo: true` = outline dot (quiz not answered yet). A cluster opens a quiz on the map when `quizzes` has an entry with the same `id`.
  - `protocolRules` decides which answers add Recovery Night to the protocol.
- **Spacing, sizes, colours of the UI**: the variables at the top of `css/style.css`.
- **Timings and motion** (loader, drift, panel): the constants at the top of `js/app.js`.

## Flow

Loader → screen 1 (tap) → dashboard (tap) → map
- Map: tap **Sleep** or **Stress** → quiz → back to the map, the dot fills
- **Add an event → Travelling** → trip, 2 questions, summary → map; the trip card then appears on the dashboard
- **Access my protocol** → recommendations from your answers → **Add to basket** → map with basket badge → basket → **Buy** → *None of the above* → order confirmed → dashboard
- Dashboard: tap a routine card → its supplement · tap the logo → screen 1 · back arrow from the map → dashboard
