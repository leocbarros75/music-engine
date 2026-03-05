# music-engine

## Install

- `npm install`
- `npm run app:install` (installs Electron app dependencies)

## Run Desktop App

- `npm run app`
- The app auto-starts the backend on `http://localhost:3001` if needed.

## Run Backend Only

- `npm run dev`

## Notes

- App outputs are written under `/Users/leobarros/Desktop/music-engine/tmp/` and can be exported elsewhere.
- To enable experimental PDF import: `VITE_PDF_IMPORT=true npm run app`.
  - Requires Audiveris installed and available as `audiveris` in PATH.
