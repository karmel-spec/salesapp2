/**
 * Sales App 💡 lightbulb (Brigham 10/30) — the Sales App's own request front
 * door. Same look and flow as the shared blpstoremap lightbulb.js, but every
 * request stays IN the Sales App: it posts to /api/requests (this origin,
 * session cookie) and is managed from Dashboard → 💡 App Requests, not the
 * Store Map's Requests list.
 *
 *   <script src="/lightbulb.js" defer data-app="Sales App"
 *           data-session="/api/lightbulb" data-who-key="blp_rep_name"
 *           data-dock="#blp-dock"></script>
 *
 * data-session : same-origin URL answering {name, email} for the signed-in
 *                person (Google sign-in). Passcode sign-ins carry no name, so
 *                the widget falls back to data-who-key (the "Who are you?"
 *                pick) and finally asks once.
 * data-dock    : CSS selector; the 💡 renders inline inside it.
 * data-position: bottom-left (default) | bottom-right | top-right.
 *
 * Page hooks: window.BLPLightbulb.open() / .refresh()
 */
(function () {
  'use strict';
  if (window.BLPLightbulb) return;

  var script = document.currentScript || {};
  var ds = script.dataset || {};
  var APP = ds.app || 'Sales App';
  var API = ds.api || '/api/requests';
  var MANAGE_URL = ds.manage || '/?tab=requests';
  var SESSION_URL = ds.session || '';
  var WHO_KEY = ds.whoKey || '';
  var DOCK = ds.dock || '';
  var POS = ds.position || 'bottom-left';
  var LS_NAME = 'blp_lightbulb_name';
  var ICON = {bug: '🐛', edit: '✏️', idea: '💡'};

  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* blocked */ } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
    });
  }
  function fetchT(url, opts, ms) {
    var c = new AbortController();
    var t = setTimeout(function () { c.abort(); }, ms || 30000);
    return fetch(url, Object.assign({signal: c.signal, credentials: 'same-origin'}, opts || {})).finally(function () { clearTimeout(t); });
  }
  async function apiJson(url, opts, ms) {
    var r = await fetchT(url, Object.assign({headers: {'content-type': 'application/json'}}, opts || {}), ms);
    var j = await r.json().catch(function () { return {}; });
    if (r.status === 401) throw new Error('your session expired — reload the page and sign in again');
    if (!r.ok) throw new Error(j.error || ('request failed (' + r.status + ')'));
    return j;
  }

  /* ---------- who is this (host session → "Who are you?" → remembered name) ---------- */
  var S = {name: '', email: '', loaded: false};
  var sessionP = null;
  function loadSession(force) {
    if (sessionP && !force) return sessionP;
    sessionP = (async function () {
      if (SESSION_URL) {
        try {
          var r = await fetchT(SESSION_URL, {cache: 'no-store'}, 12000);
          if (r.ok) {
            var j = await r.json();
            if (j && (j.name || j.email)) {
              S.name = String(j.name || (j.email ? j.email.split('@')[0] : ''));
              S.email = String(j.email || '');
            }
          }
        } catch (e) { /* fall back */ }
      }
      if (!S.name) {
        var w = WHO_KEY ? lsGet(WHO_KEY) : '';
        S.name = (w && w !== 'app' ? w : '') || lsGet(LS_NAME) || lsGet('blp_suggest_name');
      }
      S.loaded = true;
      paintIdRow();
      return S;
    })();
    return sessionP;
  }

  /* ---------- styles (shadow DOM keeps the host's CSS out, and ours in) ---------- */
  var CSS = ':host{all:initial}' +
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
    '.btn{position:fixed;z-index:2147482000;width:44px;height:44px;border-radius:50%;background:#1f1b17;color:#ffd34d;border:1px solid rgba(255,255,255,.25);cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.3);font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;transition:transform .15s;padding:0}' +
    '.btn:hover{transform:scale(1.08)}' +
    '.btn.bl{left:18px;bottom:18px}.btn.br{right:18px;bottom:18px}.btn.tr{right:14px;top:12px;width:40px;height:40px;font-size:18px}' +
    '.btn.dock{position:relative;width:34px;height:34px;font-size:17px;box-shadow:none;border-color:rgba(255,255,255,.35)}' +
    '.pop{position:fixed;z-index:2147482001;width:min(360px,calc(100vw - 24px));max-height:min(600px,calc(100vh - 90px));background:#fff;color:#221d18;border-radius:14px;box-shadow:0 12px 44px rgba(0,0,0,.35);display:none;flex-direction:column;overflow:hidden;font-size:13.5px}' +
    '.pop.open{display:flex}' +
    '.pop.bl{left:14px;bottom:72px}.pop.br{right:14px;bottom:72px}.pop.tr{right:14px;top:60px}' +
    '@media (max-width:760px){.pop{left:12px!important;right:12px!important;width:auto;bottom:70px!important;top:auto!important}}' +
    '.head{background:#1f1b17;color:#fff;padding:11px 14px;display:flex;align-items:center;gap:8px}' +
    '.head b{display:block;font-size:14px}.head span{font-size:11.5px;opacity:.75}' +
    '.x{margin-left:auto;background:none;border:none;color:#fff;font-size:16px;cursor:pointer;padding:2px 4px}' +
    '.body{padding:12px 14px;overflow-y:auto}' +
    '.types{display:flex;gap:6px;margin-bottom:8px}' +
    '.type{flex:1;border:1px solid #d8d0c4;background:#faf7f2;border-radius:8px;padding:7px 4px;font-size:12.5px;cursor:pointer;color:inherit}' +
    '.type.on{border-color:#8a1e1e;background:#f6e9e9;font-weight:600}' +
    'textarea,input[type=text]{width:100%;border:1px solid #d8d0c4;border-radius:8px;padding:8px 10px;font-size:13.5px;color:#221d18;background:#fff}' +
    'textarea{min-height:80px;resize:vertical}' +
    '.row{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}' +
    '.row input{flex:1;min-width:120px}' +
    '.shot{font-size:12.5px;cursor:pointer;color:#6b6259;white-space:nowrap}' +
    '.send{margin-left:auto;background:#8a1e1e;color:#fff;border:none;border-radius:8px;padding:9px 15px;font-size:13.5px;font-weight:600;cursor:pointer}' +
    '.send:disabled{opacity:.55;cursor:default}' +
    '.prev{margin-top:8px;display:flex;gap:8px;align-items:center}.prev[hidden]{display:none}' +
    '.prev img{height:46px;border-radius:6px;border:1px solid #d8d0c4}' +
    '.msg{font-size:12.5px;margin-top:8px;min-height:16px}.msg.ok{color:#2e7d46}.msg.err{color:#a02020}' +
    '.mine{border-top:1px solid #eee6da;padding:10px 14px;max-height:200px;overflow-y:auto;font-size:12.5px}' +
    '.cap{font-size:11px;color:#6b6259;text-transform:uppercase;letter-spacing:.5px;font-weight:700}' +
    '.req{display:flex;gap:6px;align-items:flex-start;padding:5px 0}' +
    '.st{font-size:10.5px;padding:2px 7px;border-radius:99px;background:#eee6da;white-space:nowrap;flex:none}' +
    '.st.sLive{background:#dcefe2;color:#205c35}.st.sTested{background:#e4e4f5;color:#3a3a7a}.st.sInprogress{background:#fdeed3;color:#7a5a12}.st.sDeclined,.st.sDuplicate{background:#f1eeee;color:#7a6e6e}' +
    '.mini{border:1px solid #2e7d46;color:#2e7d46;background:none;border-radius:7px;font-size:11px;padding:2px 7px;cursor:pointer;white-space:nowrap}' +
    '[hidden]{display:none!important}' +
    '.adminlink{display:block;width:100%;margin-top:10px;border:1px solid #1f1b17;background:#1f1b17;color:#ffd34d;border-radius:8px;padding:8px;font-size:13px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none}';

  var host = document.createElement('div');
  host.id = 'blp-lightbulb';
  var root = host.attachShadow ? host.attachShadow({mode: 'open'}) : host;
  var posCls = POS === 'top-right' ? 'tr' : POS === 'bottom-right' ? 'br' : 'bl';
  root.innerHTML = '<style>' + CSS + '</style>' +
    '<button class="btn ' + posCls + '" type="button" title="Suggest an improvement to the ' + esc(APP) + '">💡</button>' +
    '<div class="pop ' + posCls + '" role="dialog" aria-label="Suggest an improvement">' +
      '<div class="head"><div><b>💡 Suggest an improvement</b><span>bugs, edits, ideas for the ' + esc(APP) + ' — straight onto the fix list</span></div>' +
      '<button class="x" type="button" aria-label="close">✕</button></div>' +
      '<div class="body">' +
        '<div class="types"><button type="button" class="type on" data-t="edit">✏️ Edit</button>' +
        '<button type="button" class="type" data-t="idea">💡 Idea</button>' +
        '<button type="button" class="type" data-t="bug">🐛 Bug</button></div>' +
        '<textarea class="text" maxlength="2000" placeholder="What’s wrong / what would make it better? A sentence or two is plenty."></textarea>' +
        '<div class="row idrow" hidden><input type="text" class="who" maxlength="40" placeholder="Your name"></div>' +
        '<div class="row"><label class="shot">📷 Attach screenshot<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>' +
        '<button type="button" class="send">Send it 🚀</button></div>' +
        '<div class="prev" hidden><img alt="screenshot preview"><button type="button" class="mini rm">✕ remove</button></div>' +
        '<div class="msg"></div>' +
        '<a class="adminlink" href="' + esc(MANAGE_URL) + '">🛡 App Requests — manage on the Dashboard</a>' +
      '</div>' +
      '<div class="mine"><div class="cap">My requests</div><div class="minelist">…</div></div>' +
    '</div>';

  var $ = function (sel) { return root.querySelector(sel); };
  var btn = $('.btn'), pop = $('.pop');
  var msg = $('.msg');

  var inline = null;
  // Re-attaches the widget whenever the host page drops it: React re-renders
  // <body> after a hydration mismatch and swaps the dock element on route changes.
  function attach() {
    var dockEl = null;
    try { dockEl = DOCK ? document.querySelector(DOCK) : null; } catch (e) { dockEl = null; }
    if (dockEl) {
      if (!inline) {
        btn.classList.add('dock');
        inline = document.createElement('span');
        var iroot = inline.attachShadow ? inline.attachShadow({mode: 'open'}) : inline;
        iroot.innerHTML = '<style>' + CSS + '</style>';
        iroot.appendChild(btn);
      }
      if (inline.parentNode !== dockEl) dockEl.appendChild(inline);
    } else if (inline && !inline.isConnected) {
      btn.classList.remove('dock');
      root.appendChild(btn);
      inline = null;
    }
    if (!host.isConnected) document.body.appendChild(host);
  }
  function mount() {
    attach();
    setInterval(attach, 1000);
    loadSession();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  /* ---------- suggest popover ---------- */
  var type = 'edit', shotFile = null;
  root.querySelectorAll('.type').forEach(function (b) {
    b.onclick = function () {
      root.querySelectorAll('.type').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); type = b.dataset.t;
    };
  });
  function paintIdRow() { $('.idrow').hidden = !!S.name; }
  btn.onclick = function () {
    var open = !pop.classList.contains('open');
    pop.classList.toggle('open', open);
    if (open) { loadSession().then(function () { paintIdRow(); loadMine(); }); setTimeout(function () { $('.text').focus(); }, 30); }
  };
  $('.pop .x').onclick = function () { pop.classList.remove('open'); };
  $('.adminlink').onclick = function () { pop.classList.remove('open'); };

  var fin = $('.shot input'), prev = $('.prev');
  fin.onchange = function () {
    shotFile = fin.files && fin.files[0];
    if (!shotFile) { prev.hidden = true; return; }
    var rd = new FileReader();
    rd.onload = function () { if (shotFile) { prev.querySelector('img').src = rd.result; prev.hidden = false; } };
    rd.readAsDataURL(shotFile);
  };
  function clearShot() { shotFile = null; fin.value = ''; prev.hidden = true; prev.querySelector('img').removeAttribute('src'); }
  $('.rm').onclick = clearShot;

  function downscale(file, max, q) {
    return new Promise(function (res, rej) {
      var rd = new FileReader();
      rd.onerror = rej;
      rd.onload = function () {
        var img = new Image();
        img.onerror = rej;
        img.onload = function () {
          var k = Math.min(1, max / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', q));
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  }

  $('.send').onclick = async function () {
    var send = $('.send');
    if (send.disabled) return;
    var text = $('.text').value.trim();
    if (!text) { msg.className = 'msg err'; msg.textContent = 'Write a sentence first.'; return; }
    await loadSession();
    if (!S.name) {
      var nm = $('.who').value.trim();
      if (!nm) { msg.className = 'msg err'; msg.textContent = 'Add your name so we know who to thank.'; return; }
      S.name = nm; lsSet(LS_NAME, nm);
    }
    send.disabled = true; send.textContent = 'Sending…';
    msg.className = 'msg'; msg.textContent = shotFile ? 'Uploading screenshot…' : 'Sending…';
    var phone = window.innerWidth <= 760 || /iphone|android.*mobile|ipad/i.test(navigator.userAgent);
    var body = {type: type, text: text, who: S.name,
      context: (location.pathname + location.search).slice(0, 160) + (phone ? ' · 📱 phone' : ' · 💻 computer') + ' · via 💡 lightbulb'};
    var shotNote = '';
    try {
      if (shotFile) {
        var dataUrl = await downscale(shotFile, 1600, 0.85).catch(function () { return null; });
        if (!dataUrl) shotNote = 'this browser can’t read that image format — take a screenshot (PNG) and attach it to a follow-up';
        else body.screenshotBase64 = dataUrl.split(',')[1];
      }
      var j = await apiJson(API, {method: 'POST', body: JSON.stringify(body)}, 60000);
      if (shotFile && !j.screenshot && !shotNote) shotNote = 'the screenshot upload didn’t go through — attach it to a follow-up';
      msg.className = 'msg ok';
      msg.textContent = '✓ Filed as ' + j.id + (shotNote ? ' — WITHOUT the picture: ' + shotNote + '.'
        : ' — thank you! You’ll see it move to Live here when it ships.');
      $('.text').value = ''; clearShot(); paintIdRow();
      loadMine(true);
      try { window.dispatchEvent(new CustomEvent('blp:request-filed', {detail: j.request})); } catch (e) { /* ignore */ }
    } catch (e) {
      msg.className = 'msg err'; msg.textContent = '✗ ' + e.message;
      paintIdRow();
    }
    send.disabled = false; send.textContent = 'Send it 🚀';
  };

  /* ---------- my requests ---------- */
  var REQ = null, reqP = null;
  function getRequests(force) {
    if (force || !reqP) {
      reqP = apiJson(API, {cache: 'no-store'}, 30000).then(function (j) { REQ = j.requests || []; return REQ; },
        function (e) { reqP = null; throw e; });
    }
    return reqP;
  }
  function sameWho(a, b) {
    a = String(a || '').trim().toLowerCase(); b = String(b || '').trim().toLowerCase();
    return !!a && !!b && (a === b || a.split(/\s+/)[0] === b || b.split(/\s+/)[0] === a);
  }
  async function loadMine(force) {
    var box = $('.minelist');
    if (!S.name) { box.innerHTML = '<i>add your name above to see your requests</i>'; return; }
    try {
      var rs = await getRequests(force);
      var mine = rs.filter(function (x) { return sameWho(x.who, S.name); }).slice(0, 12);
      if (!mine.length) { box.innerHTML = '<i>none yet for the ' + esc(APP) + ' — be the first!</i>'; return; }
      box.innerHTML = mine.map(function (x) {
        return '<div class="req"><span class="st s' + esc(String(x.status).replace(/\s/g, '')) + '">' + esc(x.status) + '</span>' +
          '<span>' + (ICON[x.type] || '💡') + ' ' + esc(String(x.text).slice(0, 160)) + (x.text.length > 160 ? '…' : '') + '</span>' +
          (x.status === 'Live' ? '<button type="button" class="mini ok" data-id="' + esc(x.id) + '">✅ It works</button>' : '') + '</div>';
      }).join('');
      box.querySelectorAll('.ok').forEach(function (b) {
        b.onclick = async function () {
          b.textContent = '…'; b.disabled = true;
          try { await apiJson(API, {method: 'PATCH', body: JSON.stringify({id: b.dataset.id, status: 'Tested', who: S.name})}); }
          catch (e) { msg.className = 'msg err'; msg.textContent = '✗ ' + e.message; }
          loadMine(true);
        };
      });
    } catch (e) { box.innerHTML = '<i>couldn’t load — try again in a moment</i>'; }
  }

  window.BLPLightbulb = {
    app: APP,
    open: function () { if (!pop.classList.contains('open')) btn.onclick(); },
    refresh: function () { loadSession(true).then(function () { if (pop.classList.contains('open')) loadMine(true); }); },
  };
})();
