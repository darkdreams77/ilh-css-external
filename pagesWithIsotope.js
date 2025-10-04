var members;
var membersLength = 0;
var FC;
var base;

$(function () {
  // NORMALIZE FORUM URL
  if (INFOSLIST["URL"][INFOSLIST["URL"].length - 1] == '/')
    INFOSLIST["URL"] = INFOSLIST["URL"].slice(0, -1);

  // NORMALIZE LISTS GIVEN BY ADMINS
  for (var i = 0; i < INFOSLIST["utiles"].length; i++) {
    INFOSLIST["utiles"][i] = norm(INFOSLIST["utiles"][i]);
  }
  for (var i = 0; i < INFOSLIST["supprime"].length; i++) {
    INFOSLIST["supprime"][i] = norm(INFOSLIST["supprime"][i]);
  }
  for (var i = 0; i < INFOSLIST["contact"].length; i++) {
    INFOSLIST["contact"][i][0] = norm(INFOSLIST["contact"][i][0]);
  }

  // NORMALIZE NAMES GIVEN BY ADMINS
  INFOSLIST["grandeDescription"] = norm(INFOSLIST["grandeDescription"]);
  INFOSLIST["filtres"] = norm(INFOSLIST["filtres"]);

  members = {};
  FC = $('#bp_fc');
  base = FC.find('.member_fc').eq(0).clone();
  FC.empty();

  $('.button1.forum').attr('href', INFOSLIST["URL"]);

  // Lancement : charge toutes les pages en streaming
  streamAllMembers();
});

function norm(s) { return String(s).trim().toLowerCase(); }

// strip sûr (si tu as déjà strip(), garde le tien)
function safeStrip(s) {
  if (typeof s !== 'string') return '';
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
var strip = (typeof strip === 'function') ? strip : safeStrip;

// $.ajax HTML + retry (429/5xx) avec backoff exponentiel + jitter
function getHTMLWithRetry(url, opts) {
  var maxRetries = (opts && opts.maxRetries) || 6;
  var attempt = 0;
  var backoffBase = 500;   // ms
  var backoffCap  = 8000;  // ms

  function once() {
    return $.ajax({
      url: url,
      type: 'GET',
      dataType: 'html',
      xhrFields: { withCredentials: true } // utile si sous-domaines
    }).catch(function (jqXHR) {
      var status = jqXHR && jqXHR.status;
      if (attempt >= maxRetries) return $.Deferred().reject(jqXHR).promise();

      // Retry sur 429 et 5xx, sinon on propage l’erreur
      if (status === 429 || (status >= 500 && status < 600)) {
        attempt++;
        var delay = Math.min(backoffCap, backoffBase * Math.pow(2, attempt));
        // jitter +/- 30%
        var jitter = delay * (0.3 * (Math.random() - 0.5));
        var wait = Math.max(250, Math.floor(delay + jitter));
        return new Promise(function (res) { setTimeout(res, wait); }).then(once);
      }
      return $.Deferred().reject(jqXHR).promise();
    });
  }
  return once();
}

// Convertit string HTML → $doc fiable
function toDoc(html) {
  var nodes = $.parseHTML(html, document, true);
  var $wrap = $('<div/>'); $wrap.append(nodes);
  return $wrap;
}

// Config
var PAGE_SIZE = 50;           // Forumactif : 50 entrées par page
var PROFILE_CONCURRENCY = 6;  // nb de profils chargés en parallèle

// Retourne les paths "/u123" d'une page de la memberlist
async function fetchMemberListPage(pageIndexZeroBased) {
  var start = pageIndexZeroBased * PAGE_SIZE;
  var url = INFOSLIST["URL"] + '/memberlist?mode=username&order=DESC&start=' + start + '&username';
  var html = await getHTMLWithRetry(url);
  var $doc = toDoc(html);
  var $links = $doc.find('a[href^="/u"]');
  var set = new Set();
  $links.each(function () {
    var href = $(this).attr('href');
    if (href) set.add(href.split('?')[0]);
  });
  return Array.from(set);
}

// Télécharge et parse un profil → { profilePath, data }
async function fetchProfileData(profilePath) {
  var url = INFOSLIST["URL"] + profilePath;
  var html = await getHTMLWithRetry(url);
  var $doc = toDoc(html);

  var numberMatch = (new URL(url)).pathname.match(/\d+/);
  var number = numberMatch ? numberMatch[0] : null;

  var result = {
    number: number,
    mp: number ? ("/privmsg?mode=post&u=" + number) : null,
    contact: {},
    infos: {}
  };

  // Pseudo
  result.pseudo = $doc.find(INFOSLIST['pseudo']).text() || '';

  // Avatar
  result.avatar = $doc.find(INFOSLIST['avatar']).attr('src') || '';

  // Champs utiles
  var $dataInfo = $doc.find(INFOSLIST["champUtile"]);
  $dataInfo.each(function () {
    var txt = norm($(this).text() || '');
    var rgx, m;

    // Flag "supprimé" ?
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

    // filtres (classes)
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

async function streamAllMembers() {
  var page = 0;
  var allEmpty = false;

  while (!allEmpty) {
    // 1) Récupère la page de la memberlist (avec retry)
    var paths = await fetchMemberListPage(page);
    if (!paths.length) {
      allEmpty = true;
      break;
    }

    membersLength += paths.length;

    // 2) Crée des skeletons visibles immédiatement (effet de chargement propre)
    var placeholders = [];
    for (var i = 0; i < paths.length; i++) {
      var path = paths[i];
      var $ph = makeSkeleton(path); // retourne un jQuery <li.member_fc ...>
      FC.append($ph);
      placeholders.push($ph);
    }

    // 3) Charge les profils avec une concurrence limitée
    await drainQueueWithConcurrency(paths, PROFILE_CONCURRENCY, async function (path) {
      try {
        var res = await fetchProfileData(path);
        if (!res) {
          // profil "supprimé" → enlève le skeleton
          removeSkeleton(path);
          return;
        }
        var data = res.data;
        members[path] = data;

        // Remplace le skeleton par la vraie carte
        var $slot = $('#bp_fc .member_fc[data-profile-path="' + cssEscape(path) + '"]');
        if ($slot.length) {
          var $node = setClonedAt(base.clone(), path, $slot); // remplace in-place
          // show (au cas où)
          $node.removeClass('is-skeleton').addClass(data.filtres || '');
        } else {
          // fallback (rare) : on insère quand même
          setCloned(base.clone(), path);
        }
      } catch (e) {
        // En cas d'échec durable après retries HTML : laisse le skeleton en "retry"
        markSkeletonError(path, e);
      }
    });

    // 4) Page suivante
    page++;
  }
}

/** Exécute une queue avec concurrence N */
function drainQueueWithConcurrency(items, concurrency, worker) {
  var q = items.slice();
  var running = 0;
  var d = $.Deferred();

  function next() {
    if (!q.length && running === 0) return d.resolve();
    while (running < concurrency && q.length) {
      var item = q.shift();
      running++;
      Promise.resolve(worker(item))
        .catch(function(){ /* déjà géré dans worker */ })
        .finally(function () { running--; next(); });
    }
  }
  next();
  return d.promise();
}

// Petit polyfill d’escape CSS (pour sélecteurs d’attribut)
function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

// Crée un skeleton (même structure .member_fc) repérable par data-profile-path
function makeSkeleton(profilePath) {
  var $sk = base.clone().addClass('is-skeleton').attr('data-profile-path', profilePath);
  $sk.removeClass('none');
  // avatar gris + barres animées
  $sk.find('.avatar_fc').attr('src', '').addClass('sk-rect');
  $sk.find('.name_fc').empty().append('<span class="sk-line"></span>');
  $sk.find('.resume_fc').empty().append('<span class="sk-line"></span><span class="sk-line"></span>');
  $sk.find('.infos_fc').empty(); // fermée par défaut
  // liens inactifs
  $sk.find('a').attr('href', 'javascript:void(0)');
  return $sk;
}

function removeSkeleton(profilePath) {
  $('#bp_fc .member_fc[data-profile-path="' + cssEscape(profilePath) + '"]').remove();
}
function markSkeletonError(profilePath, err) {
  $('#bp_fc .member_fc[data-profile-path="' + cssEscape(profilePath) + '"]')
    .addClass('sk-error')
    .attr('title', 'Erreur de chargement : ' + (err && (err.status || err.message) || ''));
}

// Variante de setCloned qui **remplace** un placeholder existant
function setClonedAt(cloned, profile, $placeholder) {
  // — Copie stricte de setCloned, sauf la dernière ligne : on replace au lieu de prepend —
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

  // ⬇️ différence ici : remplacement in-place
  $placeholder.replaceWith(cloned);
  return cloned;
}
