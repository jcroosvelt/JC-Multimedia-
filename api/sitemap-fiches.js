// Sitemap des fiches /boutique/<slug> et /services/<slug>, généré à
// partir du catalogue Supabase (complète sitemap.xml, qui liste les
// pages fixes). Lecture publique avec la clé anon, comme api/share.js.
const SUPABASE_URL = "https://tkwrklboqspkzxtlvnzh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrd3JrbGJvcXNwa3p4dGx2bnpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxNzk5MzUsImV4cCI6MjEwNDc1NTkzNX0.dt3AQzMMwE02V5wyADCMQBcqL-8mNqKYIvcZOq8WuTw";
const SITE_URL = "https://www.jcmultimedia.online";

function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400');
  let rows = [];
  try{
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/catalog_items?select=slug,kind,image_urls,created_at&slug=not.is.null`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    const data = await resp.json();
    if(Array.isArray(data)) rows = data;
  }catch(e){ rows = []; }

  const urls = rows.filter(r => r.slug).map(r => {
    const section = r.kind === 'services' ? 'services' : 'boutique';
    const loc = `${SITE_URL}/${section}/${encodeURIComponent(r.slug)}`;
    const img = Array.isArray(r.image_urls) && r.image_urls[0] ? r.image_urls[0] : null;
    return `  <url>
    <loc>${esc(loc)}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>${img ? `
    <image:image><image:loc>${esc(img)}</image:loc></image:image>` : ''}
  </url>`;
  });

  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join('\n')}
</urlset>`);
};
