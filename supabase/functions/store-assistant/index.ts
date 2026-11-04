import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const instructions = `Du er Hjertekraft sin korte, vennlige butikkassistent. Du svarer på norsk bokmål, enkelt og presist. Dette nettstedet er en nettbutikkdemo. Varene, prisene, levering, retur og betalingsknappene kan være eksempelinnhold; ikke presenter dem som virkelige tilbud. Konsept og sortiment er ikke ferdig valgt. Ikke finn på produkter, lagerstatus, åpningstider, frakt, priser eller returvilkår. Si tydelig fra hvis informasjonen ikke finnes, og vis til kontaktsiden. Ikke be om sensitive opplysninger eller betalingsinformasjon. Maks 3 korte setninger per svar.`;
const allowedOrigins = new Set(["https://mathigre.github.io", "http://localhost:8000", "http://localhost:5500", "http://127.0.0.1:5500"]);
const rate = new Map<string, { count: number; reset: number }>();

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return Response.json({ error: "Origin not allowed" }, { status: 403, headers: corsHeaders });
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return Response.json({ error: "Assistant is not configured" }, { status: 503, headers: corsHeaders });
  try {
    const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const now = Date.now();
    const bucket = rate.get(ip);
    if (bucket && bucket.reset > now && bucket.count >= 20) return Response.json({ error: "Too many messages" }, { status: 429, headers: corsHeaders });
    rate.set(ip, !bucket || bucket.reset <= now ? { count: 1, reset: now + 60000 } : { count: bucket.count + 1, reset: bucket.reset });
    const body = await request.json();
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 8) {
      return Response.json({ error: "Invalid conversation" }, { status: 400, headers: corsHeaders });
    }
    const input = body.messages.map((message: { role?: unknown; content?: unknown }) => {
      if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") throw new Error("Invalid message");
      return { role: message.role, content: message.content.slice(0, 700) };
    });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: Deno.env.get("OPENAI_MODEL") || "gpt-6-luna", instructions, input, max_output_tokens: 200, reasoning: { effort: "low" }, store: false }),
      signal: AbortSignal.timeout(25000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error("The assistant request failed");
    const answer = (result.output || []).flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content || []).filter((item: { type?: string }) => item.type === "output_text").map((item: { text?: string }) => item.text || "").join("\n").trim();
    if (!answer) throw new Error("Empty assistant response");
    return Response.json({ answer }, { headers: corsHeaders });
  } catch {
    return Response.json({ error: "Could not create a reply" }, { status: 502, headers: corsHeaders });
  }
});

