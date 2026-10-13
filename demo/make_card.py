#!/usr/bin/env python3
"""make_card.py: render media/card.png (1200x630), the image shown when the site link is shared.

Loads index.html from a local server (fonts load over http, not file://), hides the page chrome, puts
the radial colour tree on the right and the title on the left, screenshots at 2x, downsamples.
usage:  python3 -m http.server 8765 --directory . &   then   python3 demo/make_card.py [--url http://127.0.0.1:8765/] [--site 30k30.github.io/mqtc]
needs:  python playwright with chromium, ffmpeg
"""
import argparse, asyncio, subprocess
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
CSS = """
header, aside, #hint { display: none !important; }
.app { padding: 0 !important; } main { grid-template-columns: 1fr !important; padding: 0 !important; gap: 0 !important; }
.stage { border: 0 !important; border-radius: 0 !important; }
#card-text { pointer-events: none; position: fixed; left: 64px; top: 0; bottom: 0; width: 520px; display: flex; flex-direction: column; justify-content: center; z-index: 5; }
#card-text .eyebrow { font: 500 15px var(--font-data); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
#card-text h1 { margin: 14px 0 0; font: 700 66px/1.0 var(--font-ui); letter-spacing: -0.03em; color: var(--ink); }
#card-text p { margin: 20px 0 0; font: 400 21px/1.45 var(--font-ui); color: var(--muted); max-width: 30ch; }
#card-text .url { margin-top: 30px; font: 500 17px var(--font-data); color: var(--ink); }
#card-scrim { pointer-events: none; position: fixed; inset: 0; z-index: 4; background: linear-gradient(90deg, var(--surface) 0%, var(--surface) 35%, transparent 49%); }
"""

async def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--url', default='http://127.0.0.1:8765/'); ap.add_argument('--site', default='30k30.github.io/mqtc')
    a = ap.parse_args()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1200, 'height': 630}, device_scale_factor=2, color_scheme='dark')
        await ctx.add_init_script("try { localStorage.setItem('qta-view', JSON.stringify({ ds: 'colors', n: 1000, layout: 'radial', lengths: 'equal' })); } catch (e) {}")
        pg = await ctx.new_page()
        await pg.goto(a.url)
        await pg.add_style_tag(content=CSS)
        await pg.evaluate("""site => { document.body.insertAdjacentHTML('beforeend', `<div id="card-scrim"></div><div id="card-text">
            <div class="eyebrow">Minimum quartet tree cost</div><h1>Quartet Tree Atlas</h1>
            <p>Trees for 1,000 handwritten digits and 1,000 colours, scored on 41,417,124,750 quartets.</p><div class="url">${site}</div></div>`); }""", a.site)
        await pg.wait_for_timeout(600)
        box = await pg.evaluate("() => { const r = document.getElementById('cv').getBoundingClientRect(); return [r.width, r.height]; }")
        # pan the wheel clear of the text: d3.zoom listens to mouse drags, so drag with the real mouse
        await pg.mouse.move(box[0] / 2, box[1] / 2); await pg.mouse.down(); await pg.mouse.move(box[0] / 2 + 292, box[1] / 2, steps=12); await pg.mouse.up()
        await pg.mouse.move(1199, 629)
        await pg.wait_for_timeout(300)
        tmp = ROOT / 'media' / '_card@2x.png'
        await pg.screenshot(path=str(tmp))
        await b.close()
    out = ROOT / 'media' / 'card.png'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(tmp), '-vf', 'scale=1200:630:flags=lanczos', str(out)], check=True)
    tmp.unlink(); print('wrote', out)

asyncio.run(main())
