# music-engine

## Install

- `npm ci` — backend and test dependencies.
- `npm run app:install` — maintained desktop app dependencies.
- `npm run web:install` — browser app dependencies.

## Run

- Desktop: `npm run app`. It starts/reuses the backend automatically.
- Browser: run `npm run dev` and `npm run web` in separate terminals, then open the address printed by the web server.
- Backend only: `npm run dev`, or `npm run build` followed by `npm start`.

The maintained clients live in `apps/electron` and `apps/web`. The older `app/` directory forwards to the maintained desktop app.

Desktop outputs are written under this repository's `tmp/`: `app_out.musicxml`, matching `app_out.mid` when supported, and `app_response.json`. The backend owns chord extraction, settings interpretation and final export.

## Check changes

`npm test` runs every registered offline suite. `npm run build`, `npm --prefix apps/web run build`, and `npm --prefix apps/electron run build` validate the three builds.

Phrase collaboration is available in the browser for string ensemble: inspect the source, review/edit an AI or external plan, then generate with that plan. See [phrase collaboration](docs/phrase-collaboration.md).

See [application paths](docs/application-paths.md), [testing](docs/testing.md), [source preservation](docs/source-preservation.md) and [unified performance](docs/unified-performance.md).

PDF/OMR support is experimental and depends on the configured import provider. AI settings need the corresponding backend credentials. Neither is required for MusicXML generation or offline tests.
