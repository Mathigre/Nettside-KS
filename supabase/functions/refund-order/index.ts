import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const token=req.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
 const {data:{user}}=await db.auth.getUser(token);
 if(!user||![true,'true'].includes(user.app_metadata?.store_admin))return reply({error:'Kun administrator kan refundere.'},403);
 if((Deno.env.get('CHECKOUT_MODE')||'test')!=='test')return reply({error:'Kun testrefusjoner er aktivert.'},403);
 let returnId='';
 try{
  returnId=(await req.json()).return_id;
  const {data:r,error}=await db.from('order_returns').select('*,orders(*)').eq('id',returnId).single();
  if(error||!r)return reply({error:'Retur finnes ikke.'},404);
  const o=r.orders;
  if(r.refund_status==='succeeded')return reply({ok:true});
  if(o.payment_status!=='paid')return reply({error:'Ordren må være betalt før refusjon.'},409);
  const {data:others}=await db.from('order_returns').select('amount_ore').eq('order_id',o.id).in('refund_status',['processing','succeeded']).neq('id',r.id);
  if((others||[]).reduce((s,x)=>s+x.amount_ore,0)+r.amount_ore>o.total_ore)return reply({error:'Refusjoner overstiger betalt beløp.'},409);
  const {data:locked,error:lockError}=await db.rpc('claim_test_refund',{p_return_id:r.id});
  if(lockError||!locked)return reply({error:'Refusjonen behandles allerede eller overstiger betalt beløp.'},409);
  let refundId='';let succeeded=false;
  if(o.payment_provider==='stripe'){
   const key=Deno.env.get('STRIPE_SECRET_KEY')||'';if(!key.startsWith('sk_test_'))throw Error('Stripe testnøkkel mangler.');
   const headers={Authorization:`Bearer ${key}`};
   const sessionResponse=await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(o.provider_reference)}`,{headers});const session=await sessionResponse.json();
   if(!sessionResponse.ok||session.livemode||session.amount_total!==o.total_ore||!session.payment_intent)throw Error('Stripe-betalingen kunne ikke verifiseres.');
   const response=await fetch('https://api.stripe.com/v1/refunds',{method:'POST',headers:{...headers,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':`hk-return-${r.id}`},body:new URLSearchParams({payment_intent:session.payment_intent,amount:String(r.amount_ore)})});const result=await response.json();
   if(!response.ok||!result.id)throw Error('Stripe avviste refusjonen.');refundId=result.id;succeeded=result.status==='succeeded';
  }else if(o.payment_provider==='vipps'){
   const api=Deno.env.get('VIPPS_API_URL')||'https://apitest.vipps.no';if(api!=='https://apitest.vipps.no')throw Error('Kun Vipps testmiljø er tillatt.');
   const subscription=Deno.env.get('VIPPS_SUBSCRIPTION_KEY')||'';
   const tokenResponse=await fetch(`${api}/accesstoken/get`,{method:'POST',headers:{client_id:Deno.env.get('VIPPS_CLIENT_ID')||'',client_secret:Deno.env.get('VIPPS_CLIENT_SECRET')||'','Ocp-Apim-Subscription-Key':subscription}});const token=await tokenResponse.json();if(!tokenResponse.ok||!token.access_token)throw Error('Vipps testtilgang mangler.');
   const response=await fetch(`${api}/epayment/v1/payments/${encodeURIComponent(o.provider_reference)}/refund`,{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Ocp-Apim-Subscription-Key':subscription,'Merchant-Serial-Number':Deno.env.get('VIPPS_MSN')||'','Idempotency-Key':r.id,'Content-Type':'application/json','Vipps-System-Name':'hjertekraft-shop','Vipps-System-Version':'1.0.0'},body:JSON.stringify({modificationAmount:{currency:'NOK',value:r.amount_ore}})});
   if(!response.ok)throw Error('Vipps avviste refusjonen.');refundId=`vipps-${r.id}`;succeeded=true;
  }else throw Error('Ukjent betalingsleverandør.');
  const update=await db.from('order_returns').update({provider_refund_id:refundId,refund_status:succeeded?'succeeded':'processing',updated_at:new Date().toISOString()}).eq('id',r.id);if(update.error)throw update.error;
  await db.from('order_history').insert({order_id:o.id,actor_id:user.id,event:'Refusjon opprettet',details:{amount_ore:r.amount_ore,provider_refund_id:refundId}});
  if(succeeded){
   const {data:completed,error:sumError}=await db.from('order_returns').select('amount_ore').eq('order_id',o.id).eq('refund_status','succeeded');
   if(sumError)throw sumError;
   if((completed||[]).reduce((s,x)=>s+x.amount_ore,0)===o.total_ore){
    const {error}=await db.rpc('set_order_payment_status',{p_order_id:o.id,p_status:'refunded',p_reference:o.provider_reference});if(error)throw error;
   }
  }
  return reply({ok:true});
 }catch(error){if(returnId)await db.from('order_returns').update({refund_status:'failed',updated_at:new Date().toISOString()}).eq('id',returnId).eq('refund_status','processing');return reply({error:error instanceof Error?error.message:'Refusjonen feilet.'},502);}
});

