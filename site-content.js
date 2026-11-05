import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { STORE_CONFIG } from './config.js';
const db=createClient(STORE_CONFIG.supabaseUrl,STORE_CONFIG.supabasePublishableKey);
const path=location.pathname.replace(/\.html$/,'').replace(/\/$/,'');
const key=path.endsWith('/about')?'about':path.endsWith('/contact')?'contact':path.endsWith('/terms')?'terms':path===''||path.endsWith('/index')?'home':null;
if(key){const {data}=await db.from('site_content').select('title,body').eq('key',key).maybeSingle();if(data){const h=document.querySelector('main h1');if(h)h.textContent=data.title;let body=document.querySelector('[data-managed-content]')||h?.parentElement.querySelector('p:not(.eyebrow)');if(!body){body=document.createElement('p');h?.after(body);}body.dataset.managedContent='';body.style.whiteSpace='pre-line';body.textContent=data.body;}}

