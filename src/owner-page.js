'use strict';
// The decision-maker's phone page. Static HTML: it holds no secrets. The person types
// their home code once; it is kept only in this browser tab and sent as a header.
// It checks for new requests every few seconds while open, so nothing needs a reload.
module.exports = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Waiting for your okay</title>
<style>
 :root{--bg:#f6f6f7;--card:#fff;--fg:#1d1d1f;--muted:#5f5f66;--yes:#1a7f37;--yes-fg:#fff;--no:#e8e8ea;--line:#ccc;--shadow:0 1px 2px rgba(0,0,0,.08)}
 @media (prefers-color-scheme:dark){:root{--bg:#111113;--card:#1e1e21;--fg:#f2f2f4;--muted:#a1a1a8;--yes:#238636;--no:#3a3a3f;--line:#444;--shadow:none}}
 body{font:17px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;margin:0 auto;padding:16px;max-width:560px;color:var(--fg);background:var(--bg)}
 h1{font-size:22px;margin:4px 0 2px} h2{font-size:15px;color:var(--muted);margin:20px 0 8px;font-weight:600}
 .card{background:var(--card);border-radius:14px;padding:14px;margin:0 0 10px;box-shadow:var(--shadow)}
 .why{color:var(--muted);margin-top:6px;font-size:15px}
 .row{display:flex;gap:10px;margin-top:12px} button{flex:1;font-size:17px;padding:12px;min-height:48px;border-radius:10px;border:0;color:var(--fg)}
 button:disabled{opacity:.5} .yes{background:var(--yes);color:var(--yes-fg)} .no{background:var(--no)}
 .muted{color:var(--muted)} .small{font-size:13px} a{color:inherit}
 input{font-size:17px;padding:10px;width:100%;box-sizing:border-box;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
</style></head><body>
<h1>Waiting for your okay</h1>
<p class="muted small" id="status">&nbsp;</p>
<form id="login" class="card" hidden>
 <label for="code">Enter your home code to see what's waiting.</label>
 <input id="code" type="password" autocomplete="current-password" required>
 <div class="row"><button class="yes" type="submit">Continue</button></div>
</form>
<div id="list"></div>
<p id="note" role="status" aria-live="polite"></p>
<p class="small" id="out" hidden><a href="#" id="forget">Forget the home code on this phone</a></p>
<script>
const KEY='home-code', EVERY_MS=3000;
const code=()=>sessionStorage.getItem(KEY);
const api=(p,m='GET')=>fetch(p,{method:m,headers:{'x-owner-key':code()},cache:'no-store'});
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const $=id=>document.getElementById(id);
let busy=false, last='', noteAt=0;\nconst note=t=>{$('note').textContent=t;noteAt=Date.now();};
function card(title,body,yes,no){
  const d=document.createElement('div');d.className='card';
  d.innerHTML='<div><b>'+esc(title)+'</b></div>'+(body?'<div class="why">'+esc(body)+'</div>':'')+
    '<div class="row"><button class="yes">Okay</button><button class="no">No</button></div>';
  d.querySelector('.yes').onclick=()=>act(d,yes);d.querySelector('.no').onclick=()=>act(d,no);return d;
}
async function act(d,p){
  if(busy)return; busy=true; d.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{const r=await api(p,'POST');const j=await r.json().catch(()=>({}));
    note(j.say||(j.status==='applied'?'Done. Your home now follows this.':j.status==='declined'?"Okay, it won't happen.":j.status==='expired'?'That waited too long, so nothing happened.':r.ok?'Done.':'That did not go through. Try again.'));}
  catch{note('Could not reach your home. Check your connection.');}
  finally{busy=false;last='';load();}
}
function showLogin(msg){$('login').hidden=false;$('out').hidden=true;$('list').innerHTML='';if(msg)$('note').textContent=msg;}
async function load(){
  if(busy)return;
  if(!code())return showLogin();
  let r;
  try{r=await api('/owner/pending');}catch{$('status').textContent='Offline. Trying again…';return;}
  if(r.status===401){sessionStorage.removeItem(KEY);return showLogin('That code did not match.');}
  if(r.status===429){$('status').textContent='Too many wrong codes. Try again in 15 minutes.';return;}
  if(!r.ok){$('status').textContent='Your home did not answer. Trying again…';return;}
  const p=await r.json(), s=JSON.stringify(p);
  $('out').hidden=false;
  $('status').textContent='Checked '+new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'});
  if(s===last)return; last=s;\n  if(Date.now()-noteAt>4000)$('note').textContent=''; // an old result shouldn't sit under a new request
  const L=$('list');L.innerHTML='';
  if(p.setup){L.insertAdjacentHTML('beforeend','<h2>New home setup</h2>');L.append(card('Start keeping these promises?',p.setup.say,'/owner/approve-setup','/owner/decline-setup'));}
  if(p.changes.length){L.insertAdjacentHTML('beforeend','<h2>Asked to change a promise</h2>');for(const c of p.changes)L.append(card('Change to:',c.say,'/owner/approve/'+c.id,'/owner/decline/'+c.id));}
  if(p.actions.length){L.insertAdjacentHTML('beforeend','<h2>Waiting to be done</h2>');for(const a of p.actions)L.append(card('Go ahead and '+a.what+'?',(a.why||[]).length?'Waiting because '+a.why.join(' and ')+'.':'', '/owner/approve/'+a.id,'/owner/decline/'+a.id));}
  if(!p.setup&&!p.changes.length&&!p.actions.length)L.innerHTML='<div class="card muted">Nothing is waiting for you.</div>';
}
$('login').onsubmit=e=>{e.preventDefault();sessionStorage.setItem(KEY,$('code').value);$('code').value='';$('login').hidden=true;$('note').textContent='';last='';load();};
$('forget').onclick=e=>{e.preventDefault();sessionStorage.removeItem(KEY);last='';showLogin('Home code forgotten on this phone.');};
setInterval(()=>{if(!document.hidden&&code())load();},EVERY_MS);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
load();
</script></body></html>`;
