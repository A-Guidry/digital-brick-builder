# Publishing Digital Brick Builder

The live deployment is already set up; see `DEPLOY.md` for its URL and how it works. This file is the general guide.

The app is a static site: one `index.html` plus assets. There is no server, database or account system to host. GitHub Pages serves it for free.

## 1. Build it (only needed if you are not using the GitHub Action)

```
npm install
npx vite build
```

This produces a `dist/` folder. Upload the contents of `dist/`. If you only have the single-file `DigitalBrickBuilder.html`, rename it to `index.html` and upload that one file.

## 2. Publish on GitHub Pages (the plan)

The project already contains `.github/workflows/deploy.yml`. Once it is in a repository, every push to `main` runs the tests, builds the site and publishes it. You do not need to upload `dist/` by hand.

1. On github.com, click New repository. Name it `digital-brick-builder`. Public is required for free Pages on a personal account. Do not add a README or .gitignore (the project has them).
2. In a terminal, in the unzipped project folder:

```
git init -b main
git add .
git commit -m "Digital Brick Builder"
git remote add origin https://github.com/<your-username>/digital-brick-builder.git
git push -u origin main
```

3. On GitHub: repository Settings, Pages, Build and deployment, Source: choose **GitHub Actions**. (Do this once, before or right after the first push.)
4. Open the Actions tab and watch "Deploy to GitHub Pages" run (about 1 to 2 minutes). When it is green, the site is at `https://<your-username>.github.io/digital-brick-builder/`.
5. To update later: change files, `git add . && git commit -m "..." && git push`. It redeploys by itself.

If the Action fails at the "npm test" step, the tests caught a problem; open the log to see which. Remove the `npm test` line in the workflow only if you want to publish regardless.

Quick alternative with no Actions: build locally (`npx vite build`), put the single `dist/index.html` alone in a repository, and choose Source: Deploy from a branch, `main`, `/ (root)`. Because the app is one self-contained file this works too.

## 3. Use your own domain or subdomain

Later, if you want an address like `bricks.yourdomain.com`: in the repository go to Settings, Pages, Custom domain and enter it. At your DNS provider add a `CNAME` record for that subdomain pointing to `<your-username>.github.io`. Tick Enforce HTTPS once the certificate is ready (can take a few minutes up to a day). Other hosts (Cloudflare Pages, Netlify, Vercel) work the same way with `dist/` if you ever move.

## 4. Do not put your own AI key in the page

Anything in a web page can be read by every visitor. The app therefore never ships with a key: each visitor pastes their own Anthropic or Gemini key into Settings, and it stays in their browser only. Do not hard-code yours.

If you want visitors to use AI without their own key, put a small proxy in front of the AI provider that holds your key, adds rate limits and a spending cap, and allows only your site's origin. A Cloudflare Worker is a good fit for this. This is optional and is not included in the app.

## 5. What visitors get, and its limits

- Saved builds, favourites and build progress are kept in the visitor's own browser (localStorage). There is no server copy.
- Visitors can save a profile file (`.dbb.json`) and load it on another device. API keys are left out of that file unless the visitor ticks the option.
- Share links carry the shape spec inside the URL, so nothing is stored on your side.
- Browsers can clear site data (Safari may do so after a stretch without a visit, as far as I know), so the profile file is the real backup.

## 6. Trademarks and the footer

Keep the footer disclaimer: the app is an independent fan project and is not affiliated with the LEGO Group. Do not use the LEGO logo or brand imagery in the name, icon or marketing. "BrickLink" is also a trademark of its owner. If you plan to charge for the app or run ads, get proper legal advice first.

## 7. Before you announce it

`index.html` already has a description, Open Graph tags and structured data. For polished link previews once you have your real address, add `<link rel="canonical">`, `og:url` and an `og:image` (a 1200x630 picture) to the head, then rebuild.
