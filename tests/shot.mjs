// tests/shot.mjs — 谱面截图工具：起本地服务 → 无头 Edge → 开始游戏 → 截静置+播放中两张 PNG
// 用法: node tests/shot.mjs   输出 tests/shot-idle.png + tests/shot-playing.png
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MIME = { '.html': 'text/html; charset=utf-8', '.wav': 'audio/wav', '.js': 'text/javascript', '.css': 'text/css' };
let server, PORT;
await new Promise(r => {
  server = http.createServer((req, res) => {
    const fp = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname === '/' ? 'index.html' : new URL(req.url, 'http://x').pathname));
    if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(fp, (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      res.end(d);
    });
  });
  server.listen(0, '127.0.0.1', () => { PORT = server.address().port; r(); });
});

const exe = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'));
spawn(exe, ['--headless=new', '--remote-debugging-port=9345', `--user-data-dir=${tmp}`, '--no-first-run', '--disable-gpu', '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' });
await sleep(2000);
const wsUrl = (await (await fetch('http://127.0.0.1:9345/json/list')).json()).find(t => t.type === 'page').webSocketDebuggerUrl;
const ws = new WebSocket(wsUrl);
let id = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };

async function shot(file) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, 'tests', file), Buffer.from(r.data, 'base64'));
  console.log('saved', file);
}

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?autostart=1` });
for (let i = 0; i < 100; i++) { if (await ev(`typeof gameState !== 'undefined' && gameState`) === 'repeating') break; await sleep(200); }
await sleep(600);
await shot('shot-idle.png');

await ev(`toggleScoreDemo()`);
await sleep(2600); // 走到第 4~5 音（4G/4F），有下加线音符未亮、普通高亮已推进
await shot('shot-playing.png');
await ev(`stopScoreDemo()`);

try { await send('Browser.close'); } catch {}
server.close();
process.exit(0);
