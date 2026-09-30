# Digital Brick Builder

Type anything or drop a picture -> a model made only of real LEGO bricks/plates in real colours, in 3D, with step-by-step instructions (max 4 pieces per step, new pieces highlighted), a virtual in-app build, and a BrickLink wanted-list XML.

**Try it live:** https://a-guidry.github.io/digital-brick-builder/

## Deployment
Hosted on GitHub Pages. Every push to `main` runs `.github/workflows/deploy.yml`, which installs, tests, builds (`dist/index.html`, a single self-contained file) and publishes. Redeploy manually with `gh workflow run deploy.yml`. Full details, local run commands and troubleshooting: [DEPLOY.md](DEPLOY.md).

## Run it
- Easiest: open `DigitalBrickBuilder.html` (single file, works offline; the 8 ready-made builds need no AI or internet).
- If AI calls fail from a file:// page, serve it instead: `npx serve .` or `python3 -m http.server` in the folder holding the file.
- From source: `npm install`, `npm run dev` (or `npm run build` -> `dist/index.html`), `npm test`.

## AI setup (AI settings button)
- Anthropic: paste a key (model default `claude-sonnet-4-5`, editable).
- Gemini: paste a key (default `gemini-2.5-flash`, editable).
- Local: any OpenAI-compatible server (Ollama `http://localhost:11434/v1`, LM Studio `http://localhost:1234/v1`). Ollama needs `OLLAMA_ORIGINS="*"`. Pictures need a vision model.
Keys live only in this browser's local storage.

## How it works
The AI only DESCRIBES SHAPES (JSON: box, sphere, cylinder, cone, wedge; add/subtract/paint; mirror_x). It may not name parts or place bricks (such specs are rejected). A program voxelises the shapes and packs them into real parts, then checks: no overlaps, every part/colour real, ONE stud-connected piece, and a build order where every part attaches to something already built. The program tries to fix problems itself (re-pack, bridge plates, stacked plates, drop tiny loose bits); anything left is sent back to the AI (max 4 rounds). If it still fails you are told plainly.

See ARCHITECTURE.md. Tests: `npm test` (25 unit tests); `scripts/e2e.mjs` and `scripts/shots.mjs` drive a real browser (Playwright) against a running dev server or `URL=file:///…/dist/index.html`.

## Virtual build (bags)
Build tab: the parts are split into 4 numbered bags (contiguous groups of steps, balanced piece counts). Open the next bag and it drops beside the build, shakes, tears open and pours its exact bricks into a tray as a physics pile (cannon-es). Sort through the pile: move the mouse (or swipe a finger) over bricks to push them around; drag a brick (touch: press and hold) onto its ghost, or tap a brick then tap the ghost. Wrong pieces are refused and fall back in the pile. Hint pulses matching bricks; Shake mixes the pile; Undo drops the last brick back; "Place one for me" / "Auto-build bag" are shortcuts. Finishing a bag unlocks the next. Verified in a software-WebGL browser (slow, ~2 fps); not yet tried on a real phone or GPU, and models near the 2,500-part limit (~625 bricks per bag) will strain the physics.

## Update: slider, gallery, colour
- Step slider is continuous: drag it and pieces drop in one by one (and lift back out going backwards); let go and it snaps to the nearest whole step. Arrow keys and buttons animate the same way.
- 18 ready-made builds (10 new: snowman, penguin, mushroom, lighthouse, sailboat, cat, duck, pyramid, flower, fire truck), each with a picture of the finished model (`src/thumbs.ts`, regenerate with `scripts/thumbs.mjs`).
- BrickLink: Parts tab has a step-by-step panel and a "Copy XML & open BrickLink" button. There is no BrickLink login/API connection in the app; upload is copy-and-paste.
- Fixed: AI settings dialog now closes on Save & close (also on backdrop click / Esc); two bridge plates could overlap in rare cases.

## Profile, saving and sharing (no server)
- Header button (Guest / your name) opens the profile: builds you make with AI, favourites, look, and bag progress are autosaved in this browser (`dbb.profile.v1`). Reopening resumes where you left off; the tray is refilled with the bricks still unplaced (exact pile positions are not saved).
- Save profile file / Load profile file: a `.dbb.json` backup you can move between computers. API keys are NOT in the file unless you tick the option; AI settings from a file are only applied when you press the apply button. Loading merges (builds by id, newest progress wins). Everything loaded is re-validated and rebuilt, so an edited file can only produce a normal checked model.
- Saved tab: open now (favourite / share link), pick up where you left off, My builds, favourites. Delete/erase need a second click.
- Share link: the shape spec is compressed into the URL hash (`#s=…`, ~200-2000 chars). Nothing is stored on a server.
- Footer disclaimer: independent fan project, not affiliated with the LEGO Group. SEO meta/OG/JSON-LD are in `index.html`.
- Publishing: see `PUBLISHING.md`.
- Tests: 64 unit tests, `scripts/e2e.mjs` (87 browser checks).

## Phones
Below 900px wide the app switches to an app-style layout (`src/mobile.css`): header, a fixed 3D view, a scrolling panel, and a bottom bar (Create, Steps, Build, Saved, Parts, Checks). The 3D view grows while building, the tray sits in front of the plate on portrait screens, and buttons are finger-sized with 16px inputs (no iOS zoom). Landscape phones get view-left / panel-right. Checked in emulated phones (390x844, 360x640, 844x390 landscape) with real touch events: `scripts/phone.mjs <phone|small|land>` (layout audit + screenshots) and `scripts/phone-build.mjs <...>` (open a bag, tap-to-place, press-and-drag, swipe without page scroll). Not checked on a real phone or GPU.
