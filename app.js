/* =========================================================
   STORAGE — panier (local), catalogue / réglages / commandes (Supabase)
   Le panier reste local à chaque visiteur (c'est normal, c'est SON
   panier). Le catalogue, les réglages et les commandes sont
   centralisés dans Supabase quand il est configuré ci-dessous ;
   sinon, le site continue de fonctionner avec les valeurs par
   défaut et un stockage local (comme avant), pour ne jamais casser
   le site si Supabase n'est pas encore branché.
   ========================================================= */
const CART_STORAGE_KEY     = "jc_multimedia_cart_v1";
const CATALOG_STORAGE_KEY  = "jc_multimedia_catalog_v1";   // cache local hors-ligne
const SETTINGS_STORAGE_KEY = "jc_multimedia_settings_v1";  // cache local hors-ligne
const ORDERS_STORAGE_KEY   = "jc_multimedia_orders_log_v1"; // repli si Supabase indisponible

let memoryStore = {};
function safeGet(key){
  try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
  catch(e){ return memoryStore[key] ?? null; }
}
function safeSet(key, val){
  try{ localStorage.setItem(key, JSON.stringify(val)); }
  catch(e){ memoryStore[key] = val; }
}

/* =========================================================
   SUPABASE — configuration
   1) Créez un projet gratuit sur https://supabase.com
   2) Exécutez le script SQL fourni (schema-supabase.sql) dans
      l'éditeur SQL de votre projet Supabase
   3) Copiez l'URL du projet et la clé "anon public" depuis
      Project Settings → API, et collez-les ci-dessous
   4) Créez votre compte admin dans Authentication → Users
      (email + mot de passe) : c'est ce compte qui vous servira
      à vous connecter à l'espace admin du site
   Tant que ces deux valeurs ne sont pas renseignées, le site
   continue de fonctionner normalement en mode local uniquement.
   ========================================================= */
const SUPABASE_URL = "https://tkwrklboqspkzxtlvnzh.supabase.co";       // ex: https://abcdefgh.supabase.co
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrd3JrbGJvcXNwa3p4dGx2bnpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxNzk5MzUsImV4cCI6MjEwNDc1NTkzNX0.dt3AQzMMwE02V5wyADCMQBcqL-8mNqKYIvcZOq8WuTw"; // clé "anon public", jamais la "service_role"

const SUPABASE_CONFIGURED = !SUPABASE_URL.includes("VOTRE_URL") && !SUPABASE_ANON_KEY.includes("VOTRE_CLE");
// Si la librairie Supabase (chargée depuis un CDN) n'a pas pu se charger — pas de
// réseau, bloqueur de script, CDN indisponible — le site continue en mode local
// au lieu de planter complètement.
const SUPABASE_ENABLED = SUPABASE_CONFIGURED && typeof window.supabase !== 'undefined';
const db = SUPABASE_ENABLED ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
if(SUPABASE_CONFIGURED && !SUPABASE_ENABLED){
  console.warn("Supabase configuré mais la librairie n'a pas pu se charger (réseau/CDN) — le site fonctionne en mode local pour cette visite.");
}

/* =========================================================
   CONFIG PAR DÉFAUT — utilisée tant que Supabase n'est pas
   configuré, ou comme repli si la connexion échoue
   ========================================================= */
const DEFAULT_SETTINGS = {
  whatsapp: "50934432139", // numéro WhatsApp qui reçoit les commandes
  adminPassword: "jcadmin2026", // ⚠️ utilisé UNIQUEMENT si Supabase n'est pas configuré (mode local) — sinon voir Supabase Auth
  exchangeRate: 132, // gourdes (HTG) pour 1 USD — à vérifier/mettre à jour régulièrement depuis l'espace admin
  slideshowAutoplay: true,
  slideshowDurationMs: 5000,
  slideshowArrows: true,
  slideshowDots: true,
  slideshowLoop: true
};
function loadSettingsLocal(){ return { ...DEFAULT_SETTINGS, ...(safeGet(SETTINGS_STORAGE_KEY) || {}) }; }
function saveSettingsLocal(){ safeSet(SETTINGS_STORAGE_KEY, SETTINGS); }
let SETTINGS = loadSettingsLocal();

const MAX_QTY = 500; // quantité maximale par article

/* =========================================================
   DEVISE — affichage double USD / HTG selon le taux réglé en admin
   ========================================================= */
function htgAmount(usd){ return usd * (SETTINGS.exchangeRate || DEFAULT_SETTINGS.exchangeRate); }
function formatHTG(usd){ return new Intl.NumberFormat('fr-FR').format(Math.round(htgAmount(usd))) + ' HTG'; }
function formatUSD(usd){ return '$' + usd.toFixed(2); }
function priceDualInline(usd){ return `${formatUSD(usd)} <span class="price-htg">≈ ${formatHTG(usd)}</span>`; }

async function fetchSettingsFromSupabase(){
  if(!SUPABASE_ENABLED) return null;
  try{
    const { data, error } = await db.from('settings').select('*').eq('id', 1).single();
    if(error || !data) throw error || new Error('no data');
    return {
      whatsapp: data.whatsapp,
      exchangeRate: Number(data.exchange_rate),
      slideshowAutoplay: data.slideshow_autoplay !== false,
      slideshowDurationMs: Number(data.slideshow_duration_ms) || 5000,
      slideshowArrows: data.slideshow_arrows !== false,
      slideshowDots: data.slideshow_dots !== false,
      slideshowLoop: data.slideshow_loop !== false
    };
  }catch(e){
    console.warn('Supabase settings fetch failed, using local cache/defaults:', e);
    return null;
  }
}
async function refreshSettings(){
  const remote = await fetchSettingsFromSupabase();
  if(remote){
    SETTINGS = { ...SETTINGS, ...remote };
    saveSettingsLocal();
  }
  renderGrid(); // les prix HTG dépendent du taux de change
}

/* =========================================================
   CONTENU DU SITE — textes, coordonnées, réseaux sociaux,
   modifiables depuis l'espace admin (onglet "Contenu")
   ========================================================= */
const DEFAULT_SITE_CONTENT = {
  hero_title: "Impression, personnalisation, graphisme, brandmark — tout pour vous plaire.",
  hero_subtitle: "Matériels informatiques, matériels de personnalisation, services de création de site web, conception et installation de banderoles (banners), et bien plus. Commandez en quelques clics, finalisez sur WhatsApp.",
  about_text: "Basé à Port-au-Prince, JC Multimedia offre des services de branding, graphic design, web design, personnalisation, etc.",
  address_1: "123, Rue Lambert, Juvénat, Pétion-Ville",
  address_2: "10, Brochette 99, Carrefour",
  nif: "0000-000-000-0",
  email: "infos@jcmultimedia.com",
  phone_display: "+509 34 43 2139 / 42 75 5464",
  social_facebook: "https://www.facebook.com/share/1FA67rVSu3/",
  social_instagram: "https://www.instagram.com/jcmultimediaht?igsi=MXJiNzlyMmp0aXBkaQ==",
  social_tiktok: "https://tiktok.com/@jc.multimedia",
  social_whatsapp_number: "50934432139",
  footer_tagline: "Impression, personnalisation, graphisme et solutions digitales."
};
const SITE_CONTENT_STORAGE_KEY = "jc_multimedia_site_content_v1";
function loadSiteContentLocal(){ return { ...DEFAULT_SITE_CONTENT, ...(safeGet(SITE_CONTENT_STORAGE_KEY) || {}) }; }
function saveSiteContentLocal(){ safeSet(SITE_CONTENT_STORAGE_KEY, SITE_CONTENT); }
let SITE_CONTENT = loadSiteContentLocal();

async function fetchSiteContentFromSupabase(){
  if(!SUPABASE_ENABLED) return null;
  try{
    const { data, error } = await db.from('site_content').select('*').eq('id', 1).single();
    if(error || !data) throw error || new Error('no data');
    const { id, ...rest } = data;
    return rest;
  }catch(e){
    console.warn('Supabase site_content fetch failed, using local cache/defaults:', e);
    return null;
  }
}
async function refreshSiteContent(){
  const remote = await fetchSiteContentFromSupabase();
  if(remote){
    SITE_CONTENT = { ...SITE_CONTENT, ...remote };
    saveSiteContentLocal();
  }
  applySiteContent();
}
/* =========================================================
   SLIDESHOW D'ACCUEIL — piloté par la base de données, jusqu'à
   10+ images, autoplay, boucle, flèches, points, swipe tactile,
   pause à l'interaction. Reste caché si aucun slide n'est configuré
   (n'affecte jamais le reste de la page d'accueil).
   ========================================================= */
let SLIDES = [];
let slideIndex = 0;
let slideTimer = null;

async function initHeroSlideshow(){
  const section = document.getElementById('heroSlideshow');
  if(!section || !SUPABASE_ENABLED) return;
  try{
    const { data, error } = await db.from('hero_slides').select('*').order('display_order', { ascending:true });
    if(error) throw error;
    SLIDES = data || [];
  }catch(e){
    console.warn('Chargement du slideshow échoué:', e);
    return;
  }
  if(!SLIDES.length){ section.style.display = 'none'; return; }
  renderSlideshow();
}
function renderSlideshow(){
  const section = document.getElementById('heroSlideshow');
  const track = document.getElementById('slideshowTrack');
  const dots = document.getElementById('slideshowDots');
  if(!section || !track || !SLIDES.length) return;

  const isMobile = window.innerWidth < 640;
  track.innerHTML = SLIDES.map((s,i) => {
    const img = (isMobile && s.mobile_image_url) ? s.mobile_image_url : s.image_url;
    const hasCaption = s.title || s.subtitle || (s.button_text && s.button_url);
    return `<div class="slide">
      <img src="${img}" alt="${(s.alt_text||'').replace(/"/g,'&quot;')}" loading="${i===0?'eager':'lazy'}">
      ${hasCaption ? `
        <div class="slide-caption">
          ${s.title ? `<h2>${s.title}</h2>` : ''}
          ${s.subtitle ? `<p>${s.subtitle}</p>` : ''}
          ${(s.button_text && s.button_url) ? `<a class="btn btn-primary" href="${s.button_url}">${s.button_text}</a>` : ''}
        </div>` : ''}
    </div>`;
  }).join('');

  dots.innerHTML = SLIDES.map((_,i) => `<button class="slide-dot" onclick="slideshowGoTo(${i})" aria-label="Aller à l'image ${i+1}"></button>`).join('');

  const multi = SLIDES.length > 1;
  section.querySelectorAll('.slideshow-arrow').forEach(b => b.style.display = (multi && SETTINGS.slideshowArrows) ? 'flex' : 'none');
  dots.style.display = (multi && SETTINGS.slideshowDots) ? 'flex' : 'none';

  section.style.display = 'block';
  slideIndex = 0;
  updateSlidePosition(false);
  startSlideshowAutoplay();

  if(!section.dataset.wired){
    section.dataset.wired = '1';
    section.addEventListener('mouseenter', pauseSlideshowAutoplay);
    section.addEventListener('mouseleave', startSlideshowAutoplay);
    let touchStartX = null;
    section.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; pauseSlideshowAutoplay(); }, { passive:true });
    section.addEventListener('touchend', e => {
      if(touchStartX === null) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      if(Math.abs(dx) > 40) slideshowGo(dx < 0 ? 1 : -1);
      touchStartX = null;
      startSlideshowAutoplay();
    });
    window.addEventListener('resize', () => { if(SLIDES.length) renderSlideshow(); });
  }
}
function updateSlidePosition(animate=true){
  const track = document.getElementById('slideshowTrack');
  if(!track) return;
  track.style.transition = animate ? 'transform .5s ease' : 'none';
  track.style.transform = `translateX(-${slideIndex*100}%)`;
  document.querySelectorAll('.slide-dot').forEach((d,i)=>d.classList.toggle('active', i===slideIndex));
}
function slideshowGo(delta){
  if(!SLIDES.length) return;
  let next = slideIndex + delta;
  if(SETTINGS.slideshowLoop === false){
    next = Math.max(0, Math.min(SLIDES.length-1, next));
  } else {
    next = (next + SLIDES.length) % SLIDES.length;
  }
  slideIndex = next;
  updateSlidePosition();
  restartSlideshowAutoplay();
}
function slideshowGoTo(i){
  slideIndex = i;
  updateSlidePosition();
  restartSlideshowAutoplay();
}
function startSlideshowAutoplay(){
  clearInterval(slideTimer);
  if(SLIDES.length < 2 || SETTINGS.slideshowAutoplay === false) return;
  slideTimer = setInterval(()=> slideshowGo(1), SETTINGS.slideshowDurationMs || 5000);
}
function pauseSlideshowAutoplay(){ clearInterval(slideTimer); }
function restartSlideshowAutoplay(){ pauseSlideshowAutoplay(); startSlideshowAutoplay(); }

function applySiteContent(){
  const c = SITE_CONTENT;
  const set = (id, html) => { const el = document.getElementById(id); if(el) el.innerHTML = html; };
  const setAttr = (id, attr, val) => { const el = document.getElementById(id); if(el && val) el.setAttribute(attr, val); };

  set('heroTitleText', c.hero_title);
  set('heroSubtitleText', c.hero_subtitle);
  set('aboutText', c.about_text);
  set('footerTaglineText', c.footer_tagline);
  set('footerContactBlock', `
    ${c.address_1}<br>
    ${c.address_2}<br><br>
    NIF : ${c.nif}<br>
    ${c.email}<br>
    ${c.phone_display}
  `);

  document.querySelectorAll('[data-social="facebook"]').forEach(el => el.href = c.social_facebook);
  document.querySelectorAll('[data-social="instagram"]').forEach(el => el.href = c.social_instagram);
  document.querySelectorAll('[data-social="tiktok"]').forEach(el => el.href = c.social_tiktok);
  document.querySelectorAll('[data-social="whatsapp"]').forEach(el => el.href = 'https://wa.me/' + c.social_whatsapp_number);
  document.querySelectorAll('[data-social="google"]').forEach(el => el.href = 'https://www.google.com/search?q=' + encodeURIComponent('JC Multimedia Port-au-Prince'));
}

/* =========================================================
   CATALOGUE PAR DÉFAUT — modifiable depuis l'espace admin
   (les modifications admin sont sauvegardées et remplacent ces
   valeurs par défaut sur cet appareil)
   ========================================================= */
const BASE_PRODUCTS = [];
const BASE_SERVICES = [];

function loadCatalogLocal(){
  const stored = safeGet(CATALOG_STORAGE_KEY);
  if(stored && Array.isArray(stored.products) && Array.isArray(stored.services)) return stored;
  return { products: JSON.parse(JSON.stringify(BASE_PRODUCTS)), services: JSON.parse(JSON.stringify(BASE_SERVICES)) };
}
function saveCatalogLocal(){ safeSet(CATALOG_STORAGE_KEY, CATALOG); }
let CATALOG = loadCatalogLocal();

/* ---- Mapping Supabase (table catalog_items) <-> objets JS ---- */
function rowToItem(row){
  const item = {
    id: row.id, name: row.name, code: row.code || null,
    imageUrls: Array.isArray(row.image_urls) ? row.image_urls.filter(Boolean) : (row.image_url ? [row.image_url] : []),
    inStock: row.in_stock, customizable: row.customizable, promo: row.promo
  };
  if(row.kind === 'services'){
    item.description = row.description;
    item.startingPrice = row.starting_price != null ? Number(row.starting_price) : 0;
  } else {
    item.utility = row.utility;
    item.price = row.price != null ? Number(row.price) : 0;
    item.oldPrice = row.old_price != null ? Number(row.old_price) : undefined;
  }
  return item;
}
function itemToRow(kind, item){
  const urls = (item.imageUrls || []).filter(Boolean);
  return {
    id: item.id, kind, name: item.name, image_urls: urls, image_url: urls[0] || null,
    utility: item.utility ?? null, description: item.description ?? null,
    price: kind === 'products' ? (item.price ?? 0) : null,
    old_price: kind === 'products' ? (item.oldPrice ?? null) : null,
    starting_price: kind === 'services' ? (item.startingPrice ?? 0) : null,
    promo: !!item.promo, in_stock: item.inStock !== false, customizable: !!item.customizable
  };
}
async function fetchCatalogFromSupabase(){
  if(!SUPABASE_ENABLED) return null;
  try{
    const { data, error } = await db.from('catalog_items').select('*').order('sort_order', { ascending: true });
    if(error) throw error;
    const products = (data || []).filter(r => r.kind === 'products').map(rowToItem);
    const services = (data || []).filter(r => r.kind === 'services').map(rowToItem);
    // Un catalogue VIDE est un état légitime (rien n'a encore été ajouté depuis
    // l'admin) — ce n'est pas une erreur, donc on ne retombe pas sur de fausses
    // données de démonstration dans ce cas.
    return { products, services };
  }catch(e){
    console.warn('Supabase catalog fetch failed, using local cache/defaults:', e);
    return null;
  }
}
async function refreshCatalog(){
  const remote = await fetchCatalogFromSupabase();
  if(remote){
    CATALOG = remote;
    saveCatalogLocal(); // on garde une copie locale comme cache hors-ligne
  }
  rebuildIndex();
  renderGrid();
  if(document.body.dataset.page === 'article') initArticlePage();
}

let ALL_ITEMS = {};
function rebuildIndex(){
  ALL_ITEMS = {};
  [...CATALOG.products, ...CATALOG.services].forEach(item => ALL_ITEMS[item.id] = item);
  ensureUiQtyDefaults();
}
function ensureUiQtyDefaults(){
  [...CATALOG.products, ...CATALOG.services].forEach(item => { if(uiQty[item.id] === undefined) uiQty[item.id] = 1; });
}
function unitPrice(item){ return item.startingPrice != null ? item.startingPrice : item.price; }
function isEstimate(item){ return item.startingPrice != null; }

/* =========================================================
   STATE
   ========================================================= */
let cart = loadCart();      // {itemId: qty}, persistant
let uiQty = {};              // quantité en attente sur les cartes avant "Ajouter au panier"
rebuildIndex();

let orderFlow = { customerName:"", customerPhone:"", customerAddress:"", customize:null, customizedItems:[], payment:null, delivery:null };

function loadCart(){
  const stored = safeGet(CART_STORAGE_KEY);
  return stored && typeof stored === 'object' ? stored : {};
}
function saveCart(){ safeSet(CART_STORAGE_KEY, cart); }

/* =========================================================
   RENDER — carte partagée boutique/services, avec recherche et stock
   ========================================================= */
function cardHTML(item){
  const subText = item.utility || item.description || "";
  const outOfStock = item.inStock === false;
  const priceBlock = isEstimate(item)
    ? `<div class="price-row"><span class="price">À partir de ${priceDualInline(item.startingPrice)}</span></div>`
    : `<div class="price-row">
         <span class="price">${priceDualInline(item.price)}</span>
         ${item.oldPrice ? `<span class="price-old">$${item.oldPrice.toFixed(2)}</span>` : ''}
       </div>`;
  return `
    <div class="card">
      <a class="thumb" href="/article/${item.id}" aria-label="Voir la page de ${item.name}">
        ${item.promo ? '<span class="promo-flag">Promo</span>' : ''}
        ${outOfStock ? '<span class="stock-flag">Rupture de stock</span>' : ''}
        ${(item.imageUrls && item.imageUrls[0]) ? `<img src="${item.imageUrls[0]}" alt="${item.name}" loading="lazy">` : `<div class="no-image">Pas de photo</div>`}
      </a>
      <div class="body">
        <h3><a href="/article/${item.id}" class="card-title-link">${item.name}</a></h3>
        ${subText ? `<p class="card-sub">${subText}</p>` : ''}
        ${priceBlock}
        <div class="qty-row">
          <button class="qty-btn" onclick="stepQty('${item.id}',-1)" aria-label="Diminuer la quantité">−</button>
          <span class="qty-val" data-qty-display="${item.id}">${uiQty[item.id]}</span>
          <button class="qty-btn" onclick="stepQty('${item.id}',1)" aria-label="Augmenter la quantité">+</button>
        </div>
        <button class="add-btn" id="add-${item.id}" ${outOfStock ? 'disabled' : ''} onclick="addToCart('${item.id}')">${outOfStock ? 'Indisponible' : 'Ajouter au panier'}</button>
      </div>
    </div>`;
}
function renderGrid(){
  const pTerm = (document.getElementById('productSearch')?.value || '').toLowerCase().trim();
  const sTerm = (document.getElementById('serviceSearch')?.value || '').toLowerCase().trim();
  const filteredProducts = CATALOG.products.filter(p => !pTerm || p.name.toLowerCase().includes(pTerm));
  const filteredServices = CATALOG.services.filter(s => !sTerm || s.name.toLowerCase().includes(sTerm));

  const productGrid = document.getElementById('productGrid');
  if(productGrid){
    productGrid.innerHTML = filteredProducts.length
      ? filteredProducts.map(cardHTML).join('')
      : `<p class="card-sub">${CATALOG.products.length === 0 ? "La boutique sera bientôt garnie — revenez vite !" : "Aucun produit ne correspond à votre recherche."}</p>`;
  }
  const serviceGrid = document.getElementById('serviceGrid');
  if(serviceGrid){
    serviceGrid.innerHTML = filteredServices.length
      ? filteredServices.map(cardHTML).join('')
      : `<p class="card-sub">${CATALOG.services.length === 0 ? "Nos services seront bientôt détaillés ici — revenez vite !" : "Aucun service ne correspond à votre recherche."}</p>`;
  }

  const sAllGrid = document.getElementById('serviceGridAll');
  if(sAllGrid){
    const sAllTerm = (document.getElementById('serviceSearchAll')?.value || '').toLowerCase().trim();
    const filteredAllServices = CATALOG.services.filter(s => !sAllTerm || s.name.toLowerCase().includes(sAllTerm));
    sAllGrid.innerHTML = filteredAllServices.length
      ? filteredAllServices.map(cardHTML).join('')
      : `<p class="card-sub">${CATALOG.services.length === 0 ? "Nos services seront bientôt détaillés ici — revenez vite !" : "Aucun service ne correspond à votre recherche."}</p>`;
  }

  const promoSection = document.getElementById('promoSection');
  const promoGrid = document.getElementById('promoGrid');
  if(promoSection && promoGrid){
    const promoItems = [...CATALOG.products, ...CATALOG.services].filter(i => i.promo);
    if(promoItems.length){
      promoGrid.innerHTML = promoItems.map(cardHTML).join('');
      promoSection.style.display = 'block';
    } else {
      promoGrid.innerHTML = '';
      promoSection.style.display = 'none';
    }
  }
}
function stepQty(id, delta){
  uiQty[id] = Math.min(MAX_QTY, Math.max(1, (uiQty[id]||1) + delta));
  document.querySelectorAll(`[data-qty-display="${id}"]`).forEach(el => el.textContent = uiQty[id]);
}
function addToCart(id){
  const item = ALL_ITEMS[id];
  if(!item || item.inStock === false) return;
  cart[id] = Math.min(MAX_QTY, (cart[id] || 0) + (uiQty[id]||1));
  uiQty[id] = 1;
  document.querySelectorAll(`[data-qty-display="${id}"]`).forEach(el => el.textContent = 1);
  const btn = document.getElementById('add-'+id);
  if(btn){
    const original = btn.textContent;
    btn.textContent = "Ajouté ✓";
    btn.classList.add('added');
    setTimeout(()=>{ btn.textContent = original === "Ajouté ✓" ? "Ajouter au panier" : original; btn.classList.remove('added'); }, 1200);
  }
  saveCart();
  updateBadge();
  showToast(item.name + " ajouté au panier");
}
function updateBadge(){
  const count = Object.values(cart).reduce((a,b)=>a+b,0);
  const badge = document.getElementById('cartBadge');
  if(count > 0){ badge.style.display='flex'; badge.textContent = count; }
  else { badge.style.display='none'; }
}
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(()=> t.classList.remove('show'), 1800);
}

/* =========================================================
   ROUTAGE — chaque page a sa propre URL réelle (/boutique, /faq,
   /article/ID...), gérée avec l'API History du navigateur.
   Nécessite le fichier vercel.json fourni (redirige toutes les
   URLs vers index.html) pour fonctionner au rechargement direct.
   ========================================================= */
function renderItemDetail(id){
  const item = ALL_ITEMS[id];
  if(!item) return;
  const subText = item.utility || item.description || "";
  const outOfStock = item.inStock === false;
  const images = (item.imageUrls && item.imageUrls.length) ? item.imageUrls : [];
  const priceBlock = isEstimate(item)
    ? `<div class="price-row"><span class="price">À partir de ${priceDualInline(item.startingPrice)}</span></div>`
    : `<div class="price-row"><span class="price">${priceDualInline(item.price)}</span>${item.oldPrice ? `<span class="price-old">$${item.oldPrice.toFixed(2)}</span>` : ''}</div>`;

  const galleryHTML = images.length ? `
    <div class="item-detail-thumb">
      ${item.promo ? '<span class="promo-flag">Promo</span>' : ''}
      ${outOfStock ? '<span class="stock-flag">Rupture de stock</span>' : ''}
      <img id="galleryMainImg" src="${images[0]}" alt="${item.name}">
    </div>
    ${images.length > 1 ? `
      <div class="gallery-thumbs">
        ${images.map((url,i) => `<button class="gallery-thumb-btn ${i===0?'active':''}" data-idx="${i}" onclick="setGalleryImage(${JSON.stringify(images).replace(/"/g,'&quot;')}, ${i}, this)"><img src="${url}" alt=""></button>`).join('')}
      </div>` : ''}
  ` : `
    <div class="item-detail-thumb">
      ${item.promo ? '<span class="promo-flag">Promo</span>' : ''}
      ${outOfStock ? '<span class="stock-flag">Rupture de stock</span>' : ''}
      <div class="no-image">Pas de photo</div>
    </div>`;

  document.title = item.name + ' — JC Multimedia';
  const canonicalEl = document.getElementById('canonicalLink');
  if(canonicalEl) canonicalEl.href = window.location.origin + '/article/' + id;

  const sectionLabel = isEstimate(item) ? 'Nos services' : 'Boutique';
  const sectionPath = isEstimate(item) ? '/services' : '/boutique';
  const breadcrumbEl = document.getElementById('articleBreadcrumb');
  if(breadcrumbEl){
    breadcrumbEl.innerHTML = `
      <a href="/">Accueil</a> <span>/</span>
      <a href="${sectionPath}">${sectionLabel}</a> <span>/</span>
      <span aria-current="page">${item.name}</span>
    `;
  }
  injectItemStructuredData(item);

  document.getElementById('itemDetailContent').innerHTML = `
    ${galleryHTML}
    <h1>${item.name}</h1>
    ${item.code ? `<p class="item-code-tag" style="display:inline-block; margin-bottom:10px;">${item.code}</p>` : ''}
    ${subText ? `<p class="card-sub" style="font-size:1rem;">${subText}</p>` : ''}
    ${priceBlock}
    <div class="qty-row">
      <button class="qty-btn" onclick="stepQty('${id}',-1)" aria-label="Diminuer la quantité">−</button>
      <span class="qty-val" data-qty-display="${id}">${uiQty[id]}</span>
      <button class="qty-btn" onclick="stepQty('${id}',1)" aria-label="Augmenter la quantité">+</button>
    </div>
    <button class="add-btn" style="max-width:280px;" ${outOfStock ? 'disabled' : ''} onclick="addToCart('${id}')">${outOfStock ? 'Indisponible' : 'Ajouter au panier'}</button>
    <button class="btn btn-ghost" style="margin-top:12px;" onclick="copyItemLink()">Copier le lien de cette page</button>
  `;
}
function injectItemStructuredData(item){
  const existing = document.getElementById('itemStructuredData');
  if(existing) existing.remove();

  const isService = isEstimate(item);
  const price = isService ? item.startingPrice : item.price;
  const data = {
    "@context": "https://schema.org",
    "@type": isService ? "Service" : "Product",
    "name": item.name,
    "url": window.location.origin + '/article/' + item.id
  };
  if(item.utility || item.description) data.description = item.utility || item.description;
  if(item.imageUrls && item.imageUrls.length) data.image = item.imageUrls;
  if(item.code) data[isService ? "serviceType" : "sku"] = item.code;
  if(!isService){
    data.brand = { "@type": "Brand", "name": "JC Multimedia" };
    data.offers = {
      "@type": "Offer",
      "priceCurrency": "USD",
      "price": price,
      "availability": item.inStock === false ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      "url": window.location.origin + '/article/' + item.id
    };
  } else if(price != null){
    data.offers = { "@type": "Offer", "priceCurrency": "USD", "price": price, "url": window.location.origin + '/article/' + item.id };
  }

  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.id = 'itemStructuredData';
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}
function copyItemLink(){
  const url = window.location.href;
  if(navigator.clipboard){
    navigator.clipboard.writeText(url).then(()=> showToast("Lien copié !"));
  } else {
    showToast(url);
  }
}

/* =========================================================
   SUIVI DE COMMANDE — recherche publique par code + téléphone
   (ne révèle jamais rien sans connaître les deux à la fois)
   ========================================================= */
async function submitTrackOrder(){
  const code = document.getElementById('trackCode').value.trim();
  const phone = document.getElementById('trackPhone').value.trim();
  const resultEl = document.getElementById('trackResult');
  if(!code || !phone){
    resultEl.innerHTML = '<p class="form-error">Merci de renseigner le code et le téléphone.</p>';
    return;
  }
  if(!SUPABASE_ENABLED){
    resultEl.innerHTML = '<p class="form-error">Le suivi de commande nécessite une connexion. Réessayez plus tard.</p>';
    return;
  }
  resultEl.innerHTML = '<p class="card-sub">Recherche…</p>';
  try{
    const { data, error } = await db.rpc('track_order', { p_code: code, p_phone: phone });
    if(error) throw error;
    if(!data){
      resultEl.innerHTML = '<p class="form-error">Aucune commande trouvée avec ce code et ce téléphone. Vérifiez vos informations.</p>';
      return;
    }
    renderTrackResult(data);
  }catch(e){
    resultEl.innerHTML = '<p class="form-error">Une erreur est survenue. Réessayez.</p>';
    console.error(e);
  }
}
function renderTrackResult(o){
  const rate = o.exchange_rate || SETTINGS.exchangeRate;
  const htg = new Intl.NumberFormat('fr-FR').format(Math.round((o.total||0) * rate));
  const items = (o.items||[]).map(i => `<li>${i.name} × ${i.qty}${i.customized ? ' (à personnaliser)' : ''}</li>`).join('');
  const history = (o.history||[]).map(h => `<li>${h.status} — ${new Date(h.changed_at).toLocaleString('fr-FR')}</li>`).join('');
  document.getElementById('trackResult').innerHTML = `
    <div class="admin-order-card">
      <div class="admin-order-head">
        <strong>${o.code}</strong>
        <span class="mono">${new Date(o.created_at).toLocaleDateString('fr-FR')}</span>
      </div>
      <div class="item-code-tag" style="margin:6px 0; display:inline-block;">${o.status}</div>
      <ul class="admin-list">${items}</ul>
      <div class="cart-total-row"><span>Total</span><span class="amt">$${Number(o.total||0).toFixed(2)}<span class="price-htg">≈ ${htg} HTG</span></span></div>
      <div class="card-sub">Paiement : ${o.payment || '—'} · ${o.delivery || '—'}</div>
      <h3 style="margin-bottom:6px;">Progression</h3>
      <ul class="admin-list">${history}</ul>
    </div>
  `;
}
function setGalleryImage(images, idx, btnEl){
  const main = document.getElementById('galleryMainImg');
  if(main) main.src = images[idx];
  document.querySelectorAll('.gallery-thumb-btn').forEach(b => b.classList.remove('active'));
  if(btnEl) btnEl.classList.add('active');
}
/* Sur la page article.html : lit l'identifiant dans l'URL (/article/ID) et
   affiche la bonne fiche dès que le catalogue est disponible. */
function initArticlePage(){
  const match = window.location.pathname.match(/^\/article\/(.+)$/);
  const id = match ? decodeURIComponent(match[1]) : null;
  const content = document.getElementById('itemDetailContent');
  if(!id){ content.innerHTML = '<p class="card-sub">Article introuvable.</p>'; return; }
  if(ALL_ITEMS[id]){ renderItemDetail(id); return; }
  content.innerHTML = '<p class="card-sub">Chargement…</p>';
}

/* =========================================================
   DRAWER (avec aria-expanded + restitution du focus)
   ========================================================= */
let lastFocusedBeforeDrawer = null;
function openDrawer(){
  lastFocusedBeforeDrawer = document.activeElement;
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawerOverlay').classList.add('open');
  document.getElementById('menuToggle').setAttribute('aria-expanded','true');
  setTimeout(()=> document.querySelector('.drawer nav a')?.focus(), 30);
}
function closeDrawer(){
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawerOverlay').classList.remove('open');
  document.getElementById('menuToggle').setAttribute('aria-expanded','false');
  if(lastFocusedBeforeDrawer && lastFocusedBeforeDrawer.focus) lastFocusedBeforeDrawer.focus();
}

/* =========================================================
   CART SHEET
   ========================================================= */
let lastFocusedBeforeCart = null;
function openCart(){
  lastFocusedBeforeCart = document.activeElement;
  renderCart();
  document.getElementById('cartOverlay').classList.add('open');
  setTimeout(()=> document.querySelector('#cartOverlay button, #cartOverlay input')?.focus(), 30);
}
function closeCart(){
  document.getElementById('cartOverlay').classList.remove('open');
  if(lastFocusedBeforeCart && lastFocusedBeforeCart.focus) lastFocusedBeforeCart.focus();
}

function cartEntries(){
  return Object.entries(cart).filter(([id,qty])=>qty>0 && ALL_ITEMS[id]).map(([id,qty])=>({...ALL_ITEMS[id], qty}));
}
function cartTotal(){
  return cartEntries().reduce((sum,item)=> sum + unitPrice(item)*item.qty, 0);
}
function renderCart(){
  const items = cartEntries();
  const itemsEl = document.getElementById('cartItems');
  const footerEl = document.getElementById('cartFooter');
  if(items.length === 0){
    itemsEl.innerHTML = '<div class="cart-empty">Votre panier est vide.</div>';
    footerEl.innerHTML = '';
    return;
  }
  const hasEstimateItems = items.some(i => isEstimate(i));
  itemsEl.innerHTML = items.map(item => `
    <div class="cart-item">
      <div>
        <div class="ci-name">${item.name}</div>
        <div class="ci-price">${item.qty} × ${isEstimate(item) ? 'à partir de ' : ''}${formatUSD(unitPrice(item))} <span class="price-htg" style="display:inline; margin:0;">≈ ${formatHTG(unitPrice(item))}</span></div>
      </div>
      <div class="ci-controls">
        <div class="qty-row-sm">
          <button class="qty-btn" onclick="changeCartQty('${item.id}',-1)" aria-label="Diminuer la quantité de ${item.name}">−</button>
          <span class="qty-val">${item.qty}</span>
          <button class="qty-btn" onclick="changeCartQty('${item.id}',1)" aria-label="Augmenter la quantité de ${item.name}">+</button>
        </div>
        <button class="ci-remove" onclick="removeFromCart('${item.id}')" aria-label="Retirer ${item.name} du panier">✕</button>
      </div>
    </div>
  `).join('');
  footerEl.innerHTML = `
    <div class="cart-total-row">
      <span>Total estimé</span>
      <span class="amt">${formatUSD(cartTotal())}<span class="price-htg" style="text-align:right;">≈ ${formatHTG(cartTotal())}</span></span>
    </div>
    ${hasEstimateItems ? '<div class="cart-quote-note">* Prix de certains services estimés « à partir de » — montant final confirmé sur WhatsApp.</div>' : ''}
    <div class="cart-actions">
      <button class="btn btn-wa btn-block" onclick="startOrderFlow()">Commander via WhatsApp</button>
      <button class="btn btn-ghost btn-block" onclick="confirmClearCart()">Vider le panier</button>
    </div>
  `;
}
function changeCartQty(id, delta){
  const next = Math.min(MAX_QTY, Math.max(1, (cart[id] || 1) + delta));
  cart[id] = next;
  saveCart();
  renderCart();
  updateBadge();
}
function removeFromCart(id){
  delete cart[id];
  saveCart();
  renderCart();
  updateBadge();
}
function clearCart(){
  cart = {};
  saveCart();
  renderCart();
  updateBadge();
  showToast("Panier vidé");
}
function confirmClearCart(){
  openStep(`
    <h3>Vider le panier ?</h3>
    <p class="card-sub">Cette action retirera tous les articles de votre panier. Cette action est irréversible.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeStep()">Annuler</button>
      <button class="btn btn-primary" onclick="clearCart(); closeStep();">Vider</button>
    </div>
  `, "Confirmer");
}

/* =========================================================
   MODALE D'ÉTAPE — bouton de fermeture, role="dialog", focus géré
   ========================================================= */
let lastFocusedBeforeModal = null;
function openStep(bodyHtml, ariaLabel){
  lastFocusedBeforeModal = document.activeElement;
  const modal = document.getElementById('stepModal');
  modal.innerHTML = `<button class="modal-close-x" onclick="closeStep()" aria-label="Fermer">✕</button>` + bodyHtml;
  modal.setAttribute('aria-label', ariaLabel || 'Étape de commande');
  document.getElementById('stepOverlay').classList.add('open');
  setTimeout(()=>{
    const focusable = modal.querySelector('input, select, button:not(.modal-close-x)');
    (focusable || modal.querySelector('.modal-close-x'))?.focus();
  }, 30);
}
function closeStep(){
  document.getElementById('stepOverlay').classList.remove('open');
  if(lastFocusedBeforeModal && lastFocusedBeforeModal.focus) lastFocusedBeforeModal.focus();
}

/* =========================================================
   ORDER FLOW: coordonnées -> personnalisation -> paiement -> livraison -> WhatsApp -> confirmation
   ========================================================= */
function startOrderFlow(){
  const idempotencyKey = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2));
  orderFlow = { customerName:"", customerPhone:"", customerAddress:"", customize:null, customizedItems:[], payment:null, delivery:null, idempotencyKey, uploadFiles:[] };
  showStepCustomerInfo();
}
function showStepCustomerInfo(){
  openStep(`
    <h3>Vos coordonnées</h3>
    <div class="form-field">
      <label for="cfName">Nom complet *</label>
      <input type="text" id="cfName" value="${orderFlow.customerName}" placeholder="Ex : Jean Baptiste" autocomplete="name">
    </div>
    <div class="form-field">
      <label for="cfPhone">Téléphone *</label>
      <input type="tel" id="cfPhone" value="${orderFlow.customerPhone}" placeholder="Ex : 3443 2139" autocomplete="tel">
    </div>
    <div class="form-field">
      <label for="cfAddress">Adresse (si livraison)</label>
      <input type="text" id="cfAddress" value="${orderFlow.customerAddress}" placeholder="Quartier, rue, repère…" autocomplete="street-address">
    </div>
    <p id="cfError" class="form-error" style="display:none;">Merci de renseigner votre nom et votre téléphone.</p>
    <div class="modal-actions">
      <button class="btn btn-primary btn-block" onclick="collectCustomerInfo()">Suivant</button>
    </div>
  `, "Vos coordonnées");
}
function collectCustomerInfo(){
  const name = document.getElementById('cfName').value.trim();
  const phone = document.getElementById('cfPhone').value.trim();
  const address = document.getElementById('cfAddress').value.trim();
  if(!name || !phone){
    document.getElementById('cfError').style.display = 'block';
    return;
  }
  orderFlow.customerName = name;
  orderFlow.customerPhone = phone;
  orderFlow.customerAddress = address;
  const customizableInCart = cartEntries().filter(i => i.customizable);
  if(customizableInCart.length > 0){ showStepCustomizeAsk(); } else { showStepPayment(); }
}
function showStepCustomizeAsk(){
  openStep(`
    <h3>Souhaitez-vous personnaliser certains articles ?</h3>
    <button class="opt-btn" onclick="orderFlow.customize=true; showStepCustomizeList();">Oui</button>
    <button class="opt-btn" onclick="orderFlow.customize=false; showStepPayment();">Non</button>
  `, "Personnalisation des articles");
}
const MAX_UPLOAD_FILES = 3;
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5 Mo
const ALLOWED_UPLOAD_TYPES = ['image/jpeg','image/png','image/webp','image/gif','application/pdf'];

function showStepCustomizeList(){
  const items = cartEntries().filter(i => i.customizable);
  openStep(`
    <h3>Articles à personnaliser</h3>
    ${items.map(i => `
      <label class="check-row">
        <input type="checkbox" value="${i.id}" ${orderFlow.customizedItems.includes(i.id) ? 'checked':''}>
        ${i.name}
      </label>
    `).join('')}
    <div class="form-field" style="margin-top:16px;">
      <label>Joindre des fichiers (logo, photo, design…) — jusqu'à ${MAX_UPLOAD_FILES}, 5 Mo max chacun (images ou PDF)</label>
      <div class="admin-image-row">
        ${[0,1,2].map(slot => `
          <div class="admin-image-slot">
            <div class="admin-image-preview" id="cfile-preview-${slot}">${orderFlow.uploadFiles[slot] ? `<span>${orderFlow.uploadFiles[slot].name.slice(0,14)}</span>` : '<span>Aucun fichier</span>'}</div>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" id="cfile-${slot}" onchange="handleCustomizeFileChange(${slot})">
          </div>
        `).join('')}
      </div>
      <p id="cfileError" class="form-error" style="display:none;"></p>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="showStepCustomizeAsk()">Retour</button>
      <button class="btn btn-primary" onclick="collectCustomizeList()">Suivant</button>
    </div>
  `, "Articles à personnaliser");
}
function handleCustomizeFileChange(slot){
  const input = document.getElementById('cfile-'+slot);
  const file = input.files[0];
  const errorEl = document.getElementById('cfileError');
  errorEl.style.display = 'none';
  if(!file) return;
  if(!ALLOWED_UPLOAD_TYPES.includes(file.type)){
    errorEl.textContent = "Format non accepté. Utilisez une image (JPG, PNG, WEBP, GIF) ou un PDF.";
    errorEl.style.display = 'block';
    input.value = '';
    return;
  }
  if(file.size > MAX_UPLOAD_SIZE){
    errorEl.textContent = "Fichier trop volumineux (5 Mo maximum).";
    errorEl.style.display = 'block';
    input.value = '';
    return;
  }
  orderFlow.uploadFiles[slot] = file;
  document.getElementById('cfile-preview-'+slot).innerHTML = `<span>${file.name.length>16 ? file.name.slice(0,14)+'…' : file.name}</span>`;
}
function collectCustomizeList(){
  orderFlow.customizedItems = Array.from(document.querySelectorAll('.check-row input:checked')).map(el => el.value);
  showStepPayment();
}
function showStepPayment(){
  const options = ["MonCash","Natcash","Cash","Virement Bancaire","Carte bancaire"];
  const hasCustomizable = cartEntries().some(i=>i.customizable);
  openStep(`
    <h3>Quel est votre mode de paiement préféré ?</h3>
    ${options.map(o => `<button class="opt-btn ${orderFlow.payment===o?'selected':''}" onclick="selectPayment('${o}')">${o}</button>`).join('')}
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="${hasCustomizable ? "showStepCustomizeAsk()" : "showStepCustomerInfo()"}">Retour</button>
      <button class="btn btn-primary" onclick="orderFlow.payment ? showStepDelivery() : null">Suivant</button>
    </div>
  `, "Mode de paiement");
}
function selectPayment(o){ orderFlow.payment = o; showStepPayment(); }
function showStepDelivery(){
  const options = ["Se faire livrer","Récupérer sur place"];
  openStep(`
    <h3>Souhaitez-vous être livré ou récupérer sur place ?</h3>
    ${options.map(o => `<button class="opt-btn ${orderFlow.delivery===o?'selected':''}" onclick="selectDelivery('${o}')">${o}</button>`).join('')}
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="showStepPayment()">Retour</button>
      <button class="btn btn-primary" id="sendOrderBtn" onclick="orderFlow.delivery ? handleSendOrderClick() : null">Envoyer</button>
    </div>
  `, "Livraison ou retrait");
}
function selectDelivery(o){ orderFlow.delivery = o; showStepDelivery(); }

let orderSending = false;
async function handleSendOrderClick(){
  if(orderSending) return;
  orderSending = true;
  const btn = document.getElementById('sendOrderBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Envoi en cours…'; }
  try{
    await sendOrder();
  } finally {
    orderSending = false;
  }
}

async function sendOrder(){
  const items = cartEntries();
  const total = cartTotal();

  let orderCode = null;
  let orderId = null;

  if(SUPABASE_ENABLED){
    try{
      const { data, error } = await db.from('orders').insert({
        customer_name: orderFlow.customerName,
        customer_phone: orderFlow.customerPhone,
        customer_address: orderFlow.customerAddress || null,
        items: items.map(i => ({
          name: i.name,
          qty: i.qty,
          kind: isEstimate(i) ? 'services' : 'products',
          customized: orderFlow.customizedItems.includes(i.id)
        })),
        total: total,
        exchange_rate: SETTINGS.exchangeRate,
        payment: orderFlow.payment,
        delivery: orderFlow.delivery,
        idempotency_key: orderFlow.idempotencyKey
      }).select('id, code').single();
      if(error) throw error;
      orderId = data.id;
      orderCode = data.code;

      // Lignes de commande détaillées avec snapshot (prix, code, nom au
      // moment de l'achat) — une modification future du catalogue ne
      // change jamais l'historique de cette commande.
      const lineRows = items.map(i => ({
        order_id: orderId,
        catalog_item_id: i.id,
        kind: isEstimate(i) ? 'services' : 'products',
        code: i.code || null,
        name: i.name,
        unit_price: unitPrice(i),
        is_estimate: isEstimate(i),
        quantity: i.qty,
        customized: orderFlow.customizedItems.includes(i.id),
        line_total: unitPrice(i) * i.qty
      }));
      if(lineRows.length){
        const { error: itemsError } = await db.from('order_items').insert(lineRows);
        if(itemsError) console.warn('order_items insert failed:', itemsError);
      }

      // Enregistrement du paiement — TOUJOURS "En attente" au départ.
      // Choisir un mode de paiement ne veut jamais dire que l'argent a
      // été reçu ; seul l'admin confirme manuellement après vérification.
      const { error: paymentError } = await db.from('payments').insert({
        order_id: orderId,
        method: orderFlow.payment,
        amount: total,
        status: 'En attente'
      });
      if(paymentError) console.warn('payment insert failed:', paymentError);

      // Envoi des fichiers joints (logo, design…) — chemin de stockage
      // toujours généré ici, jamais le nom brut envoyé par le client ;
      // le nom d'origine est seulement conservé pour affichage à l'admin.
      const filesToUpload = (orderFlow.uploadFiles || []).filter(Boolean);
      for(const file of filesToUpload){
        try{
          const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g,'');
          const safePath = `${orderId}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
          const { error: upErr } = await db.storage.from('order-uploads').upload(safePath, file);
          if(upErr) throw upErr;
          await db.from('order_uploads').insert({
            order_id: orderId,
            original_filename: file.name,
            storage_path: safePath,
            mime_type: file.type,
            size_bytes: file.size
          });
        }catch(e){ console.warn('file upload failed:', e); }
      }
    }catch(e){
      // Si la clé d'idempotence existe déjà (double clic malgré la
      // protection du bouton), on ne recrée jamais une seconde commande.
      console.warn('Supabase order insert failed, using local fallback only:', e);
    }
  }

  const orderRecord = {
    date: Date.now(),
    code: orderCode,
    customerName: orderFlow.customerName,
    customerPhone: orderFlow.customerPhone,
    customerAddress: orderFlow.customerAddress,
    items: items.map(i => ({ name:i.name, qty:i.qty, customized: orderFlow.customizedItems.includes(i.id) })),
    total: total,
    exchangeRate: SETTINGS.exchangeRate,
    payment: orderFlow.payment,
    delivery: orderFlow.delivery
  };
  logOrderLocal(orderRecord);

  let msg = "Bonjour JC Multimedia, je souhaite commander :%0A%0A";
  if(orderCode) msg += `Code commande : ${orderCode}%0A%0A`;
  msg += `Nom : ${orderFlow.customerName}%0ATéléphone : ${orderFlow.customerPhone}%0A`;
  if(orderFlow.customerAddress) msg += `Adresse : ${orderFlow.customerAddress}%0A`;
  msg += `%0A`;
  items.forEach(i => {
    const tag = orderFlow.customizedItems.includes(i.id) ? " (à personnaliser)" : "";
    const codeTag = i.code ? ` [${i.code}]` : "";
    const lineTotal = unitPrice(i) * i.qty;
    const amount = `${isEstimate(i) ? 'à partir de ' : ''}${formatUSD(lineTotal)} (≈ ${formatHTG(lineTotal)})${isEstimate(i) ? ' — estimation' : ''}`;
    msg += `• ${i.name}${codeTag}${tag} x${i.qty} — ${amount}%0A`;
  });
  msg += `%0ATotal estimé : ${formatUSD(total)} (≈ ${formatHTG(total)})%0A`;
  msg += `Mode de paiement : ${orderFlow.payment}%0A`;
  msg += `Livraison : ${orderFlow.delivery}`;

  window.open(`https://wa.me/${SETTINGS.whatsapp}?text=${msg}`, "_blank");

  cart = {};
  saveCart();
  updateBadge();
  showStepConfirmation(orderCode);
}

function showStepConfirmation(orderCode){
  const codeBlock = orderCode
    ? `<p class="order-code-display">Votre code de commande<br><strong>${orderCode}</strong></p>`
    : '';
  openStep(`
    <div class="modal-confirm">
      <div class="confirm-icon">✓</div>
      <h3 style="margin-right:0;">Commande envoyée !</h3>
      ${codeBlock}
      <p class="card-sub">Votre commande a été transmise sur WhatsApp. Un membre de l'équipe JC Multimedia vous répondra pour confirmer les détails, le paiement et la livraison.</p>
      <button class="btn btn-primary btn-block" onclick="closeStep(); closeCart();">Fermer</button>
    </div>
  `, "Commande envoyée");
}

/* =========================================================
   MODALES — fermeture au clic hors zone et à la touche Échap
   (aucun piège de focus : le clavier reste libre de sortir des modales)
   ========================================================= */
document.getElementById('stepOverlay').addEventListener('click', function(e){
  if(e.target === this) closeStep();
});
document.addEventListener('keydown', function(e){
  if(e.key !== 'Escape') return;
  if(document.getElementById('stepOverlay').classList.contains('open')){ closeStep(); return; }
  if(document.getElementById('cartOverlay').classList.contains('open')){ closeCart(); return; }
  if(document.getElementById('drawer').classList.contains('open')){ closeDrawer(); return; }
});

/* =========================================================
   BACK TO TOP
   ========================================================= */
window.addEventListener('scroll', function(){
  document.getElementById('backToTop').style.display = window.scrollY > 600 ? 'flex' : 'none';
}, { passive:true });

/* =========================================================
   ORDERS LOG — journal local (repli hors-ligne uniquement ;
   quand Supabase est configuré, l'onglet admin "Commandes"
   lit directement Supabase pour voir TOUTES les commandes,
   de tous les appareils)
   ========================================================= */
function loadOrdersLocal(){ return safeGet(ORDERS_STORAGE_KEY) || []; }
function saveOrdersLocal(orders){ safeSet(ORDERS_STORAGE_KEY, orders); }
function logOrderLocal(record){
  const orders = loadOrdersLocal();
  orders.unshift(record);
  if(orders.length > 500) orders.length = 500;
  saveOrdersLocal(orders);
}

/* =========================================================
   ESPACE ADMIN
   Si Supabase est configuré : connexion par email + mot de passe
   (vrai compte Supabase Auth créé dans Authentication → Users),
   et le catalogue/réglages/commandes sont centralisés pour tous
   les appareils. Sinon : repli sur l'ancien mot de passe local
   (protège uniquement l'accès dans CE navigateur).
   ========================================================= */
async function attemptAdminLogin(){
  const errEl = document.getElementById('adminLoginError');
  errEl.style.display = 'none';
  if(SUPABASE_ENABLED){
    const email = document.getElementById('adminEmailInput').value.trim();
    const password = document.getElementById('adminPwInput').value;
    const { error } = await db.auth.signInWithPassword({ email, password });
    if(error){
      errEl.textContent = "Identifiants incorrects.";
      errEl.style.display = 'block';
      return;
    }
    await enterAdminPanel();
  } else {
    const val = document.getElementById('adminPwInput').value;
    if(val === SETTINGS.adminPassword){
      try{ sessionStorage.setItem('jc_admin_session','1'); }catch(e){}
      await enterAdminPanel();
    } else {
      errEl.textContent = "Mot de passe incorrect.";
      errEl.style.display = 'block';
    }
  }
}
async function enterAdminPanel(){
  document.getElementById('adminLogin').style.display = 'none';
  document.getElementById('adminPanel').style.display = 'block';
  showAdminTab('dashboard');
}
async function checkAdminSession(){
  let authed = false;
  if(SUPABASE_ENABLED){
    const { data } = await db.auth.getSession();
    authed = !!data?.session;
  } else {
    try{ authed = sessionStorage.getItem('jc_admin_session') === '1'; }catch(e){}
  }
  if(authed){
    await enterAdminPanel();
  } else {
    document.getElementById('adminLogin').style.display = 'block';
    document.getElementById('adminPanel').style.display = 'none';
  }
}
async function adminLogout(){
  if(SUPABASE_ENABLED){ await db.auth.signOut(); }
  try{ sessionStorage.removeItem('jc_admin_session'); }catch(e){}
  document.getElementById('adminPanel').style.display = 'none';
  document.getElementById('adminLogin').style.display = 'block';
  const pw = document.getElementById('adminPwInput'); if(pw) pw.value = '';
  const em = document.getElementById('adminEmailInput'); if(em) em.value = '';
}
function showAdminTab(name){
  ['dashboard','catalog','content','banner','orders','customers','settings'].forEach(t=>{
    document.getElementById('adminTab-'+t).style.display = (t===name) ? 'block' : 'none';
  });
  document.querySelectorAll('.admin-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
  if(name==='dashboard') renderAdminDashboard();
  if(name==='catalog') renderAdminCatalog();
  if(name==='content') renderAdminContent();
  if(name==='banner') renderAdminBanner();
  if(name==='orders') renderAdminOrders();
  if(name==='customers') renderAdminCustomers();
  if(name==='settings') renderAdminSettings();
}

/* ---- Clients ---- */
/* ---- Bannière d'accueil (slideshow) ---- */
let ADMIN_SLIDES = [];
async function renderAdminBanner(){
  const el = document.getElementById('adminTab-banner');
  if(!SUPABASE_ENABLED){
    el.innerHTML = `<div class="admin-note">⚠️ La bannière d'accueil nécessite que Supabase soit configuré.</div>`;
    return;
  }
  el.innerHTML = `<p class="card-sub">Chargement…</p>`;
  try{
    const { data, error } = await db.from('hero_slides').select('*').order('display_order', { ascending:true });
    if(error) throw error;
    ADMIN_SLIDES = data || [];
  }catch(e){
    el.innerHTML = `<div class="admin-note">Échec du chargement des slides.</div>`;
    console.error(e);
    return;
  }
  el.innerHTML = `
    <div class="admin-note">Le slideshow s'affiche en haut de l'accueil uniquement s'il y a au moins un slide actif. Jusqu'à 10+ images, sans limite artificielle.</div>
    <div id="adminSlidesList"></div>
    <button class="btn btn-ghost" onclick="adminAddSlide()">+ Ajouter un slide</button>
  `;
  renderAdminSlidesList();
}
function renderAdminSlidesList(){
  const container = document.getElementById('adminSlidesList');
  if(!container) return;
  container.innerHTML = ADMIN_SLIDES.map((s, idx) => `
    <div class="admin-item-row" id="adminslide-${s.id}">
      <div class="admin-item-summary" onclick="toggleAdminSlideEdit(${s.id})">
        <span>${s.title || '(sans titre)'} ${!s.is_active ? '<span class="stock-flag" style="position:static;">Désactivé</span>' : ''}</span>
        <div style="display:flex; gap:4px; margin-left:auto;">
          <button class="qty-btn" onclick="event.stopPropagation(); adminMoveSlide(${idx}, -1)" ${idx===0?'disabled':''} aria-label="Monter">↑</button>
          <button class="qty-btn" onclick="event.stopPropagation(); adminMoveSlide(${idx}, 1)" ${idx===ADMIN_SLIDES.length-1?'disabled':''} aria-label="Descendre">↓</button>
        </div>
      </div>
      <div class="admin-item-edit" id="adminslideedit-${s.id}" style="display:none;">
        <div class="form-field">
          <label>Image (desktop)</label>
          <div class="admin-image-preview" id="slideimg-${s.id}-desktop" style="width:100%; height:120px;">${s.image_url ? `<img src="${s.image_url}" alt="">` : '<span>Pas de photo</span>'}</div>
          <input type="file" accept="image/*" id="slidefile-${s.id}-desktop">
        </div>
        <div class="form-field">
          <label>Image mobile (optionnelle)</label>
          <div class="admin-image-preview" id="slideimg-${s.id}-mobile" style="width:100%; height:120px;">${s.mobile_image_url ? `<img src="${s.mobile_image_url}" alt="">` : '<span>Pas de photo</span>'}</div>
          <input type="file" accept="image/*" id="slidefile-${s.id}-mobile">
        </div>
        <div class="form-field"><label>Texte alternatif (accessibilité)</label><input type="text" id="slide-alt-${s.id}" value="${(s.alt_text||'').replace(/"/g,'&quot;')}"></div>
        <div class="form-field"><label>Titre</label><input type="text" id="slide-title-${s.id}" value="${(s.title||'').replace(/"/g,'&quot;')}"></div>
        <div class="form-field"><label>Sous-titre</label><input type="text" id="slide-subtitle-${s.id}" value="${(s.subtitle||'').replace(/"/g,'&quot;')}"></div>
        <div class="form-field"><label>Texte du bouton</label><input type="text" id="slide-btntext-${s.id}" value="${(s.button_text||'').replace(/"/g,'&quot;')}"></div>
        <div class="form-field"><label>Lien du bouton</label><input type="text" id="slide-btnurl-${s.id}" value="${(s.button_url||'').replace(/"/g,'&quot;')}" placeholder="/boutique"></div>
        <div class="form-field"><label>Début de diffusion (optionnel)</label><input type="datetime-local" id="slide-start-${s.id}" value="${s.start_at ? s.start_at.slice(0,16) : ''}"></div>
        <div class="form-field"><label>Fin de diffusion (optionnel)</label><input type="datetime-local" id="slide-end-${s.id}" value="${s.end_at ? s.end_at.slice(0,16) : ''}"></div>
        <label class="check-row"><input type="checkbox" id="slide-active-${s.id}" ${s.is_active?'checked':''}> Actif</label>
        <div class="modal-actions">
          <button class="btn btn-primary" id="slidesave-${s.id}" onclick="adminSaveSlide(${s.id})">Enregistrer</button>
          <button class="btn btn-ghost" onclick="adminDeleteSlide(${s.id})">Supprimer</button>
        </div>
      </div>
    </div>
  `).join('') || '<p class="card-sub">Aucun slide pour le moment.</p>';
}
function toggleAdminSlideEdit(id){
  const el = document.getElementById('adminslideedit-'+id);
  el.style.display = (el.style.display === 'none') ? 'block' : 'none';
}
async function adminMoveSlide(idx, dir){
  const otherIdx = idx + dir;
  if(otherIdx < 0 || otherIdx >= ADMIN_SLIDES.length) return;
  const a = ADMIN_SLIDES[idx], b = ADMIN_SLIDES[otherIdx];
  const aOrder = a.display_order, bOrder = b.display_order;
  a.display_order = bOrder; b.display_order = aOrder;
  [ADMIN_SLIDES[idx], ADMIN_SLIDES[otherIdx]] = [ADMIN_SLIDES[otherIdx], ADMIN_SLIDES[idx]];
  renderAdminSlidesList();
  try{
    await db.from('hero_slides').update({ display_order: a.display_order }).eq('id', a.id);
    await db.from('hero_slides').update({ display_order: b.display_order }).eq('id', b.id);
  }catch(e){ console.error(e); }
}
async function adminSaveSlide(id){
  const slide = ADMIN_SLIDES.find(s => s.id === id);
  if(!slide) return;
  const btn = document.getElementById('slidesave-'+id);
  if(btn){ btn.disabled = true; btn.textContent = 'Enregistrement…'; }
  try{
    const desktopFile = document.getElementById(`slidefile-${id}-desktop`).files[0];
    const mobileFile = document.getElementById(`slidefile-${id}-mobile`).files[0];
    if(desktopFile){
      const path = `${id}-desktop-${Date.now()}.${(desktopFile.name.split('.').pop()||'jpg')}`;
      const { error } = await db.storage.from('hero-slides').upload(path, desktopFile, { upsert:true });
      if(error) throw error;
      slide.image_url = db.storage.from('hero-slides').getPublicUrl(path).data.publicUrl;
    }
    if(mobileFile){
      const path = `${id}-mobile-${Date.now()}.${(mobileFile.name.split('.').pop()||'jpg')}`;
      const { error } = await db.storage.from('hero-slides').upload(path, mobileFile, { upsert:true });
      if(error) throw error;
      slide.mobile_image_url = db.storage.from('hero-slides').getPublicUrl(path).data.publicUrl;
    }
    const startVal = document.getElementById('slide-start-'+id).value;
    const endVal = document.getElementById('slide-end-'+id).value;
    const payload = {
      image_url: slide.image_url,
      mobile_image_url: slide.mobile_image_url || null,
      alt_text: document.getElementById('slide-alt-'+id).value.trim(),
      title: document.getElementById('slide-title-'+id).value.trim(),
      subtitle: document.getElementById('slide-subtitle-'+id).value.trim(),
      button_text: document.getElementById('slide-btntext-'+id).value.trim(),
      button_url: document.getElementById('slide-btnurl-'+id).value.trim(),
      start_at: startVal ? new Date(startVal).toISOString() : null,
      end_at: endVal ? new Date(endVal).toISOString() : null,
      is_active: document.getElementById('slide-active-'+id).checked,
      updated_at: new Date().toISOString()
    };
    const { error } = await db.from('hero_slides').update(payload).eq('id', id);
    if(error) throw error;
    Object.assign(slide, payload);
    showToast("Slide enregistré");
  }catch(e){
    showToast("Échec de l'enregistrement du slide");
    console.error(e);
  }
  if(btn){ btn.disabled = false; btn.textContent = 'Enregistrer'; }
  renderAdminSlidesList();
}
async function adminDeleteSlide(id){
  if(!window.confirm("Supprimer définitivement ce slide ?")) return;
  try{
    const { error } = await db.from('hero_slides').delete().eq('id', id);
    if(error) throw error;
    ADMIN_SLIDES = ADMIN_SLIDES.filter(s => s.id !== id);
    renderAdminSlidesList();
    showToast("Slide supprimé");
  }catch(e){
    showToast("Échec de la suppression");
    console.error(e);
  }
}
async function adminAddSlide(){
  try{
    const maxOrder = ADMIN_SLIDES.reduce((m,s)=>Math.max(m,s.display_order||0), 0);
    const { data, error } = await db.from('hero_slides').insert({
      image_url: 'https://placehold.co/1600x700?text=Ajoutez+une+image',
      title: 'Nouveau slide', display_order: maxOrder + 1, is_active: false
    }).select().single();
    if(error) throw error;
    ADMIN_SLIDES.push(data);
    renderAdminSlidesList();
    setTimeout(()=> toggleAdminSlideEdit(data.id), 50);
  }catch(e){
    showToast("Échec de la création du slide");
    console.error(e);
  }
}

async function renderAdminCustomers(){
  const el = document.getElementById('adminTab-customers');
  if(!SUPABASE_ENABLED){
    el.innerHTML = `<div class="admin-note">⚠️ La liste des clients nécessite que Supabase soit configuré.</div>`;
    return;
  }
  el.innerHTML = `<p class="card-sub">Chargement…</p>`;
  try{
    const { data, error } = await db.from('customer_summary').select('*').order('last_order_at', { ascending:false });
    if(error) throw error;
    if(!data || data.length === 0){
      el.innerHTML = `<div class="admin-note">Les clients apparaissent ici automatiquement dès leur première commande.</div><p class="card-sub">Aucun client pour le moment.</p>`;
      return;
    }
    el.innerHTML = `
      <div class="admin-note">Calculé automatiquement à partir des commandes (le numéro de téléphone identifie chaque client).</div>
      ${data.map(c => `
        <div class="admin-order-card">
          <div class="admin-order-head">
            <strong>${c.latest_name || 'Client'}</strong>
            <span class="mono">${c.order_count} commande${c.order_count>1?'s':''}</span>
          </div>
          <div class="card-sub">${c.phone || ''}${c.latest_address ? ' · ' + c.latest_address : ''}</div>
          <div class="cart-total-row"><span>Total dépensé</span><span class="amt">$${Number(c.total_spent||0).toFixed(2)}</span></div>
          <div class="card-sub">Première commande : ${new Date(c.first_order_at).toLocaleDateString('fr-FR')} · Dernière : ${new Date(c.last_order_at).toLocaleDateString('fr-FR')}</div>
        </div>
      `).join('')}
    `;
  }catch(e){
    el.innerHTML = `<div class="admin-note">Échec du chargement des clients.</div>`;
    console.error(e);
  }
}
function renderAdminContent(){
  const c = SITE_CONTENT;
  const note = SUPABASE_ENABLED
    ? "Ces textes sont enregistrés dans Supabase et visibles immédiatement par tous vos visiteurs."
    : "⚠️ Supabase n'est pas configuré : ces textes restent enregistrés uniquement sur cet appareil/navigateur.";
  document.getElementById('adminTab-content').innerHTML = `
    <div class="admin-note">${note}</div>

    <h3 style="margin-top:0;">Page d'accueil</h3>
    <div class="form-field"><label>Titre principal</label><input type="text" id="c-hero-title" value="${(c.hero_title||'').replace(/"/g,'&quot;')}"></div>
    <div class="form-field"><label>Sous-titre</label><input type="text" id="c-hero-subtitle" value="${(c.hero_subtitle||'').replace(/"/g,'&quot;')}"></div>
    <div class="form-field"><label>Texte "À propos"</label><input type="text" id="c-about" value="${(c.about_text||'').replace(/"/g,'&quot;')}"></div>

    <h3>Coordonnées</h3>
    <div class="form-field"><label>Adresse 1</label><input type="text" id="c-addr1" value="${(c.address_1||'').replace(/"/g,'&quot;')}"></div>
    <div class="form-field"><label>Adresse 2</label><input type="text" id="c-addr2" value="${(c.address_2||'').replace(/"/g,'&quot;')}"></div>
    <div class="form-field"><label>NIF</label><input type="text" id="c-nif" value="${(c.nif||'').replace(/"/g,'&quot;')}"></div>
    <div class="form-field"><label>Email de contact</label><input type="text" id="c-email" value="${(c.email||'').replace(/"/g,'&quot;')}"></div>
    <div class="form-field"><label>Téléphone(s) affichés</label><input type="text" id="c-phone" value="${(c.phone_display||'').replace(/"/g,'&quot;')}"></div>

    <h3>Pied de page</h3>
    <div class="form-field"><label>Slogan (sous le logo)</label><input type="text" id="c-tagline" value="${(c.footer_tagline||'').replace(/"/g,'&quot;')}"></div>

    <h3>Réseaux sociaux</h3>
    <div class="form-field"><label>Facebook (lien complet)</label><input type="text" id="c-facebook" value="${(c.social_facebook||'').replace(/"/g,'&quot;')}"></div>
    <div class="form-field"><label>Instagram (lien complet)</label><input type="text" id="c-instagram" value="${(c.social_instagram||'').replace(/"/g,'&quot;')}"></div>
    <div class="form-field"><label>TikTok (lien complet)</label><input type="text" id="c-tiktok" value="${(c.social_tiktok||'').replace(/"/g,'&quot;')}"></div>
    <div class="form-field"><label>Numéro WhatsApp (format international, sans le +)</label><input type="text" id="c-whatsapp" value="${(c.social_whatsapp_number||'').replace(/"/g,'&quot;')}"></div>

    <button class="btn btn-primary" id="save-content-btn" onclick="adminSaveContent()">Enregistrer</button>
  `;
}
async function adminSaveContent(){
  const val = id => document.getElementById(id).value.trim();
  SITE_CONTENT = {
    hero_title: val('c-hero-title'),
    hero_subtitle: val('c-hero-subtitle'),
    about_text: val('c-about'),
    address_1: val('c-addr1'),
    address_2: val('c-addr2'),
    nif: val('c-nif'),
    email: val('c-email'),
    phone_display: val('c-phone'),
    footer_tagline: val('c-tagline'),
    social_facebook: val('c-facebook'),
    social_instagram: val('c-instagram'),
    social_tiktok: val('c-tiktok'),
    social_whatsapp_number: val('c-whatsapp')
  };
  if(SUPABASE_ENABLED){
    const btn = document.getElementById('save-content-btn');
    if(btn){ btn.disabled = true; btn.textContent = 'Enregistrement…'; }
    try{
      const { error } = await db.from('site_content').upsert({ id: 1, ...SITE_CONTENT });
      if(error) throw error;
    }catch(e){
      showToast("Échec de l'enregistrement Supabase — vérifiez votre connexion.");
      console.error(e);
    }
    if(btn){ btn.disabled = false; btn.textContent = 'Enregistrer'; }
  }
  saveSiteContentLocal();
  applySiteContent();
  showToast("Contenu enregistré");
}

/* ---- Tableau de bord ---- */
async function renderAdminDashboard(){
  const el = document.getElementById('adminTab-dashboard');
  el.innerHTML = `<p class="card-sub">Chargement…</p>`;
  const orders = await getOrdersForAdmin();
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((s,o)=> s + (o.total||0), 0);
  const itemCounts = {};
  orders.forEach(o => (o.items||[]).forEach(i => { itemCounts[i.name] = (itemCounts[i.name]||0) + i.qty; }));
  const topItems = Object.entries(itemCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const noteText = SUPABASE_ENABLED
    ? "Ces statistiques comptent toutes les commandes reçues via Supabase, quel que soit l'appareil utilisé par vos clients."
    : "Ces statistiques ne comptent que les commandes envoyées depuis <strong>cet appareil</strong> — Supabase n'est pas encore configuré. Voir le fichier schema-supabase.sql pour centraliser les commandes de tous vos clients.";
  el.innerHTML = `
    <div class="admin-note">${noteText}</div>
    <div class="admin-stat-grid">
      <div class="admin-stat-card"><div class="stat-num">${totalOrders}</div><div class="stat-label">Commandes ${SUPABASE_ENABLED ? '(toutes)' : '(cet appareil)'}</div></div>
      <div class="admin-stat-card"><div class="stat-num">$${totalRevenue.toFixed(2)}</div><div class="stat-label">Total estimé</div></div>
      <div class="admin-stat-card"><div class="stat-num">${CATALOG.products.length + CATALOG.services.length}</div><div class="stat-label">Articles au catalogue</div></div>
    </div>
    <h3>Articles les plus commandés</h3>
    ${topItems.length ? '<ul class="admin-list">' + topItems.map(([n,q])=>`<li>${n} — ${q}</li>`).join('') + '</ul>' : '<p class="card-sub">Aucune commande enregistrée pour le moment.</p>'}
  `;
}

/* ---- Catalogue ---- */
function renderAdminCatalog(){
  const note = SUPABASE_ENABLED
    ? "Les modifications sont enregistrées dans Supabase et visibles immédiatement par tous vos clients, sur tous les appareils."
    : "Supabase n'est pas configuré : les modifications restent enregistrées uniquement sur cet appareil/navigateur.";
  document.getElementById('adminTab-catalog').innerHTML = `
    <div class="admin-note">${note}</div>
    <h3 style="margin-top:0;">Produits (Boutique)</h3>
    <div id="adminProductsList"></div>
    <button class="btn btn-ghost" onclick="adminAddItem('products')">+ Ajouter un produit</button>
    <h3 style="margin-top:32px;">Services</h3>
    <div id="adminServicesList"></div>
    <button class="btn btn-ghost" onclick="adminAddItem('services')">+ Ajouter un service</button>
  `;
  renderAdminItemList('products');
  renderAdminItemList('services');
}
function renderAdminItemList(kind){
  const container = document.getElementById(kind==='products' ? 'adminProductsList' : 'adminServicesList');
  container.innerHTML = CATALOG[kind].map(item => adminItemRowHTML(kind, item)).join('') || '<p class="card-sub">Aucun article.</p>';
}
function adminItemRowHTML(kind, item){
  const isService = kind === 'services';
  const rawPrice = isService ? (item.startingPrice ?? null) : (item.price ?? 0);
  const priceLabel = rawPrice != null ? `$${rawPrice.toFixed(2)} <span class="price-htg" style="display:inline; margin:0;">≈ ${formatHTG(rawPrice)}</span>` : '—';
  return `
  <div class="admin-item-row" id="adminrow-${item.id}">
    <div class="admin-item-summary" onclick="toggleAdminEdit('${item.id}')">
      <span>${item.name || '(sans nom)'} ${item.code ? `<span class="item-code-tag">${item.code}</span>` : ''}</span>
      <span class="admin-item-price">${priceLabel}</span>
      ${!isService && item.inStock===false ? '<span class="stock-flag" style="position:static;">Rupture</span>' : ''}
    </div>
    <div class="admin-item-edit" id="adminedit-${item.id}" style="display:none;">
      <div class="form-field"><label>Nom</label><input type="text" id="f-name-${item.id}" value="${(item.name||'').replace(/"/g,'&quot;')}"></div>
      <div class="form-field"><label>${isService?'Description':'Utilité'}</label><input type="text" id="f-desc-${item.id}" value="${((item.utility||item.description)||'').replace(/"/g,'&quot;')}"></div>
      <div class="form-field">
        <label>Photos (jusqu'à 3)</label>
        <div class="admin-image-row">
          ${[0,1,2].map(slot => `
            <div class="admin-image-slot">
              <div class="admin-image-preview" id="f-imgpreview-${item.id}-${slot}">${(item.imageUrls && item.imageUrls[slot]) ? `<img src="${item.imageUrls[slot]}" alt="">` : '<span>Pas de photo</span>'}</div>
              <input type="file" accept="image/*" id="f-image-${item.id}-${slot}" onchange="previewAdminImage('${item.id}', ${slot})">
            </div>
          `).join('')}
        </div>
      </div>
      ${isService ? `
        <div class="form-field"><label>Prix de départ ($)</label><input type="number" step="0.01" min="0" id="f-price-${item.id}" value="${item.startingPrice ?? 0}"></div>
      ` : `
        <div class="form-field"><label>Prix ($)</label><input type="number" step="0.01" min="0" id="f-price-${item.id}" value="${item.price ?? 0}"></div>
        <div class="form-field"><label>Ancien prix ($) — laisser vide si pas de promo</label><input type="number" step="0.01" min="0" id="f-oldprice-${item.id}" value="${item.oldPrice ?? ''}"></div>
        <label class="check-row"><input type="checkbox" id="f-instock-${item.id}" ${item.inStock!==false?'checked':''}> En stock</label>
        <label class="check-row"><input type="checkbox" id="f-custom-${item.id}" ${item.customizable?'checked':''}> Personnalisable</label>
      `}
      <div class="modal-actions">
        <button class="btn btn-primary" onclick="adminSaveItem('${kind}','${item.id}')" id="save-${item.id}">Enregistrer</button>
        <button class="btn btn-ghost" onclick="adminDeleteItem('${kind}','${item.id}')">Supprimer</button>
      </div>
    </div>
  </div>`;
}
function toggleAdminEdit(id){
  const el = document.getElementById('adminedit-'+id);
  el.style.display = (el.style.display === 'none') ? 'block' : 'none';
}
function previewAdminImage(id, slot){
  const input = document.getElementById(`f-image-${id}-${slot}`);
  const preview = document.getElementById(`f-imgpreview-${id}-${slot}`);
  const file = input.files && input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => { preview.innerHTML = `<img src="${e.target.result}" alt="">`; };
  reader.readAsDataURL(file);
}
async function uploadItemImage(id, slot, file){
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${id}-${slot}-${Date.now()}.${ext}`;
  const { error } = await db.storage.from('catalog-images').upload(path, file, { upsert: true });
  if(error) throw error;
  const { data } = db.storage.from('catalog-images').getPublicUrl(path);
  return data.publicUrl;
}
async function adminSaveItem(kind, id){
  const item = CATALOG[kind].find(i => i.id === id);
  if(!item) return;
  const btn = document.getElementById('save-'+id);
  item.name = document.getElementById('f-name-'+id).value.trim();
  const desc = document.getElementById('f-desc-'+id).value.trim();
  if(kind === 'services'){
    item.description = desc;
    item.startingPrice = parseFloat(document.getElementById('f-price-'+id).value) || 0;
  } else {
    item.utility = desc;
    item.price = parseFloat(document.getElementById('f-price-'+id).value) || 0;
    const oldP = document.getElementById('f-oldprice-'+id).value;
    item.oldPrice = oldP ? parseFloat(oldP) : undefined;
    item.promo = !!oldP;
    item.inStock = document.getElementById('f-instock-'+id).checked;
    item.customizable = document.getElementById('f-custom-'+id).checked;
  }

  const imageUrls = item.imageUrls ? [...item.imageUrls] : [];
  const filesToUpload = [];
  for(const slot of [0,1,2]){
    const fileInput = document.getElementById(`f-image-${id}-${slot}`);
    const file = fileInput && fileInput.files && fileInput.files[0];
    if(file) filesToUpload.push({ slot, file });
  }

  if(SUPABASE_ENABLED){
    if(btn){ btn.disabled = true; btn.textContent = 'Enregistrement…'; }
    try{
      for(const { slot, file } of filesToUpload){
        imageUrls[slot] = await uploadItemImage(id, slot, file);
      }
      item.imageUrls = imageUrls.filter(Boolean);
      const { error } = await db.from('catalog_items').upsert(itemToRow(kind, item));
      if(error) throw error;
    }catch(e){
      showToast("Échec de l'enregistrement Supabase — vérifiez votre connexion.");
      console.error(e);
    }
    if(btn){ btn.disabled = false; btn.textContent = 'Enregistrer'; }
  } else if(filesToUpload.length){
    showToast("L'envoi de photo nécessite que Supabase soit configuré.");
  }
  saveCatalogLocal();
  rebuildIndex();
  renderGrid();
  renderAdminCatalog();
  showToast("Article enregistré");
}
async function adminDeleteItem(kind, id){
  if(!window.confirm("Supprimer définitivement cet article du catalogue ?")) return;
  CATALOG[kind] = CATALOG[kind].filter(i => i.id !== id);
  if(SUPABASE_ENABLED){
    try{
      const { error } = await db.from('catalog_items').delete().eq('id', id);
      if(error) throw error;
    }catch(e){
      showToast("Échec de la suppression Supabase — vérifiez votre connexion.");
      console.error(e);
    }
  }
  saveCatalogLocal();
  rebuildIndex();
  renderGrid();
  renderAdminCatalog();
  showToast("Article supprimé");
}
async function adminAddItem(kind){
  const id = 'item_' + Date.now();
  const base = kind === 'services'
    ? { id, name:"Nouveau service", description:"Description à compléter.", startingPrice:0, imageUrls:[] }
    : { id, name:"Nouveau produit", utility:"Utilité à compléter.", price:0, customizable:false, inStock:true, imageUrls:[] };
  CATALOG[kind].push(base);
  uiQty[id] = 1;
  if(SUPABASE_ENABLED){
    try{
      const { error } = await db.from('catalog_items').insert(itemToRow(kind, base));
      if(error) throw error;
    }catch(e){
      showToast("Échec de la création Supabase — vérifiez votre connexion.");
      console.error(e);
    }
  }
  saveCatalogLocal();
  rebuildIndex();
  renderGrid();
  renderAdminCatalog();
  setTimeout(()=> toggleAdminEdit(id), 50);
}

/* ---- Commandes ---- */
async function getOrdersForAdmin(){
  if(SUPABASE_ENABLED){
    try{
      const { data, error } = await db.from('orders').select('*').order('created_at', { ascending:false }).limit(500);
      if(error) throw error;

      let paymentsByOrder = {};
      try{
        const { data: pay } = await db.from('payments').select('*').order('created_at', { ascending:false });
        (pay||[]).forEach(p => { if(!paymentsByOrder[p.order_id]) paymentsByOrder[p.order_id] = p; });
      }catch(e){ console.warn('payments fetch failed:', e); }

      let uploadCountByOrder = {};
      try{
        const { data: uploads } = await db.from('order_uploads').select('order_id');
        (uploads||[]).forEach(u => { uploadCountByOrder[u.order_id] = (uploadCountByOrder[u.order_id]||0) + 1; });
      }catch(e){ console.warn('order_uploads fetch failed:', e); }

      return data.map(row => ({
        id: row.id,
        code: row.code,
        status: row.status,
        date: new Date(row.created_at).getTime(),
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        customerAddress: row.customer_address,
        items: row.items || [],
        total: Number(row.total || 0),
        exchangeRate: Number(row.exchange_rate || SETTINGS.exchangeRate),
        payment: row.payment,
        delivery: row.delivery,
        paymentRecord: paymentsByOrder[row.id] || null,
        uploadCount: uploadCountByOrder[row.id] || 0
      }));
    }catch(e){
      console.warn('Supabase orders fetch failed, falling back to local log:', e);
      return loadOrdersLocal();
    }
  }
  return loadOrdersLocal();
}
async function renderAdminOrders(){
  const el = document.getElementById('adminTab-orders');
  el.innerHTML = `<p class="card-sub">Chargement…</p>`;
  const orders = await getOrdersForAdmin();
  const note = SUPABASE_ENABLED
    ? "Liste de toutes les commandes reçues via Supabase, envoyées depuis n'importe quel appareil client."
    : "Supabase n'est pas configuré : liste des commandes envoyées via WhatsApp depuis <strong>cet appareil</strong> uniquement.";
  el.innerHTML = `
    <div class="admin-note">${note}</div>
    <div class="modal-actions" style="margin-bottom:16px;">
      <button class="btn btn-ghost" onclick="exportOrdersCSV()">Exporter en CSV</button>
      <button class="btn btn-ghost" onclick="adminClearOrders()">Vider l'historique</button>
    </div>
    ${orders.length === 0 ? '<p class="card-sub">Aucune commande enregistrée.</p>' : orders.map(orderRowHTML).join('')}
  `;
}
const ORDER_STATUSES = [
  'En attente','Confirmée','Paiement en attente','Paiement confirmé',
  'En préparation','En production','Prête','En livraison','Livrée',
  'Annulée','Refusée'
];
const PAYMENT_STATUSES = ['En attente','Confirmé','Refusé','Remboursé'];
function orderRowHTML(o){
  const rate = o.exchangeRate || SETTINGS.exchangeRate;
  const htg = new Intl.NumberFormat('fr-FR').format(Math.round((o.total||0) * rate));
  const statusSelect = (o.id && SUPABASE_ENABLED)
    ? `<select class="order-status-select" onchange="adminUpdateOrderStatus(${o.id}, this.value)">
        ${ORDER_STATUSES.map(s => `<option value="${s}" ${s===o.status?'selected':''}>${s}</option>`).join('')}
       </select>`
    : `<span class="item-code-tag">${o.status || '—'}</span>`;
  const paymentSelect = (o.paymentRecord && SUPABASE_ENABLED)
    ? `<select class="order-status-select" onchange="adminUpdatePaymentStatus(${o.paymentRecord.id}, this.value)">
        ${PAYMENT_STATUSES.map(s => `<option value="${s}" ${s===o.paymentRecord.status?'selected':''}>${s}</option>`).join('')}
       </select>`
    : '';
  return `<div class="admin-order-card">
    <div class="admin-order-head">
      <strong>${o.customerName || 'Client'}</strong>
      <span class="mono">${new Date(o.date).toLocaleString('fr-FR')}</span>
    </div>
    ${o.code ? `<div class="item-code-tag" style="margin:4px 0;">${o.code}</div>` : ''}
    <div class="card-sub">${o.customerPhone || ''}${o.customerAddress ? ' · ' + o.customerAddress : ''}</div>
    <ul class="admin-list">${(o.items||[]).map(i => `<li>${i.name} × ${i.qty}${i.customized ? ' (à personnaliser)' : ''}</li>`).join('')}</ul>
    <div class="cart-total-row"><span>Total</span><span class="amt">$${(o.total||0).toFixed(2)}<span class="price-htg">≈ ${htg} HTG</span></span></div>
    <div class="card-sub">Livraison : ${o.delivery || '—'}</div>
    ${o.uploadCount > 0 ? `
      <button class="btn btn-ghost" style="margin-top:10px;" onclick="adminViewOrderFiles(${o.id}, this)">📎 Voir les ${o.uploadCount} fichier${o.uploadCount>1?'s':''} joint${o.uploadCount>1?'s':''}</button>
      <div id="orderfiles-${o.id}" style="margin-top:10px;"></div>
    ` : ''}
    <div class="form-field" style="margin-top:10px;"><label>Statut de la commande</label>${statusSelect}</div>
    ${paymentSelect ? `<div class="form-field"><label>Statut du paiement (${o.payment || '—'})</label>${paymentSelect}</div>` : `<div class="card-sub">Paiement : ${o.payment || '—'}</div>`}
  </div>`;
}
async function adminViewOrderFiles(orderId, btnEl){
  const container = document.getElementById('orderfiles-'+orderId);
  if(!container) return;
  if(container.innerHTML){ container.innerHTML = ''; return; }
  container.innerHTML = '<p class="card-sub">Chargement…</p>';
  try{
    const { data: files, error } = await db.from('order_uploads').select('*').eq('order_id', orderId);
    if(error) throw error;
    if(!files || files.length === 0){ container.innerHTML = '<p class="card-sub">Aucun fichier.</p>'; return; }
    const links = [];
    for(const f of files){
      const { data: signed, error: signErr } = await db.storage.from('order-uploads').createSignedUrl(f.storage_path, 3600);
      if(signErr){ console.warn(signErr); continue; }
      links.push(`<li><a href="${signed.signedUrl}" target="_blank" rel="noopener">${f.original_filename || 'Fichier'}</a> <span class="card-sub">(${Math.round((f.size_bytes||0)/1024)} Ko, lien valable 1h)</span></li>`);
    }
    container.innerHTML = `<ul class="admin-list">${links.join('')}</ul>`;
  }catch(e){
    container.innerHTML = '<p class="card-sub">Échec du chargement des fichiers.</p>';
    console.error(e);
  }
}
async function adminUpdatePaymentStatus(paymentId, newStatus){
  if(!SUPABASE_ENABLED) return;
  try{
    const { error } = await db.from('payments').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', paymentId);
    if(error) throw error;
    showToast("Statut de paiement mis à jour");
  }catch(e){
    showToast("Échec de la mise à jour du paiement");
    console.error(e);
  }
}
async function adminUpdateOrderStatus(orderId, newStatus){
  if(!SUPABASE_ENABLED) return;
  try{
    const { error } = await db.from('orders').update({ status: newStatus }).eq('id', orderId);
    if(error) throw error;
    showToast("Statut mis à jour");
  }catch(e){
    showToast("Échec de la mise à jour du statut");
    console.error(e);
  }
}
async function adminClearOrders(){
  const msg = SUPABASE_ENABLED
    ? "Effacer DÉFINITIVEMENT tout l'historique des commandes dans Supabase (pour tous les appareils) ?"
    : "Effacer tout l'historique des commandes enregistrées sur cet appareil ?";
  if(!window.confirm(msg)) return;
  if(SUPABASE_ENABLED){
    try{
      const { error } = await db.from('orders').delete().neq('id', 0);
      if(error) throw error;
    }catch(e){
      showToast("Échec de la suppression Supabase — vérifiez votre connexion.");
      console.error(e);
    }
  }
  saveOrdersLocal([]);
  renderAdminOrders();
  showToast("Historique vidé");
}
async function exportOrdersCSV(){
  const orders = await getOrdersForAdmin();
  if(orders.length === 0){ showToast("Aucune commande à exporter"); return; }
  let csv = "Date,Nom,Telephone,Adresse,Articles,Total USD,Total HTG,Taux utilise,Paiement,Livraison\n";
  orders.forEach(o => {
    const items = (o.items||[]).map(i => `${i.name} x${i.qty}`).join(' | ').replace(/"/g,'""');
    const rate = o.exchangeRate || SETTINGS.exchangeRate;
    const htgTotal = Math.round((o.total||0) * rate);
    csv += `"${new Date(o.date).toLocaleString('fr-FR')}","${(o.customerName||'').replace(/"/g,'""')}","${(o.customerPhone||'').replace(/"/g,'""')}","${(o.customerAddress||'').replace(/"/g,'""')}","${items}",${(o.total||0).toFixed(2)},${htgTotal},${rate},"${o.payment||''}","${o.delivery||''}"\n`;
  });
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'commandes-jc-multimedia.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---- Réglages ---- */
function renderAdminSettings(){
  const pwSection = SUPABASE_ENABLED ? `
    <h3 style="margin-top:32px;">Mot de passe admin</h3>
    <div class="admin-note">La connexion admin utilise maintenant Supabase Auth (email + mot de passe). Pour changer le mot de passe, allez dans votre projet Supabase → Authentication → Users → sélectionnez votre compte → "Send password recovery" (ou modifiez-le directement là).</div>
  ` : `
    <h3 style="margin-top:32px;">Changer le mot de passe admin</h3>
    <div class="admin-note">⚠️ Supabase n'est pas configuré : ce mot de passe protège uniquement l'accès à cette page dans ce navigateur — ce n'est pas un système de sécurité serveur.</div>
    <div class="form-field">
      <label for="s-newpw">Nouveau mot de passe (4 caractères minimum)</label>
      <input type="password" id="s-newpw">
    </div>
    <button class="btn btn-ghost" onclick="adminChangePassword()">Changer le mot de passe</button>
  `;
  const supabaseNote = SUPABASE_ENABLED
    ? `<div class="admin-note">Numéro et taux enregistrés dans Supabase — visibles immédiatement par tous vos clients, sur tous les appareils.</div>`
    : `<div class="admin-note">⚠️ Supabase n'est pas configuré : ces réglages restent enregistrés uniquement sur cet appareil/navigateur.</div>`;
  document.getElementById('adminTab-settings').innerHTML = `
    ${supabaseNote}
    <div class="form-field">
      <label for="s-whatsapp">Numéro WhatsApp (format international, sans le +)</label>
      <input type="text" id="s-whatsapp" value="${SETTINGS.whatsapp}">
    </div>

    <div class="form-field">
      <label for="s-rate">Taux de change (gourdes HTG pour 1 USD)</label>
      <input type="number" step="0.01" min="0" id="s-rate" value="${SETTINGS.exchangeRate}">
    </div>
    <div class="admin-note">Ce taux sert à convertir automatiquement tous les prix (produits et services) affichés en gourdes sur le site. Mettez-le à jour régulièrement pour rester proche du taux réel du marché.</div>

    <h3>Slideshow d'accueil</h3>
    <label class="check-row"><input type="checkbox" id="s-ss-autoplay" ${SETTINGS.slideshowAutoplay!==false?'checked':''}> Défilement automatique</label>
    <div class="form-field"><label>Durée par image (millisecondes)</label><input type="number" step="500" min="1000" id="s-ss-duration" value="${SETTINGS.slideshowDurationMs||5000}"></div>
    <label class="check-row"><input type="checkbox" id="s-ss-arrows" ${SETTINGS.slideshowArrows!==false?'checked':''}> Flèches précédent/suivant</label>
    <label class="check-row"><input type="checkbox" id="s-ss-dots" ${SETTINGS.slideshowDots!==false?'checked':''}> Points indicateurs</label>
    <label class="check-row"><input type="checkbox" id="s-ss-loop" ${SETTINGS.slideshowLoop!==false?'checked':''}> Boucle continue</label>

    <button class="btn btn-primary" id="save-settings-btn" onclick="adminSaveSettings()">Enregistrer</button>

    ${pwSection}
  `;
}
async function adminSaveSettings(){
  const val = document.getElementById('s-whatsapp').value.trim();
  SETTINGS.whatsapp = val || SETTINGS.whatsapp;
  const rateVal = parseFloat(document.getElementById('s-rate').value);
  if(rateVal && rateVal > 0) SETTINGS.exchangeRate = rateVal;
  SETTINGS.slideshowAutoplay = document.getElementById('s-ss-autoplay').checked;
  SETTINGS.slideshowDurationMs = parseInt(document.getElementById('s-ss-duration').value) || 5000;
  SETTINGS.slideshowArrows = document.getElementById('s-ss-arrows').checked;
  SETTINGS.slideshowDots = document.getElementById('s-ss-dots').checked;
  SETTINGS.slideshowLoop = document.getElementById('s-ss-loop').checked;

  if(SUPABASE_ENABLED){
    const btn = document.getElementById('save-settings-btn');
    if(btn){ btn.disabled = true; btn.textContent = 'Enregistrement…'; }
    try{
      const { error } = await db.from('settings').upsert({
        id: 1, whatsapp: SETTINGS.whatsapp, exchange_rate: SETTINGS.exchangeRate,
        slideshow_autoplay: SETTINGS.slideshowAutoplay, slideshow_duration_ms: SETTINGS.slideshowDurationMs,
        slideshow_arrows: SETTINGS.slideshowArrows, slideshow_dots: SETTINGS.slideshowDots,
        slideshow_loop: SETTINGS.slideshowLoop
      });
      if(error) throw error;
    }catch(e){
      showToast("Échec de l'enregistrement Supabase — vérifiez votre connexion.");
      console.error(e);
    }
    if(btn){ btn.disabled = false; btn.textContent = 'Enregistrer'; }
  }
  saveSettingsLocal();
  renderGrid();
  showToast("Réglages enregistrés");
}
function adminChangePassword(){
  const val = document.getElementById('s-newpw').value.trim();
  if(val.length < 4){ showToast("Mot de passe trop court (4 caractères min.)"); return; }
  SETTINGS.adminPassword = val;
  saveSettingsLocal();
  document.getElementById('s-newpw').value = '';
  showToast("Mot de passe mis à jour");
}

/* =========================================================
   INIT
   1) Affichage immédiat avec les valeurs par défaut / le cache
      local, pour que le site s'affiche instantanément.
   2) Puis, si Supabase est configuré, on va chercher les
      données à jour en arrière-plan et on rafraîchit l'affichage.
   ========================================================= */
renderGrid();
updateBadge();
applySiteContent();
if(document.body.dataset.page === 'article') initArticlePage();
if(document.body.dataset.page === 'admin') checkAdminSession();

const emailField = document.getElementById('adminEmailField');
if(emailField) emailField.style.display = SUPABASE_ENABLED ? 'block' : 'none';

if(SUPABASE_ENABLED){
  refreshCatalog();
  refreshSettings().then(initHeroSlideshow);
  refreshSiteContent();
} else {
  console.info("Supabase non configuré — le site fonctionne en mode local uniquement. Voir schema-supabase.sql pour activer la synchronisation centralisée.");
}
