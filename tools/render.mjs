// Render an episode to MP4 (SIM_SPEC §8.2): Playwright drives render mode
// frame by frame, ffmpeg encodes. Needs `npm run serve` running and ffmpeg on PATH.
// usage: node tools/render.mjs episodes/e02-gfl-vs-gfm-fault output/e02_linkedin.mp4 linkedin [--final] [--audio music.mp3]
// Uses the locally installed Chrome (or Edge) so no Playwright browser download is needed.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const [ep, out, fmt = 'linkedin'] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--audio');
if (!ep || !out) { console.error('usage: node tools/render.mjs <episode dir> <out.mp4> [linkedin|youtube|square] [--final] [--audio file]'); process.exit(1); }

const SIZES = { linkedin: [1080, 1350], youtube: [1920, 1080], square: [1080, 1080] };
const [W, H] = SIZES[fmt];
const FPS = 30;
const preset = flag('--final') ? 'slow' : 'veryfast';
const audio = opt('--audio');

async function launch() {
  for (const channel of ['chrome', 'msedge', undefined]) {
    try { return await chromium.launch(channel ? { channel } : {}); } catch { /* try the next one */ }
  }
  throw new Error('no browser: install Chrome/Edge or run `npx playwright install chromium`');
}

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const epPath = ep.replace(/\\/g, '/').replace(/\/$/, '');
await page.goto(`http://localhost:5173/${epPath}/index.html?render=1&w=${W}&h=${H}`);
await page.waitForFunction(() => window.SIM && window.SIM.ready === true, null, { timeout: 120000 });
const duration = await page.evaluate(() => window.SIM.videoDuration);

const ffArgs = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-'];
if (audio) ffArgs.push('-i', audio, '-af', 'loudnorm=I=-18', '-shortest', '-c:a', 'aac', '-b:a', '160k');
ffArgs.push('-c:v', 'libx264', '-preset', preset, '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);
const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });

const N = Math.round(duration * FPS);
const t0 = Date.now();
for (let f = 0; f < N; f++) {
  await page.evaluate((t) => window.SIM.renderAt(t), f / FPS);
  const buf = await page.screenshot({ type: 'png' });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (f % 30 === 0) process.stdout.write(`\rframe ${f}/${N}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
ff.stdin.end();
const code = await new Promise((r) => ff.on('close', r));
await browser.close();
if (code !== 0) { console.error(`\nffmpeg exited with ${code}`); process.exit(1); }
console.log(`\nwrote ${out} · ${N} frames · ${duration.toFixed(1)} s · ${W}×${H} @ ${FPS} fps`);
