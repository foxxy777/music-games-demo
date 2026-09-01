// 临时静态服务器：给 v11 冒烟测试用
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = 'E:/git_repo/music-games-demo';
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript' };

http.createServer((req, res) => {
  const p = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  try {
    const data = fs.readFileSync(p);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(8117, '127.0.0.1', () => console.log('serving', ROOT, 'on 8117'));
