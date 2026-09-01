// V11 鎸夐挳涓撻」 TB锛氬ぇ鐖?09-01 11:53 鎸囩ず銆屽熀鏈殑鍔熻兘鎸夐挳閮界敤 tb 娴嬩竴涓嬨€?// 瑕嗙洊锛氶噸澶嶇偣鍗￠檺鍒?/ 缁撶畻涓偣鍗?/ 鍗囬樁脳3涓婇檺 / 瀹屾暣鐪熷疄瀵瑰眬閫氬叧 / 鍐嶅涓€鏇查噸寮€ / 澶辫触璺緞
import fs from 'fs';

const OUT = 'E:/git_repo/music-games-demo/tests/';
const URL = 'http://127.0.0.1:8117/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let tabs = await (await fetch('http://127.0.0.1:18802/json')).json();
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
  fs.writeFileSync(OUT + 'shot_btn_' + name + '.png', Buffer.from(r.data, 'base64'));
  console.log('shot saved: btn_' + name);
}
const log = [];
const check = (name, cond, extra) => log.push((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
const waitPlay = (timeout = 30000) => ev(`(function(){ return new Promise(res=>{ const t0=Date.now();
  const iv=setInterval(()=>{ const S=window.__game;
    if(S.phase==='play'||S.phase==='over'||Date.now()-t0>${timeout}){ clearInterval(iv); res({phase:S.phase,turn:S.turn,php:S.php,ehp:S.ehp}); } },250); }); })()`);

// ---- 鍔犺浇 ----
await send('Page.navigate', { url: URL });
await sleep(1000);
await send('Page.startScreencast', { format: 'jpeg', quality: 30, maxWidth: 900, maxHeight: 520, everyNthFrame: 2 });
await sleep(1500);

// ---- T1 鏀诲嚮鍗′簩杩炵偣锛氱浜屾琚嫆 ----
let st = await ev(`(function(){ const S=window.__game;
  document.getElementById('cardAttack').click();
  const pend1=S.pending.p.length;
  document.getElementById('cardAttack').click();
  return { pend1, pend2:S.pending.p.length, toast: document.getElementById('toast').textContent }; })()`);
check('T1 鏀诲嚮鍗′簩杩炵偣鈫掔浜屾琚嫆(宸插杩?', st.pend1 === 6 && st.pend2 === 6 && /宸插杩?.test(st.toast), st);

// ---- T2 闃插尽鍗′簩杩炵偣锛氱浜屾琚嫆 ----
await ev(`document.getElementById('cardDefense').click()`);
await sleep(1000);
st = await ev(`(function(){ const S=window.__game;
  const sum1=Object.values(S.defense).reduce((a,b)=>a+b,0);
  document.getElementById('cardDefense').click();
  return { sum1, sum2:Object.values(S.defense).reduce((a,b)=>a+b,0),
    toast: document.getElementById('toast').textContent }; })()`);
check('T2 闃插尽鍗′簩杩炵偣鈫掔浜屾琚嫆(宸茬敤)', st.sum1 === 7 && st.sum2 === 7 && /宸茬敤/.test(st.toast), st);

// ---- T3 缁撶畻涓偣鍗♀啋鎷掔粷 ----
st = await ev(`(function(){ const S=window.__game;
  document.getElementById('endTurnBtn').click();
  const pendBefore=S.pending.p.length;
  document.getElementById('cardAttack').click();
  return { phase:S.phase, pendBefore, pendAfter:S.pending.p.length,
    toast: document.getElementById('toast').textContent,
    btnDisabled: document.getElementById('endTurnBtn').disabled }; })()`);
check('T3 浜ゆ垬涓偣鍗♀啋鎷掔粷(杩欎竴灏忚妭宸茬粡缁撴潫鍟?', st.phase === 'resolve' && st.pendAfter === st.pendBefore && /缁撴潫/.test(st.toast), st);
check('T3b 浜ゆ垬涓粨鏉熸寜閽鐢?, st.btnDisabled === true, st);
st = await waitPlay(25000);
check('T4 绗?灏忚妭缁撶畻鈫掔2灏忚妭', st.phase === 'play' && st.turn === 2, st);

// ---- T5 鍗囬樁脳3涓婇檺锛氫綔寮婄疆婊″悗鐐瑰崱涓嶅啀娑?----
st = await ev(`(function(){ const S=window.__game;
  ['do','re','mi','fa','sol','la','si'].forEach(k=>S.defense[k]=3);
  document.getElementById('cardDefense').click();
  return new Promise(res=>setTimeout(()=>{
    const d=S.defense; res({ defSum:Object.values(d).reduce((a,b)=>a+b,0),
      allMax3: Object.values(d).every(v=>v===3),
      toast: document.getElementById('toast').textContent,
      multDOM: [...document.querySelectorAll('.defslot .mult')].map(e=>e.textContent).join(',') });
  }, 1200)); })()`);
check('T5 灞傛暟鍒懊?涓婇檺鍚庡啀鎵撲笉娑?, st.allMax3 === true && st.defSum === 21, st);
check('T5b 涔樻暟鏍囪鍏ㄩ儴鏄剧ず脳3', st.multDOM === '脳3,脳3,脳3,脳3,脳3,脳3,脳3', st);
await shot('01_defmax3');

// ---- T6 瀹屾暣鐪熷疄瀵瑰眬锛氭瘡鍥炲悎鍑烘敾鍑?缁撴潫锛岀洿鍒拌儨鍒?----
st = await ev(`(function(){ return new Promise(res=>{ const t0=Date.now();
  function bar(){ const S=window.__game;
    if(S.phase==='over'){ clearInterval(iv); res({win:true, turn:S.turn, ms:Date.now()-t0}); return; }
    if(S.phase==='play'){
      if(!S.cardsUsed.attack){ document.getElementById('cardAttack').click(); }
      else { document.getElementById('endTurnBtn').click(); }
    }
    if(Date.now()-t0>150000){ clearInterval(iv); res({win:false, turn:S.turn, ehp:S.ehp, php:S.php}); } }
  const iv=setInterval(bar, 400); }); })()`);
check('T6 瀹屾暣鐪熷疄瀵瑰眬閫氬叧(涓嶆墜鍔ㄤ綔寮?', st.win === true, st);
await shot('02_victory_full');
st = await ev(`(function(){ return { overlay: document.getElementById('overlay').classList.contains('show'),
  title: document.getElementById('overlayTitle').textContent,
  sub: document.getElementById('overlaySub').textContent }; })()`);
check('T6b 鑳滃埄閬僵鏂囨', /婕斿嚭鎴愬姛/.test(st.title) && st.overlay === true, st);

// ---- T7 鍐嶅涓€鏇?鈫?reload 澶嶄綅 ----
st = await ev(`(function(){ document.getElementById('overlayBtn').click(); return true; })()`);
await sleep(2000);
st = await ev(`(function(){ const S=window.__game;
  return { turn:S.turn, php:S.php, ehp:S.ehp, phase:S.phase,
    defSum:Object.values(S.defense).reduce((a,b)=>a+b,0),
    used:S.cardsUsed, pendP:S.pending.p.length }; })()`);
check('T7 鍐嶅涓€鏇测啋鏁村眬澶嶄綅(turn1/婊¤/鏃犻槻寰?鍗″彲鐢?', st.turn === 1 && st.php === 50 && st.ehp === 66 && st.defSum === 0 && st.used.attack === false && st.pendP === 0, st);

// ---- T8 澶辫触璺緞锛歱hp=2 纭悆涓€鍙?----
await ev(`(function(){ const S=window.__game;
  document.getElementById('cardAttack').click(); // 鍑哄崱璁╂晫鏂规湁瀵瑰眬鍐呭
  document.getElementById('endTurnBtn').click();
  S.php=2; // 浣滃紛鍘嬪埌婵掓锛岀瓑鏁屾柟婕忕綉涔嬮煶鍒拌劯
  return true; })()`);
st = await ev(`(function(){ return new Promise(res=>{ const t0=Date.now();
  const iv=setInterval(()=>{ const S=window.__game;
    if(S.phase==='over'){ clearInterval(iv); res({win:false, php:S.php, title:document.getElementById('overlayTitle').textContent}); }
    else if(Date.now()-t0>25000){ clearInterval(iv); res({win:false, timeout:true, phase:S.phase, php:S.php}); } },250); }); })()`);
check('T8 澶辫触璺緞鈫掑０闊冲搼浜?, st.timeout !== true && /澹伴煶鍝戜簡/.test(st.title), st);
await shot('03_defeat');
st = await ev(`(function(){ document.getElementById('overlayBtn').click(); return true; })()`);
await sleep(2000);
st = await ev(`(function(){ const S=window.__game; return { turn:S.turn, php:S.php }; })()`);
check('T8b 澶辫触鍚庡啀濂忎竴鏇测啋澶嶄綅', st.turn === 1 && st.php === 50, st);

console.log('\n===== 缁撴灉 =====');
log.forEach(l => console.log(l));
console.log('js寮傚父:', jsErrs.length ? jsErrs : '鏃?);
ws.close(); process.exit(log.some(l => l.startsWith('FAIL')) || jsErrs.length ? 1 : 0);
