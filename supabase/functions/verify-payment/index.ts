import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Version durcie (audit 25/11/2026). Voir ../README.md
const CLIENT_ID = Deno.env.get("PLOPPLOP_CLIENT_ID");
const ALLOWED_ORIGINS = ["https://www.jcmultimedia.online", "https://jcmultimedia.online"];

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const reference = new URL(req.url).searchParams.get("reference") || "";
  if (!CLIENT_ID || !/^[A-Za-z0-9._-]{3,80}$/.test(reference)) {
    return new Response(JSON.stringify({ status: false, message: "not_configured" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const resp = await fetch("https://plopplop.solutionip.app/api/paiement-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, refference_id: reference }),
    });
    const data = await resp.json();
    return new Response(JSON.stringify({
      status: !!data.status, trans_status: data.trans_status || null,
      montant: data.montant || null, method: data.method || null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ status: false, message: "verify_failed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
