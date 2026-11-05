import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { STORE_CONFIG } from './config.js';
const db=createClient(STORE_CONFIG.supabaseUrl,STORE_CONFIG.supabasePublishableKey);
const path=location.pathname.replace(/\.html$/,'').replace(/\/$/,'');
const key=path.endsWith('/about')?'about':path.endsWith('/contact')?'contact':path.endsWith('/terms')?'terms':path===''||path.endsWith('/index')?'home':null;
if(key){const {data}=await db.from('site_content').select('title,body').eq('key',key).maybeSingle();if(data){const h=document.querySelector('main h1');if(h)h.textContent=data.title;let body=document.querySelector('[data-managed-content]');if(!body){body=document.createElement('p');body.dataset.managedContent='';body.style.cssText='white-space:pre-line;line-height:1.7;max-width:760px';h?.after(body);}body.textContent=data.body;}}

