import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json; charset=utf-8" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

async function vippsToken() {
  const api = Deno.env.get("VIPPS_API_URL") || "https://apitest.vipps.no";
  const response = await fetch(`${api}/accesstoken/get`, { method: "POST", headers: {
    "client_id": Deno.env.get("VIPPS_CLIENT_ID")!, "client_secret": Deno.env.get("VIPPS_CLIENT_SECRET")!,
    "Ocp-Apim-Subscription-Key": Deno.env.get("VIPPS_SUBSCRIPTION_KEY")!,
  } });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error("Vipps authentication failed");
  return data.access_token as string;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  if (Deno.env.get("CHECKOUT_ENABLED") !== "true") return reply({ error: "Test checkout is not enabled yet." }, 503);
  const base = Deno.env.get("STORE_BASE_URL");
  if (!base || !base.startsWith("https://")) return reply({ error: "Store URL is not configured." }, 503);
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(base).origin) return reply({ error: "Invalid store origin." }, 403);
  if ((Deno.env.get("CHECKOUT_MODE") || "test") !== "test") return reply({ error: "Live payments are not enabled for this demo." }, 503);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return reply({ error: "Invalid request." }, 400); }
  const provider = body.provider;
  const customer = body.customer as Record<string, unknown> | undefined;
  const shipping = body.shipping as Record<string, unknown> | undefined;
  const items = body.items;
  if ((provider !== "stripe" && provider !== "vipps") || !customer || !shipping || !Array.isArray(items) || items.length < 1 || items.length > 40) return reply({ error: "Kontroller bestillingsdetaljene." }, 400);
  if (![customer.name, customer.email, shipping.address, shipping.postal_code, shipping.city].every(value => typeof value === "string" && value.trim().length > 0)) return reply({ error: "Fyll ut navn, e-post og leveringsadresse." }, 400);
  if (shipping.country !== "NO") return reply({ error: "Levering er foreløpig bare satt opp for Norge." }, 400);
  const lines = items.map((item: Record<string, unknown>) => ({ product_id: item.product_id, quantity: item.quantity }));
  if (lines.some(line => typeof line.product_id !== "string" || !Number.isInteger(line.quantity) || Number(line.quantity) < 1 || Number(line.quantity) > 99)) return reply({ error: "Ugyldig handlekurv." }, 400);
  const shippingOre = Number(Deno.env.get("SHIPPING_FLAT_ORE"));
  if (!Number.isSafeInteger(shippingOre) || shippingOre < 0) return reply({ error: "Fraktpris må konfigureres i Supabase først." }, 503);
  if (provider === "stripe" && !Deno.env.get("STRIPE_SECRET_KEY")) return reply({ error: "Stripe testnøkkel mangler i Supabase." }, 503);
  if (provider === "stripe" && !Deno.env.get("STRIPE_SECRET_KEY")!.startsWith("sk_test_")) return reply({ error: "Kun Stripe testnøkler kan brukes i denne demoen." }, 503);
  if (provider === "vipps" && !["VIPPS_CLIENT_ID", "VIPPS_CLIENT_SECRET", "VIPPS_SUBSCRIPTION_KEY", "VIPPS_MSN"].every(key => Deno.env.get(key))) return reply({ error: "Vipps testnøkler mangler i Supabase." }, 503);
  if (provider === "vipps" && (Deno.env.get("VIPPS_API_URL") || "https://apitest.vipps.no") !== "https://apitest.vipps.no") return reply({ error: "Kun Vipps testmiljø kan brukes i denne demoen." }, 503);

  const { data: orderId, error: createError } = await service.rpc("create_pending_order", {
    p_customer_name: String(customer.name).trim(), p_customer_email: String(customer.email).trim(),
    p_customer_phone: typeof customer.phone === "string" ? customer.phone.trim() : null,
    p_shipping_address: { address: String(shipping.address).trim(), postal_code: String(shipping.postal_code).trim(), city: String(shipping.city).trim(), country: "NO" },
    p_shipping_ore: shippingOre, p_payment_provider: provider, p_items: lines,
  });
  if (createError || !orderId) return reply({ error: "Produktet er utsolgt eller handlekurven er endret. Oppdater siden og prøv igjen." }, 409);
  const { data: order, error: orderError } = await service.from("orders").select("id,order_number,total_ore,customer_email").eq("id", orderId).single();
  const { data: orderItems, error: itemError } = await service.from("order_items").select("product_name,unit_price_ore,quantity").eq("order_id", orderId);
  if (orderError || itemError || !order || !orderItems?.length) {
    await service.rpc("release_pending_order", { p_order_id: orderId, p_status: "failed" });
    return reply({ error: "Ordren kunne ikke klargjøres." }, 500);
  }
  try {
    if (provider === "stripe") {
      const params = new URLSearchParams({ mode: "payment", customer_email: order.customer_email,
        success_url: `${base}/checkout-result.html?order=${order.id}`, cancel_url: `${base}/checkout.html?cancelled=1`,
        client_reference_id: order.id, "metadata[order_id]": order.id, "payment_intent_data[metadata][order_id]": order.id,
        "phone_number_collection[enabled]": "true" });
      orderItems.forEach((item, index) => {
        params.set(`line_items[${index}][price_data][currency]`, "nok");
        params.set(`line_items[${index}][price_data][unit_amount]`, String(item.unit_price_ore));
        params.set(`line_items[${index}][price_data][product_data][name]`, item.product_name);
        params.set(`line_items[${index}][quantity]`, String(item.quantity));
      });
      if (shippingOre > 0) {
        params.set(`line_items[${orderItems.length}][price_data][currency]`, "nok");
        params.set(`line_items[${orderItems.length}][price_data][unit_amount]`, String(shippingOre));
        params.set(`line_items[${orderItems.length}][price_data][product_data][name]`, "Frakt");
        params.set(`line_items[${orderItems.length}][quantity]`, "1");
      }
      const response = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: params });
      const session = await response.json();
      if (!response.ok || !session.url) throw new Error("Stripe could not create checkout session");
      await service.from("orders").update({ provider_reference: session.id, updated_at: new Date().toISOString() }).eq("id", orderId);
      return reply({ url: session.url });
    }
    const api = Deno.env.get("VIPPS_API_URL") || "https://apitest.vipps.no";
    const token = await vippsToken();
    const reference = `hk-${order.id}`;
    const response = await fetch(`${api}/epayment/v1/payments`, { method: "POST", headers: {
      Authorization: `Bearer ${token}`, "Ocp-Apim-Subscription-Key": Deno.env.get("VIPPS_SUBSCRIPTION_KEY")!,
      "Merchant-Serial-Number": Deno.env.get("VIPPS_MSN")!, "Idempotency-Key": crypto.randomUUID(),
      "Vipps-System-Name": "hjertekraft-shop", "Vipps-System-Version": "1.0.0", "Content-Type": "application/json",
    }, body: JSON.stringify({ amount: { currency: "NOK", value: order.total_ore }, paymentMethod: { type: "WALLET" },
      reference, userFlow: "WEB_REDIRECT", returnUrl: `${base}/checkout-result.html?order=${order.id}`,
      paymentDescription: `Hjertekraft ordre ${order.order_number}` }) });
    const payment = await response.json();
    if (!response.ok || !payment.redirectUrl) throw new Error("Vipps could not create payment");
    await service.from("orders").update({ provider_reference: reference, updated_at: new Date().toISOString() }).eq("id", orderId);
    return reply({ url: payment.redirectUrl });
  } catch {
    await service.rpc("release_pending_order", { p_order_id: orderId, p_status: "failed" });
    return reply({ error: "Betalingen kunne ikke startes. Kontroller testoppsettet og prøv igjen." }, 502);
  }
});

