#!/usr/bin/env python3
"""render_video.py: a scripted run through demo/index.html, rendered to MP4 (1920x1080, 30 fps, H.264).

Time inside the page is virtual. performance.now and requestAnimationFrame are replaced before the page
loads, and every frame advances the clock by exactly 1/30 s before the screenshot, so each morph renders
at full frame rate however slow the machine is. Cursor, captions and title cards are page overlays.

usage:  python3 demo/video/render_video.py [--out quartet-tree-atlas.mp4] [--outro "github.com/you/repo"]
                                           [--preview 3,10,20]   (PNG stills at those seconds, no video)
needs:  python playwright with chromium, ffmpeg with libx264 (d3 and fonts come from assets/)
"""
import argparse, asyncio, math, subprocess
from pathlib import Path
from playwright.async_api import async_playwright

HERE = Path(__file__).resolve().parent
FPS = 30

CLOCK = r"""(() => {
  let now = 0, id = 0; const q = new Map(), t0 = Date.now();
  performance.now = () => now; Date.now = () => t0 + now;
  window.requestAnimationFrame = cb => { q.set(++id, cb); return id; };
  window.cancelAnimationFrame = i => { q.delete(i); };
  window.__advance = ms => { now += ms; const cbs = [...q.values()]; q.clear(); for (const cb of cbs) { try { cb(now); } catch (e) { console.error(e); } } };
  try { localStorage.setItem('qta-view', JSON.stringify({ ds: 'digits', n: 1000, layout: 'unrooted', lengths: 'equal' })); } catch (e) {}
})();"""

HOOK = """readTokens(); resize(); load();
  window.__QTA = { state, select, zoom, cv, base, get T() { return T; }, get X() { return X; }, get Y() { return Y; }, get W() { return W; }, get H() { return H; }, get zt() { return zt; } };"""

OVERLAY = r"""
<style>
#v-cursor { position: fixed; left: 0; top: 0; width: 30px; height: 30px; z-index: 90; pointer-events: none; opacity: 0; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
#v-ring { position: fixed; left: 0; top: 0; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; border: 2.5px solid var(--accent); z-index: 89; pointer-events: none; opacity: 0; }
#v-cap { position: fixed; z-index: 40; max-width: 640px; padding: 12px 18px 13px; border-radius: 10px; background: var(--surface); border: 1px solid var(--rule); box-shadow: 0 10px 30px rgba(0,0,0,.35); opacity: 0; pointer-events: none; }
#v-cap b { display: block; font: 500 23px/1.2 var(--font-ui); color: var(--ink); letter-spacing: -0.01em; }
#v-cap span { display: block; font: 400 15px/1.35 var(--font-data); color: var(--muted); margin-top: 4px; }
#v-card { position: fixed; inset: 0; z-index: 80; display: grid; place-content: center; text-align: center; background: var(--bg); opacity: 0; pointer-events: none; padding-inline: 40px; }
#v-card h1 { margin: 0; font: 700 72px/1.02 var(--font-ui); letter-spacing: -0.03em; color: var(--ink); }
#v-card p { margin: 18px 0 0; font: 400 21px/1.5 var(--font-data); color: var(--muted); }
#v-card p.k { color: var(--accent); margin-top: 26px; font-weight: 500; }
#v-fade { position: fixed; z-index: 30; background: var(--surface); opacity: 0; pointer-events: none; border-radius: 10px; }
</style>
<div id="v-fade"></div><div id="v-cap"></div><div id="v-card"></div><div id="v-ring"></div>
<svg id="v-cursor" viewBox="0 0 30 30"><path d="M3 2 L3 24 L8.6 18.6 L12.6 27 L16.2 25.4 L12.3 17.3 L20 17.3 Z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>
<script>
(() => {
  const $ = id => document.getElementById(id);
  const place = () => { const r = $('stage').getBoundingClientRect(), f = $('v-fade'), c = $('v-cap');
    Object.assign(f.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    Object.assign(c.style, { left: (r.left + 22) + 'px', bottom: (innerHeight - r.bottom + 22) + 'px' }); };
  place(); $('hint').hidden = true;
  window.__V = s => {
    $('v-cursor').style.transform = `translate(${s.cx}px, ${s.cy}px)`; $('v-cursor').style.opacity = s.cshow;
    $('v-ring').style.transform = `translate(${s.cx}px, ${s.cy}px) scale(${s.rs})`; $('v-ring').style.opacity = s.ro;
    const cap = $('v-cap'); if (cap.dataset.k !== s.capk) { cap.innerHTML = s.caph; cap.dataset.k = s.capk; }
    cap.style.opacity = s.capo; cap.style.transform = `translateY(${(1 - s.capo) * 10}px)`;
    const card = $('v-card'); if (card.dataset.k !== s.cardk) { card.innerHTML = s.cardh; card.dataset.k = s.cardk; } card.style.opacity = s.cardo;
    $('v-fade').style.opacity = s.fadeo; document.querySelector('aside').scrollTop = s.aside;
    if (s.hover) __QTA.cv.dispatchEvent(new PointerEvent('pointermove', { clientX: s.cx, clientY: s.cy, bubbles: true }));
    window.__advance(1000 / 30);
  };
  const Q = () => window.__QTA;
  window.__V.view = () => { const q = Q(), t = q.zt, s = Math.min(q.W, q.H); return [(q.W / 2 - t.x) / t.k, (q.H / 2 - t.y) / t.k, s / t.k]; };
  window.__V.home = () => { const q = Q(); return [q.W / 2, q.H / 2, Math.min(q.W, q.H)]; };
  window.__V.setView = v => { const q = Q(), s = Math.min(q.W, q.H), k = s / v[2]; d3.select(q.cv).call(q.zoom.transform, d3.zoomIdentity.translate(q.W / 2 - v[0] * k, q.H / 2 - v[1] * k).scale(k)); };
  window.__V.camTo = v => { window.__cam = d3.interpolateZoom(window.__V.view(), v); };
  window.__V.cam = u => window.__V.setView(window.__cam(u));
  window.__V.nodeC = v => { const q = Q(); return [q.W / 2 + q.X[v] * q.base(), q.H / 2 + q.Y[v] * q.base()]; };
  window.__V.nodeScreen = v => { const q = Q(), c = window.__V.nodeC(v), r = q.cv.getBoundingClientRect(); return [r.left + q.zt.applyX(c[0]), r.top + q.zt.applyY(c[1])]; };
  window.__V.selTop = () => { const a = document.querySelector('aside'), r = $('selbox').closest('section').getBoundingClientRect(); return Math.min(a.scrollHeight - a.clientHeight, r.top - a.getBoundingClientRect().top + a.scrollTop - 4); };
  window.__V.center = id => { const r = $(id).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  // purest clade with lo..hi leaves (digits); returns node, its leaves and a camera view framing them
  window.__V.clade = (lo, hi) => { const T = Q().T, lab = T.d.label; let best = -1, bs = -1;
    for (let v = T.n; v < T.V; v++) { const c = T.cnt[v]; if (c < lo || c > hi) continue; const k = new Array(10).fill(0);
      for (let i = T.first[v]; i <= T.last[v]; i++) k[lab[T.leafOrder[i]]]++; const s = Math.max(...k) / c * 1000 + c; if (s > bs) { bs = s; best = v; } }
    const leaves = T.leafOrder.slice(T.first[best], T.last[best] + 1), pts = leaves.map(window.__V.nodeC).concat([window.__V.nodeC(best)]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { v: best, leaves, view: [(x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0) * 1.5 + 30] }; };
})();
</script>
"""

ease = lambda u: 4 * u ** 3 if u < 0.5 else 1 - (-2 * u + 2) ** 3 / 2   # cubic in-out


class Video:
    def __init__(self, page, sink):
        self.page, self.sink, self.f, self.bg = page, sink, 0, []
        self.s = dict(cx=1330.0, cy=650.0, cshow=0.0, rs=0.4, ro=0.0, capk='', caph='', capo=0.0, cardk='', cardh='', cardo=0.0, fadeo=0.0, aside=0.0, hover=False)

    async def tick(self):
        for a in list(self.bg):
            if await a():
                self.bg.remove(a)
        await self.page.evaluate('s => window.__V(s)', self.s)
        await self.sink(self.page, self.f)
        self.f += 1

    async def hold(self, sec):
        for _ in range(round(sec * FPS)):
            await self.tick()

    def tween(self, key, to, sec, fn=ease):   # background tween of an overlay value
        a, n, i = self.s[key], max(1, round(sec * FPS)), [0]
        async def step():
            i[0] += 1; self.s[key] = a + (to - a) * fn(min(1, i[0] / n)); return i[0] >= n
        self.bg.append(step); return step

    async def wait(self, *steps):   # run until the given background animations (default: all) are done
        while any(st in self.bg for st in steps) if steps else self.bg:
            await self.tick()

    async def move(self, xy, sec):
        await self.wait(self.tween('cx', xy[0], sec), self.tween('cy', xy[1], sec))

    async def ripple(self):
        self.s['rs'], self.s['ro'] = 0.35, 0.95
        self.tween('rs', 1.35, 0.4, lambda u: 1 - (1 - u) ** 2); self.tween('ro', 0.0, 0.4)

    async def click(self, el_id, move=0.5, settle=0.12):
        await self.move(await self.page.evaluate('id => __V.center(id)', el_id), move)
        await self.hold(settle); await self.ripple()
        await self.page.evaluate('id => document.getElementById(id).click()', el_id)

    def caption(self, title, sub=''):
        self.s['capk'] = title; self.s['caph'] = f'<b>{title}</b>' + (f'<span>{sub}</span>' if sub else ''); self.s['capo'] = 0.0
        self.tween('capo', 1.0, 0.35)

    async def caption_out(self, sec=0.25):
        await self.wait(self.tween('capo', 0.0, sec))

    async def camera(self, view, sec):
        await self.page.evaluate('v => __V.camTo(v)', view)
        n, i = max(1, round(sec * FPS)), [0]
        async def step():
            i[0] += 1; await self.page.evaluate('u => __V.cam(u)', ease(min(1, i[0] / n))); return i[0] >= n
        self.bg.append(step); return step


async def timeline(v, outro):
    P = v.page
    # 0. title card over the unrooted digit tree
    v.s.update(cardk='title', cardo=1.0, cardh='<h1>Quartet Tree Atlas</h1><p>1,000 handwritten digits · 41,417,124,750 quartets · one tree</p>')
    await v.hold(2.2); v.tween('cardo', 0.0, 0.7); await v.wait()
    # 1. highlight digit classes (slow push-in underneath)
    home = await P.evaluate('() => __V.home()')
    await v.camera([home[0], home[1] * 1.04, home[2] / 1.12], 6.5)
    v.tween('cshow', 1.0, 0.3)
    v.caption('Highlight a digit', 'each leaf is one 8×8 scan from the sklearn digits')
    for i, d in enumerate([0, 7, 3]):
        await v.click(f'chip-{d}', move=0.85 if i == 0 else 0.45); await v.hold(1.35)
    await v.click('chip-3', move=0.3); await v.hold(0.3)
    # 2. zoom into a clade, hover a few leaves, select the clade
    await v.caption_out()
    c = await P.evaluate('() => __V.clade(36, 70)')
    v.caption('Zoom in: every leaf is a digit')
    await v.wait(await v.camera(c['view'], 2.0))
    v.s['hover'] = True
    for leaf in c['leaves'][2:9:3]:
        await v.move(await P.evaluate('l => __V.nodeScreen(l)', leaf), 0.55); await v.hold(0.35)
    v.s['hover'] = False
    await P.evaluate('() => __QTA.cv.dispatchEvent(new PointerEvent("pointerleave"))')
    await v.caption_out()
    v.caption('Click a branch: what is in this clade?', 'the panel counts its leaves by digit')
    await v.move(await P.evaluate('n => __V.nodeScreen(n)', c['v']), 0.6); await v.hold(0.1); await v.ripple()
    await P.evaluate('n => __QTA.select(n)', c['v']); v.tween('aside', await P.evaluate('() => __V.selTop()'), 0.7); await v.hold(2.2)
    await v.wait(await v.camera(await P.evaluate('() => __V.home()'), 1.8)); await v.hold(0.5)
    # 3. same tree, other drawings
    await v.caption_out()
    v.caption('Same tree, radial layout', 'leaves in tree order around the circle')
    await v.click('clear', move=0.7); await v.wait(v.tween('aside', 0.0, 0.6)); await v.click('chip-7', move=0.6); await v.hold(0.3)
    await v.click('lay-radial', move=0.7); await v.hold(1.7)
    await v.caption_out(); v.caption('Back to unrooted, with fitted branch lengths', 'balanced least-squares lengths; only the branching is optimised')
    await v.click('lay-unrooted', move=0.5); await v.hold(1.2); await v.click('len-fitted', move=0.45); await v.hold(1.7)
    await v.click('chip-7', move=0.6); await v.hold(0.2)
    # 4. colours
    await v.caption_out()
    await v.move(await P.evaluate('() => __V.center("ds-colors")'), 0.8); await v.wait(v.tween('fadeo', 1.0, 0.22)); await v.click('ds-colors', move=0.05, settle=0.0)
    await v.click('len-equal', move=0.5, settle=0.0); await v.hold(0.1)
    v.tween('fadeo', 0.0, 0.4)
    v.caption('1,000 random colours', 'CIEDE2000 colour difference, same solver')
    await v.hold(1.9)
    await v.click('lay-radial', move=0.6); await v.hold(0.9)
    # finish on the colour wheel: drift along its rim
    home = await P.evaluate('() => __V.home()'); v.tween('cshow', 0.0, 0.4)
    await v.wait(await v.camera([home[0] + home[2] * 0.16, home[1] - home[2] * 0.30, home[2] / 2.1], 3.2)); await v.hold(0.5)
    # 5. end card
    await v.caption_out()
    v.s.update(cardk='end', cardh='<h1>Minimum quartet tree cost</h1><p>every SPR move priced in O(1) · exact 12-subtree rearrangements<br>fusion of local optima · n = 1000 in about a minute on 2 cores</p>'
               + (f'<p class="k">{outro}</p>' if outro else ''))
    v.tween('cardo', 1.0, 0.6); await v.wait(); await v.hold(2.9)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(HERE / 'quartet-tree-atlas.mp4'))
    ap.add_argument('--outro', default='')
    ap.add_argument('--preview', default='')
    ap.add_argument('--d3', default=str(HERE.parent.parent / 'assets' / 'd3.v7.9.0.min.js'))
    a = ap.parse_args()
    page_src = (HERE.parent / 'index.html').read_text()
    assert 'readTokens(); resize(); load();' in page_src, 'demo/index.html: hook point not found'
    vid_html = HERE / '_render.html'
    vid_html.write_text(page_src.replace('readTokens(); resize(); load();', HOOK, 1) + OVERLAY)
    fonts = HERE.parent.parent / 'assets' / 'fonts'
    font_css = ("@font-face{font-family:'Schibsted Grotesk';src:url(https://fonts.gstatic.com/v/sg.ttf) format('truetype');font-weight:400 900}"
                "@font-face{font-family:'IBM Plex Mono';src:url(https://fonts.gstatic.com/v/p4.ttf) format('truetype');font-weight:400}"
                "@font-face{font-family:'IBM Plex Mono';src:url(https://fonts.gstatic.com/v/p5.ttf) format('truetype');font-weight:500}")
    files = {'sg.ttf': 'SchibstedGrotesk-wght.ttf', 'p4.ttf': 'IBMPlexMono-Regular.ttf', 'p5.ttf': 'IBMPlexMono-Medium.ttf'}
    preview = sorted(round(float(t) * FPS) for t in a.preview.split(',') if t)
    ff = None
    if not preview:
        ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', str(FPS), '-c:v', 'png', '-i', '-',
                               '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', str(FPS),
                               '-movflags', '+faststart', a.out], stdin=subprocess.PIPE)

    async def sink(page, f):
        if ff:
            ff.stdin.write(await page.screenshot(type='png'))
            if f % 150 == 0: print(f'  {f / FPS:5.1f} s', flush=True)
        elif f in preview:
            await page.screenshot(path=str(HERE / f'preview_{f / FPS:05.1f}s.png')); print('preview', f / FPS)

    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1280, 'height': 720}, device_scale_factor=1.5, color_scheme='dark')
        await ctx.add_init_script(CLOCK)
        page = await ctx.new_page()
        page.on('pageerror', lambda e: print('page error:', e))
        d3src = Path(a.d3).read_text()
        await page.route('**/d3.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=d3src))
        await page.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=font_css, headers={'Access-Control-Allow-Origin': '*'}))
        await page.route('https://fonts.gstatic.com/v/*', lambda r: r.fulfill(status=200, content_type='font/ttf', path=str(fonts / files[r.request.url.rsplit('/', 1)[1]]), headers={'Access-Control-Allow-Origin': '*'}))
        await page.goto(vid_html.as_uri())
        await page.wait_for_function("document.fonts.check('500 16px \"IBM Plex Mono\"') && document.fonts.check('700 16px \"Schibsted Grotesk\"') && window.__QTA && window.__QTA.X")
        await page.evaluate("() => document.fonts.ready")
        await page.evaluate("() => { for (let i = 0; i < 10; i++) window.__advance(1000 / 30); }")
        v = Video(page, sink)
        await timeline(v, a.outro)
        print(f'{v.f} frames = {v.f / FPS:.1f} s')
        await b.close()
    if ff:
        ff.stdin.close(); ff.wait()
        print('wrote', a.out)
    vid_html.unlink()

asyncio.run(main())
