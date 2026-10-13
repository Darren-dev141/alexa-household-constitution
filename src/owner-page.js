'use strict';
// The decision-maker's phone page. Static HTML: it holds no secrets. The person types
// their home code once; it is kept only in this browser tab and sent as a header.
module.exports = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Waiting for your okay</title>
<style>
 body{font:17px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;margin:0;padding:16px;max-width:560px;color:#1d1d1f;background:#f6f6f7}
 h1{font-size:22px;margin:4px 0 12px} h2{font-size:15px;color:#666;margin:20px 0 8px;font-weight:600}
 .card{background:#fff;border-radius:14px;padding:14px;margin:0 0 10px;box-shadow:0 1px 2px rgba(0,0,0,.08)}
 .row{display:flex;gap:10px;margin-top:12px} button{flex:1;font-size:17px;padding:12px;border-radius:10px;border:0}
 .yes{background:#1a7f37;color:#fff} .no{background:#e8e8ea;color:#1d1d1f}
 .muted{color:#666} input{font-size:17px;padding:10px;width:100%;box-sizing:border-box;border-radius:10px;border:1px solid #ccc}
</style></head><body>
<h1>Waiting for your okay</h1>
<div id="login" class="card" hidden>
 <p>Enter your home code to see what's waiting.</p>
 <input id="code" type="password" autocomplete="current-password">
 <div class="row"><button class="yes" id="go">Continue</button></div>
</div>
<div id="list"></div>
<p class="muted" id="note"></p>
<script>
const KEY='home-code';
const code=()=>sessionStorage.getItem(KEY);
const api=(p,m='GET')=>fetch(p,{method:m,headers:{'x-owner-key':code()}});
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function card(title,body,yes,no){
  const d=document.createElement('div');d.className='card';
  d.innerHTML='<div><b>'+esc(title)+'</b></div><div>'+esc(body)+'</div><div class="row"><button class="yes">Okay</button><button class="no">No</button></div>';
  d.querySelector('.yes').onclick=()=>act(yes);d.querySelector('.no').onclick=()=>act(no);return d;
}
async function act(p){const r=await api(p,'POST');const j=await r.json().catch(()=>({}));
  document.getElementById('note').textContent=j.say||(j.status==='applied'?'Done. Your home now follows this.':j.status==='declined'?'Okay, nothing changed.':j.status==='expired'?'That waited too long, so nothing happened.':'Done.');load();}
async function load(){
  if(!code()){document.getElementById('login').hidden=false;return;}
  const r=await api('/owner/pending');
  if(r.status===401){sessionStorage.removeItem(KEY);document.getElementById('login').hidden=false;document.getElementById('note').textContent='That code did not match.';return;}
  const p=await r.json(),L=document.getElementById('list');L.innerHTML='';
  if(p.setup){L.insertAdjacentHTML('beforeend','<h2>New home setup</h2>');L.append(card('Start keeping these promises?',p.setup.say,'/owner/approve-setup','/owner/decline-setup'));}
  if(p.changes.length){L.insertAdjacentHTML('beforeend','<h2>Asked to change a promise</h2>');for(const c of p.changes)L.append(card('Change to:',c.say,'/owner/approve/'+c.id,'/owner/decline/'+c.id));}
  if(p.actions.length){L.insertAdjacentHTML('beforeend','<h2>Waiting to be done</h2>');for(const a of p.actions)L.append(card('Go ahead and '+a.what+'?','', '/owner/approve/'+a.id,'/owner/decline/'+a.id));}
  if(!p.setup&&!p.changes.length&&!p.actions.length)L.innerHTML='<div class="card muted">Nothing is waiting for you.</div>';
}
document.getElementById('go').onclick=()=>{sessionStorage.setItem(KEY,document.getElementById('code').value);document.getElementById('login').hidden=true;load();};
load();
</script></body></html>`;
