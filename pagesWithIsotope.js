var members;
var membersLength;
var FC;
var base;

$(function() {

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
    members = setMembers();
    FC = $('#bp_fc');
    base = FC.find('.member_fc').eq(0).clone();
    setFaceclaim();

    $('.button1.forum').attr('href', INFOSLIST["URL"]);
});





////////// STEP 0 : GLOBAL FUNCTIONS //////////

function norm(s) {
    return s.trim().toLowerCase();
}





////////// STEP 1 : GET URLS AND NAMES //////////

function setMembers() {
    var mbrs = {};
    var going = true;

    /*format the urls*/
    var URLpage = '/memberlist?mode=username&order=DESC';
    var URLstart = '&start=';
    var URLnumber = 0;
    var URLusername = '&username';
    var URL = INFOSLIST["URL"] + URLpage + URLusername;
    var going = true;
    var limit = 50;
    var l = 0;


    /*goes through the memberlist*/
    while (going) {
        var profiles = gip(URL, 'a[href^="/u"]');
        var c = 0;
        if (profiles.length === 0) going = false;
        else {

            for (var pseudo of profiles) {
                var hrf = $(pseudo).attr('href');
                if (mbrs[hrf] == undefined) {
                    mbrs[hrf] = {};
                    URLnumber += 1;
                }
            }

            URL = INFOSLIST["URL"] + URLpage + URLstart + URLnumber + URLusername;

            if (limit == 0) going = false;
            else limit--;
        }
    }
    membersLength = URLnumber;
    console.log(mbrs);
    console.log("members length : " + membersLength);
    return mbrs;
}

/*
    gets $(infoCSS) from the url page
*/
function gip(url, infoCSS) {
    var toreturn;
    $.ajax({
        url : url,
        type: 'GET',
        dataType: 'html',
        success : function(data) {
            toreturn = $(infoCSS, $(data))
        },
        async: false
    });
    return toreturn;
}





////////// STEP 1 : GET URLS AND NAMES //////////
function setFaceclaim() {
    for (var profile in members) {
        console.log(INFOSLIST["URL"] + profile);
        $.ajax({
            url : INFOSLIST["URL"] + profile,
            async: true,
            success: function(data) {
                var url = new URL(this.url);
                var profile = url.pathname;
                members[profile]["number"] = profile.match(/\d+/)[0];
                var rgx;


                //////////////////// INFOS LIST ////////////////////
                // find and stores alll small infos on the character
                var dataInfo = $(INFOSLIST["champUtile"], $(data));
                members[profile]["infos"] = {};
                members[profile]["contact"] = {};
                for (var info of dataInfo) {
                    var txt = norm($(info).text());

                    // VERIFIES IF SHOULD DELETE
                    rgx = new RegExp('^' + INFOSLIST['supprime'][0] + '\\s?\\*?' + INFOSLIST['separateurEfface'] + '(.+)');
                    var deleted = txt.match(rgx);
                    if (deleted != null) {
                        if (strip(deleted[1]) == strip(INFOSLIST['supprime'][1])) return;
                    }

                    // FINDS SMALL INFOS
                    for (var displayed of INFOSLIST["utiles"]) {
                        rgx = new RegExp('^' + displayed + '\\s?\\*?' + INFOSLIST['separateurEfface']);
                        if (txt.match(rgx) != null) {
                            members[profile]["infos"][displayed] = txt.replace(rgx, '');
                            break;
                        }
                    }

                    // FINDS CONTACT FIELDS
                    for (var contact of INFOSLIST["contact"]) {
                        var name = contact[0];
                        rgx = new RegExp('^' + name + '\\s?\\*?' + INFOSLIST['separateurEfface']);
                        if (txt.match(rgx) != null) {
                            members[profile]["contact"][name] = [txt.replace(rgx, ''), contact[1]];
                            break;
                        }
                    }

                    // finds and stores the big info on the character
                    rgx = new RegExp('^' + INFOSLIST['grandeDescription'] + '\\s?\\*?' + INFOSLIST['separateurEfface']);
                    if (txt.match(rgx) != null) members[profile]["grandeDescription"] = txt.replace(rgx, '');

                    // finds and stores all the classes
                    rgx = new RegExp('^' + INFOSLIST['filtres'] + '\\s?\\*?' + INFOSLIST['separateurEfface']);
                    if (txt.match(rgx) != null) {
                        txt = txt.replace(rgx, '');
                        txt = txt.replace(/[\\\/\.\>\<\#\[\]\{\}]/gm, '');
                        members[profile]["filtres"] = txt;
                    }
                }


                //////////////////// OTHER INFOS ////////////////////

                // find and stores pseudo
                members[profile]["pseudo"] = $(INFOSLIST['pseudo'], $(data)).text();

                // find and stores avatar url
                members[profile]["avatar"] = $(INFOSLIST['avatar'], $(data)).attr('src');

                // finds mp
                var mps = $('a[href^="/privmsg"]', $(data));
                members[profile]["mp"] = "/privmsg?mode=post&u=" + members[profile]["number"];



                //////////////////// CLONE ////////////////////
                var cloned = setCloned(base.clone(), profile);
                console.log("ajax call ok");
            }
        });
    }
}



function setCloned(cloned, profile) {
    // defines profile link
    cloned.find('a.profile_fc')
        .attr('href', (INFOSLIST["URL"] + profile))
        .attr('target', '_blank');

    // defines mp
    cloned.find('.mps_fc')
        .attr('href', INFOSLIST["URL"] + members[profile]["mp"])
        .attr('target', '_blank');

    // defines contact
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

    // defines pseudo
    cloned.find('.name_fc').html(members[profile]["pseudo"]);

    // defines avatar
    cloned.find('.avatar_fc').attr('src', members[profile]["avatar"]);

    // defines (or retrieves) small infos in resume
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

    // defines (or untoggle) big description
    var hasDesc = (members[profile]["grandeDescription"] != undefined);
    if (hasDesc) {
        cloned.find('.infos_fc').html(members[profile]["grandeDescription"]);
    } else {
        cloned.find('.infos_fc').css('height', '0');
        cloned.find('.resume_fc').removeClass('no-extend').attr('style', 'max-height: unset;');
    }

    // displays cloned and prepends it to main
    cloned.removeClass('none');

    // add inputbox a_name_fc
    cloned.find('.a_name_fc').eq(0).attr('name', tagName(members[profile]["pseudo"]));

    // add the filters
    cloned.addClass(members[profile]["filtres"]);

    FC.prepend(cloned);
    return cloned;
}

// ===== Config =====
var PAGE_SIZE = 50;                // Forumactif: 50 membres par page
var PROFILE_CONCURRENCY = 6;       // nb de profils téléchargés en parallèle
var currentPage = 1;               // 1-based
var isLoading = false;
var hasNext = true;

// ===== État global existant =====
var members;  // cache: { "/u123": {...}, ... }
var FC;       // $('#bp_fc')
var base;     // base.clone()

// ===== Filtres (état) =====
var activeFilters = {
  q: "",               // recherche texte (pseudo, infos, grandeDescription)
  classes: []          // tableau de classes requises (ET logique)
};

// ===== Utils =====
function debounce(fn, ms) {
  var t; return function() {
    clearTimeout(t);
    var args = arguments, ctx = this;
    t = setTimeout(function(){ fn.apply(ctx, args); }, ms);
  };
}

// --- helper: strip safe au cas où le tien n’est pas défini ---
function safeStrip(s) {
  if (typeof s !== 'string') return '';
  // enlève espaces, ponctuation "douce" et met en lower
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
// si tu as déjà strip(), on garde le tien, sinon on mappe
var strip = (typeof strip === 'function') ? strip : safeStrip;

// --- GET HTML fiable (préserve cookies) ---
function getHTML(url) {
  return $.ajax({
    url,
    type: 'GET',
    dataType: 'html',
    xhrFields: { withCredentials: true } // utile si sous-domaine
  });
}

// --- parser util : retourne un jQuery "document" sûr ---
function toDoc(html) {
  // $.parseHTML donne un array de nodes : on les colle dans un div
  const nodes = $.parseHTML(html, document, true);
  const $wrap = $('<div/>');
  $wrap.append(nodes);
  return $wrap;
}

// --- fetch 1 profil (version robuste & verbeuse) ---
async function fetchProfileData(profilePath) {
  const url = INFOSLIST["URL"] + profilePath;
  const html = await getHTML(url);
  const $doc = toDoc(html); // <--- différent de $(html)
  
  // numéro
  const numberMatch = (new URL(url)).pathname.match(/\d+/);
  const number = numberMatch ? numberMatch[0] : null;

  const result = {
    number,
    mp: number ? ("/privmsg?mode=post&u=" + number) : null,
    contact: {},
    infos: {}
  };

  // PSEUDO
  const $pseudo = $(INFOSLIST['pseudo'], $doc);
  result.pseudo = $pseudo.text() || '';
  if (!result.pseudo) {
    console.warn('[FC] pseudo introuvable pour', profilePath, 'selector=', INFOSLIST['pseudo']);
  }

  // AVATAR
  const $avatar = $(INFOSLIST['avatar'], $doc);
  result.avatar = $avatar.attr('src') || '';
  if (!result.avatar) {
    console.warn('[FC] avatar introuvable pour', profilePath, 'selector=', INFOSLIST['avatar']);
  }

  // CHAMPS UTILES
  const $dataInfo = $(INFOSLIST["champUtile"], $doc);
  if ($dataInfo.length === 0) {
    console.warn('[FC] champUtile vide pour', profilePath, 'selector=', INFOSLIST["champUtile"]);
  }

  // Parcours infos
  $dataInfo.each(function () {
    let txt = norm($(this).text() || '');

    // suppression ?
    let rgx = new RegExp('^' + INFOSLIST['supprime'][0] + '\\s?\\*?' + INFOSLIST['separateurEfface'] + '(.+)', 'i');
    const deleted = txt.match(rgx);
    if (deleted) {
      if (strip(deleted[1]) === strip(INFOSLIST['supprime'][1])) {
        // profil à ignorer
        result.__deleted = true;
        return false; // break .each
      }
    }

    // petites infos
    for (const displayed of INFOSLIST["utiles"]) {
      rgx = new RegExp('^' + displayed + '\\s?\\*?' + INFOSLIST['separateurEfface'], 'i');
      if (rgx.test(txt)) {
        result.infos[displayed] = txt.replace(rgx, '').trim();
        return; // continue .each
      }
    }

    // contacts
    for (const contact of INFOSLIST["contact"]) {
      const name = contact[0];
      rgx = new RegExp('^' + name + '\\s?\\*?' + INFOSLIST['separateurEfface'], 'i');
      if (rgx.test(txt)) {
        result.contact[name] = [txt.replace(rgx, '').trim(), contact[1]];
        return;
      }
    }

    // grande description
    let rgxGD = new RegExp('^' + INFOSLIST['grandeDescription'] + '\\s?\\*?' + INFOSLIST['separateurEfface'], 'i');
    if (rgxGD.test(txt)) {
      result.grandeDescription = txt.replace(rgxGD, '').trim();
      return;
    }

    // filtres → classes
    let rgxF = new RegExp('^' + INFOSLIST['filtres'] + '\\s?\\*?' + INFOSLIST['separateurEfface'], 'i');
    if (rgxF.test(txt)) {
      let cleaned = txt.replace(rgxF, '').replace(/[\\\/\.\>\<\#\[\]\{\}]/gm, '').trim();
      result.filtres = cleaned; // "student nyc lefty"
      return;
    }
  });

  if (result.__deleted) return null;

  // Logs de diag si quasi vide
  if (!result.pseudo && $.isEmptyObject(result.infos) && !result.grandeDescription) {
    console.warn('[FC] profil pauvre en données → vérifie INFOSLIST selectors.', {
      profilePath, pseudoSel: INFOSLIST['pseudo'], avatarSel: INFOSLIST['avatar'], champSel: INFOSLIST['champUtile']
    });
  }

  return { profilePath, data: result };
}


// Récupère les profils sur une page de la memberlist (renvoie tableau de "/u123")
async function fetchMemberListPage(page) {
  var start = (page - 1) * PAGE_SIZE;
  var url = INFOSLIST["URL"] + '/memberlist?mode=username&order=DESC&start=' + start + '&username';
  const html = await getHTML(url);
  const $links = $('a[href^="/u"]', $(html));
  if ($links.length === 0) return [];

  const set = new Set();
  $links.each(function () {
    const href = $(this).attr('href');
    if (href) set.add(href.split('?')[0]);
  });
  return Array.from(set);
}

// Test filtre pour un membre
function matchesFilters(member) {
  // texte : pseudo + infos + grandeDescription
  if (activeFilters.q) {
    const q = activeFilters.q;
    const hay = [
      member.pseudo || '',
      member.grandeDescription || '',
      Object.values(member.infos || {}).join(' ')
    ].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }

  // classes (AND)
  if (activeFilters.classes.length) {
    const cls = (member.filtres || '').toLowerCase().split(/\s+/).filter(Boolean);
    for (const req of activeFilters.classes) {
      if (!cls.includes(req)) return false;
    }
  }

  return true;
}

// Applique les filtres à tout ce qui est déjà dans le DOM
function applyFiltersToDOM() {
  // On parcourt les items déjà rendus
  FC.children('.member_fc').each(function() {
    const $node = $(this);
    const href = $node.find('a.profile_fc').attr('href') || '';
    // href est absolu, on veut le path "/u123"
    let profilePath = href.replace(INFOSLIST["URL"], '');
    if (!profilePath.startsWith('/')) {
      // au cas où href soit relatif
      try {
        profilePath = new URL(href).pathname;
      } catch (_) {}
    }

    const member = members[profilePath];
    const ok = member && matchesFilters(member);
    $node.toggleClass('is-filtered-out', !ok).toggle(ok);
  });
}

// Charge la page suivante (50 profils), puis stream les profils avec concurrence limitée
async function loadNextPage() {
  if (isLoading || !hasNext) return;
  isLoading = true;

  try {
    const profilePaths = await fetchMemberListPage(currentPage);
    if (!profilePaths.length) {
      hasNext = false;
      return;
    }

    // petite queue concurrente
    const queue = [...profilePaths];
    const workers = new Array(Math.min(PROFILE_CONCURRENCY, queue.length)).fill(null).map(async () => {
      while (queue.length) {
        const path = queue.shift();
        try {
          const res = await fetchProfileData(path);
          if (!res) continue;
          const { profilePath, data } = res;

          // cache
          members[profilePath] = data;

          // clone et injecte
          const cloned = setCloned(base.clone(), profilePath);

          // applique classes filtres (ton setCloned le fait déjà via members[...].filtres)
          // on ajuste la visibilité selon filtres actifs
          if (!matchesFilters(data)) {
            $(cloned).addClass('is-filtered-out').hide();
          } else {
            $(cloned).show();
          }

          FC.append(cloned); // on append (ordre naturel), tu peux garder prepend si tu préfères
        } catch (e) {
          console.error('Erreur profil:', path, e);
        }
      }
    });

    await Promise.all(workers);
    currentPage += 1; // prête pour la prochaine rafale
  } finally {
    isLoading = false;
  }
}

// IntersectionObserver pour infinite scroll
function setupInfiniteScroll() {
  const sentinel = document.getElementById('fc_sentinel');
  if (!('IntersectionObserver' in window) || !sentinel) {
    // fallback: bouton "Charger plus"
    console.warn('Pas d’IntersectionObserver, fallback manuel.');
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) loadNextPage();
    }
  }, { root: null, rootMargin: '300px 0px', threshold: 0 });
  io.observe(sentinel);
}

// Écouteurs filtres (debounce)
function setupFilters() {
  const $q = $('#fc_q');
  const $cls = $('#fc_classes');

  const onChange = debounce(function() {
    activeFilters.q = ($q.val() || '').toString().trim().toLowerCase();
    const raw = ($cls.val() || '').toString().trim().toLowerCase();
    activeFilters.classes = raw ? raw.split(/\s+/).filter(Boolean) : [];
    applyFiltersToDOM();
  }, 150);

  $q.on('input', onChange);
  $cls.on('input', onChange);
}

// ===== Bootstrap (à mettre dans ton $(function(){ ... }) existant) =====
// Remplace tes anciens setMembers()/setFaceclaim() initiaux par ceci :
$(function(){
  // (conserve tes normalisations INFOSLIST et tes lignes existantes ici)
  // ...

  members = {};
  FC = $('#bp_fc');
  base = FC.find('.member_fc').eq(0).clone();
  FC.empty(); // on part propre

  setupFilters();
  setupInfiniteScroll();

  // Démarre : charge la première page tout de suite
  loadNextPage();

  // Bonus: si l’utilisateur scrolle avant que la première rafale ne finisse,
  // l’observer déclenchera la suivante automatiquement.
});

