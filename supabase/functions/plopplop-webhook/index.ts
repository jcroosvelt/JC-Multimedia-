import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Version durcie (audit 25/11/2026). Voir ../README.md
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_SECRET = Deno.env.get("PLOPPLOP_CLIENT_SECRET");

async function verifySignature(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const hex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const expected = "sha256=" + hex;
  if (expected.length !== signatureHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const rawBody = await req.text();
  const signature = req.headers.get("x-webhook-signature");

  if (!CLIENT_SECRET) {
    console.warn("PLOPPLOP_CLIENT_SECRET non configuré — webhook ignoré par sécurité.");
    return new Response("OK (non configuré)", { status: 200 });
  }
  if (!(await verifySignature(rawBody, signature, CLIENT_SECRET))) {
    return new Response("Signature invalide", { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return new Response("JSON invalide", { status: 400 }); }

  const { event, transaction } = payload || {};
  if (event !== "transaction.status_changed" || !transaction) return new Response("OK", { status: 200 });

  const reference = String(transaction.reference_id || "");
  const newStatus = transaction.new_status;
  const transactionId = transaction.transaction_id;
  if (!reference || reference.length > 120) return new Response("OK (incomplet)", { status: 200 });

  const mappedStatus = newStatus === "ok" ? "Confirmé" : newStatus === "failed" ? "Refusé" : "En attente";
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Montant : si le fournisseur l'envoie, il doit correspondre au montant attendu.
  if (mappedStatus === "Confirmé") {
    const received = Number(transaction.amount ?? transaction.montant);
    if (Number.isFinite(received) && received > 0) {
      const { data: pay } = await supabase.from("payments").select("amount").eq("reference", reference).maybeSingle();
      if (pay && Math.round(Number(pay.amount)) !== Math.round(received)) {
        console.log("webhook_montant_different", JSON.stringify({ reference, attendu: pay.amount, recu: received }));
        return new Response("OK (montant différent, non confirmé)", { status: 200 });
      }
    }
  }

  // Ne jamais rétrograder un paiement déjà confirmé.
  await supabase.from("payments").update({
    status: mappedStatus,
    comment: transactionId ? `PLOP PLOP tx: ${String(transactionId).slice(0, 80)}` : null,
    updated_at: new Date().toISOString(),
  }).eq("reference", reference).neq("status", "Confirmé");

  return new Response("OK", { status: 200 });
});
