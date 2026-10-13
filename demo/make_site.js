// make_site.js — turn demo/index.html (built for a claude.ai artifact: d3 from cdnjs, Google Fonts, no <head>)
// into the repo-root index.html served by GitHub Pages: vendored d3 and fonts, a real <head> with link-card tags,
// and a link back to the repository. No network needed at view time.
// usage: node demo/build.js && node demo/make_site.js [--repo 30k30/mqtc]
const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2), at = argv.indexOf('--repo'), repo = at >= 0 ? argv[at + 1] : '30k30/mqtc';
const [owner, name] = repo.split('/'), user = owner.toLowerCase();
const base = name.toLowerCase() === `${user}.github.io` ? `https://${user}.github.io/` : `https://${user}.github.io/${name}/`, repoUrl = `https://github.com/${repo}`;
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), cut = src.indexOf('<div class="app">');
if (cut < 0) throw new Error('demo/index.html: <div class="app"> not found');
const swap = (s, from, to) => { if (!s.includes(from)) throw new Error('make_site: not found: ' + from.slice(0, 60)); return s.replace(from, to); };

let head = src.slice(0, cut), body = src.slice(cut);
head = head.replace(/<link rel="preconnect"[^>]*>\n/g, '');
head = head.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>\n/, () =>
  `<style>
@font-face { font-family: "Schibsted Grotesk"; src: url("assets/fonts/SchibstedGrotesk-wght.ttf") format("truetype"); font-weight: 400 900; font-display: swap; }
@font-face { font-family: "IBM Plex Mono"; src: url("assets/fonts/IBMPlexMono-Regular.ttf") format("truetype"); font-weight: 400; font-display: swap; }
@font-face { font-family: "IBM Plex Mono"; src: url("assets/fonts/IBMPlexMono-Medium.ttf") format("truetype"); font-weight: 500; font-display: swap; }
</style>\n`);
if (head.includes('fonts.googleapis.com')) throw new Error('make_site: Google Fonts link not replaced');
body = swap(body, '<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>', '<script src="assets/d3.v7.9.0.min.js"></script>');
body = swap(body, '      </section>\n    </aside>', `        <p>Code, data and the lab notebook: <a href="${repoUrl}">${repoUrl.replace('https://', '')}</a>. Demo video: <a href="media/quartet-tree-atlas.mp4">44 s, MP4</a>.</p>\n      </section>\n    </aside>`);

const desc = 'Unrooted trees that minimise the Cilibrasi–Vitányi quartet cost for 1,000 handwritten digits and 1,000 colours. Zoom, highlight digits, switch layouts, inspect clades.';
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:title" content="Quartet Tree Atlas">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${base}">
<meta property="og:image" content="${base}media/card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Quartet Tree Atlas">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${base}media/card.png">
<link rel="icon" href="assets/icon.svg" type="image/svg+xml">
<style>
/* what the artifact host supplied around the page */
body { margin: 0; } img { max-width: 100%; } [hidden] { display: none !important; }
:root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
.prose a { color: var(--accent); text-underline-offset: 2px; }
</style>
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, '..', 'index.html'), html);
console.log(`index.html: ${(html.length / 1024).toFixed(0)} KB, for ${base} (repo ${repoUrl})`);
