# Deployment

| | |
|---|---|
| Live site | https://a-guidry.github.io/digital-brick-builder/ |
| Repository | https://github.com/A-Guidry/digital-brick-builder |
| Host | GitHub Pages (source: GitHub Actions) |
| Workflow | `.github/workflows/deploy.yml` ("Deploy to GitHub Pages") |
| Runs on | every push to `main`, or manually (workflow_dispatch) |

## How deployment works

The app is a static site with no server, database or secrets. `npm run build` type-checks the code and runs Vite with `vite-plugin-singlefile`, which inlines all JavaScript and CSS into one file: `dist/index.html`. `vite.config.ts` sets `base: './'`, so the page works under the `/digital-brick-builder/` sub-path with no extra configuration.

The workflow has two jobs:

1. **build**: checkout, Node 22 with npm cache, `npm ci`, `npm test` (unit tests; a failing test stops the deploy), `npm run build`, `actions/configure-pages`, then `actions/upload-pages-artifact` uploads `dist/`.
2. **deploy**: `actions/deploy-pages` publishes that artifact to the `github-pages` environment. The run summary links to the live URL.

Permissions are limited to `contents: read`, `pages: write` and `id-token: write`. Only one deploy runs at a time; a newer push waits for the current one instead of cancelling it.

## Redeploy

- Normal: commit and push to `main`. The site updates in about 1 to 2 minutes.
- Without a code change: `gh workflow run deploy.yml --repo A-Guidry/digital-brick-builder`, or Actions tab, "Deploy to GitHub Pages", "Run workflow".
- Watch a run: `gh run watch --repo A-Guidry/digital-brick-builder` (or `gh run list --workflow deploy.yml`).
- Failed run: `gh run view --log-failed --repo A-Guidry/digital-brick-builder`. A failure at `npm test` means a test caught a problem; fix it and push again.

## One-time setup (already done)

The repository is public (free GitHub Pages needs that) and Pages is set to build from GitHub Actions. If it ever needs redoing:

```
gh api -X POST repos/A-Guidry/digital-brick-builder/pages -f build_type=workflow
# or, if Pages already exists:
gh api -X PUT repos/A-Guidry/digital-brick-builder/pages -f build_type=workflow
```

## Run locally

```
npm ci
npm run dev        # dev server with hot reload (http://localhost:5173)
npm test           # unit tests
npm run build      # production build -> dist/index.html
npm run preview    # serve the production build at http://localhost:4173
```

`dist/index.html` is self-contained; you can also open it directly from disk. AI calls may need it served over http rather than `file://`.

## Secrets

None. The site never ships with an API key. Each visitor pastes their own Anthropic or Gemini key into AI settings, and it stays in their browser's local storage. Do not add a key to the repository or the page. See `PUBLISHING.md` for a proxy option and for custom domains.

## Note on the project folder

The working copy lives in a Google Drive folder. Git works there, but Drive sync can occasionally create conflicted copies of files inside `.git`. If `git status` behaves oddly, check for files named like `index (1)` in `.git`, or clone a fresh copy outside Drive.
