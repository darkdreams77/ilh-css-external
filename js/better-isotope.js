/* =========================
   Faceclaim Loader – Full
   ========================= */

var members;
var membersLength = 0;
var FC;
var base;

/* ===== TUNING ===== */
var PAGE_SIZE = 50;                // Forumactif
var PROFILE_CONCURRENCY_MIN = 2;
var PROFILE_CONCURRENCY_MAX = 12;
var START_CONCURRENCY       = 5;
var MAX_REQUESTS_PER_SEC    = 5;   // limite réseau
var LATENCY_SOFT_LIMIT_MS   = 1200;
var PAGE_PREFETCH_AHEAD     = 2;   // pages en avance

$(function () {
  // NORMALIZE FORUM URL
  if (INFOSLIST["URL"][INFOSLIST["URL"].length - 1] == '/')
    INFOSLIST["URL"] = INFOSLIST["URL"].slice(0, -1);

  // NORMALIZE LISTS GIVEN BY ADMINS
  for (var i = 0; i < INFOSLIST["utiles"].length; i++) {
    INFOSLIST["utiles"][i] = norm(INFOSLIST["utiles"][i]);
  }
  for (var j = 0; j < INFOSLIST["supprime"].length; j++) {
    INFOSLIST["supprime"][j] = norm(INFOSLIST["supprime"][j]);
  }
  for (var k = 0; k < INFOSLIST["contact"].length; k++) {
    INFOSLIST["contact"][k][0] = norm(INFOSLIST["contact"][k][0]);
  }

  // NORMALIZE NAMES GIVEN BY ADMINS
  INFOSLIST["grandeDescription"] = norm(INFOSLIST["grandeDescription"]);
  INFOSLIST["filtres"] = norm(INFOSLIST["filtres"]);

  members = {};
  FC = $('#bp_fc');
  base = FC.find('.member_fc').eq(0).clone();
  FC.empty();

  $('.button1.forum').attr('href', INFOSLIST["URL"]);

  // Lancement
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
// si un strip() existe déjà, on garde le tien, sinon safe
var strip = (typeof strip === 'function') ? strip : safeStrip;

// Convertit string HTML → $doc fiable
function toDoc(html) {
  var nodes = $.parseHTML(html, document, true);
  var $wrap = $('<div/>');
  $wrap.append(nodes);
  return $wrap;
}

// Petit escape pour sélecteurs d'attribut
function cssEscapeAttr(s) { return String(s).replace(/["\\]/g, '\\$&'); }

// Pause
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* =========================
   Rate limiter + Backoff
   ========================= */

// Token bucket simple (remplissage à capacité 1x/s)
var Bucket = (function () {
  var capacity = MAX_REQUESTS_PER_SEC;
  var tokens = capacity;
  setInterval(function () { tokens = capacity; }, 1000); // refill total chaque seconde
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

// Concurrence adaptative AIMD
var Concurrency = (function () {
  var current = START_CONCURRENCY;
  return {
    value: function () { return current; },
    onSuccess: function (latencyMs) {
      if (latencyMs < LATENCY_SOFT_LIMIT_MS) {
        current = Math.min(PROFILE_CONCURRENCY_MAX, current + 0.2);
      } else {
        current = Math.max(PROFILE_CONCURRENCY_MIN, current - 0.5);
      }
    },
    onThrottle: function () {
      current = Math.max(PROFILE_CONCURRENCY_MIN, Math.floor(current / 2) || 1);
    }
  };
})();

// AJAX HTML géré (rate-limit + backoff + Retry-After)
async function getHTMLManaged(url, opts) {
  opts = opts || {};
  var maxRetries = opts.maxRetries != null ? opts.maxRetries : 6;
  var attempt = 0;

  while (true) {
    await Bucket.take();
    var t0 = performance.now();
    try {
      var data = await $.ajax({
        url: url,
        type: 'GET',
        dataType: 'html',
        xhrFields: { withCredentials: true } // utile si sous-domaines
      });
      var dt = performance.now() - t0;
      Concurrency.onSuccess(dt);
      return data;
    } catch (e) {
      var status = e && e.status;
      var retryAfterHeader = (typeof e.getResponseHeader === 'function') ? e.getResponseHeader('Retry-After') : null;
      var retryAfter = retryAfterHeader ? Number(retryAfterHeader) : null;

      if (status === 429 || (status >= 500 && status < 600)) {
        attempt++;
        Concurrency.onThrottle();
        if (attempt > maxRetries) throw e;

        var base = retryAfter ? retryAfter * 1000 : Math.min(8000, 400 * Math.pow(2, attempt));
        var jitter = base * (0.3 * (Math.random() - 0.5));
        await sleep(Math.max(300, base + jitter));
        continue;
      }
      throw e; // 4xx (hors 429) → inutile d’insister
    }
  }
}

/* =========================
   Fetch memberlist & profils
   ========================= */

// Retourne les paths "/u123" d'une page de memberlist
async function fetchMemberListPage(pageIndexZeroBased) {
  var start = pageIndexZeroBased * PAGE_SIZE;
  var url = INFOSLIST["URL"] + '/memberlist?mode=username&order&start=' + start + '&username';
  var html = await getHTMLManaged(url);
  var $doc = toDoc(html);
  var set = new Set();
  $doc.find('a[href^="/u"]').each(function () {
    var href = $(this).attr('href');
    if (href) set.add(href.split('?')[0]);
  });
  return Array.from(set);
}

// Télécharge + parse un profil → { profilePath, data } | null si "supprimé"
async function fetchProfileData(profilePath) {
  var url = INFOSLIST["URL"] + profilePath;
  var html = await getHTMLManaged(url);
  var $doc = toDoc(html);

  var numberMatch = (new URL(url)).pathname.match(/\d+/);
  var number = numberMatch ? numberMatch[0] : null;

  var result = {
    number: number,
    mp: number ? ("/privmsg?mode=post&u=" + number) : null,
    contact: {},
    infos: {}
  };

  // Pseudo & avatar
  result.pseudo = $doc.find(INFOSLIST['pseudo']).text() || '';
  result.avatar = $doc.find(INFOSLIST['avatar']).attr('src') || '';

  // Infos utiles
  var $dataInfo = $doc.find(INFOSLIST["champUtile"]);
  $dataInfo.each(function () {
    var txt = norm($(this).text() || '');
    var rgx, m;

    // Suppression ?
    rgx = new RegExp('^' + INFOSLIST['supprime'][0] + '\\s?\\*?' + INFOSLIST['separateurEfface'] + '(.+)', 'i');
    m = txt.match(rgx);
    if (m && strip(m[1]) === strip(INFOSLIST['supprime'][1])) {
      result.__deleted = true;
      return false; // break
    }

    // petites infos
    for (var i = 0; i < INFOSLIST["utiles"].length; i++) {
      var displayed = INFOSLIST["utiles"][i];
      rgx = new RegExp('^' + displayed + '\\s?\\*?' + INFOSLIST['separateurEfface'], 'i');
      if (rgx.test(txt)) {
        result.infos[displayed] = txt.replace(rgx, '').trim();
        return; // continue each
      }
    }

    // contacts
    for (var j = 0; j < INFOSLIST["contact"].length; j++) {
      var name = INFOSLIST["contact"][j][0];
      rgx = new RegExp('^' + name + '\\s?\\*?' + INFOSLIST['separateurEfface'], 'i');
      if (rgx.test(txt)) {
        result.contact[name] = [txt.replace(rgx, '').trim(), INFOSLIST["contact"][j][1]];
        return;
      }
    }

    // grande description
    rgx = new RegExp('^' + INFOSLIST['grandeDescription'] + '\\s?\\*?' + INFOSLIST['separateurEfface'], 'i');
    if (rgx.test(txt)) {
      result.grandeDescription = txt.replace(rgx, '').trim();
      return;
    }

    // filtres → classes
    rgx = new RegExp('^' + INFOSLIST['filtres'] + '\\s?\\*?' + INFOSLIST['separateurEfface'], 'i');
    if (rgx.test(txt)) {
      var cleaned = txt.replace(rgx, '').replace(/[\\\/\.\>\<\#\[\]\{\}]/gm, '').trim();
      result.filtres = cleaned; // ex: "student nyc lefty"
      return;
    }
  });

  if (result.__deleted) return null;
  return { profilePath: profilePath, data: result };
}

/* =========================
   Skeletons + DOM helpers
   ========================= */

// Crée un skeleton .member_fc avec data-profile-path
function makeSkeleton(profilePath) {
  var $sk = base.clone().addClass('is-skeleton').attr('data-profile-path', profilePath);
  $sk.removeClass('none');
  // placeholders visuels
  $sk.find('.avatar_fc').attr('src', '').addClass('sk-rect');
  $sk.find('.name_fc').empty().append('<span class="sk-line"></span>');
  $sk.find('.resume_fc').empty().append('<span class="sk-line"></span><span class="sk-line"></span>');
  $sk.find('.infos_fc').empty();
  // désactive les liens pendant le chargement
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

// Variante de setCloned : remplace un placeholder in-place
function setClonedAt(cloned, profile, $placeholder) {
  // — Copie de setCloned avec remplacement in-place —
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

  // pseudo + avatar
  cloned.find('.name_fc').html(members[profile]["pseudo"]);
  cloned.find('.avatar_fc').attr('src', members[profile]["avatar"]);

  // resume
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

  // grande description
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
   Affichage existant (inchangé)
   ========================= */

// Si tu veux encore utiliser setCloned ailleurs
function setCloned(cloned, profile) {
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

  FC.prepend(cloned);
  return cloned;
}

/* =========================
   Priorisation du visible
   ========================= */

// Score de priorité (plus petit = plus urgent)
function priorityScoreForPath(profilePath) {
  var $ph = $('#bp_fc .member_fc[data-profile-path="' + cssEscapeAttr(profilePath) + '"]');
  if (!$ph.length) return Number.POSITIVE_INFINITY;
  var rect = $ph[0].getBoundingClientRect();
  var center = (rect.top + rect.bottom) / 2;
  var winH = window.innerHeight || document.documentElement.clientHeight;
  var dist = Math.abs(center - (winH * 0.3));
  return dist;
}

let __lastProgressTs = Date.now();
function markProgress(){ __lastProgressTs = Date.now(); }

// “kick” si pas de progrès depuis N sec
function setupWatchdog({intervalMs=3000, stallMs=10000} = {}) {
  return setInterval(() => {
    const idle = Date.now() - __lastProgressTs;
    if (idle > stallMs && (!reachedEnd || profileQueue.length > 0)) {
      // On relance un worker et on force un tour de prefetch
      try { ensureWorkers(true /*forceOne*/); } catch {}
      try { prefetchNudge(); } catch {}
    }
  }, intervalMs);
}

// petit nudge de prefetch
function prefetchNudge(){
  // rien à faire ici si prefetchPages tourne, mais on peut pousser un tick logique
  // par exemple en diminuant légèrement le tampon pour déclencher un tour
}


/* =========================
   Pipeline : toutes les pages
   ========================= */

async function streamAllMembers() {
  members = members || {};
  FC.empty();

  var pageIdx = 0;
  var reachedEnd = false;
  var profileQueue = []; // { path, retries? }
  var inQueue = new Set();

  // Précharge des pages pendant qu’on traite les profils
  async function prefetchPages() {
    const wd = setupWatchdog({ intervalMs: 3000, stallMs: 12000 });  
    while (!reachedEnd) {
      const desired = Math.max(PROFILE_CONCURRENCY_MIN, Math.floor(Concurrency.value()));
      const bufferPages = Math.max(PAGE_PREFETCH_AHEAD, Math.ceil(desired / 2));
      if ((profileQueue.length / PAGE_SIZE) >= bufferPages) { await sleep(120); continue; }

      var paths = await fetchMemberListPage(pageIdx);
      if (!paths.length) { reachedEnd = true; break; }

      membersLength += paths.length;

      // Placeholders en batch pour performance
      var frag = document.createDocumentFragment();
      for (var i = 0; i < paths.length; i++) {
        var p = paths[i];
        if (inQueue.has(p)) continue;
        inQueue.add(p);
        var $ph = makeSkeleton(p);
        frag.appendChild($ph[0]);
        profileQueue.push({ path: p });
      }
      FC[0].appendChild(frag);

      pageIdx++;
    }
  }

  // Défile un élément de queue avec petite fenêtre triée par priorité visuelle
  function dequeueNext() {
    if (!profileQueue.length) return null;
    var windowSize = Math.min(20, profileQueue.length);
    var bestIdx = 0, bestScore = Number.POSITIVE_INFINITY;
    for (var i = 0; i < windowSize; i++) {
      var s = priorityScoreForPath(profileQueue[i].path);
      if (s < bestScore) { bestScore = s; bestIdx = i; }
    }
    return profileQueue.splice(bestIdx, 1)[0];
  }

  // Nombre de workers actifs (flag DOM discret)
  function activeWorkers() { return $('.__pf-worker-flag').length; }

  // Worker profil (remplace entièrement l’ancienne version)
   async function profileWorker() {
     while (true) {
       // 1) Prendre le prochain item
       const next = dequeueNext();
       if (!next) {
         // plus d’items en file : si on a atteint la fin ET plus rien à traiter → sort
         if (reachedEnd) break;
         await sleep(60);
         continue;
       }
   
       const path = next.path;
       try {
         const res = await fetchProfileData(path);
         if (!res) { removeSkeleton(path); continue; }
   
         members[path] = res.data;
   
         // Remplacement in-place
         const $slot = $('#bp_fc .member_fc[data-profile-path="' + cssEscapeAttr(path) + '"]');
         if ($slot.length) {
           const node = setClonedAt(base.clone(), path, $slot);
           $(node).removeClass('is-skeleton').addClass(res.data.filtres || '');
         } else {
           setCloned(base.clone(), path);
         }
   
         // Progrès pour le watchdog
         markProgress();
   
       } catch (e) {
         // marque l’erreur et re-essaie jusqu’à 2 fois
         markSkeletonError(path, e);
         next.retries = (next.retries || 0) + 1;
         if (next.retries <= 2) profileQueue.push(next);
       }
     }
   }


  // Démarre le préfetch en parallèle
  prefetchPages();

  // Démarre un pool dynamique de workers
  var workers = new Set();
   function ensureWorkers(forceOne){
     const desired = Math.max(PROFILE_CONCURRENCY_MIN, Math.floor(Concurrency.value()));
     const target = forceOne ? Math.max(desired, workers.size + 1) : desired;
   
     while (workers.size < target) {
       const $flag = $('<i class="__pf-worker-flag" style="display:none"></i>').appendTo(document.body);
       const w = profileWorker().finally(() => { $flag.remove(); workers.delete(w); });
       workers.add(w);
     }
     // si trop de workers, on ne tue pas brutalement : ils se termineront naturellement
  }

  var heart = setInterval(ensureWorkers, 200);
  ensureWorkers();

  // Attente de fin
  while (true) {
    if (reachedEnd && profileQueue.length === 0 && workers.size === 0) break;
    await sleep(200);
  }
  clearInterval(heart);

  // ✅ Indicateur de fin
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
    background: '#222',
    color: '#fff',
    padding: '10px 16px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
    zIndex: 9999,
    opacity: 0,
    transition: 'opacity 0.6s ease'
  });

  requestAnimationFrame(function () { $msg.css('opacity', 1); });

  setTimeout(function () {
    $msg.css('opacity', 0);
    setTimeout(function () { $msg.remove(); }, 1000);
  }, 5000);
}
