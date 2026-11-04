import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json; charset=utf-8" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
async function vippsToken() {
  const api = Deno.env.get("VIPPS_API_URL") || "https://apitest.vipps.no";
  const response = await fetch(`${api}/accesstoken/get`, { method: "POST", headers: { client_id: Deno.env.get("VIPPS_CLIENT_ID")!, client_secret: Deno.env.get("VIPPS_CLIENT_SECRET")!, "Ocp-Apim-Subscription-Key": Deno.env.get("VIPPS_SUBSCRIPTION_KEY")! } });
  const data = await response.json(); if (!response.ok || !data.access_token) throw new Error("Vipps token failed"); return data.access_token as string;
}
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  let orderId = "";
  try { orderId = String((await request.json()).order_id || ""); } catch { return reply({ error: "Invalid request" }, 400); }
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return reply({ error: "Invalid order" }, 400);
  const { data: order } = await service.from("orders").select("id,order_number,payment_provider,payment_status,provider_reference").eq("id", orderId).maybeSingle();
  if (!order) return reply({ error: "Order not found" }, 404);
  if (order.payment_status === "pending" && order.provider_reference) {
    try {
      if (order.payment_provider === "stripe" && Deno.env.get("STRIPE_SECRET_KEY")) {
        const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(order.provider_reference)}`, { headers: { Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY")}` } });
        const session = await response.json();
        if (response.ok && session.metadata?.order_id === order.id && session.payment_status === "paid") await service.rpc("set_order_payment_status", { p_order_id: order.id, p_status: "paid", p_reference: order.provider_reference });
        if (response.ok && session.status === "expired") await service.rpc("release_pending_order", { p_order_id: order.id, p_status: "failed" });
      } else if (order.payment_provider === "vipps" && Deno.env.get("VIPPS_CLIENT_ID")) {
        const api = Deno.env.get("VIPPS_API_URL") || "https://apitest.vipps.no";
        const token = await vippsToken();
        const response = await fetch(`${api}/epayment/v1/payments/${encodeURIComponent(order.provider_reference)}`, { headers: { Authorization: `Bearer ${token}`, "Ocp-Apim-Subscription-Key": Deno.env.get("VIPPS_SUBSCRIPTION_KEY")!, "Merchant-Serial-Number": Deno.env.get("VIPPS_MSN")! } });
        const payment = await response.json();
        if (response.ok && payment.reference === order.provider_reference) {
          if (payment.state === "AUTHORIZED") await service.rpc("set_order_payment_status", { p_order_id: order.id, p_status: "authorized", p_reference: order.provider_reference });
          if (payment.state === "CAPTURED") await service.rpc("set_order_payment_status", { p_order_id: order.id, p_status: "paid", p_reference: order.provider_reference });
          if (["ABORTED", "EXPIRED", "TERMINATED"].includes(payment.state)) await service.rpc("release_pending_order", { p_order_id: order.id, p_status: "failed" });
        }
      }
    } catch { /* Keep pending; provider status can be checked again. */ }
  }
  const { data: latest } = await service.from("orders").select("order_number,payment_status").eq("id", orderId).single();
  return reply({ order_number: latest?.order_number, status: latest?.payment_status || order.payment_status });
});

