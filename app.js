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
const SUPABASE_URL = "https://ggfqjumxfpcrfogytsvy.supabase.co";       // ex: https://abcdefgh.supabase.co
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnZnFqdW14ZnBjcmZvZ3l0c3Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzMDQzNDcsImV4cCI6MjEwMzg4MDM0N30.A9RXcHj2Lc27sSt0dS6EfO7jCpR-uHblDN_4YninOTY"; // clé "anon public", jamais la "service_role"

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
  exchangeRate: 132 // gourdes (HTG) pour 1 USD — à vérifier/mettre à jour régulièrement depuis l'espace admin
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
    return { whatsapp: data.whatsapp, exchangeRate: Number(data.exchange_rate) };
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
    id: row.id, name: row.name, imageUrl: row.image_url || "",
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
  return {
    id: item.id, kind, name: item.name, image_url: item.imageUrl || null,
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
        ${item.imageUrl ? `<img src="${item.imageUrl}" alt="${item.name}" loading="lazy">` : `<div class="no-image">Pas de photo</div>`}
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
  const priceBlock = isEstimate(item)
    ? `<div class="price-row"><span class="price">À partir de ${priceDualInline(item.startingPrice)}</span></div>`
    : `<div class="price-row"><span class="price">${priceDualInline(item.price)}</span>${item.oldPrice ? `<span class="price-old">$${item.oldPrice.toFixed(2)}</span>` : ''}</div>`;

  document.title = item.name + ' — JC Multimedia';
  const canonicalEl = document.getElementById('canonicalLink');
  if(canonicalEl) canonicalEl.href = window.location.origin + '/article/' + id;
  document.getElementById('itemDetailContent').innerHTML = `
    <div class="item-detail-thumb">
      ${item.promo ? '<span class="promo-flag">Promo</span>' : ''}
      ${outOfStock ? '<span class="stock-flag">Rupture de stock</span>' : ''}
      ${item.imageUrl ? `<img src="${item.imageUrl}" alt="${item.name}">` : `<div class="no-image">Pas de photo</div>`}
    </div>
    <h1>${item.name}</h1>
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
function copyItemLink(){
  const url = window.location.href;
  if(navigator.clipboard){
    navigator.clipboard.writeText(url).then(()=> showToast("Lien copié !"));
  } else {
    showToast(url);
  }
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
  orderFlow = { customerName:"", customerPhone:"", customerAddress:"", customize:null, customizedItems:[], payment:null, delivery:null };
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
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="showStepCustomizeAsk()">Retour</button>
      <button class="btn btn-primary" onclick="collectCustomizeList()">Suivant</button>
    </div>
  `, "Articles à personnaliser");
}
function collectCustomizeList(){
  orderFlow.customizedItems = Array.from(document.querySelectorAll('.check-row input:checked')).map(el => el.value);
  showStepPayment();
}
function showStepPayment(){
  const options = ["MonCash","Cash","Virement Bancaire"];
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
      <button class="btn btn-primary" onclick="orderFlow.delivery ? sendOrder() : null">Envoyer</button>
    </div>
  `, "Livraison ou retrait");
}
function selectDelivery(o){ orderFlow.delivery = o; showStepDelivery(); }

function sendOrder(){
  const items = cartEntries();
  const total = cartTotal();

  let msg = "Bonjour JC Multimedia, je souhaite commander :%0A%0A";
  msg += `Nom : ${orderFlow.customerName}%0ATéléphone : ${orderFlow.customerPhone}%0A`;
  if(orderFlow.customerAddress) msg += `Adresse : ${orderFlow.customerAddress}%0A`;
  msg += `%0A`;
  items.forEach(i => {
    const tag = orderFlow.customizedItems.includes(i.id) ? " (à personnaliser)" : "";
    const lineTotal = unitPrice(i) * i.qty;
    const amount = `${isEstimate(i) ? 'à partir de ' : ''}${formatUSD(lineTotal)} (≈ ${formatHTG(lineTotal)})${isEstimate(i) ? ' — estimation' : ''}`;
    msg += `• ${i.name}${tag} x${i.qty} — ${amount}%0A`;
  });
  msg += `%0ATotal estimé : ${formatUSD(total)} (≈ ${formatHTG(total)})%0A`;
  msg += `Mode de paiement : ${orderFlow.payment}%0A`;
  msg += `Livraison : ${orderFlow.delivery}`;

  const orderRecord = {
    date: Date.now(),
    customerName: orderFlow.customerName,
    customerPhone: orderFlow.customerPhone,
    customerAddress: orderFlow.customerAddress,
    items: items.map(i => ({ name:i.name, qty:i.qty, customized: orderFlow.customizedItems.includes(i.id) })),
    total: total,
    exchangeRate: SETTINGS.exchangeRate,
    payment: orderFlow.payment,
    delivery: orderFlow.delivery
  };

  // On envoie toujours une copie locale (repli hors-ligne), et on tente
  // en plus Supabase pour que la commande soit visible depuis N'IMPORTE
  // QUEL appareil dans l'espace admin, pas seulement celui du client.
  logOrderLocal(orderRecord);
  logOrderToSupabase(orderRecord);

  window.open(`https://wa.me/${SETTINGS.whatsapp}?text=${msg}`, "_blank");

  cart = {};
  saveCart();
  updateBadge();
  showStepConfirmation();
}
async function logOrderToSupabase(record){
  if(!SUPABASE_ENABLED) return;
  try{
    const { error } = await db.from('orders').insert({
      customer_name: record.customerName,
      customer_phone: record.customerPhone,
      customer_address: record.customerAddress || null,
      items: record.items,
      total: record.total,
      exchange_rate: record.exchangeRate,
      payment: record.payment,
      delivery: record.delivery
    });
    if(error) throw error;
  }catch(e){
    console.warn('Supabase order insert failed, order kept locally only:', e);
  }
}
function showStepConfirmation(){
  openStep(`
    <div class="modal-confirm">
      <div class="confirm-icon">✓</div>
      <h3 style="margin-right:0;">Commande envoyée !</h3>
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
  ['dashboard','catalog','orders','settings'].forEach(t=>{
    document.getElementById('adminTab-'+t).style.display = (t===name) ? 'block' : 'none';
  });
  document.querySelectorAll('.admin-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
  if(name==='dashboard') renderAdminDashboard();
  if(name==='catalog') renderAdminCatalog();
  if(name==='orders') renderAdminOrders();
  if(name==='settings') renderAdminSettings();
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
      <span>${item.name || '(sans nom)'}</span>
      <span class="admin-item-price">${priceLabel}</span>
      ${!isService && item.inStock===false ? '<span class="stock-flag" style="position:static;">Rupture</span>' : ''}
    </div>
    <div class="admin-item-edit" id="adminedit-${item.id}" style="display:none;">
      <div class="form-field"><label>Nom</label><input type="text" id="f-name-${item.id}" value="${(item.name||'').replace(/"/g,'&quot;')}"></div>
      <div class="form-field"><label>${isService?'Description':'Utilité'}</label><input type="text" id="f-desc-${item.id}" value="${((item.utility||item.description)||'').replace(/"/g,'&quot;')}"></div>
      <div class="form-field">
        <label>Photo</label>
        <div class="admin-image-row">
          <div class="admin-image-preview" id="f-imgpreview-${item.id}">${item.imageUrl ? `<img src="${item.imageUrl}" alt="">` : '<span>Pas de photo</span>'}</div>
          <input type="file" accept="image/*" id="f-image-${item.id}" onchange="previewAdminImage('${item.id}')">
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
function previewAdminImage(id){
  const input = document.getElementById('f-image-'+id);
  const preview = document.getElementById('f-imgpreview-'+id);
  const file = input.files && input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => { preview.innerHTML = `<img src="${e.target.result}" alt="">`; };
  reader.readAsDataURL(file);
}
async function uploadItemImage(id, file){
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${id}-${Date.now()}.${ext}`;
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

  const fileInput = document.getElementById('f-image-'+id);
  const file = fileInput.files && fileInput.files[0];

  if(SUPABASE_ENABLED){
    if(btn){ btn.disabled = true; btn.textContent = 'Enregistrement…'; }
    try{
      if(file){
        item.imageUrl = await uploadItemImage(id, file);
      }
      const { error } = await db.from('catalog_items').upsert(itemToRow(kind, item));
      if(error) throw error;
    }catch(e){
      showToast("Échec de l'enregistrement Supabase — vérifiez votre connexion.");
      console.error(e);
    }
    if(btn){ btn.disabled = false; btn.textContent = 'Enregistrer'; }
  } else if(file){
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
    ? { id, name:"Nouveau service", description:"Description à compléter.", startingPrice:0 }
    : { id, name:"Nouveau produit", utility:"Utilité à compléter.", price:0, customizable:false, inStock:true };
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
      return data.map(row => ({
        id: row.id,
        date: new Date(row.created_at).getTime(),
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        customerAddress: row.customer_address,
        items: row.items || [],
        total: Number(row.total || 0),
        exchangeRate: Number(row.exchange_rate || SETTINGS.exchangeRate),
        payment: row.payment,
        delivery: row.delivery
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
function orderRowHTML(o){
  const rate = o.exchangeRate || SETTINGS.exchangeRate;
  const htg = new Intl.NumberFormat('fr-FR').format(Math.round((o.total||0) * rate));
  return `<div class="admin-order-card">
    <div class="admin-order-head">
      <strong>${o.customerName || 'Client'}</strong>
      <span class="mono">${new Date(o.date).toLocaleString('fr-FR')}</span>
    </div>
    <div class="card-sub">${o.customerPhone || ''}${o.customerAddress ? ' · ' + o.customerAddress : ''}</div>
    <ul class="admin-list">${(o.items||[]).map(i => `<li>${i.name} × ${i.qty}${i.customized ? ' (à personnaliser)' : ''}</li>`).join('')}</ul>
    <div class="cart-total-row"><span>Total</span><span class="amt">$${(o.total||0).toFixed(2)}<span class="price-htg">≈ ${htg} HTG</span></span></div>
    <div class="card-sub">Paiement : ${o.payment || '—'} · ${o.delivery || '—'}</div>
  </div>`;
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

    <button class="btn btn-primary" id="save-settings-btn" onclick="adminSaveSettings()">Enregistrer</button>

    ${pwSection}
  `;
}
async function adminSaveSettings(){
  const val = document.getElementById('s-whatsapp').value.trim();
  SETTINGS.whatsapp = val || SETTINGS.whatsapp;
  const rateVal = parseFloat(document.getElementById('s-rate').value);
  if(rateVal && rateVal > 0) SETTINGS.exchangeRate = rateVal;

  if(SUPABASE_ENABLED){
    const btn = document.getElementById('save-settings-btn');
    if(btn){ btn.disabled = true; btn.textContent = 'Enregistrement…'; }
    try{
      const { error } = await db.from('settings').upsert({
        id: 1, whatsapp: SETTINGS.whatsapp, exchange_rate: SETTINGS.exchangeRate
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
if(document.body.dataset.page === 'article') initArticlePage();
if(document.body.dataset.page === 'admin') checkAdminSession();

const emailField = document.getElementById('adminEmailField');
if(emailField) emailField.style.display = SUPABASE_ENABLED ? 'block' : 'none';

if(SUPABASE_ENABLED){
  refreshCatalog();
  refreshSettings();
} else {
  console.info("Supabase non configuré — le site fonctionne en mode local uniquement. Voir schema-supabase.sql pour activer la synchronisation centralisée.");
}
