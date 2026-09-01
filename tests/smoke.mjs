// V11 鍗峰笜瀵瑰硻鐗堝啋鐑熸祴璇曪細CDP 鐩磋繛 Edge锛屽嵎甯樻剰鍥锯啋鍑哄崱鈫掓姢鐩锯啋榻愬皠瀵规挒鈫掔簿纭处鐩啋鑳滃埄
import fs from 'fs';

const OUT = 'E:/git_repo/music-games-demo/tests/';
const URL = 'http://127.0.0.1:8117/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 鎵句笓灞炴祴璇曟爣绛撅紱娌℃湁灏卞紑鍚庡彴鏂版爣绛撅紙WS 鏂瑰紡锛屼笉鐢ㄤ細鏂皟璇曠鍙ｇ殑 PUT /json/new锛?let tabs = await (await fetch('http://127.0.0.1:18802/json')).json();
let page = tabs.find(t => t.type === 'page' && t.url.includes('127.0.0.1:8117'));
if (!page) {
  const ver = await (await fetch('http://127.0.0.1:18802/json/version')).json();
  const bws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => { bws.onopen = r; bws.onerror = j; });
  const tid = await new Promise((res, rej) => {
    bws.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) { m.error ? rej(new Error(m.error.message)) : res(m.result.targetId); } };
    bws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'about:blank', background: true } }));
  });
  bws.close();
  await sleep(800);
  tabs = await (await fetch('http://127.0.0.1:18802/json')).json();
  page = tabs.find(t => t.id === tid);
}
if (!page) { console.log('FAIL no test tab'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map(); const jsErrs = [];
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++mid; pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') jsErrs.push('EXC: ' + JSON.stringify(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails).slice(0, 300));
  else if (m.method === 'Page.screencastFrame') send('Page.screencastFrameAck', { sessionId: m.params?.sessionId }).catch(() => {});
};
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.bringToFront');
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + 'shot_' + name + '.png', Buffer.from(r.data, 'base64'));
  console.log('shot saved:', name);
}
const log = [];
const check = (name, cond, extra) => log.push((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));

// ---- 1. 鍔犺浇锛氫袱鍗″彲鐢?+ 鏁屾柟鎰忓浘 3 鏍兼帓鍦ㄩ煶杞ㄥ彸绔?----
await send('Page.navigate', { url: URL });
await sleep(1000);
await send('Page.startScreencast', { format: 'jpeg', quality: 30, maxWidth: 900, maxHeight: 520, everyNthFrame: 2 });
await sleep(1600);
let st = await ev(`(function(){ const S=window.__game; if(!S) return null;
  return { phase:S.phase, turn:S.turn, php:S.php, ehp:S.ehp, shield:S.shield,
    used:S.cardsUsed, pendP:S.pending.p.length, pendE:S.pending.e.length,
    slotEDOM: document.querySelectorAll('.slot.e').length, slotPDOM: document.querySelectorAll('.slot.p').length,
    intentTxt: document.getElementById('intentLabel').textContent.slice(0,12) }; })()`);
check('鍒濆锛氭晫鎰忓浘3鏍煎湪闊宠建涓?, !!st && st.pendE === 3 && st.slotEDOM === 3 && st.pendP === 0, st);
check('鍒濆锛氫袱鍗″彲鐢?鏃犳姢鐩?, st.phase === 'play' && st.used.attack === false && st.used.defense === false && st.shield === 0, st);
let hpChk = await ev(`(function(){ return { hero: !!document.querySelector('#heroZone .hpbar'), enemy: !!document.querySelector('#enemyZone .hpbar') }; })()`);
check('琛€鏉℃寕鍦ㄨ鑹插ご涓?瑙掕壊鍖哄唴)', hpChk.hero === true && hpChk.enemy === true, hpChk);
await shot('01_initial');

// ---- 2. 鏀诲嚮鍗★細鍥涘路鏄ョ涓€鍙ユ帓宸︾锛坢i脳5 + sol脳1锛?---
let atk = await ev(`(function(){ const S=window.__game;
  document.getElementById('cardAttack').click();
  const lanes = {};
  S.pending.p.forEach(b=>lanes[b.note]=(lanes[b.note]||0)+1);
  return { pendP:S.pending.p.length, slotPDOM: document.querySelectorAll('.slot.p').length,
    used:S.cardsUsed.attack, springIdx:S.springIdx, lanes,
    steps: S.pending.p.map(b=>b.step).join(',') }; })()`);
check('鏀诲嚮鍗♀啋6鏍兼帓鍦ㄩ煶杞ㄥ乏绔?, atk.pendP === 6 && atk.slotPDOM === 6 && atk.used === true, atk);
check('鏄ヤ富棰樼涓€鍙?mi脳5+sol脳1', atk.lanes.mi === 5 && atk.lanes.sol === 1, atk);
check('鍙戝皠搴?step 0-5', atk.steps === '0,1,2,3,4,5', atk);
await shot('02_spring_queued');

// ---- 3. 闃插尽鍗★細鎶ょ浘 8 ----
st = await ev(`(function(){ const S=window.__game;
  document.getElementById('cardDefense').click();
  return { shield:S.shield, used:S.cardsUsed.defense }; })()`);
check('闃插尽鍗♀啋鎶ょ浘8', st.shield === 8 && st.used === true, st);

// ---- 4. 缁撴潫灏忚妭锛氶綈灏勨啋sol瀵规挒鍚屽敖鈫抦i脳5鍏ㄤ腑鈫抎o脳2琚浘鎸?----
await ev(`document.getElementById('endTurnBtn').click()`);
st = await ev(`(function(){ const S=window.__game; return { phase:S.phase, blocks:S.blocks.length }; })()`);
check('杩涘叆浜ゆ垬鎬?, st.phase === 'resolve', st);
await sleep(2500);
await shot('03_volley_flying');
st = await ev(`(function(){ return new Promise(res=>{ const t0=Date.now();
  const iv=setInterval(()=>{ const S=window.__game;
    if(S.phase==='play'||S.phase==='over'||Date.now()-t0>25000){ clearInterval(iv);
      res({turn:S.turn, phase:S.phase, php:S.php, ehp:S.ehp, shield:S.shield,
        used:S.cardsUsed, pendE:S.pending.e.length}); } },300); }); })()`);
check('缁撶畻鍥炵2灏忚妭', st.phase === 'play' && st.turn === 2, st);
check('绮剧‘璐︾洰锛氭晫鏂?66-20=46锛坢i脳5脳4绌块€忥紝sol鍚屽敖锛?, st.ehp === 46, st);
check('绮剧‘璐︾洰锛氭垜鏂?0 浼ゅ锛坉o脳2脳3=6 鍏ㄨ鎶ょ浘鍚告敹锛?, st.php === 50, st);
check('鏂板皬鑺傦細鍗￠噸缃?鏂版剰鍥?鏍?鎶ょ浘娓呴浂', st.used.attack === false && st.used.defense === false && st.pendE === 3 && st.shield === 0, st);
await shot('04_bar2');

// ---- 5. 鑳滃埄璺緞 ----
await ev(`(function(){ const S=window.__game; S.ehp=3;
  window.__api.spawnBlock('p','do',6); S.blocks[0].x = 99999; return true; })()`);
await sleep(1000);
st = await ev(`(function(){ return { overlay: document.getElementById('overlay').classList.contains('show') }; })()`);
check('鑳滃埄閬僵寮瑰嚭', st.overlay === true, st);
await shot('05_victory');

console.log('\n===== 缁撴灉 =====');
log.forEach(l => console.log(l));
console.log('js寮傚父:', jsErrs.length ? jsErrs : '鏃?);
ws.close(); process.exit(log.some(l => l.startsWith('FAIL')) || jsErrs.length ? 1 : 0);
