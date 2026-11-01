/* Service worker de l'app admin JC Multimedia (portée : /admin).
   Il ne met rien en cache : l'admin a toujours besoin d'Internet
   (Supabase) et on évite ainsi d'afficher une ancienne version.
   Il sert seulement à rendre l'app installable et à afficher un
   message clair quand il n'y a pas de connexion. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const OFFLINE_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Hors connexion — JC Admin</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0B2158;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:24px}
button{margin-top:18px;padding:12px 22px;border:0;border-radius:10px;background:#E8AE2B;color:#0B2158;font-weight:700;font-size:1rem}</style></head>
<body><div><h1 style="font-size:1.3rem">Pas de connexion Internet</h1>
<p>L'admin JC Multimedia a besoin d'Internet pour fonctionner.</p>
<button onclick="location.reload()">Réessayer</button></div></body></html>`;

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
  );
});
