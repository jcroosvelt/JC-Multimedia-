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
   DEVISE — la GOURDE (HTG) est désormais la monnaie de référence
   du site. Tous les montants (prix, totaux, paiements) sont
   stockés et manipulés en HTG ; le dollar n'est qu'un affichage
   secondaire, calculé automatiquement selon le taux réglé en
   admin — il ne change jamais le prix réel fixé pour un article.
   ========================================================= */
function usdFromHtg(htg){ return htg / (SETTINGS.exchangeRate || DEFAULT_SETTINGS.exchangeRate); }
function formatHTG(htg){ return new Intl.NumberFormat('fr-FR').format(Math.round(htg)) + ' HTG'; }
function formatUSD(htg){ return '$' + usdFromHtg(htg).toFixed(2); }
function priceDualInline(htg){ return `${formatHTG(htg)} <span class="price-htg">≈ ${formatUSD(htg)}</span>`; }

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

/* =========================================================
   PORTFOLIO — réalisations, gérées depuis l'admin, affichées
   en grille avec filtre par catégorie et fenêtre de détail.
   ========================================================= */
let PORTFOLIO_ITEMS = [];
let PORTFOLIO_ACTIVE_CATEGORY = 'Tous';
async function initPortfolio(){
  const grid = document.getElementById('portfolioGrid');
  if(!grid || !SUPABASE_ENABLED) return;
  try{
    const { data, error } = await db.from('portfolio_items').select('*').order('display_order', { ascending:true });
    if(error) throw error;
    PORTFOLIO_ITEMS = data || [];
  }catch(e){ console.warn('portfolio fetch failed:', e); return; }
  renderPortfolio();
}
function renderPortfolio(){
  const grid = document.getElementById('portfolioGrid');
  const filtersEl = document.getElementById('portfolioFilters');
  if(!grid) return;
  const categories = ['Tous', ...new Set(PORTFOLIO_ITEMS.map(p => p.category).filter(Boolean))];
  if(filtersEl){
    filtersEl.innerHTML = categories.length > 1 ? categories.map(cat => `<button class="filter-chip ${cat===PORTFOLIO_ACTIVE_CATEGORY?'active':''}" onclick="setPortfolioCategory('${cat.replace(/'/g,"\\'")}')">${cat}</button>`).join('') : '';
  }
  const filtered = PORTFOLIO_ACTIVE_CATEGORY === 'Tous' ? PORTFOLIO_ITEMS : PORTFOLIO_ITEMS.filter(p => p.category === PORTFOLIO_ACTIVE_CATEGORY);
  grid.innerHTML = filtered.length
    ? filtered.map(portfolioCardHTML).join('')
    : '<p class="card-sub">Aucune réalisation à afficher pour le moment — revenez bientôt !</p>';
}
function setPortfolioCategory(cat){
  PORTFOLIO_ACTIVE_CATEGORY = cat;
  renderPortfolio();
}
function portfolioCardHTML(p){
  const imgs = Array.isArray(p.image_urls) ? p.image_urls : [];
  const thumb = imgs[0];
  const title = escapeHtml(p.title);
  const category = escapeHtml(p.category);
  return `
    <div class="card">
      <div class="thumb" style="cursor:pointer;" onclick="showPortfolioDetail(${p.id})" role="button" tabindex="0" aria-label="Voir ${title}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();showPortfolioDetail(${p.id})}">
        ${p.category ? `<span class="promo-flag" style="background:var(--navy);">${category}</span>` : ''}
        ${thumb ? `<img src="${thumb}" alt="${title}" loading="lazy">` : `<div class="no-image">Pas de photo</div>`}
      </div>
      <div class="body">
        <h3>${title}</h3>
        ${p.client_name ? `<p class="card-sub">${escapeHtml(p.client_name)}</p>` : ''}
      </div>
    </div>
  `;
}
function showPortfolioDetail(id){
  const p = PORTFOLIO_ITEMS.find(x => x.id === id);
  if(!p) return;
  const imgs = Array.isArray(p.image_urls) ? p.image_urls : [];
  const title = escapeHtml(p.title);
  openStep(`
    <div class="quickview">
      ${imgs.length ? `<div class="thumb qv-thumb"><img id="galleryMainImg" src="${imgs[0]}" alt="${title}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;border-radius:12px;"></div>` : ''}
      ${imgs.length > 1 ? `<div class="gallery-thumbs">${imgs.map((u,i)=>`<button class="gallery-thumb-btn ${i===0?'active':''}" onclick='setGalleryImage(${JSON.stringify(imgs)}, ${i}, this)'><img src="${u}" alt=""></button>`).join('')}</div>` : ''}
      <h3 style="margin-right:0;">${title}</h3>
      ${p.category ? `<p class="item-code-tag" style="display:inline-block;">${escapeHtml(p.category)}</p>` : ''}
      ${p.client_name ? `<p class="card-sub">Client : ${escapeHtml(p.client_name)}</p>` : ''}
      ${p.description ? `<p class="card-sub" style="font-size:.92rem;">${escapeHtml(p.description).replace(/\n/g,'<br>')}</p>` : ''}
      ${p.project_url ? `<a class="btn btn-ghost" href="${escapeHtml(p.project_url)}" target="_blank" rel="noopener">Voir le projet</a>` : ''}
    </div>
  `, title);
}

/* =========================================================
   AVIS CLIENTS — commentaires généraux sur l'accueil (sans note),
   et notes par étoiles sur chaque fiche produit/service.
   Tout avis est mis "en attente" et n'apparaît qu'une fois
   approuvé par l'admin (protection anti-spam / anti-abus).
   ========================================================= */
async function initHomeReviews(){
  const list = document.getElementById('homeReviewsList');
  if(!list || !SUPABASE_ENABLED) return;
  try{
    const { data, error } = await db.from('reviews')
      .select('*')
      .is('catalog_item_id', null)
      .eq('is_approved', true)
      .order('created_at', { ascending:false })
      .limit(3);
    if(error) throw error;
    renderHomeReviews(data || []);
  }catch(e){ console.warn('reviews fetch failed:', e); }
}
function renderHomeReviews(reviews){
  const list = document.getElementById('homeReviewsList');
  if(!list) return;
  if(!reviews.length){
    list.innerHTML = `<p class="card-sub">Aucun commentaire pour le moment — soyez le premier à partager votre expérience !</p>`;
    return;
  }
  list.innerHTML = reviews.map(r => `
    <div class="review-card">
      <strong>${escapeHtml(r.customer_name)}</strong>
      <span class="card-sub" style="display:block; margin:4px 0 8px;">${new Date(r.created_at).toLocaleDateString('fr-FR')}</span>
      <p style="margin:0;">${escapeHtml(r.comment).replace(/\n/g,'<br>')}</p>
    </div>
  `).join('');
}
async function submitHomeReview(){
  const nameEl = document.getElementById('reviewName');
  const commentEl = document.getElementById('reviewComment');
  const msgEl = document.getElementById('reviewFormMsg');
  const name = nameEl.value.trim();
  const comment = commentEl.value.trim();
  msgEl.style.display = 'block';
  if(!name || !comment){
    msgEl.textContent = "Merci de remplir votre nom et votre commentaire.";
    msgEl.className = 'form-error';
    return;
  }
  if(!SUPABASE_ENABLED){
    msgEl.textContent = "L'envoi de commentaire nécessite une connexion. Réessayez plus tard.";
    msgEl.className = 'form-error';
    return;
  }
  try{
    const { error } = await db.from('reviews').insert({
      catalog_item_id: null, customer_name: name, comment, rating: null, is_approved: false
    });
    if(error) throw error;
    nameEl.value = ''; commentEl.value = '';
    msgEl.textContent = "Merci ! Votre commentaire sera visible après validation.";
    msgEl.className = 'card-sub';
  }catch(e){
    msgEl.textContent = "Échec de l'envoi. Réessayez.";
    msgEl.className = 'form-error';
    console.error(e);
  }
}

/* ---- Notation par étoiles sur une fiche produit/service ---- */
function starRowHTML(current, itemId){
  let html = `<div class="star-row" id="starRow-${itemId}" data-selected="${current||0}">`;
  for(let i=1;i<=5;i++){
    html += `<button type="button" class="star-btn ${i<=current?'filled':''}" onclick="selectStarRating('${itemId}',${i})" aria-label="${i} étoile${i>1?'s':''}">★</button>`;
  }
  html += `</div>`;
  return html;
}
let selectedRatings = {};
function selectStarRating(itemId, value){
  selectedRatings[itemId] = value;
  const row = document.getElementById('starRow-'+itemId);
  if(row){
    row.dataset.selected = value;
    Array.from(row.children).forEach((btn,i) => btn.classList.toggle('filled', i < value));
  }
}
async function initItemReviews(itemId, description){
  const summaryEl = document.getElementById('itemRatingSummary');
  const listEl = document.getElementById('itemReviewsList');
  if(!SUPABASE_ENABLED || !summaryEl) return;
  try{
    const { data: summary } = await db.from('item_rating_summary').select('*').eq('catalog_item_id', itemId).single();
    if(summary && summary.rating_count > 0){
      summaryEl.innerHTML = `${'★'.repeat(Math.round(summary.avg_rating))}${'☆'.repeat(5-Math.round(summary.avg_rating))} <strong>${summary.avg_rating}</strong> <span class="card-sub">(${summary.rating_count} avis)</span>`;
      const item = ALL_ITEMS[itemId];
      if(item) injectItemStructuredData(item, description, summary);
    } else {
      summaryEl.innerHTML = `<span class="card-sub">Aucun avis pour le moment — soyez le premier à noter cet article !</span>`;
    }
  }catch(e){ console.warn('rating summary fetch failed:', e); }
  try{
    const { data: reviews } = await db.from('reviews').select('*').eq('catalog_item_id', itemId).eq('is_approved', true).not('rating', 'is', null).order('created_at', { ascending:false }).limit(10);
    if(listEl){
      listEl.innerHTML = (reviews||[]).map(r => `
        <div class="review-card">
          <div>${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</div>
          <strong>${escapeHtml(r.customer_name)}</strong>
          ${r.comment ? `<p style="margin:6px 0 0;">${escapeHtml(r.comment).replace(/\n/g,'<br>')}</p>` : ''}
        </div>
      `).join('') || `<p class="card-sub">Aucun commentaire pour le moment.</p>`;
    }
  }catch(e){ console.warn('item reviews fetch failed:', e); }
}
async function submitItemReview(itemId){
  const nameEl = document.getElementById('reviewerName-'+itemId);
  const commentEl = document.getElementById('reviewerComment-'+itemId);
  const msgEl = document.getElementById('itemReviewMsg-'+itemId);
  const rating = selectedRatings[itemId];
  const name = nameEl.value.trim();
  msgEl.style.display = 'block';
  if(!rating){
    msgEl.textContent = "Merci de choisir une note (1 à 5 étoiles).";
    msgEl.className = 'form-error';
    return;
  }
  if(!name){
    msgEl.textContent = "Merci d'indiquer votre nom.";
    msgEl.className = 'form-error';
    return;
  }
  if(!SUPABASE_ENABLED){
    msgEl.textContent = "L'envoi d'avis nécessite une connexion. Réessayez plus tard.";
    msgEl.className = 'form-error';
    return;
  }
  try{
    const { error } = await db.from('reviews').insert({
      catalog_item_id: itemId, customer_name: name, rating, comment: commentEl.value.trim() || null, is_approved: false
    });
    if(error) throw error;
    nameEl.value = ''; commentEl.value = ''; selectedRatings[itemId] = 0;
    selectStarRating(itemId, 0);
    msgEl.textContent = "Merci pour votre avis ! Il sera visible après validation.";
    msgEl.className = 'card-sub';
  }catch(e){
    msgEl.textContent = "Échec de l'envoi. Réessayez.";
    msgEl.className = 'form-error';
    console.error(e);
  }
}

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
      <img src="${img}" alt="${escapeHtml(s.alt_text)}" loading="${i===0?'eager':'lazy'}">
      ${hasCaption ? `
        <div class="slide-caption">
          ${s.title ? `<h2>${escapeHtml(s.title)}</h2>` : ''}
          ${s.subtitle ? `<p>${escapeHtml(s.subtitle)}</p>` : ''}
          ${(s.button_text && s.button_url) ? `<a class="btn btn-primary" href="${escapeHtml(s.button_url)}">${escapeHtml(s.button_text)}</a>` : ''}
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
   CONTENU ÉDITABLE DE CHAQUE PAGE (Boutique, Services, FAQ,
   pages légales, Suivi de commande) — modifiable depuis
   l'espace admin, onglet "Contenu"
   ========================================================= */
const DEFAULT_PAGE_CONTENT = {
  boutique_title: "Boutique",
  boutique_intro: "",
  services_title: "Nos services",
  services_intro: "",
  portfolio_title: "Notre portfolio",
  portfolio_intro: "Un aperçu de nos réalisations récentes en branding, graphisme, web design et personnalisation.",
  faq_title: "Foire aux questions",
  faq_intro: "",
  faq_items: [
    {question:"Quels sont les délais de livraison ?", answer:"Comptez généralement 24 à 72h dans la région métropolitaine de Port-au-Prince (Pétion-Ville, Delmas, Carrefour, Juvénat…), selon la disponibilité du produit. Le délai exact vous est confirmé lors de l'étape de commande sur WhatsApp."},
    {question:"Quelles zones desservez-vous ?", answer:"Nous livrons dans la région métropolitaine de Port-au-Prince, notamment Pétion-Ville, Juvénat, Delmas et Carrefour. Pour une zone plus éloignée, contactez-nous sur WhatsApp pour vérifier la faisabilité et les frais éventuels."},
    {question:"Puis-je récupérer ma commande en boutique ?", answer:"Oui. Choisissez « Récupérer sur place » lors de la commande, puis présentez-vous à l'un de nos deux points : 123, Rue Lambert, Juvénat (Pétion-Ville) ou 10, Brochette 99 (Carrefour)."},
    {question:"Quelle est votre politique de retour ?", answer:"Les articles défectueux peuvent être échangés sous 7 jours avec preuve d'achat. Les produits personnalisés (gravure, impression, coques sur mesure) ne sont repris qu'en cas de défaut de fabrication."},
    {question:"Quels moyens de paiement acceptez-vous ?", answer:"MonCash, Natcash, espèces (Cash), virement bancaire et carte bancaire."},
    {question:"Comment passer commande ?", answer:"Ajoutez vos articles ou services au panier, indiquez si certains doivent être personnalisés, choisissez votre mode de paiement puis livraison ou retrait. La commande est ensuite envoyée en message pré-rempli sur WhatsApp pour confirmation."}
  ],
  confidentialite_title: "Politique de confidentialité",
  confidentialite_content: "JC Multimedia respecte votre vie privée.",
  conditions_title: "Conditions générales de vente",
  conditions_content: "",
  livraison_title: "Livraison & retours",
  livraison_content: "",
  suivi_title: "Suivre ma commande",
  suivi_intro: "Entrez le code de votre commande (ex : JC-PRC1001) et le numéro de téléphone utilisé lors de la commande."
};
const PAGE_CONTENT_STORAGE_KEY = "jc_multimedia_page_content_v1";
function loadPageContentLocal(){ return { ...DEFAULT_PAGE_CONTENT, ...(safeGet(PAGE_CONTENT_STORAGE_KEY) || {}) }; }
function savePageContentLocal(){ safeSet(PAGE_CONTENT_STORAGE_KEY, PAGE_CONTENT); }
let PAGE_CONTENT = loadPageContentLocal();

async function fetchPageContentFromSupabase(){
  if(!SUPABASE_ENABLED) return null;
  try{
    const { data, error } = await db.from('page_content').select('*');
    if(error) throw error;
    const map = {};
    (data||[]).forEach(row => { map[row.key] = row.key === 'faq_items' ? safeParseJSON(row.value) : row.value; });
    return map;
  }catch(e){
    console.warn('Supabase page_content fetch failed, using local cache/defaults:', e);
    return null;
  }
}
function safeParseJSON(str){
  try{ return JSON.parse(str); }catch(e){ return null; }
}
async function refreshPageContent(){
  const remote = await fetchPageContentFromSupabase();
  if(remote){
    Object.keys(remote).forEach(k => { if(remote[k] != null) PAGE_CONTENT[k] = remote[k]; });
    savePageContentLocal();
  }
  applyPageContent();
}
/* =========================================================
   COMPRESSION D'IMAGES — réduit poids/dimensions avant envoi vers
   Supabase, pour un chargement rapide même sur connexion lente.
   Utilisée à la fois pour les nouveaux envois et pour l'optimisation
   rétroactive des photos déjà en ligne.
   ========================================================= */
function compressImageBlob(blob, maxWidth = 1600, quality = 0.82){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if(width > maxWidth){
        height = Math.round(height * (maxWidth / width));
        width = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(newBlob => {
        if(newBlob) resolve(newBlob); else reject(new Error('Échec de la compression'));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
    img.src = url;
  });
}
function extractStoragePath(url, bucket){
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if(idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length).split('?')[0]);
}

// Mélange aléatoire (Fisher-Yates) — utilisé pour varier l'ordre des
// aperçus produits/services sur l'accueil à chaque affichage, sans
// jamais modifier le tableau d'origine (CATALOG reste intact pour les
// autres pages et pour l'admin).
function shuffleArray(arr){
  const copy = [...arr];
  for(let i = copy.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function escapeHtml(s){
  return (s == null ? '' : String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function renderSimpleContentInto(elId, rawText){
  const el = document.getElementById(elId);
  if(!el || rawText == null) return;
  const escaped = escapeHtml(rawText);
  const blocks = escaped.split(/\n\s*\n/).filter(b => b.trim());
  el.innerHTML = blocks.map(block => {
    const trimmed = block.trim();
    if(trimmed.startsWith('## ')){
      const lines = trimmed.split('\n');
      const heading = lines[0].slice(3);
      const rest = lines.slice(1).join('<br>');
      return `<h3>${heading}</h3>` + (rest ? `<p>${rest}</p>` : '');
    }
    return `<p>${trimmed.replace(/\n/g,'<br>')}</p>`;
  }).join('\n');
}
function renderFaqItems(items){
  const container = document.getElementById('faqItemsContainer');
  if(!container) return;
  if(!Array.isArray(items)) return;
  container.innerHTML = items.map((it, i) => `
    <details class="faq-item" ${i===0?'open':''}>
      <summary>${escapeHtml(it.question)}</summary>
      <p>${escapeHtml(it.answer).replace(/\n/g,'<br>')}</p>
    </details>
  `).join('');
}
function applyPageContent(){
  const c = PAGE_CONTENT;
  const setText = (id, val) => { const el = document.getElementById(id); if(el && val != null) el.textContent = val; };
  setText('boutiqueTitleText', c.boutique_title);
  setText('boutiqueIntroText', c.boutique_intro);
  setText('servicesTitleText', c.services_title);
  setText('servicesIntroText', c.services_intro);
  setText('portfolioTitleText', c.portfolio_title);
  setText('portfolioIntroText', c.portfolio_intro);
  setText('faqTitleText', c.faq_title);
  setText('faqIntroText', c.faq_intro);
  setText('confidentialiteTitleText', c.confidentialite_title);
  setText('conditionsTitleText', c.conditions_title);
  setText('livraisonTitleText', c.livraison_title);
  setText('suiviTitleText', c.suivi_title);
  setText('suiviIntroText', c.suivi_intro);
  renderSimpleContentInto('confidentialiteContentBlock', c.confidentialite_content);
  renderSimpleContentInto('conditionsContentBlock', c.conditions_content);
  renderSimpleContentInto('livraisonContentBlock', c.livraison_content);
  renderFaqItems(c.faq_items);
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
    id: row.id, name: row.name, code: row.code || null, slug: row.slug || row.id,
    imageUrls: Array.isArray(row.image_urls) ? row.image_urls.filter(Boolean) : (row.image_url ? [row.image_url] : []),
    inStock: row.in_stock, customizable: row.customizable, promo: row.promo,
    seoTitle: row.seo_title || "", seoDescription: row.seo_description || "",
    sortOrder: row.sort_order ?? 0,
    isDimensionBased: !!row.is_dimension_based,
    pricePerSqft: row.price_per_sqft != null ? Number(row.price_per_sqft) : null
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
    promo: !!item.promo, in_stock: item.inStock !== false, customizable: !!item.customizable,
    seo_title: item.seoTitle || null, seo_description: item.seoDescription || null,
    is_dimension_based: !!item.isDimensionBased,
    price_per_sqft: item.isDimensionBased ? (item.pricePerSqft ?? 0) : null,
    slug: item.slug
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
  await refreshPromos();
  rebuildIndex();
  renderGrid();
  if(document.body.dataset.page === 'article') initArticlePage();
}
// Indicateur de diagnostic TEMPORAIRE, visible directement sur la page
// (sans outils techniques) — sera retiré dès que le problème des codes
async function refreshPromos(){
  // Remet à zéro toute remise précédemment appliquée (au cas où un
  // article ne serait plus concerné par aucun code promo actif).
  [...CATALOG.products, ...CATALOG.services].forEach(item => {
    item.specialPercent = null;
    item.specialPrice = null;
    item.specialName = null;
  });
  if(!SUPABASE_ENABLED) return;
  try{
    const { data: codes } = await db.from('promo_codes').select('id, name, discount_percent').eq('active', true);
    if(!codes || !codes.length) return;
    const { data: links } = await db.from('promo_code_items').select('promo_code_id, catalog_item_id');
    const codeById = {};
    codes.forEach(c => codeById[c.id] = c);
    // IMPORTANT : on cherche toujours l'article dans le catalogue tout
    // juste reçu (CATALOG), jamais dans ALL_ITEMS — à ce stade, ALL_ITEMS
    // n'a pas encore été reconstruit pour ce nouveau catalogue (ça arrive
    // juste après) et peut encore pointer vers d'anciens objets périmés.
    // Écrire la remise dessus serait sans effet, puisqu'ils sont jetés
    // juste après par rebuildIndex().
    const currentItemsById = {};
    [...CATALOG.products, ...CATALOG.services].forEach(i => currentItemsById[i.id] = i);
    let matched = 0;
    (links||[]).forEach(link => {
      const code = codeById[link.promo_code_id];
      if(!code) return;
      const item = currentItemsById[link.catalog_item_id];
      if(!item || item.isDimensionBased) return;
      // Certaines bases de données renvoient un pourcentage sous forme de
      // texte ("15") plutôt que de nombre — on le convertit explicitement
      // pour ne jamais comparer ou calculer avec un texte par erreur.
      const percent = Number(code.discount_percent);
      if(!percent || percent <= 0) return;
      // Si plusieurs codes s'appliquent au même article, on retient
      // toujours la remise la plus avantageuse pour le client.
      if(item.specialPercent == null || percent > item.specialPercent){
        const base = Number(item.startingPrice != null ? item.startingPrice : item.price) || 0;
        item.specialPercent = percent;
        item.specialPrice = Math.round(base * (1 - percent / 100) * 100) / 100;
        item.specialName = code.name;
        matched++;
      }
    });
  }catch(e){
    console.warn('refreshPromos failed:', e);
  }
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
function unitPrice(item){
  if(item.specialPrice != null) return item.specialPrice;
  return item.startingPrice != null ? item.startingPrice : item.price;
}
function isEstimate(item){ return item.startingPrice != null; }
function itemUrlPath(item){
  const section = isEstimate(item) ? 'services' : 'boutique';
  return `/${section}/${item.slug || item.id}`;
}

/* =========================================================
   STATE
   ========================================================= */
let cart = loadCart();      // {itemId: qty}, persistant
const CUSTOM_CART_STORAGE_KEY = "jc_multimedia_custom_cart_v1";
let customCart = loadCustomCart(); // [{id, itemId, name, code, price, qty, widthIn, heightIn, dimensionsLabel, kind}]
let uiQty = {};              // quantité en attente sur les cartes avant "Ajouter au panier"
rebuildIndex();

let orderFlow = { customerName:"", customerPhone:"", customerAddress:"", customize:null, customizedItems:[], payment:null, delivery:null, modelFiles:[] };

function loadCart(){
  const stored = safeGet(CART_STORAGE_KEY);
  return stored && typeof stored === 'object' ? stored : {};
}
function saveCart(){ safeSet(CART_STORAGE_KEY, cart); }

function loadCustomCart(){
  const stored = safeGet(CUSTOM_CART_STORAGE_KEY);
  return Array.isArray(stored) ? stored : [];
}
function saveCustomCart(){ safeSet(CUSTOM_CART_STORAGE_KEY, customCart); }

/* =========================================================
   RENDER — carte partagée boutique/services, avec recherche et stock
   ========================================================= */
function cardHTML(item){
  const name = escapeHtml(item.name);
  const rawText = item.utility || item.description || "";
  const truncatedText = rawText.length > 90 ? rawText.slice(0, 90).trim() + "…" : rawText;
  const subText = escapeHtml(truncatedText);
  const outOfStock = item.inStock === false;
  const priceBlock = item.isDimensionBased
    ? `<div class="price-row"><span class="price">${formatHTG(item.pricePerSqft||0)} / pi²</span></div><p class="card-sub" style="margin-top:-8px;">Indiquez les dimensions</p>`
    : item.specialPercent != null
    ? `<div class="price-row">
         <span class="price">${priceDualInline(item.specialPrice)}</span>
         <span class="price-old">${formatHTG(item.startingPrice != null ? item.startingPrice : item.price)}</span>
       </div>`
    : isEstimate(item)
    ? `<div class="price-row"><span class="price">À partir de ${priceDualInline(item.startingPrice)}</span></div>`
    : `<div class="price-row">
         <span class="price">${priceDualInline(item.price)}</span>
         ${item.oldPrice ? `<span class="price-old">${formatHTG(item.oldPrice)}</span>` : ''}
       </div>`;
  return `
    <div class="card">
      <a class="thumb" href="${itemUrlPath(item)}" aria-label="Voir la page de ${name}">
        ${item.specialPercent != null ? `<span class="promo-flag">Spécial -${item.specialPercent}%</span>` : (item.promo ? '<span class="promo-flag">Promo</span>' : '')}
        ${outOfStock ? '<span class="stock-flag">Rupture de stock</span>' : ''}
        ${(item.imageUrls && item.imageUrls[0]) ? `<img src="${item.imageUrls[0]}" alt="${name}" loading="lazy">` : `<div class="no-image">Pas de photo</div>`}
      </a>
      <div class="body">
        <h3><a href="${itemUrlPath(item)}" class="card-title-link">${name}</a></h3>
        ${subText ? `<p class="card-sub">${subText}</p>` : ''}
        ${priceBlock}
        ${item.isDimensionBased ? `
        <a class="add-btn" style="display:block; text-align:center; text-decoration:none;" href="${itemUrlPath(item)}">Indiquer les dimensions</a>
        ` : `
        <div class="qty-row">
          <button class="qty-btn" onclick="stepQty('${item.id}',-1)" aria-label="Diminuer la quantité">−</button>
          <span class="qty-val" data-qty-display="${item.id}">${uiQty[item.id]}</span>
          <button class="qty-btn" onclick="stepQty('${item.id}',1)" aria-label="Augmenter la quantité">+</button>
        </div>
        <button class="add-btn" id="add-${item.id}" ${outOfStock ? 'disabled' : ''} onclick="addToCart('${item.id}')">${outOfStock ? 'Indisponible' : 'Ajouter au panier'}</button>
        `}
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

  const promoPageGrid = document.getElementById('promoPageGrid');
  if(promoPageGrid){
    const onPromo = [...CATALOG.products, ...CATALOG.services].filter(i => i.specialPercent != null);
    promoPageGrid.innerHTML = onPromo.length
      ? onPromo.map(cardHTML).join('')
      : `<p class="card-sub">Aucune promotion en cours pour le moment — revenez bientôt !</p>`;
  }

  // Aperçus sur l'accueil — 10 articles maximum, sans filtre de recherche.
  // L'ordre est mélangé aléatoirement à chaque affichage (deux visiteurs
  // au même moment peuvent donc voir un agencement différent) — l'ordre
  // défini dans l'admin ne s'applique qu'aux pages Boutique/Services
  // elles-mêmes, jamais à cet aperçu. Les articles en promotion sont
  // toujours inclus (jamais laissés de côté par le tirage aléatoire),
  // pour qu'une promotion ne reste jamais invisible par hasard.
  function pickHomePreview(list){
    const onPromo = list.filter(i => i.specialPercent != null);
    const rest = shuffleArray(list.filter(i => i.specialPercent == null));
    return [...shuffleArray(onPromo), ...rest].slice(0, 10);
  }
  const productGridHome = document.getElementById('productGridHome');
  if(productGridHome){
    productGridHome.innerHTML = CATALOG.products.length
      ? pickHomePreview(CATALOG.products).map(cardHTML).join('')
      : `<p class="card-sub">La boutique sera bientôt garnie — revenez vite !</p>`;
  }
  const serviceGridHome = document.getElementById('serviceGridHome');
  if(serviceGridHome){
    serviceGridHome.innerHTML = CATALOG.services.length
      ? pickHomePreview(CATALOG.services).map(cardHTML).join('')
      : `<p class="card-sub">Nos services seront bientôt détaillés ici — revenez vite !</p>`;
  }

  const promoSection = document.getElementById('promoSection');
  const promoGrid = document.getElementById('promoGrid');
  if(promoSection && promoGrid){
    // Inclut à la fois l'ancien marquage manuel (promo) et les articles
    // couverts par un code promo actif (specialPercent) — un article ne
    // doit jamais être compté deux fois s'il a les deux à la fois.
    const promoItems = shuffleArray([...CATALOG.products, ...CATALOG.services].filter(i => i.promo || i.specialPercent != null));
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
/* ---- Calcul au pied carré (largeur × longueur en pouces) ---- */
function computeSqftPrice(widthIn, heightIn, pricePerSqft){
  const sqft = (widthIn * heightIn) / 144;
  return sqft * pricePerSqft;
}
function updateDimensionPrice(id){
  const item = ALL_ITEMS[id];
  if(!item) return;
  const widthEl = document.getElementById('dimWidth-'+id);
  const heightEl = document.getElementById('dimHeight-'+id);
  const priceEl = document.getElementById('dimComputedPrice-'+id);
  const btn = document.getElementById('dimAddBtn-'+id);
  const width = parseFloat(widthEl.value);
  const height = parseFloat(heightEl.value);
  const qty = uiQty[id] || 1;
  if(!(width > 0) || !(height > 0)){
    priceEl.innerHTML = '';
    btn.disabled = true;
    btn.textContent = 'Indiquez les dimensions';
    return;
  }
  const unit = computeSqftPrice(width, height, item.pricePerSqft || 0);
  const total = unit * qty;
  priceEl.innerHTML = `<strong>${formatHTG(total)}</strong> <span class="price-htg" style="display:inline; margin:0;">≈ ${formatUSD(total)}</span>${qty>1 ? ` <span class="card-sub">(${formatHTG(unit)} / unité)</span>` : ''}`;
  btn.disabled = false;
  btn.textContent = 'Ajouter au panier';
}
function addDimensionalToCart(id){
  const item = ALL_ITEMS[id];
  if(!item) return;
  const width = parseFloat(document.getElementById('dimWidth-'+id).value);
  const height = parseFloat(document.getElementById('dimHeight-'+id).value);
  if(!(width > 0) || !(height > 0)) return;
  const qty = uiQty[id] || 1;
  const unit = computeSqftPrice(width, height, item.pricePerSqft || 0);
  const lineId = 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  customCart.push({
    id: lineId,
    itemId: item.id,
    name: item.name,
    code: item.code || null,
    price: unit,
    qty,
    widthIn: width,
    heightIn: height,
    dimensionsLabel: `${width}" × ${height}" (${(width*height/144).toFixed(2)} pi²)`,
    kind: isEstimate(item) ? 'services' : 'products'
  });
  saveCustomCart();
  updateBadge();
  uiQty[id] = 1;
  document.getElementById('dimWidth-'+id).value = '';
  document.getElementById('dimHeight-'+id).value = '';
  document.querySelectorAll(`[data-qty-display="${id}"]`).forEach(el => el.textContent = 1);
  updateDimensionPrice(id);
  showToast(item.name + " ajouté au panier");
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
  const count = Object.values(cart).reduce((a,b)=>a+b,0) + customCart.reduce((s,l)=>s+l.qty,0);
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
  logPageView('article', id);
  const name = escapeHtml(item.name);
  const subText = escapeHtml(item.utility || item.description || "");
  const outOfStock = item.inStock === false;
  const images = (item.imageUrls && item.imageUrls.length) ? item.imageUrls : [];
  const priceBlock = item.isDimensionBased
    ? `<div class="price-row"><span class="price">${formatHTG(item.pricePerSqft||0)} / pi²</span></div><p class="card-sub" style="margin-top:-6px;">Indiquez les dimensions ci-dessous</p>`
    : item.specialPercent != null
    ? `<div class="price-row"><span class="price">${priceDualInline(item.specialPrice)}</span><span class="price-old">${formatHTG(item.startingPrice != null ? item.startingPrice : item.price)}</span></div>`
    : isEstimate(item)
    ? `<div class="price-row"><span class="price">À partir de ${priceDualInline(item.startingPrice)}</span></div>`
    : `<div class="price-row"><span class="price">${priceDualInline(item.price)}</span>${item.oldPrice ? `<span class="price-old">${formatHTG(item.oldPrice)}</span>` : ''}</div>`;

  const galleryHTML = images.length ? `
    <div class="item-detail-thumb">
      ${item.specialPercent != null ? `<span class="promo-flag">Spécial -${item.specialPercent}%</span>` : (item.promo ? '<span class="promo-flag">Promo</span>' : '')}
      ${outOfStock ? '<span class="stock-flag">Rupture de stock</span>' : ''}
      <img id="galleryMainImg" src="${images[0]}" alt="${name}">
    </div>
    ${images.length > 1 ? `
      <div class="gallery-thumbs">
        ${images.map((url,i) => `<button class="gallery-thumb-btn ${i===0?'active':''}" data-idx="${i}" onclick='setGalleryImage(${JSON.stringify(images)}, ${i}, this)'><img src="${url}" alt=""></button>`).join('')}
      </div>` : ''}
  ` : `
    <div class="item-detail-thumb">
      ${item.specialPercent != null ? `<span class="promo-flag">Spécial -${item.specialPercent}%</span>` : (item.promo ? '<span class="promo-flag">Promo</span>' : '')}
      ${outOfStock ? '<span class="stock-flag">Rupture de stock</span>' : ''}
      <div class="no-image">Pas de photo</div>
    </div>`;

  // SEO avancé : titre/description personnalisés par l'admin (onglet
  // Catalogue), sinon générés automatiquement à partir des infos réelles
  // de l'article — jamais de contenu inventé.
  const seoTitle = (item.seoTitle && item.seoTitle.trim()) || `${item.name} — JC Multimedia`;
  const seoDesc = (item.seoDescription && item.seoDescription.trim())
    || (item.utility || item.description || `${item.name} — disponible chez JC Multimedia, Port-au-Prince.`);

  document.title = seoTitle;
  const setMeta = (id, val) => { const el = document.getElementById(id); if(el) el.setAttribute('content', val); };
  setMeta('metaDescriptionTag', seoDesc);
  setMeta('ogTitleMeta', seoTitle);
  setMeta('ogDescriptionMeta', seoDesc);
  setMeta('twitterTitleMeta', seoTitle);
  setMeta('twitterDescriptionMeta', seoDesc);
  // Si l'article a une vraie photo hébergée, on l'utilise pour l'aperçu
  // de partage (WhatsApp/Facebook) au lieu du logo générique.
  if(item.imageUrls && item.imageUrls[0]){
    setMeta('ogImageMeta', item.imageUrls[0]);
    setMeta('twitterImageMeta', item.imageUrls[0]);
  }
  const canonicalEl = document.getElementById('canonicalLink');
  if(canonicalEl) canonicalEl.href = window.location.origin + itemUrlPath(item);
  const ogUrlEl = document.getElementById('ogUrlMeta');
  if(ogUrlEl) ogUrlEl.setAttribute('content', window.location.origin + itemUrlPath(item));

  const sectionLabel = isEstimate(item) ? 'Nos services' : 'Boutique';
  const sectionPath = isEstimate(item) ? '/services' : '/boutique';
  const breadcrumbEl = document.getElementById('articleBreadcrumb');
  if(breadcrumbEl){
    breadcrumbEl.innerHTML = `
      <a href="/">Accueil</a> <span>/</span>
      <a href="${sectionPath}">${sectionLabel}</a> <span>/</span>
      <span aria-current="page">${name}</span>
    `;
  }
  injectItemStructuredData(item, seoDesc);

  document.getElementById('itemDetailContent').innerHTML = `
    ${galleryHTML}
    <h1>${name}</h1>
    ${item.code ? `<p class="item-code-tag" style="display:inline-block; margin-bottom:10px;">${escapeHtml(item.code)}</p>` : ''}
    ${subText ? `<p class="card-sub" style="font-size:1rem;">${subText}</p>` : ''}
    ${priceBlock}
    ${item.isDimensionBased ? `
    <div class="form-field"><label>Format</label>
      <div class="dim-format-badge">Pied carré — ${formatHTG(item.pricePerSqft||0)}/pi²</div>
    </div>
    <div class="form-field"><label>Dimensions (en pouces)</label>
      <div class="dim-inputs">
        <input type="number" min="0.1" step="0.1" id="dimWidth-${id}" placeholder="Largeur" inputmode="decimal" oninput="updateDimensionPrice('${id}')">
        <span>×</span>
        <input type="number" min="0.1" step="0.1" id="dimHeight-${id}" placeholder="Longueur" inputmode="decimal" oninput="updateDimensionPrice('${id}')">
        <span>pouces</span>
      </div>
    </div>
    <div class="qty-row">
      <button class="qty-btn" onclick="stepQty('${id}',-1); updateDimensionPrice('${id}')" aria-label="Diminuer la quantité">−</button>
      <span class="qty-val" data-qty-display="${id}">${uiQty[id]}</span>
      <button class="qty-btn" onclick="stepQty('${id}',1); updateDimensionPrice('${id}')" aria-label="Augmenter la quantité">+</button>
    </div>
    <div id="dimComputedPrice-${id}" class="dim-computed-price"></div>
    <button class="add-btn" style="max-width:280px;" id="dimAddBtn-${id}" disabled onclick="addDimensionalToCart('${id}')">Indiquez les dimensions</button>
    ` : `
    <div class="qty-row">
      <button class="qty-btn" onclick="stepQty('${id}',-1)" aria-label="Diminuer la quantité">−</button>
      <span class="qty-val" data-qty-display="${id}">${uiQty[id]}</span>
      <button class="qty-btn" onclick="stepQty('${id}',1)" aria-label="Augmenter la quantité">+</button>
    </div>
    <button class="add-btn" style="max-width:280px;" ${outOfStock ? 'disabled' : ''} onclick="addToCart('${id}')">${outOfStock ? 'Indisponible' : 'Ajouter au panier'}</button>
    `}
    <button class="btn btn-ghost" style="margin-top:12px;" onclick="shareItem('${id}')">Partager</button>

    <div class="item-reviews-section">
      <h3>Avis clients</h3>
      <div id="itemRatingSummary" class="rating-summary"></div>
      <div id="itemReviewsList"></div>

      <h3 style="margin-top:24px;">Laisser un avis</h3>
      <div class="form-field">
        <label>Votre note</label>
        ${starRowHTML(0, id)}
      </div>
      <div class="form-field"><label for="reviewerName-${id}">Votre nom</label><input type="text" id="reviewerName-${id}"></div>
      <div class="form-field"><label for="reviewerComment-${id}">Commentaire (optionnel)</label><textarea id="reviewerComment-${id}" rows="3"></textarea></div>
      <button class="btn btn-primary" onclick="submitItemReview('${id}')">Envoyer mon avis</button>
      <p id="itemReviewMsg-${id}" class="card-sub" style="display:none;"></p>
    </div>
  `;
  initItemReviews(id, seoDesc);
}
function injectItemStructuredData(item, description, ratingSummary){
  const existing = document.getElementById('itemStructuredData');
  if(existing) existing.remove();

  const isService = isEstimate(item);
  const price = isService ? item.startingPrice : item.price;
  const url = window.location.origin + itemUrlPath(item);
  const data = {
    "@context": "https://schema.org",
    "@type": isService ? "Service" : "Product",
    "name": item.name,
    "url": url
  };
  if(description || item.utility || item.description) data.description = description || item.utility || item.description;
  if(item.imageUrls && item.imageUrls.length) data.image = item.imageUrls;
  if(item.code) data[isService ? "serviceType" : "sku"] = item.code;
  if(ratingSummary && ratingSummary.rating_count > 0){
    // Notes réellement laissées par des clients (jamais inventées) —
    // ajoutées seulement si au moins un avis existe.
    data.aggregateRating = {
      "@type": "AggregateRating",
      "ratingValue": ratingSummary.avg_rating,
      "reviewCount": ratingSummary.rating_count
    };
  }
  if(!isService){
    data.brand = { "@type": "Brand", "name": "JC Multimedia" };
    if(!item.isDimensionBased){
      data.offers = {
        "@type": "Offer",
        "priceCurrency": "HTG",
        "price": price,
        "availability": item.inStock === false ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
        "url": url
      };
    }
  } else if(item.isDimensionBased && item.pricePerSqft > 0){
    // Prix calculé au pied carré : pas de prix fixe à annoncer, on
    // décrit le tarif unitaire plutôt que d'inventer un prix total.
    data.offers = {
      "@type": "Offer",
      "priceSpecification": {
        "@type": "UnitPriceSpecification",
        "price": item.pricePerSqft,
        "priceCurrency": "HTG",
        "unitText": "pi²"
      },
      "url": url
    };
  } else if(price != null){
    data.offers = { "@type": "Offer", "priceCurrency": "HTG", "price": price, "url": url };
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
function shareItem(id){
  const item = ALL_ITEMS[id];
  if(!item) return;
  const section = isEstimate(item) ? 'services' : 'boutique';
  const url = `${window.location.origin}/partage/${section}/${item.slug || item.id}`;
  if(navigator.share){
    navigator.share({ title: item.name, url }).catch(()=>{});
  } else if(navigator.clipboard){
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
  const items = (o.items||[]).map(i => `<li>${escapeHtml(i.name)} × ${Number(i.qty)||0}${i.customized ? ' (à personnaliser)' : ''}</li>`).join('');
  const history = (o.history||[]).map(h => `<li>${escapeHtml(h.status)} — ${new Date(h.changed_at).toLocaleString('fr-FR')}</li>`).join('');
  document.getElementById('trackResult').innerHTML = `
    <div class="admin-order-card">
      <div class="admin-order-head">
        <strong>${escapeHtml(o.code)}</strong>
        <span class="mono">${new Date(o.created_at).toLocaleDateString('fr-FR')}</span>
      </div>
      <div class="item-code-tag" style="margin:6px 0; display:inline-block;">${escapeHtml(o.status)}</div>
      <ul class="admin-list">${items}</ul>
      <div class="cart-total-row"><span>Total</span><span class="amt">${priceDualInline(Number(o.total||0))}</span></div>
      <div class="card-sub">Paiement : ${escapeHtml(o.payment) || '—'} · ${escapeHtml(o.delivery) || '—'}</div>
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
  const match = window.location.pathname.match(/^\/(boutique|services)\/([^\/]+)$/);
  const slug = match ? decodeURIComponent(match[2]) : null;
  const content = document.getElementById('itemDetailContent');
  if(!slug){ content.innerHTML = '<p class="card-sub">Article introuvable.</p>'; return; }
  const found = Object.values(ALL_ITEMS).find(i => i.slug === slug);
  if(found){ renderItemDetail(found.id); return; }
  if(Object.keys(ALL_ITEMS).length > 0){
    content.innerHTML = '<p class="card-sub">Article introuvable.</p>';
    return;
  }
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
  const regular = Object.entries(cart).filter(([id,qty])=>qty>0 && ALL_ITEMS[id]).map(([id,qty])=>({...ALL_ITEMS[id], qty}));
  const custom = customCart.map(line => ({...line, isCustomLine:true}));
  return [...regular, ...custom];
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
        <div class="ci-name">${escapeHtml(item.name)}</div>
        ${item.dimensionsLabel ? `<div class="card-sub" style="margin:2px 0;">${escapeHtml(item.dimensionsLabel)}</div>` : ''}
        <div class="ci-price">${item.qty} × ${isEstimate(item) ? 'à partir de ' : ''}${formatHTG(unitPrice(item))} <span class="price-htg" style="display:inline; margin:0;">≈ ${formatUSD(unitPrice(item))}</span></div>
      </div>
      <div class="ci-controls">
        <div class="qty-row-sm">
          <button class="qty-btn" onclick="changeCartQty('${item.id}',-1)" aria-label="Diminuer la quantité de ${escapeHtml(item.name)}">−</button>
          <span class="qty-val">${item.qty}</span>
          <button class="qty-btn" onclick="changeCartQty('${item.id}',1)" aria-label="Augmenter la quantité de ${escapeHtml(item.name)}">+</button>
        </div>
        <button class="ci-remove" onclick="removeFromCart('${item.id}')" aria-label="Retirer ${escapeHtml(item.name)} du panier">✕</button>
      </div>
    </div>
  `).join('');
  footerEl.innerHTML = `
    <div class="cart-total-row">
      <span>Total estimé</span>
      <span class="amt">${formatHTG(cartTotal())}<span class="price-htg" style="text-align:right;">≈ ${formatUSD(cartTotal())}</span></span>
    </div>
    ${hasEstimateItems ? '<div class="cart-quote-note">* Prix de certains services estimés « à partir de » — montant final confirmé sur WhatsApp.</div>' : ''}
    <div class="cart-actions">
      <button class="btn btn-wa btn-block" onclick="startOrderFlow()">Commander</button>
      <button class="btn btn-ghost btn-block" onclick="confirmClearCart()">Vider le panier</button>
    </div>
  `;
}
function changeCartQty(id, delta){
  const customLine = customCart.find(l => l.id === id);
  if(customLine){
    customLine.qty = Math.min(MAX_QTY, Math.max(1, customLine.qty + delta));
    saveCustomCart();
    renderCart();
    updateBadge();
    return;
  }
  const next = Math.min(MAX_QTY, Math.max(1, (cart[id] || 1) + delta));
  cart[id] = next;
  saveCart();
  renderCart();
  updateBadge();
}
function removeFromCart(id){
  if(customCart.some(l => l.id === id)){
    customCart = customCart.filter(l => l.id !== id);
    saveCustomCart();
    renderCart();
    updateBadge();
    return;
  }
  delete cart[id];
  saveCart();
  renderCart();
  updateBadge();
}
function clearCart(){
  cart = {};
  customCart = [];
  saveCustomCart();
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

/* Fenêtre de confirmation maison — remplace les popups natives du
   navigateur (moches et incohérentes avec le design) partout dans
   l'admin. */
let _pendingConfirmCallback = null;
function showConfirmModal(message, onConfirm){
  _pendingConfirmCallback = onConfirm;
  openStep(`
    <h3>${message}</h3>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="_pendingConfirmCallback=null; closeStep();">Annuler</button>
      <button class="btn btn-primary" onclick="runPendingConfirm()">Confirmer</button>
    </div>
  `, "Confirmation");
}
function runPendingConfirm(){
  const cb = _pendingConfirmCallback;
  _pendingConfirmCallback = null;
  closeStep();
  if(cb) cb();
}

/* =========================================================
   ORDER FLOW: coordonnées -> personnalisation -> paiement -> livraison -> WhatsApp -> confirmation
   ========================================================= */
function startOrderFlow(){
  const idempotencyKey = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2));
  orderFlow = { customerName:"", customerPhone:"", customerAddress:"", customize:null, customizedItems:[], payment:null, delivery:null, idempotencyKey, uploadFiles:[], modelFiles:[], details:"", servicePhotoSlots:5 };
  showStepCustomerInfo();
}
function showStepCustomerInfo(){
  openStep(`
    <h3>Vos coordonnées</h3>
    <div class="form-field">
      <label for="cfName">Nom complet *</label>
      <input type="text" id="cfName" value="${escapeHtml(orderFlow.customerName)}" placeholder="Ex : Jean Baptiste" autocomplete="name">
    </div>
    <div class="form-field">
      <label for="cfPhone">Téléphone *</label>
      <input type="tel" id="cfPhone" value="${escapeHtml(orderFlow.customerPhone)}" placeholder="Ex : 3443 2139" autocomplete="tel">
    </div>
    <div class="form-field">
      <label for="cfAddress">Adresse (si livraison)</label>
      <input type="text" id="cfAddress" value="${escapeHtml(orderFlow.customerAddress)}" placeholder="Quartier, rue, repère…" autocomplete="street-address">
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
  // Une commande contenant au moins un service suit désormais le
  // parcours dédié (fichiers modèles + photos + description) avant
  // la livraison et le paiement réel. Une commande de produits purs
  // garde son parcours existant (personnalisation éventuelle, puis
  // livraison et paiement).
  if(hasServiceInOrder()){ showStepServiceUploads(); return; }
  const customizableInCart = cartEntries().filter(i => i.customizable);
  if(customizableInCart.length > 0){ showStepCustomizeAsk(); } else { goPastCustomize(); }
}
/* L'étape "Détails de votre commande" (description + fichiers) n'a de
   sens que si le client personnalise un produit — les services ont
   désormais leur propre étape dédiée (showStepServiceUploads). */
function shouldShowFilesStep(){
  return orderFlow.customize === true;
}
/* Une commande de PRODUITS PURS (aucun service) : infos → (personnalisation
   éventuelle) → livraison → paiement réel. */
function isPureProductOrder(){
  const items = cartEntries();
  return items.length > 0 && items.every(i => !isEstimate(i));
}
/* Une commande avec au moins un service (seul ou mélangé à des
   produits) : infos → fichiers modèles/photos/description → livraison
   → paiement réel MonCash/NatCash → récapitulatif WhatsApp après
   paiement confirmé. */
function hasServiceInOrder(){
  return cartEntries().some(i => isEstimate(i));
}
function goPastCustomize(){
  if(shouldShowFilesStep()){ showStepFiles(); }
  else { showStepDelivery(); }
}

/* =========================================================
   ÉTAPE DÉDIÉE AUX SERVICES — fichiers modèles (jusqu'à 2),
   photos du client (5 minimum, extensible), description du projet.
   ========================================================= */
const MAX_SERVICE_PHOTOS = 20;
function renderServicePhotoSlots(){
  return Array.from({length: orderFlow.servicePhotoSlots || 5}, (_, slot) => `
    <div class="admin-image-slot">
      <div class="admin-image-preview" id="sphoto-preview-${slot}">${orderFlow.uploadFiles[slot] ? `<span>${orderFlow.uploadFiles[slot].name.slice(0,14)}</span>` : '<span>Aucun fichier</span>'}</div>
      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" id="sphoto-${slot}" onchange="handleServicePhotoChange(${slot})">
    </div>
  `).join('');
}
function addServicePhotoSlot(){
  if((orderFlow.servicePhotoSlots || 5) >= MAX_SERVICE_PHOTOS){ showToast("Maximum " + MAX_SERVICE_PHOTOS + " photos"); return; }
  orderFlow.servicePhotoSlots = (orderFlow.servicePhotoSlots || 5) + 1;
  document.getElementById('servicePhotosRow').innerHTML = renderServicePhotoSlots();
}
function handleServicePhotoChange(slot){
  const input = document.getElementById('sphoto-'+slot);
  const file = input.files[0];
  const errorEl = document.getElementById('serviceUploadError');
  if(errorEl) errorEl.style.display = 'none';
  if(!file) return;
  if(file.size > MAX_UPLOAD_SIZE){
    showToast("Fichier trop volumineux (5 Mo maximum)");
    input.value = '';
    return;
  }
  orderFlow.uploadFiles[slot] = file;
  document.getElementById('sphoto-preview-'+slot).innerHTML = `<span>${file.name.length>16 ? file.name.slice(0,14)+'…' : file.name}</span>`;
}
function handleModelFileChange(slot){
  const input = document.getElementById('cmodel-'+slot);
  const file = input.files[0];
  if(!file) return;
  if(file.size > MAX_UPLOAD_SIZE){
    showToast("Fichier trop volumineux (5 Mo maximum)");
    input.value = '';
    return;
  }
  orderFlow.modelFiles[slot] = file;
  document.getElementById('cmodel-preview-'+slot).innerHTML = `<span>${file.name.length>16 ? file.name.slice(0,14)+'…' : file.name}</span>`;
}
function showStepServiceUploads(){
  openStep(`
    <h3>Votre projet</h3>
    <div class="form-field">
      <label>Fichiers modèles (jusqu'à 2) — montrez-nous un style ou un exemple de ce que vous voulez, facultatif</label>
      <div class="admin-image-row">
        ${[0,1].map(slot => `
          <div class="admin-image-slot">
            <div class="admin-image-preview" id="cmodel-preview-${slot}">${orderFlow.modelFiles[slot] ? `<span>${orderFlow.modelFiles[slot].name.slice(0,14)}</span>` : '<span>Aucun fichier</span>'}</div>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" id="cmodel-${slot}" onchange="handleModelFileChange(${slot})">
          </div>
        `).join('')}
      </div>
    </div>
    <div class="form-field">
      <label>Vos photos (minimum 5) — le contenu à utiliser pour votre projet</label>
      <div class="admin-image-row" id="servicePhotosRow">${renderServicePhotoSlots()}</div>
      <button type="button" class="btn btn-ghost" style="margin-top:8px;" onclick="addServicePhotoSlot()">+ Ajouter une photo</button>
      <p id="serviceUploadError" class="form-error" style="display:none;">Merci de joindre au moins 5 photos.</p>
    </div>
    <div class="form-field">
      <label>Décrivez votre projet</label>
      <textarea id="serviceDescription" rows="4" placeholder="Expliquez ce que vous souhaitez (couleur, taille, texte, style, délai…)">${escapeHtml(orderFlow.details || '')}</textarea>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="showStepCustomerInfo()">Retour</button>
      <button class="btn btn-primary" onclick="collectServiceUploads()">Suivant</button>
    </div>
  `, "Votre projet");
}
function collectServiceUploads(){
  const photoCount = orderFlow.uploadFiles.filter(Boolean).length;
  if(photoCount < 5){
    document.getElementById('serviceUploadError').style.display = 'block';
    return;
  }
  orderFlow.details = document.getElementById('serviceDescription').value.trim();
  showStepDelivery();
}
function showStepCustomizeAsk(){
  openStep(`
    <h3>Souhaitez-vous personnaliser certains articles ?</h3>
    <button class="opt-btn" onclick="orderFlow.customize=true; showStepCustomizeList();">Oui</button>
    <button class="opt-btn" onclick="orderFlow.customize=false; goPastCustomize();">Non</button>
  `, "Personnalisation des articles");
}
/* =========================================================
   RETOUR DE PAIEMENT (PLOP PLOP) — page où le client revient
   après avoir payé (ou annulé) sur la page hébergée PLOP PLOP.
   La confirmation officielle du paiement se fait par webhook
   (voir api/plopplop-webhook.js) ; cette page ne fait qu'un
   affichage rassurant pour le client, jamais la mise à jour
   définitive de la commande.
   ========================================================= */
const LAST_PAYMENT_REF_KEY = "jc_multimedia_last_payment_ref";
function buildWhatsappRecapMessage(summary){
  const SEP = "─────────────────────%0A";
  let msg = `✅ *PAIEMENT CONFIRMÉ — JC MULTIMEDIA*%0A${SEP}`;
  msg += `*Réf. commande :* ${summary.orderCode}%0A%0A`;
  msg += `*CLIENT*%0ANom : ${summary.customerName}%0A`;
  if(summary.customerPhone) msg += `Téléphone : ${summary.customerPhone}%0A`;
  if(summary.customerAddress) msg += `Adresse : ${summary.customerAddress}%0A`;
  msg += `%0A${SEP}*ARTICLES*%0A`;
  (summary.items||[]).forEach(i => {
    msg += `▪ ${i.name}${i.code ? ` (${i.code})` : ''} × ${i.qty}%0A`;
  });
  msg += `%0A${SEP}*Total payé : ${formatHTG(summary.total)}* (≈ ${formatUSD(summary.total)})`;
  if(summary.delivery) msg += `%0ALivraison : ${summary.delivery}`;
  msg += `%0A%0A${SEP}Merci pour votre confiance ! Ceci est une confirmation — aucune action supplémentaire n'est requise de votre part.`;
  return msg;
}

async function initPaymentReturnPage(){
  const statusEl = document.getElementById('paymentReturnStatus');
  if(!statusEl) return;
  const params = new URLSearchParams(window.location.search);
  const summary = safeGet(PAYMENT_SUMMARY_KEY);
  const reference = params.get('reference') || (summary && summary.reference) || safeGet(LAST_PAYMENT_REF_KEY);

  if(!reference){
    statusEl.innerHTML = `<p class="card-sub">Merci ! Si vous venez de finaliser un paiement, il sera confirmé sous peu.</p>`;
    return;
  }

  statusEl.innerHTML = `<p class="card-sub">Vérification de votre paiement…</p>`;

  try{
    const resp = await fetch(`https://tkwrklboqspkzxtlvnzh.supabase.co/functions/v1/verify-payment?reference=${encodeURIComponent(reference)}`);
    const data = await resp.json();

    if(data.status && data.trans_status === 'ok'){
      statusEl.innerHTML = `
        <p class="card-sub">✅ Paiement confirmé${summary ? ` pour la commande <strong>${escapeHtml(summary.orderCode)}</strong>` : ''}. Merci pour votre confiance !</p>
        ${summary ? `<button class="btn btn-primary" style="margin-top:12px;" onclick="sendWhatsappRecap()">Envoyer la confirmation sur WhatsApp</button>` : ''}
      `;
    } else if(data.status && summary){
      statusEl.innerHTML = `
        <p class="card-sub">⏳ Le paiement n'a pas été confirmé (annulé, échoué, ou en cours). Vous pouvez réessayer ci-dessous.</p>
        <div class="form-field" style="margin-top:12px;">
          <label>Réessayer avec</label>
          <button class="opt-btn" onclick="retryPayment('moncash')">MonCash</button>
          <button class="opt-btn" onclick="retryPayment('natcash')">NatCash</button>
        </div>
        <p id="retryStatus" class="card-sub" style="margin-top:8px;"></p>
      `;
    } else {
      throw new Error('vérification indisponible');
    }
  }catch(e){
    statusEl.innerHTML = `<p class="card-sub">Merci ! Nous confirmons votre paiement sous peu. Vous pouvez aussi nous contacter directement si besoin.</p>`;
    console.warn('payment verify failed:', e);
  }
}

function sendWhatsappRecap(){
  const summary = safeGet(PAYMENT_SUMMARY_KEY);
  if(!summary) return;
  const msg = buildWhatsappRecapMessage(summary);
  window.open(`https://wa.me/${SETTINGS.whatsapp}?text=${msg}`, "_blank");
  safeSet(PAYMENT_SUMMARY_KEY, null);
}

async function retryPayment(method){
  const summary = safeGet(PAYMENT_SUMMARY_KEY);
  const retryEl = document.getElementById('retryStatus');
  if(!summary){ if(retryEl) retryEl.textContent = "Détails de commande introuvables — contactez-nous directement."; return; }
  // Commande payée via un lien de paiement : on retourne simplement sur ce lien.
  // Toute nouvelle tentative passe par la page /payer/<jeton> (montant relu en base).
  if(summary.payToken){ window.location.href = '/payer/' + encodeURIComponent(summary.payToken); return; }
  // Ancienne commande sans jeton : reprise par WhatsApp.
  if(retryEl) retryEl.textContent = "Pour réessayer le paiement de cette commande, contactez-nous sur WhatsApp en indiquant votre code de commande.";
}

/* =========================================================
   LIEN DE PAIEMENT — page /payer/<jeton> envoyée au client
   (commande prise sur WhatsApp et créée depuis l'admin).
   Lecture via la fonction SQL get_payment_link (renvoie
   uniquement cette commande) ; le paiement passe par l'Edge
   Function pay-link, qui relit le montant dans la base.
   ========================================================= */
const PAY_LINK_URL = "https://tkwrklboqspkzxtlvnzh.supabase.co/functions/v1/pay-link";
let PAY_LINK_DATA = null;

function payLinkToken(){
  const m = window.location.pathname.match(/\/payer\/([A-Za-z0-9]+)/);
  if(m) return m[1];
  return new URLSearchParams(window.location.search).get('t') || '';
}

async function initPayLinkPage(){
  const box = document.getElementById('payLinkBox');
  if(!box) return;
  const token = payLinkToken();
  if(!token || !SUPABASE_ENABLED){
    box.innerHTML = `<p class="card-sub">Ce lien de paiement est incomplet. Contactez-nous sur WhatsApp pour recevoir un nouveau lien.</p>`;
    return;
  }
  try{
    const { data, error } = await db.rpc('get_payment_link', { p_token: token });
    if(error) throw error;
    if(!data){
      box.innerHTML = `<p class="card-sub">Ce lien de paiement n'est pas valide. Contactez-nous sur WhatsApp pour recevoir un nouveau lien.</p>`;
      return;
    }
    PAY_LINK_DATA = { ...data, token };
    renderPayLink();
  }catch(e){
    console.error('initPayLinkPage:', e);
    box.innerHTML = `<p class="card-sub">Impossible de charger votre commande pour le moment. Réessayez dans un instant.</p>`;
  }
}

function renderPayLink(){
  const box = document.getElementById('payLinkBox');
  const d = PAY_LINK_DATA;
  const total = Number(d.total) || 0;
  const items = (d.items || []).map(i => `
    <div class="cart-item">
      <div>
        <div class="ci-name">${escapeHtml(i.name || '')}</div>
        <div class="ci-price">${Number(i.qty)||0} × ${formatHTG(Number(i.unit_price)||0)}</div>
      </div>
      <strong class="mono">${formatHTG(Number(i.line_total)||0)}</strong>
    </div>`).join('');
  const header = `
    <div class="admin-note" style="margin-bottom:14px;">
      Commande <strong>${escapeHtml(d.code || '')}</strong>${d.customer_name ? ` — ${escapeHtml(d.customer_name)}` : ''}
    </div>
    ${items}
    <div class="cart-total-row" style="margin-top:12px;"><span>Total à payer</span><span class="amt">${priceDualInline(total)}</span></div>
    ${d.delivery ? `<p class="card-sub">Livraison : ${escapeHtml(d.delivery)}</p>` : ''}`;
  let actions;
  if(d.paid){
    actions = `<p class="card-sub" style="margin-top:14px;">✅ Cette commande est déjà payée. Merci pour votre confiance !</p>`;
  } else if(d.status === 'Annulée' || d.status === 'Refusée'){
    actions = `<p class="card-sub" style="margin-top:14px;">Cette commande a été annulée. Contactez-nous sur WhatsApp si besoin.</p>`;
  } else {
    actions = `
      <div class="form-field" style="margin-top:16px;">
        <label>Payer avec</label>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-primary" id="payLinkMoncash" onclick="payLinkPay('moncash')">MonCash</button>
          <button class="btn btn-wa" id="payLinkNatcash" onclick="payLinkPay('natcash')">Natcash</button>
        </div>
      </div>
      <p class="card-sub" id="payLinkStatus">Vous serez redirigé vers la page de paiement sécurisée, puis de retour sur notre site.</p>`;
  }
  box.innerHTML = header + actions;
}

async function payLinkPay(method){
  const d = PAY_LINK_DATA;
  if(!d) return;
  const statusEl = document.getElementById('payLinkStatus');
  const btns = [document.getElementById('payLinkMoncash'), document.getElementById('payLinkNatcash')];
  btns.forEach(b => { if(b) b.disabled = true; });
  if(statusEl) statusEl.textContent = 'Préparation du paiement…';
  const fail = (msg) => {
    btns.forEach(b => { if(b) b.disabled = false; });
    if(statusEl) statusEl.textContent = msg;
  };
  try{
    const resp = await fetch(PAY_LINK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: d.token, method })
    });
    const data = await resp.json();
    if(!data || !data.status || !data.url){
      if(data && data.message === 'already_paid'){ d.paid = true; renderPayLink(); return; }
      if(data && data.message === 'order_cancelled'){ d.status = 'Annulée'; renderPayLink(); return; }
      fail("Le paiement n'a pas pu démarrer. Réessayez ou choisissez l'autre moyen de paiement.");
      return;
    }
    safeSet(PAYMENT_SUMMARY_KEY, {
      orderId: null, orderCode: data.code || d.code, reference: data.reference, amountHTG: data.amount, method,
      customerName: d.customer_name || '', customerPhone: '', customerAddress: '', delivery: d.delivery || '',
      items: (d.items || []).map(i => ({ name: i.name, qty: i.qty, code: null })),
      total: Number(d.total) || 0,
      payToken: d.token
    });
    safeSet(LAST_PAYMENT_REF_KEY, data.reference);
    window.location.href = data.url;
  }catch(e){
    console.error('payLinkPay:', e);
    fail("Erreur de connexion. Réessayez dans un instant.");
  }
}

const MAX_UPLOAD_FILES = 10;
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5 Mo
const ALLOWED_UPLOAD_TYPES = ['image/jpeg','image/png','image/webp','image/gif','application/pdf'];

function showStepCustomizeList(){
  const items = cartEntries().filter(i => i.customizable);
  openStep(`
    <h3>Articles à personnaliser</h3>
    ${items.map(i => `
      <label class="check-row">
        <input type="checkbox" value="${i.id}" ${orderFlow.customizedItems.includes(i.id) ? 'checked':''}>
        ${escapeHtml(i.name)}
      </label>
    `).join('')}
    <div class="form-field" style="margin-top:14px;">
      <label for="customizeNotes">Précisez ce que vous souhaitez (couleur, taille, texte à graver, style, délai souhaité…)</label>
      <textarea id="customizeNotes" rows="4" style="width:100%; padding:11px 12px; border-radius:10px; border:1px solid var(--line); background:var(--surface2); color:var(--text); font-family:inherit; font-size:.9rem;" placeholder="Ex : logo en bleu marine, taille M, à livrer avant vendredi…">${orderFlow.customizationNotes || ''}</textarea>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="showStepCustomizeAsk()">Retour</button>
      <button class="btn btn-primary" onclick="collectCustomizeList()">Suivant</button>
    </div>
  `, "Articles à personnaliser");
}
function collectCustomizeList(){
  orderFlow.customizedItems = Array.from(document.querySelectorAll('.check-row input:checked')).map(el => el.value);
  orderFlow.customizationNotes = document.getElementById('customizeNotes').value.trim();
  showStepFiles();
}

/* Étape toujours proposée, quel que soit l'article (produit ou
   service) — le client peut décrire précisément ce qu'il veut et
   joindre jusqu'à 3 fichiers (logo, photo, design…). Particulièrement
   utile pour les services et les produits à personnaliser, mais
   disponible pour toute commande. */
function showStepFiles(){
  const items = cartEntries();
  const hasServices = items.some(i => isEstimate(i));
  const hasCustomizable = items.some(i => i.customizable);
  const helperText = (hasServices || hasCustomizable)
    ? "Décrivez précisément ce que vous voulez (couleur, taille, texte, style, délai souhaité…) — utile pour vos services et vos articles à personnaliser."
    : "Une précision à ajouter sur votre commande ? (optionnel)";
  openStep(`
    <h3>Détails de votre commande</h3>
    <div class="form-field">
      <label for="cfDetails">${helperText}</label>
      <textarea id="cfDetails" rows="4" placeholder="Expliquez ce que vous souhaitez…" style="width:100%; padding:11px 12px; border-radius:10px; border:1px solid var(--line); background:var(--surface2); color:var(--text); font-family:inherit; font-size:.92rem;">${escapeHtml(orderFlow.details || '')}</textarea>
    </div>
    <div class="form-field">
      <label>Joindre des fichiers (logo, photo, design…) — jusqu'à ${MAX_UPLOAD_FILES}, 5 Mo max chacun (images ou PDF), facultatif</label>
      <div class="admin-image-row">
        ${Array.from({length: MAX_UPLOAD_FILES}, (_, slot) => `
          <div class="admin-image-slot">
            <div class="admin-image-preview" id="cfile-preview-${slot}">${orderFlow.uploadFiles[slot] ? `<span>${orderFlow.uploadFiles[slot].name.slice(0,14)}</span>` : '<span>Aucun fichier</span>'}</div>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" id="cfile-${slot}" onchange="handleCustomizeFileChange(${slot})">
          </div>
        `).join('')}
      </div>
    </div>
    <p id="cfileError" class="form-error" style="display:none;"></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="showStepFilesBack()">Retour</button>
      <button class="btn btn-primary" onclick="collectStepFiles()">Suivant</button>
    </div>
  `, "Détails de votre commande");
}
function collectStepFiles(){
  orderFlow.details = document.getElementById('cfDetails').value.trim();
  if(isPureProductOrder()){ showStepDelivery(); } else { showStepPayment(); }
}
function showStepFilesBack(){
  const hasCustomizable = cartEntries().some(i => i.customizable);
  if(hasCustomizable){ showStepCustomizeAsk(); } else { showStepCustomerInfo(); }
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
function showStepPayment(){
  const options = ["MonCash","Natcash"];
  openStep(`
    <h3>Quel est votre mode de paiement préféré ?</h3>
    ${options.map(o => `<button class="opt-btn ${orderFlow.payment===o?'selected':''}" onclick="selectPayment('${o}')">${o}</button>`).join('')}
    <p class="card-sub" style="margin-top:10px;">Vous serez redirigé vers une page sécurisée pour finaliser le paiement.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="showStepDelivery()">Retour</button>
      <button class="btn btn-primary" id="paymentNextBtn" onclick="orderFlow.payment ? handleRealPayment() : null">Payer</button>
    </div>
  `, "Mode de paiement");
}
function selectPayment(o){ orderFlow.payment = o; showStepPayment(); }
function showStepDelivery(){
  const options = ["Se faire livrer","Récupérer sur place"];
  const hasCustomizableInCart = cartEntries().some(i => i.customizable);
  const backAction = hasServiceInOrder()
    ? "showStepServiceUploads()"
    : (shouldShowFilesStep() ? "showStepFiles()" : (hasCustomizableInCart ? "showStepCustomizeAsk()" : "showStepCustomerInfo()"));
  openStep(`
    <h3>Souhaitez-vous être livré ou récupérer sur place ?</h3>
    ${options.map(o => `<button class="opt-btn ${orderFlow.delivery===o?'selected':''}" onclick="selectDelivery('${o}')">${o}</button>`).join('')}
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="${backAction}">Retour</button>
      <button class="btn btn-primary" id="sendOrderBtn" onclick="orderFlow.delivery ? showStepPayment() : null">Suivant</button>
    </div>
  `, "Livraison ou retrait");
}
function selectDelivery(o){ orderFlow.delivery = o; showStepDelivery(); }

const PAYMENT_SUMMARY_KEY = "jc_multimedia_payment_summary";

async function handleRealPayment(){
  const btn = document.getElementById('paymentNextBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Préparation du paiement…'; }
  try{
    const method = orderFlow.payment === 'Natcash' ? 'natcash' : 'moncash';
    const { orderId, orderCode, items, total, payToken } = await createOrderRecord();

    if(!orderCode || !payToken){
      showToast("Échec de la création de la commande. Réessayez.");
      if(btn){ btn.disabled = false; btn.textContent = 'Payer'; }
      return;
    }

    // Paiement via pay-link : le serveur relit le montant dans la base,
    // enregistre la référence de cette tentative (pour la confirmation
    // automatique par le webhook) et renvoie l'adresse de paiement.
    const resp = await fetch(PAY_LINK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: payToken, method })
    });
    const data = await resp.json();

    if(!data || !data.status || !data.url){
      showToast("Le paiement en ligne n'a pas pu être initié. Réessayez ou choisissez un autre mode.");
      if(btn){ btn.disabled = false; btn.textContent = 'Payer'; }
      return;
    }

    // Résumé conservé pour reconstruire le message WhatsApp de
    // confirmation une fois le client revenu sur le site, et pour
    // permettre une nouvelle tentative sans tout ressaisir.
    const paymentRef = data.reference;
    safeSet(PAYMENT_SUMMARY_KEY, {
      orderId, orderCode, reference: paymentRef, amountHTG: data.amount, method, payToken,
      customerName: orderFlow.customerName, customerPhone: orderFlow.customerPhone,
      customerAddress: orderFlow.customerAddress, delivery: orderFlow.delivery,
      items: items.map(i => ({ name: i.dimensionsLabel ? `${i.name} (${i.dimensionsLabel})` : i.name, qty: i.qty, code: i.code || null })),
      total
    });
    safeSet(LAST_PAYMENT_REF_KEY, paymentRef);

    cart = {}; customCart = [];
    saveCart(); saveCustomCart(); updateBadge();

    window.location.href = data.url;
  }catch(e){
    console.error('handleRealPayment error:', e);
    showToast("Une erreur est survenue. Réessayez.");
    if(btn){ btn.disabled = false; btn.textContent = 'Payer'; }
  }
}

/* Crée la commande dans Supabase via la fonction serveur
   place_public_order : les prix sont RELUS dans le catalogue côté
   serveur (promos et pied carré compris), jamais pris du navigateur.
   La fonction crée aussi les lignes, le paiement « En attente » et un
   jeton de paiement (pay_token) utilisé ensuite par pay-link. */
async function createOrderRecord(){
  const items = cartEntries();
  let total = cartTotal();
  let orderCode = null, orderId = null, payToken = null;

  if(!SUPABASE_ENABLED) return { orderId, orderCode, items, total, payToken };

  try{
    const lines = items.map(i => i.isCustomLine
      ? { catalog_item_id: i.itemId, qty: i.qty, width_in: i.widthIn, height_in: i.heightIn,
          customized: orderFlow.customizedItems.includes(i.id) }
      : { catalog_item_id: i.id, qty: i.qty, customized: orderFlow.customizedItems.includes(i.id) });
    const { data, error } = await db.rpc('place_public_order', {
      order_data: {
        customer_name: orderFlow.customerName,
        customer_phone: orderFlow.customerPhone,
        customer_address: orderFlow.customerAddress || null,
        payment: orderFlow.payment,
        delivery: orderFlow.delivery,
        details: orderFlow.details || null,
        idempotency_key: orderFlow.idempotencyKey,
        lines
      }
    });
    if(error) throw error;
    orderId = data.id;
    orderCode = data.code;
    payToken = data.pay_token;
    total = Number(data.total) || 0;

    // Envoi des fichiers joints (logo, design…) — chemin de stockage
    // toujours généré ici, jamais le nom brut envoyé par le client ;
    // le nom d'origine est seulement conservé pour affichage à l'admin.
    const filesToUpload = (orderFlow.uploadFiles || []).filter(Boolean).map(f => ({ file:f, label:null }));
    const modelFilesToUpload = (orderFlow.modelFiles || []).filter(Boolean).map(f => ({ file:f, label:'[Modèle] ' }));
    for(const { file, label } of [...modelFilesToUpload, ...filesToUpload]){
      try{
        const parts = file.name.split('.');
        const ext = ((parts.length > 1 ? parts.pop() : '') .toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8)) || 'bin';
        const safePath = `${orderId}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
        const { error: upErr } = await db.storage.from('order-uploads').upload(safePath, file);
        if(upErr) throw upErr;
        await db.from('order_uploads').insert({
          order_id: orderId,
          original_filename: (label || '') + file.name,
          storage_path: safePath,
          mime_type: file.type,
          size_bytes: file.size
        });
      }catch(e){ console.warn('file upload failed:', e); }
    }
  }catch(e){
    // Si la clé d'idempotence existe déjà (double clic malgré la
    // protection du bouton), on ne recrée jamais une seconde commande.
    console.warn('place_public_order failed:', e);
  }

  return { orderId, orderCode, items, total, payToken };
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
  ['dashboard','catalog','content','banner','portfolio','reviews','promos','whatsapp','orders','paylinks','recus','files','customers','settings'].forEach(t=>{
    const panel = document.getElementById('adminTab-'+t);
    if(panel) panel.style.display = (t===name) ? 'block' : 'none';
  });
  document.querySelectorAll('.admin-tab[data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
  // En-tête de l'admin : titre de l'onglet, menu refermé sur téléphone
  const admTitle = document.getElementById('admTitle');
  const admLink = document.querySelector(`.adm-link[data-tab="${name}"]`);
  if(admTitle && admLink) admTitle.textContent = admLink.dataset.label || admLink.textContent.trim();
  if(typeof admCloseSide === 'function') admCloseSide();
  if(name==='dashboard') renderAdminDashboard();
  if(name==='catalog') renderAdminCatalog();
  if(name==='content') renderAdminContent();
  if(name==='banner') renderAdminBanner();
  if(name==='portfolio') renderAdminPortfolio();
  if(name==='reviews') renderAdminReviews();
  if(name==='promos') renderAdminPromos();
  if(name==='whatsapp') renderAdminWhatsapp();
  if(name==='orders') renderAdminOrders();
  if(name==='paylinks' && typeof renderAdminPayLinks === 'function') renderAdminPayLinks();
  if(name==='recus' && typeof renderAdminRecus === 'function') renderAdminRecus();
  if(name==='files') renderAdminFiles();
  if(name==='customers') renderAdminCustomers();
  if(name==='settings') renderAdminSettings();
}
/* =========================================================
   WHATSAPP MARKETING — envoi de messages WhatsApp en masse via
   Twilio, à des modèles déjà approuvés par WhatsApp (obligatoire :
   impossible d'envoyer un texte libre à quelqu'un qui ne vous a pas
   écrit dans les dernières 24h). Les identifiants Twilio restent
   toujours côté serveur (fonction Supabase), jamais dans ce fichier.
   ========================================================= */
const SEND_WHATSAPP_URL = "https://tkwrklboqspkzxtlvnzh.supabase.co/functions/v1/send-whatsapp";
let WA_SUBTAB = 'contacts';
let WA_MANUAL_CONTACTS = [];
let WA_CUSTOMER_CONTACTS = [];
let WA_TEMPLATES = [];
let WA_SELECTED = new Set();

async function renderAdminWhatsapp(){
  const el = document.getElementById('adminTab-whatsapp');
  if(!SUPABASE_ENABLED){
    el.innerHTML = `<div class="admin-note">⚠️ Nécessite que Supabase soit configuré.</div>`;
    return;
  }
  el.innerHTML = `<p class="card-sub">Chargement…</p>`;
  try{
    const { data: manual } = await db.from('whatsapp_contacts').select('*').order('name');
    WA_MANUAL_CONTACTS = manual || [];
    const { data: templates } = await db.from('whatsapp_templates').select('*').order('name');
    WA_TEMPLATES = templates || [];
    const orders = await getOrdersForAdmin();
    const seen = new Set();
    WA_CUSTOMER_CONTACTS = [];
    orders.forEach(o => {
      if(o.customerPhone && !seen.has(o.customerPhone)){
        seen.add(o.customerPhone);
        WA_CUSTOMER_CONTACTS.push({ name: o.customerName || 'Client', phone: o.customerPhone });
      }
    });
    renderAdminWhatsappShell();
  }catch(e){
    el.innerHTML = `<p class="card-sub">Erreur de chargement.</p>`;
    console.error(e);
  }
}
function renderAdminWhatsappShell(){
  const el = document.getElementById('adminTab-whatsapp');
  el.innerHTML = `
    <h3>WhatsApp marketing</h3>
    <div class="admin-note">
      WhatsApp interdit d'écrire librement à quelqu'un qui ne vous a pas contacté depuis moins de 24h — seuls des <strong>modèles de message déjà approuvés par WhatsApp</strong> peuvent être envoyés ici. Les modèles se créent et s'approuvent sur <a href="https://console.twilio.com/" target="_blank" rel="noopener">console.twilio.com</a> (Content Template Builder), puis s'enregistrent dans l'onglet "Modèles" ci-dessous.
    </div>
    <div style="display:flex; gap:6px; margin:12px 0; flex-wrap:wrap;">
      <button class="opt-btn ${WA_SUBTAB==='contacts'?'selected':''}" onclick="switchWaSubtab('contacts')">Contacts</button>
      <button class="opt-btn ${WA_SUBTAB==='templates'?'selected':''}" onclick="switchWaSubtab('templates')">Modèles</button>
      <button class="opt-btn ${WA_SUBTAB==='send'?'selected':''}" onclick="switchWaSubtab('send')">Envoyer</button>
      <button class="opt-btn ${WA_SUBTAB==='log'?'selected':''}" onclick="switchWaSubtab('log')">Historique</button>
    </div>
    <div id="waSubtabBody"></div>
  `;
  renderWaSubtabBody();
}
function switchWaSubtab(name){ WA_SUBTAB = name; renderAdminWhatsappShell(); }
function renderWaSubtabBody(){
  const body = document.getElementById('waSubtabBody');
  if(WA_SUBTAB === 'contacts') return renderWaContacts(body);
  if(WA_SUBTAB === 'templates') return renderWaTemplates(body);
  if(WA_SUBTAB === 'send') return renderWaSend(body);
  if(WA_SUBTAB === 'log') return renderWaLog(body);
}

/* ---- Contacts ---- */
function renderWaContacts(body){
  const allContacts = [...WA_CUSTOMER_CONTACTS.map(c=>({...c, source:'client'})), ...WA_MANUAL_CONTACTS.map(c=>({...c, source:'manuel'}))];
  body.innerHTML = `
    <div class="admin-note">${WA_SELECTED.size} contact${WA_SELECTED.size>1?'s':''} sélectionné${WA_SELECTED.size>1?'s':''} pour l'envoi.</div>
    <button class="btn btn-ghost" style="margin:8px 0;" onclick="waSelectAll()">Tout sélectionner</button>
    <button class="btn btn-ghost" style="margin:8px 0 8px 6px;" onclick="waSelectNone()">Tout désélectionner</button>
    <h4 style="margin-top:14px;">Ajouter un contact manuel</h4>
    <div class="form-field"><label>Nom</label><input type="text" id="waNewContactName" placeholder="Nom"></div>
    <div class="form-field"><label>Téléphone (format international, ex: +50934432139)</label><input type="text" id="waNewContactPhone" placeholder="+509..."></div>
    <button class="btn btn-primary" onclick="waAddContact()">+ Ajouter</button>
    <h4 style="margin-top:18px;">Tous les contacts (${allContacts.length})</h4>
    ${allContacts.length ? allContacts.map(c => `
      <label class="check-row">
        <input type="checkbox" class="wa-contact-cb" value="${escapeHtml(c.phone)}" data-phone="${escapeHtml(c.phone)}" ${WA_SELECTED.has(c.phone)?'checked':''} onchange="waToggleContact(this.dataset.phone, '', this.checked)">
        ${escapeHtml(c.name)} — ${escapeHtml(c.phone)} <span class="card-sub">(${c.source})</span>
        ${c.source==='manuel' ? `<button type="button" class="ci-remove" style="margin-left:8px;" onclick="event.preventDefault(); waDeleteContact(${c.id})">✕</button>` : ''}
      </label>
    `).join('') : '<p class="card-sub">Aucun contact pour le moment.</p>'}
  `;
}
function waToggleContact(phone, name, checked){
  if(checked) WA_SELECTED.add(phone); else WA_SELECTED.delete(phone);
  const noteEl = document.querySelector('#waSubtabBody .admin-note');
  if(noteEl) noteEl.textContent = `${WA_SELECTED.size} contact${WA_SELECTED.size>1?'s':''} sélectionné${WA_SELECTED.size>1?'s':''} pour l'envoi.`;
}
function waSelectAll(){
  [...WA_CUSTOMER_CONTACTS, ...WA_MANUAL_CONTACTS].forEach(c => WA_SELECTED.add(c.phone));
  renderWaContacts(document.getElementById('waSubtabBody'));
}
function waSelectNone(){ WA_SELECTED.clear(); renderWaContacts(document.getElementById('waSubtabBody')); }
async function waAddContact(){
  const name = document.getElementById('waNewContactName').value.trim();
  const phone = document.getElementById('waNewContactPhone').value.trim();
  if(!name || !phone){ showToast("Nom et téléphone requis"); return; }
  if(!phone.startsWith('+')){ showToast("Le téléphone doit commencer par + et l'indicatif pays (ex: +509)"); return; }
  try{
    const { error } = await db.from('whatsapp_contacts').insert({ name, phone });
    if(error) throw error;
    showToast("Contact ajouté");
    await renderAdminWhatsapp();
  }catch(e){
    showToast("Échec de l'ajout");
    console.error(e);
  }
}
async function waDeleteContact(id){
  try{
    await db.from('whatsapp_contacts').delete().eq('id', id);
    await renderAdminWhatsapp();
  }catch(e){ showToast("Échec de la suppression"); }
}

/* ---- Modèles ---- */
function renderWaTemplates(body){
  body.innerHTML = `
    <div class="admin-note">Le modèle doit déjà être <strong>approuvé</strong> sur Twilio avant de l'ajouter ici — copiez son identifiant "ContentSid" (commence par "HX...") depuis la console Twilio.</div>
    <div class="form-field"><label>Nom (repère interne)</label><input type="text" id="waTplName" placeholder="Ex : Promo du mois"></div>
    <div class="form-field"><label>ContentSid Twilio</label><input type="text" id="waTplSid" placeholder="HX..."></div>
    <div class="form-field"><label>Variables du modèle, dans l'ordre, séparées par des virgules</label><input type="text" id="waTplVars" placeholder="Ex : Nom, Offre, Date"></div>
    <button class="btn btn-primary" onclick="waAddTemplate()">+ Enregistrer ce modèle</button>
    <h4 style="margin-top:18px;">Modèles enregistrés</h4>
    ${WA_TEMPLATES.length ? WA_TEMPLATES.map(t => `
      <div class="admin-item-card">
        <div class="admin-item-summary" style="cursor:default;">
          <span>${escapeHtml(t.name)} <span class="item-code-tag">${escapeHtml(t.content_sid)}</span></span>
          <button class="ci-remove" onclick="waDeleteTemplate(${t.id})">✕</button>
        </div>
        <div style="padding:10px 14px;" class="card-sub">Variables : ${(t.variable_labels||[]).map((v,i)=>`{{${i+1}}} = ${escapeHtml(v)}`).join(', ') || 'aucune'}</div>
      </div>
    `).join('') : '<p class="card-sub">Aucun modèle enregistré.</p>'}
  `;
}
async function waAddTemplate(){
  const name = document.getElementById('waTplName').value.trim();
  const sid = document.getElementById('waTplSid').value.trim();
  const varsRaw = document.getElementById('waTplVars').value.trim();
  if(!name || !sid){ showToast("Nom et ContentSid requis"); return; }
  if(!sid.startsWith('HX')){ showToast("Le ContentSid Twilio commence toujours par \"HX\""); return; }
  const variable_labels = varsRaw ? varsRaw.split(',').map(s=>s.trim()).filter(Boolean) : [];
  try{
    const { error } = await db.from('whatsapp_templates').insert({ name, content_sid: sid, variable_labels });
    if(error) throw error;
    showToast("Modèle enregistré");
    await renderAdminWhatsapp();
  }catch(e){
    showToast("Échec — ce ContentSid est peut-être déjà enregistré");
    console.error(e);
  }
}
async function waDeleteTemplate(id){
  showConfirmModal("Retirer ce modèle de la liste ? (Ne le supprime pas de Twilio, juste d'ici.)", async () => {
    try{
      await db.from('whatsapp_templates').delete().eq('id', id);
      await renderAdminWhatsapp();
    }catch(e){ showToast("Échec de la suppression"); }
  });
}

/* ---- Envoyer ---- */
function renderWaSend(body){
  if(!WA_TEMPLATES.length){
    body.innerHTML = `<p class="card-sub">Enregistrez d'abord un modèle dans l'onglet "Modèles".</p>`;
    return;
  }
  if(!WA_SELECTED.size){
    body.innerHTML = `<p class="card-sub">Sélectionnez d'abord des contacts dans l'onglet "Contacts".</p>`;
    return;
  }
  body.innerHTML = `
    <div class="form-field"><label>Modèle</label>
      <select id="waSendTemplate" onchange="renderWaSendVariables()">
        ${WA_TEMPLATES.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
      </select>
    </div>
    <div id="waSendVariables"></div>
    <div class="admin-note" style="margin-top:10px;">Envoi à <strong>${WA_SELECTED.size}</strong> contact${WA_SELECTED.size>1?'s':''}. Chaque envoi a un coût réel chez Twilio.</div>
    <button class="btn btn-primary" id="waSendBtn" onclick="waSendCampaign()">Envoyer maintenant</button>
    <div id="waSendResult" style="margin-top:12px;"></div>
  `;
  renderWaSendVariables();
}
function renderWaSendVariables(){
  const tplId = Number(document.getElementById('waSendTemplate').value);
  const tpl = WA_TEMPLATES.find(t => t.id === tplId);
  const el = document.getElementById('waSendVariables');
  if(!tpl || !el) return;
  el.innerHTML = (tpl.variable_labels||[]).map((label, i) => `
    <div class="form-field">
      <label>{{${i+1}}} — ${escapeHtml(label)}</label>
      ${i===0 ? `
        <label class="check-row"><input type="checkbox" id="waVarUseName-${i+1}" checked onchange="document.getElementById('waVarShared-${i+1}').disabled = this.checked;"> Utiliser le nom de chaque contact automatiquement</label>
      ` : ''}
      <input type="text" id="waVarShared-${i+1}" placeholder="Valeur pour tous les destinataires" ${i===0?'disabled':''}>
    </div>
  `).join('') || '<p class="card-sub">Ce modèle n\'a aucune variable.</p>';
}
async function waSendCampaign(){
  const btn = document.getElementById('waSendBtn');
  const resultEl = document.getElementById('waSendResult');
  const tplId = Number(document.getElementById('waSendTemplate').value);
  const tpl = WA_TEMPLATES.find(t => t.id === tplId);
  if(!tpl) return;

  const allContacts = [...WA_CUSTOMER_CONTACTS, ...WA_MANUAL_CONTACTS];
  const recipients = [...WA_SELECTED].map(phone => {
    const contact = allContacts.find(c => c.phone === phone) || { name: '', phone };
    const variables = {};
    (tpl.variable_labels||[]).forEach((label, i) => {
      const idx = i + 1;
      const useName = i === 0 && document.getElementById(`waVarUseName-${idx}`)?.checked;
      variables[idx] = useName ? contact.name : (document.getElementById(`waVarShared-${idx}`)?.value || '');
    });
    return { name: contact.name, phone: contact.phone, variables };
  });

  btn.disabled = true; btn.textContent = 'Envoi en cours…';
  resultEl.innerHTML = `<p class="card-sub">Envoi à ${recipients.length} contacts, merci de patienter…</p>`;
  try{
    const { data: sessionData } = await db.auth.getSession();
    const token = sessionData?.session?.access_token;
    const resp = await fetch(SEND_WHATSAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ contentSid: tpl.content_sid, templateId: tpl.id, recipients })
    });
    const data = await resp.json();
    if(!data.status){
      resultEl.innerHTML = `<p class="card-sub">Échec : ${escapeHtml(data.message || 'erreur inconnue')}${data.message==='twilio_not_configured' ? ' — les identifiants Twilio ne sont pas encore configurés (voir Réglages).' : ''}</p>`;
    } else {
      resultEl.innerHTML = `<p class="card-sub">✅ ${data.sent} envoyé(s), ${data.failed} échec(s).</p>` +
        (data.failed ? '<ul class="admin-list">' + data.results.filter(r=>r.status==='failed').map(r=>`<li>${escapeHtml(r.phone)} — ${escapeHtml(r.error||'erreur')}</li>`).join('') + '</ul>' : '');
    }
  }catch(e){
    resultEl.innerHTML = `<p class="card-sub">Échec de l'envoi — réessayez.</p>`;
    console.error(e);
  }
  btn.disabled = false; btn.textContent = 'Envoyer maintenant';
}

/* ---- Historique ---- */
async function renderWaLog(body){
  body.innerHTML = `<p class="card-sub">Chargement…</p>`;
  try{
    const { data, error } = await db.from('whatsapp_sends').select('*').order('created_at', { ascending:false }).limit(100);
    if(error) throw error;
    body.innerHTML = (data||[]).length ? '<ul class="admin-list">' + data.map(s => `
      <li>${s.status==='sent'?'✅':'❌'} ${escapeHtml(s.recipient_name||'')} — ${escapeHtml(s.recipient_phone)} — ${new Date(s.created_at).toLocaleString('fr-FR')}${s.error_message ? ` — ${escapeHtml(s.error_message)}` : ''}</li>
    `).join('') + '</ul>' : '<p class="card-sub">Aucun envoi pour le moment.</p>';
  }catch(e){
    body.innerHTML = '<p class="card-sub">Erreur de chargement.</p>';
  }
}
/* ---- Avis (modération) ---- */
async function renderAdminReviews(){
  const el = document.getElementById('adminTab-reviews');
  if(!SUPABASE_ENABLED){
    el.innerHTML = `<div class="admin-note">⚠️ La modération des avis nécessite que Supabase soit configuré.</div>`;
    return;
  }
  el.innerHTML = `<p class="card-sub">Chargement…</p>`;
  try{
    const { data, error } = await db.from('reviews').select('*').order('created_at', { ascending:false });
    if(error) throw error;
    const pending = (data||[]).filter(r => !r.is_approved);
    const approved = (data||[]).filter(r => r.is_approved);
    const reviewRow = r => `
      <div class="admin-order-card" id="review-${r.id}">
        <div class="admin-order-head">
          <strong>${escapeHtml(r.customer_name)}</strong>
          <span class="mono">${new Date(r.created_at).toLocaleDateString('fr-FR')}</span>
        </div>
        ${r.rating ? `<div>${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)} ${r.catalog_item_id ? `<span class="item-code-tag">${escapeHtml(r.catalog_item_id)}</span>` : ''}</div>` : '<span class="item-code-tag">Commentaire général (accueil)</span>'}
        ${r.comment ? `<p style="margin:8px 0;">${escapeHtml(r.comment).replace(/\n/g,'<br>')}</p>` : ''}
        <div class="modal-actions">
          ${!r.is_approved ? `<button class="btn btn-primary" onclick="adminSetReviewApproval(${r.id}, true)">Approuver</button>` : `<button class="btn btn-ghost" onclick="adminSetReviewApproval(${r.id}, false)">Masquer</button>`}
          <button class="btn btn-ghost" onclick="adminDeleteReview(${r.id})">Supprimer</button>
        </div>
      </div>
    `;
    el.innerHTML = `
      <div class="admin-note">Un avis n'apparaît publiquement qu'une fois approuvé ici.</div>
      <h3 style="margin-top:0;">En attente (${pending.length})</h3>
      ${pending.length ? pending.map(reviewRow).join('') : '<p class="card-sub">Aucun avis en attente.</p>'}
      <h3>Approuvés (${approved.length})</h3>
      ${approved.length ? approved.map(reviewRow).join('') : '<p class="card-sub">Aucun avis approuvé pour le moment.</p>'}
    `;
  }catch(e){
    el.innerHTML = `<div class="admin-note">Échec du chargement des avis.</div>`;
    console.error(e);
  }
}
async function adminSetReviewApproval(id, approve){
  try{
    const { error } = await db.from('reviews').update({ is_approved: approve }).eq('id', id);
    if(error) throw error;
    showToast(approve ? "Avis approuvé" : "Avis masqué");
    renderAdminReviews();
  }catch(e){
    showToast("Échec de la mise à jour");
    console.error(e);
  }
}
async function adminDeleteReview(id){
  showConfirmModal("Supprimer définitivement cet avis ?", async () => {
    try{
      const { error } = await db.from('reviews').delete().eq('id', id);
      if(error) throw error;
      const el = document.getElementById('review-'+id);
      if(el) el.remove();
      showToast("Avis supprimé");
    }catch(e){
      showToast("Échec de la suppression");
      console.error(e);
    }
  });
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
      const compressed = await compressImageBlob(desktopFile).catch(()=>desktopFile);
      const path = `${id}-desktop-${Date.now()}.jpg`;
      const { error } = await db.storage.from('hero-slides').upload(path, compressed, { upsert:true, contentType:'image/jpeg' });
      if(error) throw error;
      slide.image_url = db.storage.from('hero-slides').getPublicUrl(path).data.publicUrl;
    }
    if(mobileFile){
      const compressed = await compressImageBlob(mobileFile).catch(()=>mobileFile);
      const path = `${id}-mobile-${Date.now()}.jpg`;
      const { error } = await db.storage.from('hero-slides').upload(path, compressed, { upsert:true, contentType:'image/jpeg' });
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
  showConfirmModal("Supprimer définitivement ce slide ?", async () => {
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
  });
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

/* ---- Fichiers reçus (toutes commandes confondues) ---- */
async function renderAdminFiles(){
  const el = document.getElementById('adminTab-files');
  if(!SUPABASE_ENABLED){
    el.innerHTML = `<div class="admin-note">⚠️ Cette page nécessite que Supabase soit configuré.</div>`;
    return;
  }
  el.innerHTML = `<p class="card-sub">Chargement…</p>`;
  try{
    const { data, error } = await db.from('order_uploads')
      .select('*, orders(code, customer_name, customer_phone, created_at)')
      .order('created_at', { ascending:false });
    if(error) throw error;
    if(!data || data.length === 0){
      el.innerHTML = `<div class="admin-note">Les fichiers envoyés par vos clients lors d'une commande (logo, photo, design…) apparaîtront ici.</div><p class="card-sub">Aucun fichier pour le moment.</p>`;
      return;
    }
    const cards = [];
    for(const f of data){
      let url = null;
      try{
        // Lien valable 10 ans — autant dire permanent, tout en gardant
        // le fichier hors d'accès public direct (bucket privé).
        const { data: signed, error: signErr } = await db.storage.from('order-uploads').createSignedUrl(f.storage_path, 60*60*24*365*10);
        if(!signErr) url = signed.signedUrl;
      }catch(e){ console.warn(e); }
      const order = f.orders || {};
      cards.push(`
        <div class="admin-order-card" id="upload-${f.id}">
          <div class="admin-order-head">
            <strong>${escapeHtml(order.customer_name) || 'Client'}</strong>
            <span class="mono">${new Date(f.created_at).toLocaleString('fr-FR')}</span>
          </div>
          ${order.code ? `<div class="item-code-tag" style="margin:4px 0;">${escapeHtml(order.code)}</div>` : ''}
          <div class="card-sub">${escapeHtml(order.customer_phone)}</div>
          <div style="margin-top:8px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            ${url ? `<a href="${url}" target="_blank" rel="noopener">📎 ${escapeHtml(f.original_filename) || 'Fichier'}</a>` : `<span class="card-sub">Lien indisponible</span>`}
            <span class="card-sub">${Math.round((f.size_bytes||0)/1024)} Ko</span>
            <button class="btn btn-ghost" style="margin-left:auto; padding:6px 12px; font-size:.8rem;" data-path="${escapeHtml(f.storage_path||'')}" onclick="adminDeleteUpload(${Number(f.id)}, this.dataset.path)">Supprimer</button>
          </div>
        </div>
      `);
    }
    el.innerHTML = `
      <div class="admin-note">Tous les fichiers envoyés par vos clients, du plus récent au plus ancien. Les liens n'expirent pas.</div>
      ${cards.join('')}
    `;
  }catch(e){
    el.innerHTML = `<div class="admin-note">Échec du chargement des fichiers.</div>`;
    console.error(e);
  }
}
async function adminDeleteUpload(id, storagePath){
  showConfirmModal("Supprimer définitivement ce fichier ?", async () => {
    try{
      const { error: storageErr } = await db.storage.from('order-uploads').remove([storagePath]);
      if(storageErr) console.warn('storage remove failed:', storageErr);
      const { error } = await db.from('order_uploads').delete().eq('id', id);
      if(error) throw error;
      const card = document.getElementById('upload-'+id);
      if(card) card.remove();
      showToast("Fichier supprimé");
    }catch(e){
      showToast("Échec de la suppression");
      console.error(e);
    }
  });
}

/* ---- Portfolio (réalisations) ---- */
let ADMIN_PORTFOLIO = [];
async function renderAdminPortfolio(){
  const el = document.getElementById('adminTab-portfolio');
  if(!SUPABASE_ENABLED){
    el.innerHTML = `<div class="admin-note">⚠️ Le portfolio nécessite que Supabase soit configuré.</div>`;
    return;
  }
  el.innerHTML = `<p class="card-sub">Chargement…</p>`;
  try{
    const { data, error } = await db.from('portfolio_items').select('*').order('display_order', { ascending:true });
    if(error) throw error;
    ADMIN_PORTFOLIO = data || [];
  }catch(e){
    el.innerHTML = `<div class="admin-note">Échec du chargement du portfolio.</div>`;
    console.error(e);
    return;
  }
  el.innerHTML = `
    <div class="admin-note">Ces réalisations s'affichent sur la page publique "Portfolio", uniquement celles activées.</div>
    <div id="adminPortfolioList"></div>
    <button class="btn btn-ghost" onclick="adminAddPortfolioItem()">+ Ajouter une réalisation</button>
  `;
  renderAdminPortfolioList();
}
function renderAdminPortfolioList(){
  const container = document.getElementById('adminPortfolioList');
  if(!container) return;
  container.innerHTML = ADMIN_PORTFOLIO.map((p, idx) => `
    <div class="admin-item-row" id="adminportfolio-${p.id}">
      <div class="admin-item-summary" onclick="toggleAdminPortfolioEdit(${p.id})">
        <span>${p.title || '(sans titre)'} ${!p.is_active ? '<span class="stock-flag" style="position:static;">Désactivé</span>' : ''}</span>
        <div style="display:flex; gap:4px; margin-left:auto;">
          <button class="qty-btn" onclick="event.stopPropagation(); adminMovePortfolioItem(${idx}, -1)" ${idx===0?'disabled':''} aria-label="Monter">↑</button>
          <button class="qty-btn" onclick="event.stopPropagation(); adminMovePortfolioItem(${idx}, 1)" ${idx===ADMIN_PORTFOLIO.length-1?'disabled':''} aria-label="Descendre">↓</button>
        </div>
      </div>
      <div class="admin-item-edit" id="adminportfolioedit-${p.id}" style="display:none;">
        <div class="form-field"><label>Titre</label><input type="text" id="pf-title-${p.id}" value="${(p.title||'').replace(/"/g,'&quot;')}"></div>
        <div class="form-field"><label>Catégorie (ex : Branding, Web Design, Impression…)</label><input type="text" id="pf-category-${p.id}" value="${(p.category||'').replace(/"/g,'&quot;')}"></div>
        <div class="form-field"><label>Client (optionnel)</label><input type="text" id="pf-client-${p.id}" value="${(p.client_name||'').replace(/"/g,'&quot;')}"></div>
        <div class="form-field"><label>Description</label><input type="text" id="pf-desc-${p.id}" value="${(p.description||'').replace(/"/g,'&quot;')}"></div>
        <div class="form-field"><label>Lien du projet (optionnel)</label><input type="text" id="pf-url-${p.id}" value="${(p.project_url||'').replace(/"/g,'&quot;')}" placeholder="https://…"></div>
        <div class="form-field">
          <label>Photos (jusqu'à 3)</label>
          <div class="admin-image-row">
            ${[0,1,2].map(slot => `
              <div class="admin-image-slot">
                <div class="admin-image-preview" id="pf-imgpreview-${p.id}-${slot}">${(p.image_urls && p.image_urls[slot]) ? `<img src="${p.image_urls[slot]}" alt="">` : '<span>Pas de photo</span>'}</div>
                <input type="file" accept="image/*" id="pf-image-${p.id}-${slot}" onchange="previewAdminPortfolioImage(${p.id}, ${slot})">
              </div>
            `).join('')}
          </div>
        </div>
        <label class="check-row"><input type="checkbox" id="pf-active-${p.id}" ${p.is_active?'checked':''}> Visible sur le site</label>
        <div class="modal-actions">
          <button class="btn btn-primary" id="pfsave-${p.id}" onclick="adminSavePortfolioItem(${p.id})">Enregistrer</button>
          <button class="btn btn-ghost" onclick="adminDeletePortfolioItem(${p.id})">Supprimer</button>
        </div>
      </div>
    </div>
  `).join('') || '<p class="card-sub">Aucune réalisation pour le moment.</p>';
}
function toggleAdminPortfolioEdit(id){
  const el = document.getElementById('adminportfolioedit-'+id);
  el.style.display = (el.style.display === 'none') ? 'block' : 'none';
}
function previewAdminPortfolioImage(id, slot){
  const input = document.getElementById(`pf-image-${id}-${slot}`);
  const preview = document.getElementById(`pf-imgpreview-${id}-${slot}`);
  const file = input.files && input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => { preview.innerHTML = `<img src="${e.target.result}" alt="">`; };
  reader.readAsDataURL(file);
}
async function adminMovePortfolioItem(idx, dir){
  const otherIdx = idx + dir;
  if(otherIdx < 0 || otherIdx >= ADMIN_PORTFOLIO.length) return;
  const a = ADMIN_PORTFOLIO[idx], b = ADMIN_PORTFOLIO[otherIdx];
  const aOrder = a.display_order, bOrder = b.display_order;
  a.display_order = bOrder; b.display_order = aOrder;
  [ADMIN_PORTFOLIO[idx], ADMIN_PORTFOLIO[otherIdx]] = [ADMIN_PORTFOLIO[otherIdx], ADMIN_PORTFOLIO[idx]];
  renderAdminPortfolioList();
  try{
    await db.from('portfolio_items').update({ display_order: a.display_order }).eq('id', a.id);
    await db.from('portfolio_items').update({ display_order: b.display_order }).eq('id', b.id);
  }catch(e){ console.error(e); }
}
async function adminSavePortfolioItem(id){
  const p = ADMIN_PORTFOLIO.find(x => x.id === id);
  if(!p) return;
  const btn = document.getElementById('pfsave-'+id);
  if(btn){ btn.disabled = true; btn.textContent = 'Enregistrement…'; }
  try{
    const imageUrls = p.image_urls ? [...p.image_urls] : [];
    for(const slot of [0,1,2]){
      const fileInput = document.getElementById(`pf-image-${id}-${slot}`);
      const file = fileInput && fileInput.files && fileInput.files[0];
      if(file){
        const compressed = await compressImageBlob(file).catch(()=>file);
        const path = `${id}-${slot}-${Date.now()}.jpg`;
        const { error: upErr } = await db.storage.from('portfolio-images').upload(path, compressed, { upsert:true, contentType:'image/jpeg' });
        if(upErr) throw upErr;
        imageUrls[slot] = db.storage.from('portfolio-images').getPublicUrl(path).data.publicUrl;
      }
    }
    const payload = {
      title: document.getElementById('pf-title-'+id).value.trim(),
      category: document.getElementById('pf-category-'+id).value.trim() || null,
      client_name: document.getElementById('pf-client-'+id).value.trim() || null,
      description: document.getElementById('pf-desc-'+id).value.trim() || null,
      project_url: document.getElementById('pf-url-'+id).value.trim() || null,
      image_urls: imageUrls.filter(Boolean),
      is_active: document.getElementById('pf-active-'+id).checked,
      updated_at: new Date().toISOString()
    };
    const { error } = await db.from('portfolio_items').update(payload).eq('id', id);
    if(error) throw error;
    Object.assign(p, payload);
    showToast("Réalisation enregistrée");
  }catch(e){
    showToast("Échec de l'enregistrement");
    console.error(e);
  }
  if(btn){ btn.disabled = false; btn.textContent = 'Enregistrer'; }
  renderAdminPortfolioList();
}
async function adminDeletePortfolioItem(id){
  showConfirmModal("Supprimer définitivement cette réalisation ?", async () => {
    try{
      const { error } = await db.from('portfolio_items').delete().eq('id', id);
      if(error) throw error;
      ADMIN_PORTFOLIO = ADMIN_PORTFOLIO.filter(p => p.id !== id);
      renderAdminPortfolioList();
      showToast("Réalisation supprimée");
    }catch(e){
      showToast("Échec de la suppression");
      console.error(e);
    }
  });
}
async function adminAddPortfolioItem(){
  try{
    const maxOrder = ADMIN_PORTFOLIO.reduce((m,p)=>Math.max(m,p.display_order||0), 0);
    const { data, error } = await db.from('portfolio_items').insert({
      title: 'Nouvelle réalisation', display_order: maxOrder + 1, is_active: false, image_urls: []
    }).select().single();
    if(error) throw error;
    ADMIN_PORTFOLIO.push(data);
    renderAdminPortfolioList();
    setTimeout(()=> toggleAdminPortfolioEdit(data.id), 50);
  }catch(e){
    showToast("Échec de la création");
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
            <strong>${escapeHtml(c.latest_name) || 'Client'}</strong>
            <span class="mono">${c.order_count} commande${c.order_count>1?'s':''}</span>
          </div>
          <div class="card-sub">${escapeHtml(c.phone)}${c.latest_address ? ' · ' + escapeHtml(c.latest_address) : ''}</div>
          <div class="cart-total-row"><span>Total dépensé</span><span class="amt">${formatHTG(Number(c.total_spent||0))}</span></div>
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
  const p = PAGE_CONTENT;
  const note = SUPABASE_ENABLED
    ? "Ces textes sont enregistrés dans Supabase et visibles immédiatement par tous vos visiteurs."
    : "⚠️ Supabase n'est pas configuré : ces textes restent enregistrés uniquement sur cet appareil/navigateur.";
  const esc = v => (v||'').replace(/"/g,'&quot;');
  document.getElementById('adminTab-content').innerHTML = `
    <div class="admin-note">${note}</div>

    <h3 style="margin-top:0;">Page d'accueil</h3>
    <div class="form-field"><label>Titre principal</label><input type="text" id="c-hero-title" value="${esc(c.hero_title)}"></div>
    <div class="form-field"><label>Sous-titre</label><input type="text" id="c-hero-subtitle" value="${esc(c.hero_subtitle)}"></div>
    <div class="form-field"><label>Texte "À propos"</label><input type="text" id="c-about" value="${esc(c.about_text)}"></div>

    <h3>Coordonnées</h3>
    <div class="form-field"><label>Adresse 1</label><input type="text" id="c-addr1" value="${esc(c.address_1)}"></div>
    <div class="form-field"><label>Adresse 2</label><input type="text" id="c-addr2" value="${esc(c.address_2)}"></div>
    <div class="form-field"><label>NIF</label><input type="text" id="c-nif" value="${esc(c.nif)}"></div>
    <div class="form-field"><label>Email de contact</label><input type="text" id="c-email" value="${esc(c.email)}"></div>
    <div class="form-field"><label>Téléphone(s) affichés</label><input type="text" id="c-phone" value="${esc(c.phone_display)}"></div>

    <h3>Pied de page</h3>
    <div class="form-field"><label>Slogan (sous le logo)</label><input type="text" id="c-tagline" value="${esc(c.footer_tagline)}"></div>

    <h3>Réseaux sociaux</h3>
    <div class="form-field"><label>Facebook (lien complet)</label><input type="text" id="c-facebook" value="${esc(c.social_facebook)}"></div>
    <div class="form-field"><label>Instagram (lien complet)</label><input type="text" id="c-instagram" value="${esc(c.social_instagram)}"></div>
    <div class="form-field"><label>TikTok (lien complet)</label><input type="text" id="c-tiktok" value="${esc(c.social_tiktok)}"></div>
    <div class="form-field"><label>Numéro WhatsApp (format international, sans le +)</label><input type="text" id="c-whatsapp" value="${esc(c.social_whatsapp_number)}"></div>

    <h3>Page Boutique</h3>
    <div class="form-field"><label>Titre</label><input type="text" id="p-boutique-title" value="${esc(p.boutique_title)}"></div>
    <div class="form-field"><label>Texte d'introduction (optionnel)</label><input type="text" id="p-boutique-intro" value="${esc(p.boutique_intro)}"></div>

    <h3>Page Services</h3>
    <div class="form-field"><label>Titre</label><input type="text" id="p-services-title" value="${esc(p.services_title)}"></div>
    <div class="form-field"><label>Texte d'introduction (optionnel)</label><input type="text" id="p-services-intro" value="${esc(p.services_intro)}"></div>

    <h3>Page Portfolio</h3>
    <div class="form-field"><label>Titre</label><input type="text" id="p-portfolio-title" value="${esc(p.portfolio_title)}"></div>
    <div class="form-field"><label>Texte d'introduction (optionnel)</label><input type="text" id="p-portfolio-intro" value="${esc(p.portfolio_intro)}"></div>

    <h3>Page FAQ</h3>
    <div class="form-field"><label>Titre</label><input type="text" id="p-faq-title" value="${esc(p.faq_title)}"></div>
    <div class="form-field"><label>Texte d'introduction (optionnel)</label><input type="text" id="p-faq-intro" value="${esc(p.faq_intro)}"></div>
    <div id="faqAdminList"></div>
    <button class="btn btn-ghost" type="button" onclick="adminAddFaqItem()">+ Ajouter une question</button>

    <h3>Politique de confidentialité</h3>
    <div class="form-field"><label>Titre</label><input type="text" id="p-conf-title" value="${esc(p.confidentialite_title)}"></div>
    <div class="form-field">
      <label>Contenu — une ligne vide sépare les paragraphes ; faites précéder un titre de section par "## "</label>
      <textarea id="p-conf-content" rows="8" style="width:100%; padding:11px 12px; border-radius:10px; border:1px solid var(--line); background:var(--surface2); color:var(--text); font-family:inherit; font-size:.9rem;">${(p.confidentialite_content||'')}</textarea>
    </div>

    <h3>Conditions générales</h3>
    <div class="form-field"><label>Titre</label><input type="text" id="p-cond-title" value="${esc(p.conditions_title)}"></div>
    <div class="form-field">
      <label>Contenu</label>
      <textarea id="p-cond-content" rows="8" style="width:100%; padding:11px 12px; border-radius:10px; border:1px solid var(--line); background:var(--surface2); color:var(--text); font-family:inherit; font-size:.9rem;">${(p.conditions_content||'')}</textarea>
    </div>

    <h3>Livraison &amp; retours</h3>
    <div class="form-field"><label>Titre</label><input type="text" id="p-livr-title" value="${esc(p.livraison_title)}"></div>
    <div class="form-field">
      <label>Contenu</label>
      <textarea id="p-livr-content" rows="8" style="width:100%; padding:11px 12px; border-radius:10px; border:1px solid var(--line); background:var(--surface2); color:var(--text); font-family:inherit; font-size:.9rem;">${(p.livraison_content||'')}</textarea>
    </div>

    <h3>Page Suivre ma commande</h3>
    <div class="form-field"><label>Titre</label><input type="text" id="p-suivi-title" value="${esc(p.suivi_title)}"></div>
    <div class="form-field"><label>Texte d'introduction</label><input type="text" id="p-suivi-intro" value="${esc(p.suivi_intro)}"></div>

    <button class="btn btn-primary" id="save-content-btn" onclick="adminSaveContent()" style="margin-top:10px;">Enregistrer tout le contenu</button>
  `;
  renderAdminFaqList();
}

/* ---- Éditeur de FAQ (liste dynamique) ---- */
let ADMIN_FAQ_DRAFT = null;
function renderAdminFaqList(){
  if(!ADMIN_FAQ_DRAFT) ADMIN_FAQ_DRAFT = JSON.parse(JSON.stringify(PAGE_CONTENT.faq_items || []));
  const container = document.getElementById('faqAdminList');
  if(!container) return;
  container.innerHTML = ADMIN_FAQ_DRAFT.map((item, i) => `
    <div class="admin-item-row">
      <div class="admin-item-edit" style="display:block;">
        <div class="form-field"><label>Question ${i+1}</label><input type="text" value="${(item.question||'').replace(/"/g,'&quot;')}" oninput="ADMIN_FAQ_DRAFT[${i}].question = this.value"></div>
        <div class="form-field"><label>Réponse</label><input type="text" value="${(item.answer||'').replace(/"/g,'&quot;')}" oninput="ADMIN_FAQ_DRAFT[${i}].answer = this.value"></div>
        <button class="btn btn-ghost" type="button" onclick="adminRemoveFaqItem(${i})">Supprimer cette question</button>
      </div>
    </div>
  `).join('') || '<p class="card-sub">Aucune question pour le moment.</p>';
}
function adminAddFaqItem(){
  if(!ADMIN_FAQ_DRAFT) ADMIN_FAQ_DRAFT = JSON.parse(JSON.stringify(PAGE_CONTENT.faq_items || []));
  ADMIN_FAQ_DRAFT.push({ question:"Nouvelle question", answer:"Réponse à compléter." });
  renderAdminFaqList();
}
function adminRemoveFaqItem(i){
  ADMIN_FAQ_DRAFT.splice(i, 1);
  renderAdminFaqList();
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
  PAGE_CONTENT = {
    ...PAGE_CONTENT,
    boutique_title: val('p-boutique-title'),
    boutique_intro: val('p-boutique-intro'),
    services_title: val('p-services-title'),
    services_intro: val('p-services-intro'),
    portfolio_title: val('p-portfolio-title'),
    portfolio_intro: val('p-portfolio-intro'),
    faq_title: val('p-faq-title'),
    faq_intro: val('p-faq-intro'),
    faq_items: ADMIN_FAQ_DRAFT || PAGE_CONTENT.faq_items,
    confidentialite_title: val('p-conf-title'),
    confidentialite_content: document.getElementById('p-conf-content').value.trim(),
    conditions_title: val('p-cond-title'),
    conditions_content: document.getElementById('p-cond-content').value.trim(),
    livraison_title: val('p-livr-title'),
    livraison_content: document.getElementById('p-livr-content').value.trim(),
    suivi_title: val('p-suivi-title'),
    suivi_intro: val('p-suivi-intro')
  };

  if(SUPABASE_ENABLED){
    const btn = document.getElementById('save-content-btn');
    if(btn){ btn.disabled = true; btn.textContent = 'Enregistrement…'; }
    try{
      const { error } = await db.from('site_content').upsert({ id: 1, ...SITE_CONTENT });
      if(error) throw error;

      const pageContentRows = Object.keys(PAGE_CONTENT).map(key => ({
        key,
        value: key === 'faq_items' ? JSON.stringify(PAGE_CONTENT.faq_items) : PAGE_CONTENT[key]
      }));
      const { error: pcError } = await db.from('page_content').upsert(pageContentRows);
      if(pcError) throw pcError;
    }catch(e){
      showToast("Échec de l'enregistrement Supabase — vérifiez votre connexion.");
      console.error(e);
    }
    if(btn){ btn.disabled = false; btn.textContent = 'Enregistrer tout le contenu'; }
  }
  saveSiteContentLocal();
  savePageContentLocal();
  applySiteContent();
  applyPageContent();
  showToast("Contenu enregistré");
}

/* ---- Tableau de bord ---- */
let ADMIN_DASHBOARD_PERIOD = '30j';
let ADMIN_DASHBOARD_CUSTOM_FROM = '';
let ADMIN_DASHBOARD_CUSTOM_TO = '';
let ADMIN_DASHBOARD_ORDERS_CACHE = [];
let ADMIN_DASHBOARD_PAGEVIEWS_CACHE = [];

async function renderAdminDashboard(){
  const el = document.getElementById('adminTab-dashboard');
  el.innerHTML = `<p class="card-sub">Chargement…</p>`;
  ADMIN_DASHBOARD_ORDERS_CACHE = await getOrdersForAdmin();
  ADMIN_DASHBOARD_PAGEVIEWS_CACHE = await getPageViewsForAdmin();
  renderDashboardContent();
}
async function getPageViewsForAdmin(){
  if(!SUPABASE_ENABLED) return [];
  try{
    const { data, error } = await db.from('page_views').select('page, item_id, created_at').order('created_at', { ascending:false }).limit(20000);
    if(error) throw error;
    return (data||[]).map(r => ({ page: r.page, itemId: r.item_id, date: new Date(r.created_at).getTime() }));
  }catch(e){
    console.warn('page_views fetch failed:', e);
    return [];
  }
}
function getDashboardDateRange(){
  const now = new Date();
  let from = null, to = null;
  if(ADMIN_DASHBOARD_PERIOD === 'today'){
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  } else if(ADMIN_DASHBOARD_PERIOD === '7j'){
    from = now.getTime() - 7*24*60*60*1000;
  } else if(ADMIN_DASHBOARD_PERIOD === '30j'){
    from = now.getTime() - 30*24*60*60*1000;
  } else if(ADMIN_DASHBOARD_PERIOD === 'mois'){
    from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  } else if(ADMIN_DASHBOARD_PERIOD === 'custom'){
    from = ADMIN_DASHBOARD_CUSTOM_FROM ? new Date(ADMIN_DASHBOARD_CUSTOM_FROM).getTime() : null;
    to = ADMIN_DASHBOARD_CUSTOM_TO ? new Date(ADMIN_DASHBOARD_CUSTOM_TO + 'T23:59:59').getTime() : null;
  }
  return { from, to };
}
function getFilteredDashboardOrders(){
  const orders = ADMIN_DASHBOARD_ORDERS_CACHE || [];
  const { from, to } = getDashboardDateRange();
  return orders.filter(o => (from == null || o.date >= from) && (to == null || o.date <= to));
}
function getFilteredDashboardPageViews(){
  const views = ADMIN_DASHBOARD_PAGEVIEWS_CACHE || [];
  const { from, to } = getDashboardDateRange();
  return views.filter(v => (from == null || v.date >= from) && (to == null || v.date <= to));
}
function setDashboardPeriod(period){
  ADMIN_DASHBOARD_PERIOD = period;
  renderDashboardContent();
}
function setDashboardCustomRange(){
  ADMIN_DASHBOARD_PERIOD = 'custom';
  ADMIN_DASHBOARD_CUSTOM_FROM = document.getElementById('dashFrom').value;
  ADMIN_DASHBOARD_CUSTOM_TO = document.getElementById('dashTo').value;
  renderDashboardContent();
}
/* ---- Tableau de bord (design « cartes » : chiffres clés, graphiques) ---- */
const DASH_ICONS = {
  cash:'<path d="M3 7h18v10H3z"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/>',
  orders:'<path d="M6 2h12l2 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z"/><path d="M4 6h16"/><path d="M9 11h6M9 15h6"/>',
  visits:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  items:'<path d="M21 8 12 3 3 8l9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'
};
function dashIcon(k){ return `<span class="dash-ico"><svg viewBox="0 0 24 24" aria-hidden="true">${DASH_ICONS[k]}</svg></span>`; }
function dashPrevRange(){
  const { from, to } = getDashboardDateRange();
  if(from == null) return null;
  const end = to != null ? to : Date.now();
  const len = Math.max(1, end - from);
  return { from: from - len, to: from - 1 };
}
function dashTrend(cur, prev){
  if(prev == null) return '';
  if(!prev && !cur) return '';
  if(!prev) return `<span class="dash-badge up">Nouveau</span>`;
  const pct = (cur - prev) / prev * 100;
  const txt = (pct >= 0 ? '+' : '') + pct.toFixed(1).replace('.', ',') + ' %';
  return `<span class="dash-badge ${pct >= 0 ? 'up' : 'down'}">${txt}</span>`;
}
function dashShort(n){
  n = Number(n) || 0;
  if(n >= 1e6) return (n/1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' M';
  if(n >= 1e3) return Math.round(n/1e3) + ' k';
  return String(Math.round(n));
}
function dashKpi(k, label, value, sub, trend, highlight){
  return `<div class="dash-kpi ${highlight ? 'hl' : ''}">
    <div class="dash-kpi-top">${dashIcon(k)}${trend}</div>
    <div class="dash-kpi-label">${label}</div>
    <div class="dash-kpi-row"><span class="dash-kpi-val">${value}</span>${sub ? `<span class="dash-kpi-sub">${sub}</span>` : ''}</div>
  </div>`;
}
// Barres : 7 derniers mois — total commandé (gris) et encaissé (couleur)
function dashBarsHTML(allOrders){
  const now = new Date();
  const months = [];
  for(let i = 6; i >= 0; i--){
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleDateString('fr-FR', { month:'short' }).replace('.', ''), ordered: 0, cashed: 0, count: 0 });
  }
  allOrders.forEach(o => {
    const d = new Date(o.date);
    const mo = months.find(x => x.y === d.getFullYear() && x.m === d.getMonth());
    if(!mo) return;
    mo.ordered += o.total || 0; mo.count++;
    if(o.paymentRecord && o.paymentRecord.status === 'Confirmé') mo.cashed += o.total || 0;
  });
  const max = Math.max(1, ...months.map(x => x.ordered));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const ticks = [0, .25, .5, .75, 1].map(f => top * f);
  const H = 180;
  return `
    <div class="dash-bars" role="img" aria-label="Commandes et encaissements des 7 derniers mois">
      <div class="dash-bars-y">${ticks.slice().reverse().map(t => `<span>${dashShort(t)}</span>`).join('')}</div>
      <div class="dash-bars-plot">
        ${ticks.map((t, i) => `<div class="dash-grid" style="bottom:${i*25}%"></div>`).join('')}
        <div class="dash-bars-cols">
          ${months.map((mo, i) => `
            <button class="dash-col" onclick="dashShowBar(this)" data-label="${mo.label} ${mo.y}" data-ordered="${formatHTG(mo.ordered)}" data-cashed="${formatHTG(mo.cashed)}" data-count="${mo.count}">
              <span class="dash-bar gray" style="height:${Math.max(2, mo.ordered / top * H)}px"></span>
              <span class="dash-bar main" style="height:${Math.max(2, mo.cashed / top * H)}px"></span>
            </button>`).join('')}
        </div>
        <div class="dash-tip" id="dashTip" hidden></div>
      </div>
    </div>
    <div class="dash-bars-x">${months.map(mo => `<span>${mo.label}</span>`).join('')}</div>`;
}
function dashShowBar(btn){
  const tip = document.getElementById('dashTip');
  if(!tip) return;
  document.querySelectorAll('.dash-col.on').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  tip.innerHTML = `<strong>${escapeHtml(btn.dataset.label)}</strong>
    <div><i class="dot gray"></i>${escapeHtml(btn.dataset.ordered)} commandés (${escapeHtml(btn.dataset.count)})</div>
    <div><i class="dot main"></i>${escapeHtml(btn.dataset.cashed)} encaissés</div>`;
  tip.hidden = false;
  const plot = btn.closest('.dash-bars-plot');
  const r = btn.getBoundingClientRect(), pr = plot.getBoundingClientRect();
  let left = r.left - pr.left + r.width/2 - tip.offsetWidth/2;
  left = Math.max(0, Math.min(left, pr.width - tip.offsetWidth));
  tip.style.left = left + 'px';
}
// Anneaux : répartition des commandes (produits / services / mixtes)
function dashRingsHTML(orders){
  const kinds = [
    { key:'PRC', label:'Produits', color:'var(--dash-main)' },
    { key:'SRC', label:'Services', color:'var(--dash-accent)' },
    { key:'ORC', label:'Mixtes', color:'#A9B1C6' }
  ];
  kinds.forEach(k => { k.count = orders.filter(o => String(o.code || '').startsWith('JC-' + k.key)).length; k.amount = orders.filter(o => String(o.code || '').startsWith('JC-' + k.key)).reduce((s,o) => s + (o.total||0), 0); });
  const total = orders.length;
  const max = Math.max(1, ...kinds.map(k => k.count));
  const R = [86, 66, 46];
  const arcs = kinds.map((k, i) => {
    const r = R[i], c = 2 * Math.PI * r, full = c * 0.75;
    const len = full * (k.count / max);
    return `<circle cx="100" cy="100" r="${r}" fill="none" stroke="#E7E9F2" stroke-width="13" stroke-linecap="round" stroke-dasharray="${full} ${c}" transform="rotate(135 100 100)"/>
            ${k.count ? `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${k.color}" stroke-width="13" stroke-linecap="round" stroke-dasharray="${len} ${c}" transform="rotate(135 100 100)"/>` : ''}`;
  }).join('');
  return `
    <div class="dash-rings">
      <svg viewBox="0 0 200 200" role="img" aria-label="Répartition des commandes">${arcs}</svg>
      <div class="dash-rings-center"><strong>${total}</strong><span>commande${total>1?'s':''}</span></div>
    </div>
    <ul class="dash-legend">
      ${kinds.map(k => `<li><i class="dot" style="background:${k.color}"></i><span>${k.label}</span><strong>${k.count}</strong><span class="dash-badge neutral">${total ? Math.round(k.count / total * 100) : 0} %</span></li>`).join('')}
    </ul>`;
}
function dashTopListHTML(rows, emptyText, unit){
  if(!rows.length) return `<p class="card-sub">${emptyText}</p>`;
  const max = Math.max(...rows.map(r => r[1]));
  return `<ul class="dash-top">${rows.map(([name, n]) => `
    <li><div class="dash-top-row"><span>${escapeHtml(name)}</span><strong>${n}${unit ? ' ' + unit : ''}</strong></div>
    <div class="dash-meter"><span style="width:${Math.max(4, n / max * 100)}%"></span></div></li>`).join('')}</ul>`;
}

function renderDashboardContent(){
  const el = document.getElementById('adminTab-dashboard');
  const all = ADMIN_DASHBOARD_ORDERS_CACHE || [];
  const orders = getFilteredDashboardOrders();
  const isPaid = o => o.paymentRecord && o.paymentRecord.status === 'Confirmé';
  const confirmedOrders = orders.filter(isPaid);
  const totalRevenue = confirmedOrders.reduce((s,o) => s + (o.total||0), 0);
  const itemsQty = list => list.reduce((s,o) => s + (o.items||[]).reduce((a,i) => a + (Number(i.qty)||0), 0), 0);
  const pageViews = getFilteredDashboardPageViews();

  // Période précédente (même durée) pour les évolutions en %
  const prev = dashPrevRange();
  let pOrders = null, pRevenue = null, pVisits = null, pItems = null;
  if(prev){
    const inPrev = d => d >= prev.from && d <= prev.to;
    const po = all.filter(o => inPrev(o.date));
    pOrders = po.length;
    pRevenue = po.filter(isPaid).reduce((s,o) => s + (o.total||0), 0);
    pItems = itemsQty(po);
    pVisits = (ADMIN_DASHBOARD_PAGEVIEWS_CACHE || []).filter(v => inPrev(v.date)).length;
  }

  const itemCounts = {};
  orders.forEach(o => (o.items||[]).forEach(i => { itemCounts[i.name] = (itemCounts[i.name]||0) + (Number(i.qty)||0); }));
  const topItems = Object.entries(itemCounts).sort((a,b) => b[1]-a[1]).slice(0,5);
  const viewCounts = {};
  pageViews.forEach(v => { if(v.itemId) viewCounts[v.itemId] = (viewCounts[v.itemId]||0) + 1; });
  const topViewed = Object.entries(viewCounts)
    .map(([id,count]) => [ALL_ITEMS[id] ? ALL_ITEMS[id].name : null, count])
    .filter(x => x[0]).sort((a,b) => b[1]-a[1]).slice(0,5);

  const periods = [
    {key:'today', label:"Aujourd'hui"}, {key:'7j', label:'7 derniers jours'}, {key:'30j', label:'30 derniers jours'},
    {key:'mois', label:'Ce mois-ci'}, {key:'all', label:'Depuis le début'}, {key:'custom', label:'Personnalisé…'}
  ];
  const cmpNote = prev ? 'Évolution comparée à la période précédente de même durée.' : '';
  const htgParts = n => { const t = formatHTG(n); const m = t.match(/^(.*?)\s*(HTG)$/); return m ? `${m[1]}<small> HTG</small>` : t; };

  el.innerHTML = `
    <div class="dash-toolbar">
      <label class="dash-select"><span>Période</span>
        <select onchange="this.value==='custom' ? toggleDashboardCustomRange() : setDashboardPeriod(this.value)">
          ${periods.map(p => `<option value="${p.key}" ${ADMIN_DASHBOARD_PERIOD===p.key?'selected':''}>${p.label}</option>`).join('')}
        </select>
      </label>
      <div id="dashboardCustomRange" class="dash-range" style="display:${ADMIN_DASHBOARD_PERIOD==='custom'?'flex':'none'};">
        <label>Du <input type="date" id="dashFrom" value="${ADMIN_DASHBOARD_CUSTOM_FROM}" onchange="setDashboardCustomRange()"></label>
        <label>Au <input type="date" id="dashTo" value="${ADMIN_DASHBOARD_CUSTOM_TO}" onchange="setDashboardCustomRange()"></label>
      </div>
    </div>

    <div class="dash-grid-main">
      <div class="dash-col-left">
        <div class="dash-kpis">
          ${dashKpi('cash', 'Encaissé', htgParts(totalRevenue), `${confirmedOrders.length} paiement${confirmedOrders.length>1?'s':''} confirmé${confirmedOrders.length>1?'s':''}`, dashTrend(totalRevenue, pRevenue), true)}
          ${dashKpi('orders', 'Commandes', orders.length, 'sur la période', dashTrend(orders.length, pOrders))}
          ${dashKpi('visits', 'Visites du site', pageViews.length, 'pages vues', dashTrend(pageViews.length, pVisits))}
          ${dashKpi('items', 'Articles commandés', itemsQty(orders), `${CATALOG.products.length + CATALOG.services.length} au catalogue`, dashTrend(itemsQty(orders), pItems))}
        </div>
        ${cmpNote ? `<p class="dash-note">${cmpNote}</p>` : ''}

        <div class="dash-card">
          <div class="dash-card-head">
            <div><h3>Ventes des 7 derniers mois</h3><p>Touchez une colonne pour voir le détail</p></div>
          </div>
          <div class="dash-legend-inline"><span><i class="dot gray"></i>Commandé</span><span><i class="dot main"></i>Encaissé</span></div>
          ${dashBarsHTML(all)}
        </div>

        <div class="dash-two">
          <div class="dash-card">
            <div class="dash-card-head"><div><h3>Les plus commandés</h3><p>Quantités sur la période</p></div></div>
            ${dashTopListHTML(topItems, 'Aucune commande sur cette période.', '')}
          </div>
          <div class="dash-card">
            <div class="dash-card-head"><div><h3>Les plus consultés</h3><p>Visites des fiches produits</p></div></div>
            ${dashTopListHTML(topViewed, 'Aucune consultation sur cette période.', 'vue(s)')}
          </div>
        </div>
      </div>

      <div class="dash-col-right">
        <div class="dash-card">
          <div class="dash-card-head"><div><h3>Types de commandes</h3><p>Produits, services ou les deux</p></div></div>
          ${dashRingsHTML(orders)}
        </div>
        ${dashboardCashSectionHTML(confirmedOrders)}
      </div>
    </div>
  `;
}

/* ---- Encaissements : en ligne (PLOP PLOP) vs confirmés à la main ----
   payments.confirmation est rempli automatiquement par la base :
   'en_ligne' quand le webhook confirme, 'manuel' quand l'admin
   passe le paiement à « Confirmé ». Les anciens paiements (avant
   cette colonne) sont « à classer » et se corrigent ici. */
function dashboardCashSectionHTML(confirmedOrders){
  const groups = { en_ligne: [], manuel: [], aucun: [] };
  confirmedOrders.forEach(o => {
    const c = o.paymentRecord && o.paymentRecord.confirmation;
    (groups[c] || groups.aucun).push(o);
  });
  const sum = list => list.reduce((s,o) => s + (o.total||0), 0);
  const card = (num, label, sub) => `<div class="admin-stat-card"><div class="stat-num">${num}</div><div class="stat-label">${label}</div>${sub ? `<div class="card-sub" style="margin-top:2px;">${sub}</div>` : ''}</div>`;
  const plural = (n) => `${n} paiement${n>1?'s':''}`;
  const badge = (c) => c === 'en_ligne'
    ? `<span class="cash-badge cash-online">En ligne</span>`
    : c === 'manuel' ? `<span class="cash-badge cash-manual">À la main</span>` : `<span class="cash-badge cash-none">À classer</span>`;
  const rows = [...confirmedOrders].sort((a,b) => b.date - a.date).map(o => {
    const p = o.paymentRecord;
    const c = p.confirmation || null;
    return `<div class="cash-row">
      <div class="cash-row-main">
        <strong>${escapeHtml(o.code || '—')}</strong> ${badge(c)}
        <div class="card-sub">${escapeHtml(o.customerName || 'Client')} · ${escapeHtml(p.method || '')} · ${new Date(o.date).toLocaleDateString('fr-FR')}</div>
      </div>
      <div class="cash-row-side">
        <strong class="mono">${formatHTG(o.total||0)}</strong>
        <div class="cash-switch">
          <button class="opt-btn ${c==='en_ligne'?'selected':''}" onclick="dashSetConfirmation(${Number(p.id)}, 'en_ligne')">En ligne</button>
          <button class="opt-btn ${c==='manuel'?'selected':''}" onclick="dashSetConfirmation(${Number(p.id)}, 'manuel')">À la main</button>
        </div>
      </div>
    </div>`;
  }).join('');
  // Bulles proportionnelles aux montants
  const parts = [
    { key:'en_ligne', label:'En ligne (site)', color:'var(--dash-main)', list: groups.en_ligne },
    { key:'manuel', label:'Confirmé à la main', color:'var(--dash-accent)', list: groups.manuel },
    { key:'aucun', label:'À classer', color:'#A9B1C6', list: groups.aucun }
  ].map(p => ({ ...p, amount: sum(p.list) }));
  const maxAmount = Math.max(1, ...parts.map(p => p.amount));
  const totalAmount = parts.reduce((a,p) => a + p.amount, 0);
  const spots = [[58, 42], [26, 34], [34, 74]];
  const bubbles = parts.slice().sort((a,b) => b.amount - a.amount).map((p, i) => {
    const size = p.amount ? Math.round(56 + 74 * Math.sqrt(p.amount / maxAmount)) : 40;
    return `<div class="dash-bubble" style="width:${size}px;height:${size}px;left:${spots[i][0]}%;top:${spots[i][1]}%;background:${p.color};opacity:${p.amount ? 1 : .35}">${p.list.length}</div>`;
  }).join('');
  return `
    <div class="dash-card">
      <div class="dash-card-head"><div><h3>Encaissements</h3><p>En ligne ou confirmés à la main</p></div></div>
      <div class="dash-bubbles-wrap">
        <div class="dash-bubbles">${bubbles}</div>
        <ul class="dash-legend dash-legend-bars">
          ${parts.filter(p => p.key !== 'aucun' || p.list.length).map(p => `<li>
            <div class="dash-legend-line"><i class="dot" style="background:${p.color}"></i><span>${p.label}</span><strong>${formatHTG(p.amount)}</strong></div>
            <div class="dash-meter"><span style="width:${totalAmount ? Math.max(3, p.amount / totalAmount * 100) : 0}%;background:${p.color}"></span></div>
            <div class="card-sub">${plural(p.list.length)}</div>
          </li>`).join('')}
        </ul>
      </div>
      ${confirmedOrders.length
        ? `<details class="recu-details dash-details" ${groups.aucun.length ? 'open' : ''}><summary>Détail et classement des paiements (${confirmedOrders.length})</summary>
            <p class="card-sub">« En ligne » = payé sur le site et confirmé automatiquement. « À la main » = passé par toi à « Confirmé ». Tu peux corriger chaque paiement.</p>${rows}</details>`
        : '<p class="card-sub">Aucun paiement confirmé sur cette période.</p>'}
    </div>
  `;
}
async function dashSetConfirmation(paymentId, value){
  try{
    const { error } = await db.from('payments').update({ confirmation: value, updated_at: new Date().toISOString() }).eq('id', paymentId);
    if(error) throw error;
    (ADMIN_DASHBOARD_ORDERS_CACHE || []).forEach(o => {
      if(o.paymentRecord && Number(o.paymentRecord.id) === Number(paymentId)) o.paymentRecord.confirmation = value;
    });
    renderDashboardContent();
    showToast(value === 'en_ligne' ? 'Classé : encaissé en ligne' : 'Classé : confirmé à la main');
  }catch(e){
    console.error('dashSetConfirmation:', e);
    showToast('Échec — réessayez.');
  }
}
function toggleDashboardCustomRange(){
  ADMIN_DASHBOARD_PERIOD = 'custom';
  renderDashboardContent();
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
  container.innerHTML = CATALOG[kind].map((item, idx) => adminItemRowHTML(kind, item, idx, CATALOG[kind].length)).join('') || '<p class="card-sub">Aucun article.</p>';
}
async function adminMoveCatalogItem(kind, idx, dir){
  const arr = CATALOG[kind];
  const otherIdx = idx + dir;
  if(otherIdx < 0 || otherIdx >= arr.length) return;
  const a = arr[idx], b = arr[otherIdx];
  const aOrder = a.sortOrder ?? idx, bOrder = b.sortOrder ?? otherIdx;
  a.sortOrder = bOrder; b.sortOrder = aOrder;
  [arr[idx], arr[otherIdx]] = [arr[otherIdx], arr[idx]];
  renderAdminItemList(kind);
  rebuildIndex();
  renderGrid();
  saveCatalogLocal();
  if(SUPABASE_ENABLED){
    try{
      await db.from('catalog_items').update({ sort_order: a.sortOrder }).eq('id', a.id);
      await db.from('catalog_items').update({ sort_order: b.sortOrder }).eq('id', b.id);
    }catch(e){
      showToast("Échec de l'enregistrement de l'ordre");
      console.error(e);
    }
  }
}
function adminItemRowHTML(kind, item, idx, total){
  const isService = kind === 'services';
  const rawPrice = isService ? (item.startingPrice ?? null) : (item.price ?? 0);
  const priceLabel = item.isDimensionBased
    ? `${formatHTG(item.pricePerSqft||0)}/pi² <span class="price-htg" style="display:inline; margin:0;">au pied carré</span>`
    : (rawPrice != null ? `${formatHTG(rawPrice)} <span class="price-htg" style="display:inline; margin:0;">≈ ${formatUSD(rawPrice)}</span>` : '—');
  return `
  <div class="admin-item-row" id="adminrow-${item.id}">
    <div class="admin-item-summary" onclick="toggleAdminEdit('${item.id}')">
      <span>${item.name || '(sans nom)'} ${item.code ? `<span class="item-code-tag">${item.code}</span>` : ''}</span>
      <span class="admin-item-price">${priceLabel}</span>
      ${!isService && item.inStock===false ? '<span class="stock-flag" style="position:static;">Rupture</span>' : ''}
      <div style="display:flex; gap:4px;">
        <button class="qty-btn" onclick="event.stopPropagation(); adminMoveCatalogItem('${kind}', ${idx}, -1)" ${idx===0?'disabled':''} aria-label="Monter">↑</button>
        <button class="qty-btn" onclick="event.stopPropagation(); adminMoveCatalogItem('${kind}', ${idx}, 1)" ${idx===total-1?'disabled':''} aria-label="Descendre">↓</button>
      </div>
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
      <div class="admin-note" style="margin-bottom:6px;">
        <label class="check-row" style="margin-bottom:0;">
          <input type="checkbox" id="f-dimbased-${item.id}" ${item.isDimensionBased?'checked':''} onchange="toggleDimensionPricing('${item.id}')">
          Calcul au pied carré (le client indique largeur × longueur en pouces, prix calculé automatiquement)
        </label>
      </div>
      <div id="f-dimprice-wrap-${item.id}" style="display:${item.isDimensionBased?'block':'none'};">
        <div class="form-field"><label id="f-pricesqft-label-${item.id}">Prix par pied carré (HTG/pi²)</label><input type="number" step="0.01" min="0" id="f-pricesqft-${item.id}" value="${item.pricePerSqft ?? 0}"></div>
      </div>
      <div id="f-normalprice-wrap-${item.id}" style="display:${item.isDimensionBased?'none':'block'};">
      ${isService ? `
        <div class="form-field"><label id="f-price-label-${item.id}">Prix de départ (HTG)</label><input type="number" step="0.01" min="0" id="f-price-${item.id}" value="${item.startingPrice ?? 0}"></div>
      ` : `
        <div class="form-field"><label id="f-price-label-${item.id}">Prix (HTG)</label><input type="number" step="0.01" min="0" id="f-price-${item.id}" value="${item.price ?? 0}"></div>
        <div class="form-field"><label id="f-oldprice-label-${item.id}">Ancien prix (HTG) — laisser vide si pas de promo</label><input type="number" step="0.01" min="0" id="f-oldprice-${item.id}" value="${item.oldPrice ?? ''}"></div>
      `}
      </div>
      ${!isService ? `
        <label class="check-row"><input type="checkbox" id="f-instock-${item.id}" ${item.inStock!==false?'checked':''}> En stock</label>
        <label class="check-row"><input type="checkbox" id="f-custom-${item.id}" ${item.customizable?'checked':''}> Personnalisable</label>
      ` : ''}
      <div class="form-field">
        <label>Adresse de cette page</label>
        <input type="text" readonly value="https://www.jcmultimedia.online${itemUrlPath(item)}" onclick="this.select()">
        <p class="card-sub" style="margin-top:4px;">Se met à jour automatiquement à partir du nom, à chaque enregistrement.</p>
      </div>
      <h3 style="margin:18px 0 4px; font-size:.95rem;">SEO de cette fiche (optionnel)</h3>
      <div class="admin-note" style="margin-bottom:10px;">Si laissé vide, un titre/description sont générés automatiquement à partir du nom et de la description ci-dessus.</div>
      <div class="form-field"><label>Titre pour Google (optionnel)</label><input type="text" id="f-seotitle-${item.id}" value="${(item.seoTitle||'').replace(/"/g,'&quot;')}" placeholder="${escapeHtml(item.name)} — JC Multimedia"></div>
      <div class="form-field"><label>Description pour Google (optionnel)</label><input type="text" id="f-seodesc-${item.id}" value="${(item.seoDescription||'').replace(/"/g,'&quot;')}" placeholder="${escapeHtml(((item.utility||item.description)||'').slice(0,80))}"></div>
      <div class="modal-actions">
        <button class="btn btn-primary" onclick="adminSaveItem('${kind}','${item.id}')" id="save-${item.id}">Enregistrer</button>
        <button class="btn btn-ghost" onclick="adminDeleteItem('${kind}','${item.id}')">Supprimer</button>
      </div>
    </div>
  </div>`;
}
function toggleDimensionPricing(id){
  const checked = document.getElementById('f-dimbased-'+id).checked;
  document.getElementById('f-dimprice-wrap-'+id).style.display = checked ? 'block' : 'none';
  document.getElementById('f-normalprice-wrap-'+id).style.display = checked ? 'none' : 'block';
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
  const compressed = await compressImageBlob(file).catch(()=>file);
  const path = `${id}-${slot}-${Date.now()}.jpg`;
  const { error } = await db.storage.from('catalog-images').upload(path, compressed, { upsert: true, contentType:'image/jpeg' });
  if(error) throw error;
  const { data } = db.storage.from('catalog-images').getPublicUrl(path);
  return data.publicUrl;
}
function slugifyClient(input){
  let s = (input || '').toLowerCase().trim();
  const accents = { 'à':'a','á':'a','â':'a','ã':'a','ä':'a','å':'a','è':'e','é':'e','ê':'e','ë':'e','ì':'i','í':'i','î':'i','ï':'i','ò':'o','ó':'o','ô':'o','õ':'o','ö':'o','ù':'u','ú':'u','û':'u','ü':'u','ç':'c','ñ':'n' };
  s = s.replace(/[àáâãäåèéêëìíîïòóôõöùúûüçñ]/g, ch => accents[ch] || ch);
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'article';
}
async function adminSaveItem(kind, id){
  const item = CATALOG[kind].find(i => i.id === id);
  if(!item) return;
  const btn = document.getElementById('save-'+id);
  item.name = document.getElementById('f-name-'+id).value.trim();

  // L'adresse publique se resynchronise automatiquement avec le nom
  // actuel à chaque enregistrement — jamais de saisie manuelle.
  const baseSlug = slugifyClient(item.name);
  if(baseSlug !== item.slug){
    let candidate = baseSlug, suffix = 1;
    const allItems = [...CATALOG.products, ...CATALOG.services];
    while(allItems.some(other => other.id !== item.id && other.slug === candidate)){
      suffix++;
      candidate = `${baseSlug}-${suffix}`;
    }
    item.slug = candidate;
  }
  const desc = document.getElementById('f-desc-'+id).value.trim();
  // Les prix se saisissent et se stockent uniquement en gourdes (HTG).
  // Le dollar n'est qu'un affichage calculé avec le taux de change.
  const toHTG = (v) => Math.round(v * 100) / 100;
  if(kind === 'services'){
    item.description = desc;
    item.startingPrice = toHTG(parseFloat(document.getElementById('f-price-'+id).value) || 0);
  } else {
    item.utility = desc;
    item.price = toHTG(parseFloat(document.getElementById('f-price-'+id).value) || 0);
    const oldP = document.getElementById('f-oldprice-'+id).value;
    item.oldPrice = oldP ? toHTG(parseFloat(oldP)) : undefined;
    item.promo = !!oldP;
    item.inStock = document.getElementById('f-instock-'+id).checked;
    item.customizable = document.getElementById('f-custom-'+id).checked;
  }
  item.seoTitle = document.getElementById('f-seotitle-'+id).value.trim();
  item.seoDescription = document.getElementById('f-seodesc-'+id).value.trim();
  item.isDimensionBased = document.getElementById('f-dimbased-'+id).checked;
  item.pricePerSqft = toHTG(parseFloat(document.getElementById('f-pricesqft-'+id).value) || 0);

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
  showConfirmModal("Supprimer définitivement cet article du catalogue ?", async () => {
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
  });
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
        details: row.details,
        paymentRecord: paymentsByOrder[row.id] || null,
        uploadCount: uploadCountByOrder[row.id] || 0,
        payToken: row.pay_token || null,
        source: row.source || null
      }));
    }catch(e){
      console.warn('Supabase orders fetch failed, falling back to local log:', e);
      return loadOrdersLocal();
    }
  }
  return loadOrdersLocal();
}
/* =========================================================
   CODES PROMO — remise automatique en % sur une sélection de
   produits/services. S'affiche sur le site sous forme de badge
   "Spécial" avec ancien prix barré, sans que le client n'ait à
   saisir de code : la sélection se fait entièrement dans l'admin.
   ========================================================= */
let ADMIN_PROMOS = [];
async function renderAdminPromos(){
  const el = document.getElementById('adminTab-promos');
  if(!SUPABASE_ENABLED){
    el.innerHTML = `<div class="admin-note">⚠️ Les codes promo nécessitent que Supabase soit configuré.</div>`;
    return;
  }
  el.innerHTML = `<p class="card-sub">Chargement…</p>`;
  try{
    const { data: codes, error } = await db.from('promo_codes').select('*').order('created_at', { ascending:false });
    if(error) throw error;
    const { data: links } = await db.from('promo_code_items').select('promo_code_id, catalog_item_id');
    ADMIN_PROMOS = (codes||[]).map(c => ({
      ...c,
      itemIds: (links||[]).filter(l => l.promo_code_id === c.id).map(l => l.catalog_item_id)
    }));
    renderAdminPromosList();
  }catch(e){
    el.innerHTML = `<p class="card-sub">Erreur de chargement des codes promo.</p>`;
    console.error(e);
  }
}
function renderAdminPromosList(){
  const el = document.getElementById('adminTab-promos');
  el.innerHTML = `
    <h3>Codes promo</h3>
    <div class="admin-note">Créez un code, indiquez le pourcentage de réduction, puis cochez les produits et services concernés. La remise s'applique automatiquement sur le site — le client n'a rien à saisir.</div>
    <button class="btn btn-primary" style="margin:10px 0;" onclick="adminAddPromo()">+ Nouveau code promo</button>
    <div id="adminPromosList"></div>
  `;
  const listEl = document.getElementById('adminPromosList');
  listEl.innerHTML = ADMIN_PROMOS.map(p => adminPromoRowHTML(p)).join('') || '<p class="card-sub">Aucun code promo pour le moment.</p>';
}
function adminPromoRowHTML(p){
  const itemCount = p.itemIds.length;
  return `
    <div class="admin-item-card">
      <div class="admin-item-summary" onclick="toggleAdminPromoEdit('${p.id}')">
        <span>${escapeHtml(p.name || '(sans nom)')} <span class="item-code-tag">${escapeHtml(p.code)}</span></span>
        <span class="admin-item-price">-${p.discount_percent}% ${p.active ? '' : '<span class="stock-flag" style="position:static;">Inactif</span>'}</span>
      </div>
      <div id="promo-edit-${p.id}" style="display:none; padding:14px; border-top:1px solid var(--line);">
        <div class="form-field"><label>Nom (repère interne)</label><input type="text" id="f-promoname-${p.id}" value="${escapeHtml(p.name||'').replace(/"/g,'&quot;')}" placeholder="Ex : Soldes de rentrée"></div>
        <div class="form-field"><label>Code</label><input type="text" id="f-promocode-${p.id}" value="${escapeHtml(p.code||'').replace(/"/g,'&quot;')}" placeholder="Ex : RENTREE20" style="text-transform:uppercase;"></div>
        <div class="form-field"><label>Pourcentage de réduction (%)</label><input type="number" id="f-promopercent-${p.id}" min="1" max="100" step="1" value="${p.discount_percent}"></div>
        <label class="check-row"><input type="checkbox" id="f-promoactive-${p.id}" ${p.active ? 'checked' : ''}> Actif (remise appliquée sur le site)</label>
        <h4 style="margin:16px 0 6px;">Produits et services concernés (${itemCount} sélectionné${itemCount>1?'s':''})</h4>
        <div style="max-height:260px; overflow-y:auto; border:1px solid var(--line); border-radius:10px; padding:10px;">
          <div class="admin-note" style="margin-bottom:6px;">Produits</div>
          ${CATALOG.products.map(i => `<label class="check-row"><input type="checkbox" class="promo-item-cb" data-promo="${p.id}" value="${i.id}" ${p.itemIds.includes(i.id)?'checked':''}> ${escapeHtml(i.name)}</label>`).join('') || '<p class="card-sub">Aucun produit.</p>'}
          <div class="admin-note" style="margin:10px 0 6px;">Services</div>
          ${CATALOG.services.map(i => `<label class="check-row"><input type="checkbox" class="promo-item-cb" data-promo="${p.id}" value="${i.id}" ${p.itemIds.includes(i.id)?'checked':''}> ${escapeHtml(i.name)}</label>`).join('') || '<p class="card-sub">Aucun service.</p>'}
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" onclick="adminDeletePromo('${p.id}')">Supprimer</button>
          <button class="btn btn-primary" id="save-promo-${p.id}" onclick="adminSavePromo('${p.id}')">Enregistrer</button>
        </div>
      </div>
    </div>
  `;
}
function toggleAdminPromoEdit(id){
  const el = document.getElementById('promo-edit-'+id);
  if(el) el.style.display = (el.style.display === 'none') ? 'block' : 'none';
}
function adminAddPromo(){
  const newId = 'new-' + Date.now();
  ADMIN_PROMOS.unshift({ id: newId, name:'', code:'', discount_percent:10, active:true, itemIds:[], _isNew:true });
  renderAdminPromosList();
  toggleAdminPromoEdit(newId);
}
async function adminSavePromo(id){
  const promo = ADMIN_PROMOS.find(p => String(p.id) === String(id));
  if(!promo) return;
  const btn = document.getElementById('save-promo-'+id);
  if(btn){ btn.disabled = true; btn.textContent = 'Enregistrement…'; }
  try{
    const name = document.getElementById('f-promoname-'+id).value.trim();
    const code = document.getElementById('f-promocode-'+id).value.trim().toUpperCase();
    const percent = parseFloat(document.getElementById('f-promopercent-'+id).value) || 0;
    const active = document.getElementById('f-promoactive-'+id).checked;
    const selectedIds = Array.from(document.querySelectorAll(`.promo-item-cb[data-promo="${id}"]:checked`)).map(cb => cb.value);

    if(!name || !code){ showToast("Le nom et le code sont obligatoires"); if(btn){ btn.disabled=false; btn.textContent='Enregistrer'; } return; }
    if(percent <= 0 || percent > 100){ showToast("Le pourcentage doit être entre 1 et 100"); if(btn){ btn.disabled=false; btn.textContent='Enregistrer'; } return; }

    let realId = (typeof id === 'string' && id.startsWith('new-')) ? null : Number(id);

    if(realId == null){
      const { data, error } = await db.from('promo_codes').insert({ name, code, discount_percent: percent, active }).select('id').single();
      if(error) throw error;
      realId = data.id;
    } else {
      const { error } = await db.from('promo_codes').update({ name, code, discount_percent: percent, active }).eq('id', realId);
      if(error) throw error;
      await db.from('promo_code_items').delete().eq('promo_code_id', realId);
    }

    if(selectedIds.length){
      const rows = selectedIds.map(itemId => ({ promo_code_id: realId, catalog_item_id: itemId }));
      const { error: linkError } = await db.from('promo_code_items').insert(rows);
      if(linkError) throw linkError;
    }

    showToast("Code promo enregistré");
    await refreshPromos();
    await renderAdminPromos();
  }catch(e){
    showToast("Échec de l'enregistrement — le code est peut-être déjà utilisé");
    console.error(e);
    if(btn){ btn.disabled = false; btn.textContent = 'Enregistrer'; }
  }
}
async function adminDeletePromo(id){
  if(typeof id === 'string' && id.startsWith('new-')){
    ADMIN_PROMOS = ADMIN_PROMOS.filter(p => String(p.id) !== String(id));
    renderAdminPromosList();
    return;
  }
  showConfirmModal("Supprimer ce code promo ? La remise cessera immédiatement de s'appliquer.", async () => {
    try{
      const { error } = await db.from('promo_codes').delete().eq('id', id);
      if(error) throw error;
      showToast("Code promo supprimé");
      await refreshPromos();
      await renderAdminPromos();
    }catch(e){
      showToast("Échec de la suppression");
      console.error(e);
    }
  });
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
  if(typeof recuDecorateOrderButtons === 'function') recuDecorateOrderButtons();
}
const ORDER_STATUSES = [
  'En attente','Confirmée','Paiement en attente','Paiement confirmé',
  'En préparation','En production','Prête','En livraison','Livrée',
  'Annulée','Refusée'
];
const PAYMENT_STATUSES = ['En attente','Confirmé','Refusé','Remboursé'];
function orderRowHTML(o){
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
      <strong>${escapeHtml(o.customerName) || 'Client'}</strong>
      <span class="mono">${new Date(o.date).toLocaleString('fr-FR')}</span>
    </div>
    ${o.code ? `<div class="item-code-tag" style="margin:4px 0;">${escapeHtml(o.code)}</div>` : ''}
    <div class="card-sub">${escapeHtml(o.customerPhone)}${o.customerAddress ? ' · ' + escapeHtml(o.customerAddress) : ''}</div>
    <ul class="admin-list">${(o.items||[]).map(i => `<li>${escapeHtml(i.name)} × ${Number(i.qty)||0}${i.customized ? ' (à personnaliser)' : ''}</li>`).join('')}</ul>
    <div class="cart-total-row"><span>Total</span><span class="amt">${priceDualInline(o.total||0)}</span></div>
    <div class="card-sub">Livraison : ${escapeHtml(o.delivery) || '—'}</div>
    ${o.details ? `<div class="admin-note" style="margin-top:8px;"><strong>Détails demandés par le client :</strong><br>${escapeHtml(o.details).replace(/\n/g,'<br>')}</div>` : ''}
    ${o.uploadCount > 0 ? `
      <button class="btn btn-ghost" style="margin-top:10px;" onclick="adminViewOrderFiles(${o.id}, this)">📎 Voir les ${o.uploadCount} fichier${o.uploadCount>1?'s':''} joint${o.uploadCount>1?'s':''}</button>
      <div id="orderfiles-${o.id}" style="margin-top:10px;"></div>
    ` : ''}
    ${(o.payToken && SUPABASE_ENABLED) ? `<button class="btn btn-ghost" style="margin-top:10px;" onclick="payLinkShare(${Number(o.id)})">🔗 Lien de paiement</button>` : ''}
    ${(o.id && SUPABASE_ENABLED) ? `<button class="btn btn-wa recu-order-btn" style="margin-top:10px;" data-order-id="${Number(o.id)}" onclick="recuFromOrder(${Number(o.id)})">🧾 Faire le reçu</button>` : ''}
    <div class="form-field" style="margin-top:10px;"><label>Statut de la commande</label>${statusSelect}</div>
    ${paymentSelect ? `<div class="form-field"><label>Statut du paiement (${escapeHtml(o.payment) || '—'})</label>${paymentSelect}</div>` : `<div class="card-sub">Paiement : ${escapeHtml(o.payment) || '—'}</div>`}
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
      links.push(`<li><a href="${signed.signedUrl}" target="_blank" rel="noopener">${escapeHtml(f.original_filename || 'Fichier')}</a> <span class="card-sub">(${Math.round((f.size_bytes||0)/1024)} Ko, lien valable 1h)</span></li>`);
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
/* Suppression de TOUT l'historique : irréversible, donc on exige de
   taper le mot SUPPRIMER (un simple appui ne suffit pas). */
function adminClearOrders(){
  const msg = SUPABASE_ENABLED
    ? "Effacer DÉFINITIVEMENT toutes les commandes et leurs paiements dans Supabase (pour tous les appareils) ?"
    : "Effacer tout l'historique des commandes enregistrées sur cet appareil ?";
  openStep(`
    <h3>${msg}</h3>
    <p class="card-sub">Cette action est irréversible. Pour confirmer, tapez <strong>SUPPRIMER</strong> ci-dessous.</p>
    <div class="form-field"><input type="text" id="clearOrdersConfirm" autocomplete="off" autocapitalize="characters" placeholder="SUPPRIMER"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeStep()">Annuler</button>
      <button class="btn btn-primary" onclick="adminClearOrdersConfirmed()">Tout effacer</button>
    </div>
  `, "Confirmation");
}
async function adminClearOrdersConfirmed(){
  const input = document.getElementById('clearOrdersConfirm');
  if(!input || input.value.trim().toUpperCase() !== 'SUPPRIMER'){
    showToast("Tapez SUPPRIMER pour confirmer");
    return;
  }
  closeStep();
  if(SUPABASE_ENABLED){
    try{
      const { error } = await db.from('orders').delete().neq('id', 0);
      if(error) throw error;
    }catch(e){
      showToast("Échec de la suppression Supabase — vérifiez votre connexion.");
      console.error(e);
      return;
    }
  }
  saveOrdersLocal([]);
  renderAdminOrders();
  showToast("Historique vidé");
}
async function exportOrdersCSV(){
  const orders = await getOrdersForAdmin();
  if(orders.length === 0){ showToast("Aucune commande à exporter"); return; }
  // Neutralise l'injection de formule CSV (Excel/Sheets) : si une valeur
  // commence par = + - @, un tableur peut l'interpréter comme une formule.
  const csvSafe = v => {
    let s = (v == null ? '' : String(v)).replace(/"/g,'""');
    if(/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return s;
  };
  let csv = "Date,Nom,Telephone,Adresse,Articles,Total USD,Total HTG,Taux utilise,Paiement,Livraison\n";
  orders.forEach(o => {
    const items = (o.items||[]).map(i => `${csvSafe(i.name)} x${Number(i.qty)||0}`).join(' | ');
    const rate = o.exchangeRate || SETTINGS.exchangeRate;
    const htgTotal = Number(o.total)||0;
    const usdTotal = rate ? htgTotal / rate : 0;
    csv += `"${new Date(o.date).toLocaleString('fr-FR')}","${csvSafe(o.customerName)}","${csvSafe(o.customerPhone)}","${csvSafe(o.customerAddress)}","${items}",${usdTotal.toFixed(2)},${htgTotal.toFixed(2)},${rate},"${csvSafe(o.payment)}","${csvSafe(o.delivery)}"\n`;
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
      <p class="card-sub" style="margin-top:4px;">Sert uniquement à afficher l'équivalent en dollars sur le site. Les prix en gourdes ne changent jamais.</p>
    </div>
    <div class="admin-note">Ce taux sert à convertir automatiquement tous les prix (produits et services) affichés en gourdes sur le site. Mettez-le à jour régulièrement pour rester proche du taux réel du marché.</div>

    <h3>Photos déjà en ligne</h3>
    <div class="admin-note">Les nouvelles photos que vous envoyez sont désormais automatiquement compressées. Pour alléger celles déjà en ligne (catalogue, bannière, portfolio) et accélérer le site sur connexion lente, lancez l'optimisation ci-dessous. Cela peut prendre plusieurs minutes selon le nombre de photos — ne fermez pas cette page pendant l'opération.</div>
    <button class="btn btn-ghost" id="optimize-images-btn" onclick="optimizeAllImages()">Optimiser toutes les images</button>
    <div id="optimizeImagesStatus" style="margin-top:10px;"></div>

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
async function optimizeAllImages(){
  if(!SUPABASE_ENABLED){ showToast("Nécessite Supabase"); return; }
  showConfirmModal(
    "Optimiser toutes les images déjà en ligne ? Cette opération peut prendre plusieurs minutes selon leur nombre.",
    async () => {
      const btn = document.getElementById('optimize-images-btn');
      const statusEl = document.getElementById('optimizeImagesStatus');
      if(btn) btn.disabled = true;

      // Rassemble toutes les photos existantes : catalogue, bannière, portfolio.
      const jobs = [];
      [...CATALOG.products, ...CATALOG.services].forEach(item => {
        (item.imageUrls || []).forEach(url => jobs.push({ bucket:'catalog-images', url }));
      });
      try{
        const { data: slides } = await db.from('hero_slides').select('image_url, mobile_image_url');
        (slides||[]).forEach(s => {
          if(s.image_url) jobs.push({ bucket:'hero-slides', url: s.image_url });
          if(s.mobile_image_url) jobs.push({ bucket:'hero-slides', url: s.mobile_image_url });
        });
      }catch(e){ console.warn('hero_slides fetch failed:', e); }
      try{
        const { data: pItems } = await db.from('portfolio_items').select('image_urls');
        (pItems||[]).forEach(p => (p.image_urls||[]).forEach(url => jobs.push({ bucket:'portfolio-images', url })));
      }catch(e){ console.warn('portfolio_items fetch failed:', e); }

      if(jobs.length === 0){
        statusEl.innerHTML = `<p class="card-sub">Aucune photo trouvée à optimiser.</p>`;
        if(btn) btn.disabled = false;
        return;
      }

      let done = 0, failed = 0;
      for(const job of jobs){
        statusEl.innerHTML = `<p class="card-sub">Optimisation en cours… ${done + failed} / ${jobs.length}</p>`;
        try{
          const path = extractStoragePath(job.url, job.bucket);
          if(!path) throw new Error('Chemin introuvable pour ' + job.url);
          const resp = await fetch(job.url);
          if(!resp.ok) throw new Error('Téléchargement échoué');
          const blob = await resp.blob();
          const compressed = await compressImageBlob(blob);
          const { error } = await db.storage.from(job.bucket).upload(path, compressed, { upsert:true, contentType:'image/jpeg' });
          if(error) throw error;
          done++;
        }catch(e){
          failed++;
          console.warn('optimisation échouée pour', job.url, e);
        }
      }
      statusEl.innerHTML = `<p class="card-sub">Terminé : ${done} photo${done>1?'s':''} optimisée${done>1?'s':''}${failed ? `, ${failed} échec${failed>1?'s':''}` : ''} sur ${jobs.length}.</p>`;
      if(btn) btn.disabled = false;
      showToast("Optimisation des images terminée");
    }
  );
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
applyPageContent();
if(document.body.dataset.page === 'article') initArticlePage();
if(document.body.dataset.page === 'admin') checkAdminSession();
function logPageView(page, itemId){
  if(!SUPABASE_ENABLED) return;
  try{
    db.from('page_views').insert({ page, item_id: itemId || null }).then(()=>{}, ()=>{});
  }catch(e){ /* le suivi de visite ne doit jamais bloquer l'affichage du site */ }
}
if(document.body.dataset.page && document.body.dataset.page !== 'article' && document.body.dataset.page !== 'admin'){
  logPageView(document.body.dataset.page);
}
if(document.body.dataset.page === 'retour-paiement') initPaymentReturnPage();
if(document.body.dataset.page === 'payer') initPayLinkPage();

const emailField = document.getElementById('adminEmailField');
if(emailField) emailField.style.display = SUPABASE_ENABLED ? 'block' : 'none';

if(SUPABASE_ENABLED){
  refreshCatalog();
  refreshSettings().then(initHeroSlideshow);
  refreshSiteContent();
  refreshPageContent();
  initPortfolio();
  initHomeReviews();
} else {
  console.info("Supabase non configuré — le site fonctionne en mode local uniquement. Voir schema-supabase.sql pour activer la synchronisation centralisée.");
}
