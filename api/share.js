// Sert un aperçu correct (titre, description, vraie photo) uniquement
// pour les liens de partage générés depuis le bouton "Copier le lien
// pour WhatsApp". N'affecte jamais la navigation normale du site :
// les adresses /boutique/... et /services/... restent inchangées et
// passent toujours directement par article.html, comme avant.
const SUPABASE_URL = "https://tkwrklboqspkzxtlvnzh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrd3JrbGJvcXNwa3p4dGx2bnpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxNzk5MzUsImV4cCI6MjEwNDc1NTkzNX0.dt3AQzMMwE02V5wyADCMQBcqL-8mNqKYIvcZOq8WuTw";
const SITE_URL = "https://jc-multimedia.vercel.app";
const DEFAULT_IMAGE = `${SITE_URL}/og-image.png`;

function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fallbackHtml(pageUrl){
  return `<!doctype html><html lang="fr"><head><meta charset="UTF-8">
<title>JC Multimedia</title>
<meta property="og:title" content="JC Multimedia">
<meta property="og:image" content="${esc(DEFAULT_IMAGE)}">
<meta http-equiv="refresh" content="0; url=${esc(pageUrl)}">
</head><body>Redirection… <a href="${esc(pageUrl)}">Continuer</a></body></html>`;
}

module.exports = async (req, res) => {
  const { slug, section } = req.query;
  const safeSection = section === 'services' ? 'services' : 'boutique';
  const pageUrl = `${SITE_URL}/${safeSection}/${slug || ''}`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');

  if(!slug){
    res.status(200).send(fallbackHtml(SITE_URL));
    return;
  }

  try{
    const query = `${SUPABASE_URL}/rest/v1/catalog_items?slug=eq.${encodeURIComponent(slug)}&select=name,seo_title,seo_description,utility,description,image_urls`;
    const resp = await fetch(query, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    const rows = await resp.json();
    const item = Array.isArray(rows) ? rows[0] : null;

    if(!item){
      res.status(200).send(fallbackHtml(pageUrl));
      return;
    }

    const title = (item.seo_title && item.seo_title.trim()) || `${item.name} — JC Multimedia`;
    const description = (item.seo_description && item.seo_description.trim())
      || item.utility || item.description
      || `${item.name} — disponible chez JC Multimedia, Port-au-Prince.`;
    const image = (Array.isArray(item.image_urls) && item.image_urls[0]) || DEFAULT_IMAGE;

    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(pageUrl)}">
<meta property="og:type" content="product">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:site_name" content="JC Multimedia">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=${esc(pageUrl)}">
</head>
<body>
<p>JC Multimedia — <a href="${esc(pageUrl)}">${esc(item.name)}</a></p>
</body>
</html>`;

    res.status(200).send(html);
  }catch(e){
    res.status(200).send(fallbackHtml(pageUrl));
  }
};
