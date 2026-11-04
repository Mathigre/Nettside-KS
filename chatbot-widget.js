import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { STORE_CONFIG } from './config.js';

if (!document.getElementById('hjertekraft-chat')) {
  const db = createClient(STORE_CONFIG.supabaseUrl, STORE_CONFIG.supabasePublishableKey);
  const host = document.createElement('div');
  host.id = 'hjertekraft-chat';
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      *{box-sizing:border-box}.launcher{position:fixed;right:22px;bottom:22px;z-index:2147483000;display:flex;align-items:center;gap:9px;border:0;border-radius:999px;padding:13px 18px;background:#292628;color:#fff;box-shadow:0 7px 26px #27212430;font:600 12px/1.2 Arial,sans-serif;cursor:pointer}.launcher img{width:23px;height:23px}.panel{position:fixed;right:22px;bottom:80px;z-index:2147483000;width:min(370px,calc(100vw - 24px));height:min(485px,calc(100dvh - 100px));display:flex;flex-direction:column;overflow:hidden;background:#fff;border:1px solid #ece7e6;box-shadow:0 14px 50px #28222426;color:#2c292b;font:14px/1.5 Arial,sans-serif}.panel[hidden]{display:none}.head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#fff;border-bottom:1px solid #f0ebea}.head-title{display:flex;align-items:center;gap:10px}.head-title img{width:31px;height:31px}.head strong{display:block;font-size:13px}.head small{display:block;color:#858082;font-size:10px}.close{width:32px;height:32px;border:0;background:transparent;font-size:22px;color:#757072;cursor:pointer}.notice{margin:0;padding:9px 14px;background:#fff8f3;color:#70696a;font-size:10px}.messages{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:9px}.bubble{max-width:88%;white-space:pre-wrap;overflow-wrap:anywhere;padding:9px 11px;border-radius:12px;font-size:12px}.bot{align-self:flex-start;background:#f5f2f1}.user{align-self:flex-end;background:#f16988;color:#fff}.status{min-height:17px;padding:0 14px;color:#8a8183;font-size:10px}.form{display:flex;gap:7px;padding:11px;border-top:1px solid #eee}.form input{min-width:0;flex:1;border:1px solid #e6e0df;padding:10px 11px;font-size:12px;outline:none}.form input:focus{border-color:#36b7a9}.form button{border:0;background:#292628;color:#fff;padding:0 13px;font-size:11px;cursor:pointer}.form button:disabled{opacity:.6;cursor:wait}@media(max-width:480px){.launcher{right:13px;bottom:13px}.panel{right:10px;bottom:68px;width:calc(100vw - 20px)}}
    </style>
    <button class="launcher" aria-expanded="false" aria-haspopup="dialog"><img src="assets/hjertekraft-mark.svg" alt=""><span>Spør Hjertekraft</span></button>
    <section class="panel" role="dialog" aria-label="Spør Hjertekraft" hidden><header class="head"><div class="head-title"><img src="assets/hjertekraft-mark.svg" alt=""><div><strong>Spør Hjertekraft</strong><small>En liten digital hjelper</small></div></div><button class="close" aria-label="Lukk chat">×</button></header><p class="notice">Svarene er laget for denne nettbutikkdemoen. Ikke del sensitive opplysninger.</p><div class="messages" aria-live="polite"><div class="bubble bot">Hei! Jeg kan fortelle om nettbutikkforslaget. Produktene her er bare eksempler. Hva lurer du på?</div></div><div class="status" aria-live="polite"></div><form class="form"><input name="message" required maxlength="700" autocomplete="off" placeholder="Skriv et spørsmål …" aria-label="Skriv et spørsmål"><button type="submit">Send</button></form></section>`;
  const launcher = root.querySelector('.launcher');
  const panel = root.querySelector('.panel');
  const input = root.querySelector('input');
  const form = root.querySelector('form');
  const send = form.querySelector('button');
  const messagesEl = root.querySelector('.messages');
  const status = root.querySelector('.status');
  const conversation = [];
  function add(role, value) { const bubble=document.createElement('div'); bubble.className=`bubble ${role==='user'?'user':'bot'}`; bubble.textContent=value; messagesEl.append(bubble); messagesEl.scrollTop=messagesEl.scrollHeight; }
  function open(value) { panel.hidden=!value; launcher.setAttribute('aria-expanded',String(value)); if(value)input.focus(); else launcher.focus(); }
  launcher.addEventListener('click',()=>open(panel.hidden));
  root.querySelector('.close').addEventListener('click',()=>open(false));
  form.addEventListener('submit',async event=>{
    event.preventDefault(); const message=input.value.trim(); if(!message||send.disabled)return;
    conversation.push({role:'user',content:message}); add('user',message); input.value=''; send.disabled=true; status.textContent='Skriver svar …';
    try {
      const {data,error}=await db.functions.invoke('store-assistant',{body:{messages:conversation.slice(-8)}});
      if(error||typeof data?.answer!=='string')throw new Error('not-ready');
      conversation.push({role:'assistant',content:data.answer}); add('assistant',data.answer); status.textContent='';
    } catch { status.textContent='Hjelperen er ikke aktiv ennå. Du kan bruke kontaktsiden for spørsmål.'; }
    finally { send.disabled=false; input.focus(); }
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden)open(false);});
}

