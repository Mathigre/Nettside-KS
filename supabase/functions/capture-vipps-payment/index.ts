import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json; charset=utf-8" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
async function vippsToken() {
  const response = await fetch(`${Deno.env.get("VIPPS_API_URL") || "https://apitest.vipps.no"}/accesstoken/get`, { method: "POST", headers: { client_id: Deno.env.get("VIPPS_CLIENT_ID")!, client_secret: Deno.env.get("VIPPS_CLIENT_SECRET")!, "Ocp-Apim-Subscription-Key": Deno.env.get("VIPPS_SUBSCRIPTION_KEY")! } });
  const body = await response.json(); if (!response.ok || !body.access_token) throw new Error("Vipps token failed"); return body.access_token as string;
}
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: userResult, error: authError } = await service.auth.getUser(token);
  if (authError || !(userResult.user?.app_metadata?.store_admin === true || userResult.user?.app_metadata?.store_admin === "true")) return reply({ error: "Admin only" }, 403);
  let orderId = ""; try { orderId = String((await request.json()).order_id || ""); } catch { return reply({ error: "Invalid request" }, 400); }
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return reply({ error: "Invalid order" }, 400);
  const { data: order } = await service.from("orders").select("id,total_ore,payment_provider,payment_status,provider_reference").eq("id", orderId).maybeSingle();
  if (!order || order.payment_provider !== "vipps" || order.payment_status !== "authorized" || !order.provider_reference) return reply({ error: "Ordren er ikke klar for innbetaling." }, 409);
  try {
    const api = Deno.env.get("VIPPS_API_URL") || "https://apitest.vipps.no";
    if (api !== "https://apitest.vipps.no") return reply({ error: "Kun Vipps testbetaling er aktivert." }, 503);
    const accessToken = await vippsToken();
    const response = await fetch(`${api}/epayment/v1/payments/${encodeURIComponent(order.provider_reference)}/capture`, { method: "POST", headers: {
      Authorization: `Bearer ${accessToken}`, "Ocp-Apim-Subscription-Key": Deno.env.get("VIPPS_SUBSCRIPTION_KEY")!,
      "Merchant-Serial-Number": Deno.env.get("VIPPS_MSN")!, "Idempotency-Key": crypto.randomUUID(),
      "Vipps-System-Name": "hjertekraft-shop", "Vipps-System-Version": "1.0.0", "Content-Type": "application/json",
    }, body: JSON.stringify({ modificationAmount: { currency: "NOK", value: order.total_ore } }) });
    const result = await response.json();
    if (!response.ok) return reply({ error: "Vipps kunne ikke fullføre betalingen." }, 502);
    await service.rpc("set_order_payment_status", { p_order_id: order.id, p_status: "paid", p_reference: order.provider_reference });
    return reply({ ok: true, status: result.state || "CAPTURED" });
  } catch { return reply({ error: "Vipps-testmiljøet svarte ikke." }, 502); }
});
