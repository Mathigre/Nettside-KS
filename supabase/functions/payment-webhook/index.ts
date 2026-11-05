import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
function constantTimeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0; for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]; return diff === 0;
}
async function stripeSignatureValid(payload: string, header: string, secret: string) {
  const entries = header.split(",").map(part => part.split("=", 2));
  const timestamp = entries.find(([key]) => key === "t")?.[1];
  const signatures = entries.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return signatures.some(signature => constantTimeEqual(signature, expected));
}
Deno.serve(async request => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const payload = await request.text();
  if (!await stripeSignatureValid(payload, request.headers.get("Stripe-Signature") || "", secret)) return new Response("Invalid signature", { status: 400 });
  let event: Record<string, any>;
  try { event = JSON.parse(payload); } catch { return new Response("Invalid payload", { status: 400 }); }
  const session = event.data?.object;
  if (!['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired','checkout.session.async_payment_failed'].includes(event.type)) return Response.json({ received: true });
  if (event.livemode !== false || session?.livemode !== false) return new Response('Only sandbox events accepted', { status: 400 });
  if (typeof session?.metadata?.order_id === "string" && session.client_reference_id === session.metadata.order_id) {
    const orderId = session.metadata.order_id;
    const { data: order, error } = await service.from('orders').select('payment_provider,provider_reference,total_ore,payment_status').eq('id',orderId).maybeSingle();
    if (error) return new Response('Order lookup failed', { status: 500 });
    if (!order) return Response.json({ received: true });
    if (!order.provider_reference) return new Response('Order setup pending', { status: 503 });
    if (order.payment_provider !== 'stripe' || order.provider_reference !== session.id || session.currency !== 'nok' || session.amount_total !== order.total_ore) return new Response('Payment does not match order', { status: 400 });
    if (order.payment_status === 'refunded') return Response.json({ received: true });
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type) && session.payment_status === "paid") {
      const { error } = await service.rpc("set_order_payment_status", { p_order_id: orderId, p_status: "paid", p_reference: session.id });
      if (error) return new Response('Payment update failed', { status: 500 });
    } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      const { error } = await service.rpc("release_pending_order", { p_order_id: orderId, p_status: "failed" });
      if (error) return new Response('Stock release failed', { status: 500 });
    }
  }
  return Response.json({ received: true });
});

