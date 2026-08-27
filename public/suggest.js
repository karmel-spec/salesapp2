/**
 * BLP 💡 Suggestion Box — shared across every BLP web app.
 *
 * Embed with:
 *   <script src="https://blpsalesapp.netlify.app/suggest.js" defer
 *           data-app="CRM" data-who-key="blp_rep_name"></script>
 *
 * data-app      : which app the idea is about (shown on the fix list)
 * data-who-key  : optional localStorage key holding the signed-in user's
 *                 name in that app; falls back to asking once.
 *
 * Ideas/edits/bugs land on the central "App Suggestions" list (Leads Log
 * workbook) with status flow Requested → In progress → Live → Tested, and
 * the requester confirms "Tested" from their own list here.
 */
(function () {
  "use strict";
  if (window.__blpSuggestLoaded) return;
  window.__blpSuggestLoaded = true;

  var script = document.currentScript || {};
  var APP = (script.dataset && script.dataset.app) || document.title.slice(0, 30) || "BLP app";
  var WHO_KEY = (script.dataset && script.dataset.whoKey) || "blp_rep_name";
  var API = (function () {
    try {
      var o = new URL(script.src).origin;
      return o + "/api/suggest";
    } catch (e) {
      return "https://blpsalesapp.netlify.app/api/suggest";
    }
  })();

  function whoAmI() {
    try {
      var w = localStorage.getItem(WHO_KEY) || localStorage.getItem("blp_suggest_name") || "";
      if (w && w !== "app") return w;
    } catch (e) { /* storage blocked */ }
    return "";
  }

  var CRIMSON = "#8a1e1e";
  var css =
    ".blps-btn{position:fixed;left:18px;bottom:18px;z-index:2147482000;width:44px;height:44px;border-radius:50%;background:#2c2620;color:#ffd34d;border:1px solid rgba(255,255,255,.25);cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.3);font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;transition:transform .15s}" +
    ".blps-btn:hover{transform:scale(1.08)}" +
    ".blps-panel{position:fixed;left:18px;bottom:72px;z-index:2147482000;width:min(340px,calc(100vw - 30px));max-height:min(540px,calc(100vh - 100px));background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.35);display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#221d18}" +
    ".blps-panel.open{display:flex}" +
    ".blps-head{background:#2c2620;color:#fff;padding:12px 14px;font-size:14px}" +
    ".blps-head b{display:block}" +
    ".blps-head span{font-size:11.5px;opacity:.75}" +
    ".blps-body{padding:12px 14px;overflow-y:auto}" +
    ".blps-types{display:flex;gap:6px;margin-bottom:8px}" +
    ".blps-type{flex:1;border:1px solid #d8d0c4;background:#faf7f2;border-radius:8px;padding:6px 4px;font-size:12.5px;cursor:pointer;font-family:inherit}" +
    ".blps-type.on{border-color:" + CRIMSON + ";background:#f6e9e9;font-weight:600}" +
    ".blps-text{width:100%;box-sizing:border-box;border:1px solid #d8d0c4;border-radius:8px;padding:8px 10px;font-size:13.5px;font-family:inherit;min-height:74px;resize:vertical}" +
    ".blps-row{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}" +
    ".blps-who{flex:1;min-width:110px;border:1px solid #d8d0c4;border-radius:8px;padding:7px 9px;font-size:13px;font-family:inherit}" +
    ".blps-shot{font-size:12px;cursor:pointer;color:#6b6259}" +
    ".blps-send{background:" + CRIMSON + ";color:#fff;border:none;border-radius:8px;padding:9px 14px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit}" +
    ".blps-send:disabled{opacity:.55}" +
    ".blps-msg{font-size:12.5px;margin-top:8px;min-height:16px}" +
    ".blps-msg.ok{color:#2e7d46}.blps-msg.err{color:#a02020}" +
    ".blps-prev{margin-top:8px;display:flex;gap:8px;align-items:center}" +
    ".blps-prev[hidden]{display:none}" +
    ".blps-prev img{height:44px;border-radius:6px;border:1px solid #d8d0c4}" +
    ".blps-mine{border-top:1px solid #eee6da;padding:10px 14px;font-size:12.5px;max-height:180px;overflow-y:auto}" +
    ".blps-mine b{font-size:12px;color:#6b6259;text-transform:uppercase;letter-spacing:.5px}" +
    ".blps-req{display:flex;gap:6px;align-items:center;padding:4px 0}" +
    ".blps-st{font-size:10.5px;padding:2px 7px;border-radius:99px;background:#eee6da;white-space:nowrap}" +
    ".blps-st.sLive{background:#dcefe2;color:#205c35}.blps-st.sTested{background:#e4e4f5;color:#3a3a7a}.blps-st.sInprogress{background:#fdeeD3;color:#7a5a12}" +
    ".blps-ok{border:1px solid #2e7d46;color:#2e7d46;background:none;border-radius:7px;font-size:11px;padding:2px 7px;cursor:pointer;font-family:inherit;white-space:nowrap}" +
    ".blps-x{margin-left:auto;background:none;border:none;color:#fff;font-size:15px;cursor:pointer}";

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var btn = document.createElement("button");
  btn.className = "blps-btn";
  btn.title = "Suggest an improvement to the " + APP;
  btn.innerHTML = "&#128161;";

  var panel = document.createElement("div");
  panel.className = "blps-panel";
  panel.innerHTML =
    '<div class="blps-head" style="display:flex;align-items:center"><div><b>&#128161; Suggest an improvement</b>' +
    '<span>bugs, edits, ideas for the ' + APP + ' — straight onto the fix list</span></div>' +
    '<button class="blps-x" aria-label="close">&#10005;</button></div>' +
    '<div class="blps-body">' +
    '<div class="blps-types">' +
    '<button type="button" class="blps-type on" data-t="edit">&#9999;&#65039; Edit</button>' +
    '<button type="button" class="blps-type" data-t="idea">&#128161; Idea</button>' +
    '<button type="button" class="blps-type" data-t="bug">&#128027; Bug</button></div>' +
    '<textarea class="blps-text" maxlength="1500" placeholder="What’s wrong / what would make it better? A sentence or two is plenty."></textarea>' +
    '<div class="blps-row">' +
    '<input class="blps-who" maxlength="40" placeholder="Your name">' +
    '<label class="blps-shot">&#128247; screenshot<input type="file" accept="image/*" hidden></label>' +
    '<button type="button" class="blps-send">Send it &#128640;</button></div>' +
    '<div class="blps-prev" hidden><img alt="screenshot"><button type="button" class="blps-ok blps-rm">&#10005; remove</button></div>' +
    '<div class="blps-msg"></div></div>' +
    '<div class="blps-mine"><b>My requests</b><div class="blps-list">&#8230;</div></div>';

  function mount() {
    document.body.appendChild(btn);
    document.body.appendChild(panel);
    panel.querySelector(".blps-who").value = whoAmI();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  var type = "edit";
  var shotB64 = "";
  var msg = panel.querySelector(".blps-msg");

  panel.querySelectorAll(".blps-type").forEach(function (b) {
    b.onclick = function () {
      panel.querySelectorAll(".blps-type").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      type = b.dataset.t;
    };
  });
  panel.querySelector(".blps-x").onclick = function () { panel.classList.remove("open"); };
  btn.onclick = function () {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) loadMine();
  };

  var fin = panel.querySelector(".blps-shot input");
  var prev = panel.querySelector(".blps-prev");
  fin.onchange = function () {
    var f = fin.files && fin.files[0];
    if (!f) return;
    // Downscale so even huge screenshots fit the 3.5MB request cap.
    var img = new Image();
    var rd = new FileReader();
    rd.onload = function () {
      img.onload = function () {
        var scale = Math.min(1, 1400 / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        var dataUrl = c.toDataURL("image/jpeg", 0.82);
        shotB64 = dataUrl.split(",")[1] || "";
        prev.querySelector("img").src = dataUrl;
        prev.hidden = false;
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(f);
  };
  panel.querySelector(".blps-rm").onclick = function () {
    shotB64 = "";
    fin.value = "";
    prev.hidden = true;
  };

  panel.querySelector(".blps-send").onclick = function () {
    var text = panel.querySelector(".blps-text").value.trim();
    var who = panel.querySelector(".blps-who").value.trim();
    if (!text) { msg.className = "blps-msg err"; msg.textContent = "Write a sentence first."; return; }
    if (!who) { msg.className = "blps-msg err"; msg.textContent = "Add your name so we know who to thank."; return; }
    try { localStorage.setItem("blp_suggest_name", who); } catch (e) { /* fine */ }
    var send = panel.querySelector(".blps-send");
    send.disabled = true;
    msg.className = "blps-msg";
    msg.textContent = shotB64 ? "Uploading…" : "Sending…";
    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app: APP,
        who: who,
        type: type,
        text: text,
        context: location.pathname + location.search,
        screenshotBase64: shotB64 || undefined,
      }),
    })
      .then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
      .then(function (x) {
        if (!x.r.ok || !x.j.ok) throw new Error(x.j.error || "failed (" + x.r.status + ")");
        msg.className = "blps-msg ok";
        msg.textContent = "✓ Filed as " + x.j.id + " — thank you! Watch it move to Live here when it ships.";
        panel.querySelector(".blps-text").value = "";
        shotB64 = ""; fin.value = ""; prev.hidden = true;
        loadMine();
      })
      .catch(function (e) {
        msg.className = "blps-msg err";
        msg.textContent = "✗ " + e.message;
      })
      .finally(function () { send.disabled = false; });
  };

  function loadMine() {
    var list = panel.querySelector(".blps-list");
    var who = panel.querySelector(".blps-who").value.trim() || whoAmI();
    if (!who) { list.innerHTML = "<i>add your name above to see your requests</i>"; return; }
    fetch(API + "?who=" + encodeURIComponent(who))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var mine = (j.requests || []).slice(0, 10);
        if (!mine.length) { list.innerHTML = "<i>none yet — be the first!</i>"; return; }
        var ICONS = { bug: "\u{1F41B}", edit: "✏️", idea: "\u{1F4A1}" };
        list.innerHTML = mine.map(function (x) {
          return '<div class="blps-req"><span class="blps-st s' + String(x.status || "").replace(/\s/g, "") + '">' +
            (x.status || "Requested") + "</span><span>" + (ICONS[x.type] || "\u{1F4A1}") + " " +
            String(x.text || "").slice(0, 56).replace(/[<>&]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]; }) +
            "</span>" + (x.status === "Live" ? '<button class="blps-ok" data-id="' + x.id + '">✅ It works</button>' : "") +
            "</div>";
        }).join("");
        list.querySelectorAll(".blps-ok[data-id]").forEach(function (b) {
          b.onclick = function () {
            b.textContent = "…";
            fetch(API, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: b.dataset.id, status: "Tested" }),
            }).then(loadMine);
          };
        });
      })
      .catch(function () { list.innerHTML = "<i>couldn’t load</i>"; });
  }
})();
