(function(){
  window.SZ_MS_VER = "MS-v0.7-experimental";

  var STORAGE_KEY = "skinz_multiswitch_v1";

  // ---- helpers storage ----
  function load(){
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
    catch(e){ return []; }
  }
  function save(list){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }
  function esc(s){
    s = s || "";
    return s.replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c];
    });
  }
  function normNick(s){
    s = String(s || "");
    s = s.replace(/\u00a0/g, " ");
    s = s.replace(/bienvenido\/a\s*/i, "");
    s = s.replace(/\s+/g, " ").trim();
    return s.toLowerCase();
  }

  // -- find logout WITH key (no confirm) 
  function pickLogoutUrl(){
    var a = document.getElementById('logout');
    if (a && a.href && a.href.indexOf('logout=1') > -1 && a.href.indexOf('key=') > -1) return a.href;

    var links = document.getElementsByTagName('a');
    for (var i=0; i<links.length; i++){
      var h = links[i].href || '';
      if (h.indexOf('logout=1') > -1 && h.indexOf('key=') > -1) return h;
    }
    return "";
  }

  // -- get current user from toolbar
  function getCurrentUser(){
    var img = document.querySelector('#fa_usermenu img');
    var avatar = img && img.src ? img.src : "";

    // 1 ALT del avatar 
    var nickAlt = document.querySelector('#navbar_username').innerHTML;
    nickAlt = String(nickAlt || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (nickAlt) {
      return { nick: nickAlt, avatar: avatar };
    }

    // 2 Fallback- texto de welcome
    var w = document.getElementById('fa_welcome');
    if (!w) return null;

    var nickText = (w.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/Bienvenue\/à\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!nickText) return null;

    return { nick: nickText, avatar: avatar };
  }

  function isGuest(){
    return !getCurrentUser();
  }

  function isActiveAccount(nick){
    var cur = getCurrentUser();
    if (!cur || !cur.nick) return false;
    return normNick(cur.nick) === normNick(nick);
  }

  function currentIsSaved(list){
    var cur = getCurrentUser();
    if (!cur || !cur.nick) return false;
    var curNorm = normNick(cur.nick);
    for (var i=0; i<list.length; i++){
      if (normNick(list[i].nick) === curNorm) return true;
    }
    return false;
  }

  function deleteCurrentFromStorage(){
    var cur = getCurrentUser();
    if (!cur || !cur.nick) return false;
    var raw = load();
    var curNorm = normNick(cur.nick);

    for (var i=0; i<raw.length; i++){
      if (normNick(raw[i].nick) === curNorm){
        raw.splice(i, 1);
        save(raw);
        return true;
      }
    }
    return false;
  }

  // ---- prefill login 
  function prefillLogin(){
    var nick = sessionStorage.getItem("skinz_prefill_nick");
    if (!nick) return;

    var input =
      document.querySelector('input[name="username"]') ||
      document.querySelector('input#username') ||
      document.querySelector('input[name="login_username"]');

    if (input){
      input.value = nick;
      input.focus();
      sessionStorage.removeItem("skinz_prefill_nick");
    }
  }
  // ---- UI mount - HTML en template si existe fallback si no
  function ensureMarkup(){
    var wrap = document.getElementById('szSw');

    // Si no existe se crea
    if (!wrap){
      wrap = document.createElement('div');
      wrap.id = 'szSw';
      wrap.innerHTML = defaultMarkup();
      document.body.appendChild(wrap);
      return wrap;
    }

    // Si existe pero vacio, markup
    if (!wrap.firstElementChild){
      wrap.innerHTML = defaultMarkup();
    }

    // Si existe, solo minimo
    if (!document.getElementById('szSwBtn')){
      var b = wrap.querySelector('button[data-role="toggle"], #szSwBtn');
      if (b && !b.id) b.id = 'szSwBtn';
      if (!b){
        var nb = document.createElement('button');
        nb.id = 'szSwBtn';
        nb.type = 'button';
        nb.title = 'Multi-comptes';
        nb.innerHTML = '&#8644;';
        wrap.insertBefore(nb, wrap.firstChild);
      }
    }

    if (!document.getElementById('szSwPanel')){
      var p = document.createElement('div');
      p.id = 'szSwPanel';

      var btn = document.getElementById('szSwBtn');
      if (btn && btn.parentNode === wrap) btn.insertAdjacentElement('afterend', p);
      else wrap.appendChild(p);
      p.innerHTML = defaultPanelInner();
    } else {
      // Si hay panel pero falta lista- se crea
      if (!document.getElementById('szSwList')){
        var body = document.getElementById('szSwBody') || document.getElementById('szSwPanel');
        var ul = document.createElement('ul');
        ul.id = 'szSwList';
        body.appendChild(ul);
      }
    }

    return wrap;
  }

  // Markup por defecto
  function defaultPanelInner(){
    return (
      '<div id="szSwHead">' +
        '<b>Multicuentas</b>' +
        '<div class="actions">' +
          '<button type="button" data-act="saveCurrent">Enregistrer le compte</button>' +
          '<button type="button" data-act="deleteCurrent">Supprimer le compte</button>' +
          '<button type="button" data-act="close">Fermer</button>' +
        '</div>' +
      '</div>' +
      '<div id="szSwBody">' +
        '<ul id="szSwList"></ul>' +
      '</div>'
    );
  }

  function defaultMarkup(){
    return (
      '<button id="szSwBtn" type="button" title="Multi-comptes" data-role="toggle">&#8644;</button>' +
      '<div id="szSwPanel">' +
        defaultPanelInner() +
      '</div>'
    );
  }

  var wrap = ensureMarkup();

  // Referencias 
  var btn = document.getElementById('szSwBtn');
  var panel = document.getElementById('szSwPanel');
  var listEl = document.getElementById('szSwList');

  function findAction(act){
    return (wrap && wrap.querySelector) ? wrap.querySelector('[data-act="' + act + '"]') : null;
  }

  var saveBtn = findAction('saveCurrent') || document.getElementById('szSwSave');
  var delBtn  = findAction('deleteCurrent') || document.getElementById('szSwDel');

  // inicial
  if (isGuest()){
    if (saveBtn) saveBtn.style.display = "none";
    if (delBtn)  delBtn.style.display  = "none";
  } else {
    if (delBtn)  delBtn.style.display  = "none";
  }

  // render
  function render(){
    var guest = isGuest();
    var list = load();

    // Toggle botones- guardar vs borrar 
    var savedNow = (!guest) && currentIsSaved(list);
    if (saveBtn) saveBtn.style.display = guest ? "none" : (savedNow ? "none" : "");
    if (delBtn)  delBtn.style.display  = guest ? "none" : (savedNow ? "" : "none");

    // Activa arriba + resto ordenado por nombre
    var activeIdx = -1;
    for (var ai = 0; ai < list.length; ai++){
      if (isActiveAccount(list[ai].nick)) { activeIdx = ai; break; }
    }

    var activeAcc = null;
    if (activeIdx > -1){
      activeAcc = list.splice(activeIdx, 1)[0];
    }

    list.sort(function(a, b){
      return String(a.nick || "").localeCompare(String(b.nick || ""), "es", { sensitivity: "base" });
    });

    if (activeAcc){
      list.unshift(activeAcc);
    }

    listEl.innerHTML = "";

    if (!list.length){
      var li0 = document.createElement('li');
      li0.style.cursor = "default";
      li0.innerHTML =
        '<div class="meta">' +
          '<span class="nick">Aucun compte enregistré</span>' +
          (guest
            ? '<span class="sub">Connectez-vous et enregistrez vos multi-comptes</span>'
            : '<span class="sub">Appuyez sur "Enregistrer le compte" pour ajouter le compte actuel</span>') +
        '</div>';
      listEl.appendChild(li0);
      return;
    }

    for (var i=0; i<list.length; i++){
      (function(acc){
        var li = document.createElement('li');

        var img = document.createElement('img');
        img.src = acc.avatar ? acc.avatar :
          "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='%23333'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-size='28' fill='%23fff'%3E%3F%3C/text%3E%3C/svg%3E";

        var meta = document.createElement('div');
        meta.className = "meta";

        if (isActiveAccount(acc.nick)){
          meta.innerHTML =
            '<span class="nick">' + esc(acc.nick) + '</span>' +
            '<span class="sub">Actif·ve</span>';
          li.classList.add('szSw-active');
          li.style.cursor = "default";
        } else {
          meta.innerHTML =
            '<span class="nick">' + esc(acc.nick) + '</span>' +
            '<span class="sub">Basculer vers ce compte</span>';
        }

        li.appendChild(img);
        li.appendChild(meta);

        li.onclick = function(){
          if (isActiveAccount(acc.nick)){
            wrap.className = wrap.className.replace("open","").trim();
            return;
          }

          sessionStorage.setItem("skinz_prefill_nick", acc.nick);

          var out = pickLogoutUrl();
          if (out) window.location.href = out;
          else window.location.href = "/login";
        };

        // click derecho como extra
        li.oncontextmenu = function(e){
          e.preventDefault();
          if (confirm("Supprimer ce compte ?")){
            var targetNick = normNick(acc.nick);
            var targetAv = String(acc.avatar || "");

            var raw = load();
            for (var k=0; k<raw.length; k++){
              if (normNick(raw[k].nick) === targetNick && String(raw[k].avatar || "") === targetAv){
                raw.splice(k,1);
                break;
              }
            }
            save(raw);
            render();
          }
        };

        listEl.appendChild(li);
      })(list[i]);
    }
  }

  // ---- eventos
  btn.onclick = function(e){
    if (e && e.stopPropagation) e.stopPropagation();
    var isOpen = (wrap.className.indexOf("open") > -1);
    if (isOpen) wrap.className = wrap.className.replace("open","").trim();
    else { render(); wrap.className = (wrap.className + " open").trim(); }
  };

  panel.onclick = function(e){
    if (e && e.stopPropagation) e.stopPropagation();
    var t = e.target || e.srcElement;
    if (!t || !t.getAttribute) return;
    var act = t.getAttribute("data-act");
    if (!act) return;

    if (act === "close"){
      wrap.className = wrap.className.replace("open","").trim();
      return;
    }

    if (act === "saveCurrent"){
      var cur = getCurrentUser();
      if (!cur){
        alert("Connectez-vous d'abord pour pouvoir enregistrer le compte");
        return;
      }

      var list = load();
      var curNorm = normNick(cur.nick);

      for (var i=0; i<list.length; i++){
        if (normNick(list[i].nick) === curNorm){
          alert("Ce compte est déjà enregistré.");
          return;
        }
      }

      list.push(cur);
      save(list);
      render();
      return;
    }

    if (act === "deleteCurrent"){
      if (isGuest()){
        alert("Aucune session active à supprimer");
        return;
      }
      if (!confirm("Supprimer le compte actuel de la liste ?")) return;

      var ok = deleteCurrentFromStorage();
      if (!ok) alert("Ce compte n'était pas enregistré");
      render();
      return;
    }
  };

  document.addEventListener("click", function(){
    wrap.className = wrap.className.replace("open","").trim();
  });

  // ---- init ----
  render();
  prefillLogin();
})();
