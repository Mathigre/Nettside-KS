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
  if (typeof session?.metadata?.order_id === "string" && session.client_reference_id === session.metadata.order_id) {
    const orderId = session.metadata.order_id;
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type) && session.payment_status === "paid") {
      await service.rpc("set_order_payment_status", { p_order_id: orderId, p_status: "paid", p_reference: session.id });
    } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      await service.rpc("release_pending_order", { p_order_id: orderId, p_status: "failed" });
    }
  }
  return Response.json({ received: true });
});
