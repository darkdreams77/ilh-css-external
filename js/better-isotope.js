/* =========================
   Faceclaim Loader – FINAL (ordre déterministe + warm-boot + caching + anti-429)
   ========================= */

var members;
var membersLength = 0;
var FC;
var base;

/* ===== ORDONNANCEMENT DÉTERMINISTE ===== */
var orderList = [];                    // ['/u12','/u34',...]
var orderIndex = Object.create(null);  // path -> index (0..n-1)

/* ===== TUNING ===== */
var PAGE_SIZE = 50;                // Forumactif
var PROFILE_CONCURRENCY_MIN = 2;
var PROFILE_CONCURRENCY_MAX = 12;
var START_CONCURRENCY       = 6;
var MAX_REQUESTS_PER_SEC    = 6;   // limite réseau
var LATENCY_SOFT_LIMIT_MS   = 1200;
var PAGE_PREFETCH_AHEAD     = 2;   // pages tampon min

$(function () {
  // Invalidation simple quand tu changes tes sélecteurs
  var FC_SELECTOR_VERSION = 'v4'; // ⬅ bump si tu modifies INFOSLIST/parse
  (function(){
    const K='fc_selectors_ver';
    const cur = localStorage.getItem(K);
    if (cur !== FC_SELECTOR_VERSION) {
      try { MemberIndexCache.clear(); } catch(_) {}
      try { ProfileCache.clear(); } catch(_) {}
      localStorage.setItem(K, FC_SELECTOR_VERSION);
    }
  })();

  // NORMALIZE FORUM URL
  if (INFOSLIST["URL"][INFOSLIST["URL"].length - 1] == '/')
    INFOSLIST["URL"] = INFOSLIST["URL"].slice(0, -1);

  // NORMALIZE LISTS GIVEN BY ADMINS
  for (var i = 0; i < INFOSLIST["utiles"].length; i++) INFOSLIST["utiles"][i] = norm(INFOSLIST["utiles"][i]);
  for (var j = 0; j < INFOSLIST["supprime"].length; j++) INFOSLIST["supprime"][j] = norm(INFOSLIST["supprime"][j]);
  for (var k = 0; k < INFOSLIST["contact"].length; k++) INFOSLIST["contact"][k][0] = norm(INFOSLIST["contact"][k][0]);

  INFOSLIST["grandeDescription"] = norm(INFOSLIST["grandeDescription"]);
  INFOSLIST["filtres"] = norm(INFOSLIST["filtres"]);

  members = {};
  FC = $('#bp_fc');
  base = FC.find('.member_fc').eq(0).clone();

  $('.button1.forum').attr('href', INFOSLIST["URL"]);

  streamAllMembers();
});


/* =========================
   Helpers génériques
   ========================= */

function norm(s) { return String(s || '').trim().toLowerCase(); }
function safeStrip(s) {
  if (typeof s !== 'string') return '';
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
var strip = (typeof strip === 'function') ? strip : safeStrip;

function toDoc(html) {
  var nodes = $.parseHTML(html, document, true);
  var $wrap = $('<div/>'); $wrap.append(nodes);
  return $wrap;
}
function cssEscapeAttr(s) { return String(s).replace(/["\\]/g, '\\$&'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* Place un placeholder à la bonne position d’après orderIndex */
function ensurePlaceholder(profilePath){
  if ($('#bp_fc .member_fc[data-profile-path="'+cssEscapeAttr(profilePath)+'"]').length) return;

  const idx = orderIndex[profilePath];
  const $ph = makeSkeleton(profilePath);

  // insère avant le premier suivant déjà présent
  for (let i = idx+1; i < orderList.length; i++){
    const nxt = orderList[i];
    const $n = $('#bp_fc .member_fc[data-profile-path="'+cssEscapeAttr(nxt)+'"]');
    if ($n.length) { $ph.insertBefore($n); return; }
  }
  // sinon après le dernier précédent
  for (let i = idx-1; i >= 0; i--){
    const prev = orderList[i];
    const $p = $('#bp_fc .member_fc[data-profile-path="'+cssEscapeAttr(prev)+'"]');
    if ($p.length) { $ph.insertAfter($p); return; }
  }
  // container vide
  FC.append($ph);
}


/* =========================
   Cache HTML (RAM + sessionStorage)
   ========================= */

var HTMLCache = (function(){
  const mem = new Map();           // url -> { html, exp }
  const inflight = new Map();      // url -> Promise<string>
  const PREFIX = 'fc_htmlcache:';
  const now = () => Date.now();
  const key = (url) => PREFIX + url;

  function get(url){
    const m = mem.get(url);
    if (m && m.exp > now()) return m.html;
    try {
      const raw = sessionStorage.getItem(key(url));
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (obj.exp > now()) { mem.set(url, obj); return obj.html; }
      sessionStorage.removeItem(key(url));
    } catch(_) {}
    return null;
  }
  function set(url, html, ttlMs){
    const val = { html, exp: now() + (ttlMs || 5*60*1000) };
    mem.set(url, val);
    try { sessionStorage.setItem(key(url), JSON.stringify(val)); } catch(_) {}
  }
  function dedupe(url, factory){
    if (inflight.has(url)) return inflight.get(url);
    const p = Promise.resolve(factory()).finally(()=>inflight.delete(url));
    inflight.set(url, p); return p;
  }
  return { get, set, dedupe };
})();

/* =========================
   ProfileCache (RAM + sessionStorage)
   ========================= */

var ProfileCache = (function(){
  const mem = new Map();            // key -> { data, exp }
  const inflight = new Map();       // key -> Promise
  const PREFIX = 'fc_profile:';
  const now = () => Date.now();
  const key = (p) => PREFIX + p;

  function get(p){
    const k = key(p);
    const m = mem.get(k); if (m && m.exp > now()) return m.data;
    try {
      const raw = sessionStorage.getItem(k);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (obj.exp > now()) { mem.set(k, obj); return obj.data; }
      sessionStorage.removeItem(k);
    } catch(_) {}
    return null;
  }
  function set(p, data, ttlMs){
    const k = key(p), v = { data, exp: now() + (ttlMs || 7*24*60*60*1000) }; // TTL profils: 7 jours
    mem.set(k, v); try { sessionStorage.setItem(k, JSON.stringify(v)); } catch(_) {}
  }
  function dedupe(p, factory){
    const k = key(p);
    if (inflight.has(k)) return inflight.get(k);
    const pr = Promise.resolve(factory()).finally(()=>inflight.delete(k));
    inflight.set(k, pr); return pr;
  }
  function clear(){
    try { Object.keys(sessionStorage).forEach(k=>{ if (k.indexOf(PREFIX)===0) sessionStorage.removeItem(k); }); } catch(_) {}
    mem.clear();
  }
  return { get, set, dedupe, clear };
})();

/* =========================
   MemberIndexCache (localStorage)
   ========================= */

var MemberIndexCache = (function(){
  const K = 'fc_member_index_v1';
  function get(){ try{ return JSON.parse(localStorage.getItem(K) || 'null'); }catch(_){ return null; } }
  function set(arr){ try{ localStorage.setItem(K, JSON.stringify({ paths: arr, ts: Date.now() })); }catch(_){} }
  function clear(){ try{ localStorage.removeItem(K); }catch(_){} }
  return { get, set, clear };
})();

/* =========================
   Rate limiter + Backoff + Concurrency
   ========================= */

// Token bucket (refill total chaque seconde)
var Bucket = (function () {
  var capacity = MAX_REQUESTS_PER_SEC;
  var tokens = capacity;
  setInterval(function () { tokens = capacity; }, 1000);
  return {
    take: function () {
      return new Promise(function (res) {
        (function wait() {
          if (tokens > 0) { tokens--; return res(); }
          setTimeout(wait, 50);
        })();
      });
    }
  };
})();

// AIMD
var Concurrency = (function () {
  var current = START_CONCURRENCY;
  return {
    value: function () { return current; },
    onSuccess: function (latencyMs) {
      if (latencyMs < LATENCY_SOFT_LIMIT_MS) current = Math.min(PROFILE_CONCURRENCY_MAX, current + 0.2);
      else current = Math.max(PROFILE_CONCURRENCY_MIN, current - 0.5);
    },
    onThrottle: function () {
      current = Math.max(PROFILE_CONCURRENCY_MIN, Math.floor(current / 2) || 1);
    }
  };
})();

// AJAX HTML géré (cache + rate-limit + backoff + Retry-After)
async function getHTMLManaged(url, opts) {
  opts = opts || {};
  var maxRetries = (opts.maxRetries != null) ? opts.maxRetries : 6;
  var useCache  = (opts.cache !== false);
  var ttlMs     = (opts.ttlMs != null) ? opts.ttlMs : 5*60*1000;

  // Cache hit
  if (useCache) {
    const hit = HTMLCache.get(url);
    if (hit) return hit;
  }

  return HTMLCache.dedupe(url, async () => {
    var attempt = 0;
    while (true) {
      await Bucket.take();
      var t0 = performance.now();
      try {
        var data = await $.ajax({ url: url, type: 'GET', dataType: 'html', xhrFields: { withCredentials: true } });
        var dt = performance.now() - t0;
        Concurrency.onSuccess(dt);
        if (useCache) HTMLCache.set(url, data, ttlMs);
        return data;
      } catch (e) {
        var status = e && e.status;
        var retryAfterHeader = (typeof e.getResponseHeader === 'function') ? e.getResponseHeader('Retry-After') : null;
        var retryAfter = retryAfterHeader ? Number(retryAfterHeader) : null;
        if (status === 429 || (status >= 500 && status < 600)) {
          attempt++; Concurrency.onThrottle();
          if (attempt > maxRetries) throw e;
          var base = retryAfter ? retryAfter*1000 : Math.min(8000, 400 * Math.pow(2, attempt));
          var jitter = base * (0.3 * (Math.random() - 0.5));
          await sleep(Math.max(300, base + jitter)); continue;
        }
        throw e;
      }
    }
  });
}

/* =========================
   Fetch memberlist & profils
   ========================= */

async function fetchMemberListPage(pageIndexZeroBased) {
  var start = pageIndexZeroBased * PAGE_SIZE;
  var url = INFOSLIST["URL"] + '/memberlist?mode=username&order&start=' + start + '&username';
  var html = await getHTMLManaged(url, { cache: true, ttlMs: 10*60*1000 });
  var $doc = toDoc(html);
  var set = new Set();
  $doc.find('a[href^="/u"]').each(function () {
    var href = $(this).attr('href');
    if (href) set.add(href.split('?')[0]);
  });
  return Array.from(set);
}

async function fetchProfileData(profilePath){
  const cached = ProfileCache.get(profilePath);
  if (cached) return { profilePath, data: cached };

  return ProfileCache.dedupe(profilePath, async () => {
    var url  = INFOSLIST["URL"] + profilePath;
    var html = await getHTMLManaged(url, { cache: true, ttlMs: 30*60*1000 });
    var $doc = toDoc(html);

    var numberMatch = (new URL(url)).pathname.match(/\d+/);
    var number = numberMatch ? numberMatch[0] : null;

    var result = { number: number, mp: number?('/privmsg?mode=post&u='+number):null, contact: {}, infos: {} };

    // Pseudo & avatar
    result.pseudo = $doc.find(INFOSLIST['pseudo']).text() || '';
    result.avatar = $doc.find(INFOSLIST['avatar']).attr('src') || '';

    // Champs utiles
    var $dataInfo = $doc.find(INFOSLIST["champUtile"]);
    $dataInfo.each(function () {
      var txt = norm($(this).text() || '');
      var rgx, m;

      // Suppression ?
      rgx = new RegExp('^' + INFOSLIST['supprime'][0] + '\\s?\\*?' + INFOSLIST['separateurEfface'] + '(.+)', 'i');
      m = txt.match(rgx);
      if (m && strip(m[1]) === strip(INFOSLIST['supprime'][1])) { result.__deleted = true; return false; }

      // petites infos
      for (var i = 0; i < INFOSLIST["utiles"].length; i++) {
        var displayed = INFOSLIST["utiles"][i];
        rgx = new RegExp('^' + displayed + '\\s?\\*?' + INFOSLIST['separateurEfface'], 'i');
        if (rgx.test(txt)) { result.infos[displayed] = txt.replace(rgx,'').trim(); return; }
      }
      // contacts
      for (var j = 0; j < INFOSLIST["contact"].length; j++) {
        var name = INFOSLIST["contact"][j][0];
        rgx = new RegExp('^' + name + '\\s?\\*?' + INFOSLIST['separateurEfface'], 'i');
        if (rgx.test(txt)) { result.contact[name] = [txt.replace(rgx,'').trim(), INFOSLIST["contact"][j][1]]; return; }
      }
      // grande description
      rgx = new RegExp('^' + INFOSLIST['grandeDescription'] + '\\s?\\*?' + INFOSLIST['separateurEfface'], 'i');
      if (rgx.test(txt)) { result.grandeDescription = txt.replace(rgx,'').trim(); return; }
      // filtres → classes
      rgx = new RegExp('^' + INFOSLIST['filtres'] + '\\s?\\*?' + INFOSLIST['separateurEfface'], 'i');
      if (rgx.test(txt)) {
        var cleaned = txt.replace(rgx,'').replace(/[\\\/\.\>\<\#\[\]\{\}]/gm,'').trim();
        result.filtres = cleaned; return;
      }
    });

    if (result.__deleted) return null;

    ProfileCache.set(profilePath, result, 7*24*60*60*1000); // 7 jours
    return { profilePath, data: result };
  });
}

/* =========================
   Skeletons + DOM helpers
   ========================= */

function makeSkeleton(profilePath) {
  var $sk = base.clone().addClass('is-skeleton').attr('data-profile-path', profilePath);
  $sk.removeClass('none');
  $sk.find('.avatar_fc').attr('src', '').addClass('sk-rect');
  $sk.find('.name_fc').empty().append('<span class="sk-line"></span>');
  $sk.find('.resume_fc').empty().append('<span class="sk-line"></span><span class="sk-line"></span>');
  $sk.find('.infos_fc').empty();
  $sk.find('a').attr('href', 'javascript:void(0)');
  return $sk;
}
function removeSkeleton(profilePath) {
  $('#bp_fc .member_fc[data-profile-path="' + cssEscapeAttr(profilePath) + '"]').remove();
}
function markSkeletonError(profilePath, err) {
  $('#bp_fc .member_fc[data-profile-path="' + cssEscapeAttr(profilePath) + '"]')
    .addClass('sk-error')
    .attr('title', 'Erreur de chargement : ' + (err && (err.status || err.message) || ''));
}

function setClonedAt(cloned, profile, $placeholder) {
  cloned.find('a.profile_fc')
    .attr('href', (INFOSLIST["URL"] + profile))
    .attr('target', '_blank');

  cloned.find('.mps_fc')
    .attr('href', INFOSLIST["URL"] + members[profile]["mp"])
    .attr('target', '_blank');

  var ctct = cloned.find('.contact_fc td').eq(0);
  if (!jQuery.isEmptyObject(members[profile]["contact"])) {
    for (var contact in members[profile]["contact"]) {
      var obj = createHTML('a',
        createHTML('button', members[profile]["contact"][contact][1])
          .addClass('button1')
          .attr('style', "--hover: '" + contact + "';"))
        .attr('href', members[profile]["contact"][contact][0])
        .attr('target', '_blank');
      ctct.append(obj);
    }
  }
  ctct.append(createHTML('sms', 'contact'));

  cloned.find('.name_fc').html(members[profile]["pseudo"]);
  cloned.find('.avatar_fc').attr('src', members[profile]["avatar"]);

  var resume = cloned.find('.resume_fc');
  if (jQuery.isEmptyObject(members[profile]["infos"])) resume.remove();
  else {
    for (var info in members[profile]["infos"]) {
      resume.append(createHTML('cv', info));
      resume.append(' ');
      resume.append(members[profile]["infos"][info]);
      resume.append(INFOSLIST['separateurAffiche']);
    }
  }

  var hasDesc = (members[profile]["grandeDescription"] != undefined);
  if (hasDesc) {
    cloned.find('.infos_fc').html(members[profile]["grandeDescription"]);
  } else {
    cloned.find('.infos_fc').css('height', '0');
    cloned.find('.resume_fc').removeClass('no-extend').attr('style', 'max-height: unset;');
  }

  cloned.removeClass('none');
  cloned.find('.a_name_fc').eq(0).attr('name', tagName(members[profile]["pseudo"]));
  cloned.addClass(members[profile]["filtres"]);

  $placeholder.replaceWith(cloned);
  return cloned;
}

/* =========================
   Priorisation (optionnelle) du visible
   ========================= */

function priorityScoreForPath(profilePath) {
  var $ph = $('#bp_fc .member_fc[data-profile-path="' + cssEscapeAttr(profilePath) + '"]');
  if (!$ph.length) return Number.POSITIVE_INFINITY;
  var rect = $ph[0].getBoundingClientRect();
  var center = (rect.top + rect.bottom) / 2;
  var winH = window.innerHeight || document.documentElement.clientHeight;
  return Math.abs(center - (winH * 0.3));
}

/* =========================
   Hydratation ultra-rapide (warm-boot)
   ========================= */

async function hydrateFromCacheFast(){
  const idx = MemberIndexCache.get();
  if (!idx || !idx.paths || !idx.paths.length) return false;

  // Fige l’ordre
  orderList = idx.paths.slice();
  orderIndex = Object.create(null);
  orderList.forEach((p,i)=> orderIndex[p]=i);

   // ----- tri alphabétique par pseudo (warm-boot) -----
   const cachedEntries = [];
   for (const path of orderList) {
     const data = ProfileCache.get(path);
     if (data && data.pseudo) cachedEntries.push({ path, pseudo: data.pseudo.toLowerCase() });
   }
   cachedEntries.sort((a, b) => a.pseudo.localeCompare(b.pseudo));
   orderList = cachedEntries.map(e => e.path);
   orderIndex = Object.create(null);
   orderList.forEach((p, i) => orderIndex[p] = i);


  // Skeletons rapides (puis remplacement immédiat si data en cache)
  const frag = document.createDocumentFragment();
  for (const path of orderList) {
    const cached = ProfileCache.get(path);
    if (!cached) continue;
    members[path] = cached;
    const $placeholder = makeSkeleton(path);
    frag.appendChild($placeholder[0]);
  }
  if (frag.childNodes.length) FC[0].appendChild(frag);

  // Remplace in-place sans réseau
  const nodes = Array.from(FC.find('.member_fc[data-profile-path]').toArray());
  for (const el of nodes) {
    const path = el.getAttribute('data-profile-path');
    const data = members[path];
    if (!data) continue;
    setClonedAt(base.clone(), path, $(el));
  }

  // Revalidation “doux” en arrière-plan (premiers items)
  (async ()=> {
    const origRps = MAX_REQUESTS_PER_SEC, origMax = PROFILE_CONCURRENCY_MAX;
    MAX_REQUESTS_PER_SEC = Math.max(3, Math.floor(MAX_REQUESTS_PER_SEC/2));
    PROFILE_CONCURRENCY_MAX = Math.max(4, Math.floor(PROFILE_CONCURRENCY_MAX/2));
    try { await revalidateStaleProfiles(orderList.slice(0, 300)); } catch(_){}
    MAX_REQUESTS_PER_SEC = origRps; PROFILE_CONCURRENCY_MAX = origMax;
  })();

  return true;
}

async function revalidateStaleProfiles(paths){
  for (const p of paths) {
    try {
      const res = await fetchProfileData(p); // passe par TTL
      if (res) {
        members[p] = res.data;
        const node = $('#bp_fc .member_fc[data-profile-path="'+cssEscapeAttr(p)+'"]');
        if (node.length) setClonedAt(base.clone(), p, node);
      }
    } catch(_) {}
  }
}

/* =========================
   Pipeline : toutes les pages (ordre figé)
   ========================= */

let __lastProgressTs = Date.now();
function markProgress(){ __lastProgressTs = Date.now(); }

function setupWatchdog({intervalMs=3000, stallMs=12000} = {}) {
  return setInterval(function(){
    var idle = Date.now() - __lastProgressTs;
    if (idle > stallMs && (!reachedEnd || profileQueue.length > 0)) {
      try { ensureWorkers(true); } catch(_) {}
    }
  }, intervalMs);
}

// portée partagée par stream + watchdog
var reachedEnd = false;
var profileQueue = [];
var inQueue = new Set();

async function streamAllMembers() {
  members = members || {};

  // Hydratation rapide si possible
  const hydrated = await hydrateFromCacheFast();
  if (!hydrated) {
    FC.empty(); // si pas d’hydratation, on repart propre
  }

  var pageIdx = 0;
  reachedEnd = false;
  profileQueue = [];
  inQueue = new Set();
  var allPaths = []; // pour persister l’index

  async function prefetchPages() {
    while (!reachedEnd) {
      const desired = Math.max(PROFILE_CONCURRENCY_MIN, Math.floor(Concurrency.value()));
      const bufferPages = Math.max(PAGE_PREFETCH_AHEAD, Math.ceil(desired / 2));
      if ((profileQueue.length / PAGE_SIZE) >= bufferPages) { await sleep(120); continue; }

      var paths = await fetchMemberListPage(pageIdx);
      if (!paths.length) { reachedEnd = true; break; }

      // Alimente l’ordre global (si nouveaux)
      for (const p of paths) {
        if (orderIndex[p] == null) {
          orderIndex[p] = orderList.length;
          orderList.push(p);
        }
      }

      membersLength += paths.length;
      allPaths = allPaths.concat(paths);

      // Pose les placeholders à la bonne place + alimente la file
      for (const p of paths) {
        if (inQueue.has(p)) continue;
        inQueue.add(p);
        ensurePlaceholder(p);
        profileQueue.push({ path: p });
      }

      pageIdx++;
      markProgress();
    }
  }

  // ----- Choix du dequeue -----
  // A) ordre strict FIFO (déterministe à 100%)
  function dequeueNext(){ return profileQueue.shift() || null; }

  // B) (Option) priorité au visible : remplace la fonction ci-dessus par:
  // function dequeueNext() {
  //   if (!profileQueue.length) return null;
  //   var windowSize = Math.min(20, profileQueue.length);
  //   var bestIdx = 0, bestScore = Number.POSITIVE_INFINITY;
  //   for (var i = 0; i < windowSize; i++) {
  //     var s = priorityScoreForPath(profileQueue[i].path);
  //     if (s < bestScore) { bestScore = s; bestIdx = i; }
  //   }
  //   return profileQueue.splice(bestIdx, 1)[0];
  // }

  async function profileWorker() {
    while (true) {
      const next = dequeueNext();
      if (!next) {
        if (reachedEnd) break;
        await sleep(60);
        continue;
      }
      const path = next.path;
      try {
        // si déjà rendu (hydratation) et pas skeleton → skip
        const $existing = $('#bp_fc .member_fc[data-profile-path="'+cssEscapeAttr(path)+'"]');
        if (members[path] && $existing.length && !$existing.hasClass('is-skeleton')) {
          markProgress(); continue;
        }

        const res = await fetchProfileData(path);
        if (!res) { removeSkeleton(path); markProgress(); continue; }
        members[path] = res.data;

        // s’assurer que le placeholder est là et bien placé
        ensurePlaceholder(path);
        const $slot = $('#bp_fc .member_fc[data-profile-path="' + cssEscapeAttr(path) + '"]');
        setClonedAt(base.clone(), path, $slot);
        markProgress();
      } catch (e) {
        markSkeletonError(path, e);
        next.retries = (next.retries || 0) + 1;
        if (next.retries <= 2) profileQueue.push(next);
      }
    }
  }

  // Lancer le préfetch
  prefetchPages();

  // Pool dynamique
  var workers = new Set();
  function ensureWorkers(forceOne){
    const desired = Math.max(PROFILE_CONCURRENCY_MIN, Math.floor(Concurrency.value()));
    const target = forceOne ? Math.max(desired, workers.size + 1) : desired;
    while (workers.size < target) {
      const $flag = $('<i class="__pf-worker-flag" style="display:none"></i>').appendTo(document.body);
      const w = profileWorker().finally(function(){ $flag.remove(); workers.delete(w); });
      workers.add(w);
    }
  }
  var heart = setInterval(ensureWorkers, 200);
  ensureWorkers();

  // Watchdog anti-stall
  var wd = setupWatchdog({ intervalMs: 3000, stallMs: 12000 });

  // Attente de fin
  while (true) {
    if (reachedEnd && profileQueue.length === 0 && workers.size === 0) break;
    await sleep(200);
  }
  clearInterval(heart);
  clearInterval(wd);

  // Sauvegarde l'ordre alphabétique pour le prochain warm-boot
  const sorted = orderList.slice().sort((a,b)=>{
    const pa = members[a]?.pseudo?.toLowerCase?.() || '';
    const pb = members[b]?.pseudo?.toLowerCase?.() || '';
    return pa.localeCompare(pb);
  });
  MemberIndexCache.set(sorted);


  if (typeof showAllLoadedCheck === 'function') showAllLoadedCheck();
}

/* =========================
   ✅ Indicateur "tout chargé"
   ========================= */

function showAllLoadedCheck() {
  if ($('#fc_done_check').length) return;
  var $msg = $('<div id="fc_done_check" class="fc-done-check">✅ Tous les profils ont été chargés</div>');
  $('body').append($msg);
  $msg.css({
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    background: 'linear-gradient(135deg, #16a34a, #22c55e)',
    color: '#fff',
    padding: '10px 16px',
    borderRadius: '8px',
    fontSize: '15px',
    fontWeight: '500',
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
    zIndex: 9999,
    opacity: 0,
    transition: 'opacity 0.6s ease'
  });
  requestAnimationFrame(function(){ $msg.css('opacity', 1); });
  setTimeout(function(){ $msg.css('opacity', 0); setTimeout(function(){ $msg.remove(); }, 1000); }, 5000);
}
