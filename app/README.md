# Compatibility directory

The maintained desktop app is `../apps/electron`. This directory is no longer an independent application: its package commands forward there, and its Electron entry point loads that app's compiled entry point. Run `npm run app` from the repository root.

The old renderer/preload files are retained for reference only. Make new UI changes under `apps/electron/renderer` or `apps/web/src`. Install the maintained app's dependencies with `npm run app:install` at the repository root.
