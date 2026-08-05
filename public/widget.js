/**
 * BLP Webchat — Brigham Larson Pianos "text us" widget.
 *
 * Embed on any page with:
 *   <script src="https://blpsalesapp.netlify.app/widget.js" defer></script>
 *
 * Visitors leave their name + mobile number + message; the conversation
 * continues over SMS from the BLP Sales Console. Every message records the
 * page the visitor was on. FAQ copy lives in the FAQS array below.
 */
(function () {
  "use strict";
  if (window.__blpWidgetLoaded) return;
  window.__blpWidgetLoaded = true;

  var API_BASE = (function () {
    try {
      var src = (document.currentScript && document.currentScript.src) || "";
      return new URL(src).origin;
    } catch (e) {
      return "https://blpsalesapp.netlify.app";
    }
  })();

  var FAQS = [
    {
      q: "How much is piano tuning?",
      a: "A tuning for most pianos is $150, as long as you are in our service area. If your piano hasn't been tuned in several years it may also need a pitch raise. Send us a message and we'll get you scheduled.",
    },
    {
      q: "How much is my piano worth?",
      a: "If you're curious about your piano's value, we offer a free evaluation. Text us the brand, the model or serial number, and a photo or two, and we'll give you an honest estimate.",
    },
    {
      q: "Interested in selling or donating your piano?",
      a: "Thank you for considering Brigham Larson Pianos for your piano's next chapter. Send us photos and details and we'll let you know whether consignment, trade-in, or donation is the best fit.",
    },
  ];

  var CRIMSON = "#8a1e1e";
  var css =
    ".blpw-btn{position:fixed;right:22px;bottom:22px;z-index:2147483000;width:58px;height:58px;border-radius:50%;background:" + CRIMSON + ";color:#fff;border:none;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.28);font-size:26px;line-height:1;display:flex;align-items:center;justify-content:center;transition:transform .15s}" +
    ".blpw-btn:hover{transform:scale(1.06)}" +
    ".blpw-panel{position:fixed;right:22px;bottom:92px;z-index:2147483000;width:min(360px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 120px));background:#f7f5f2;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.3);display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}" +
    ".blpw-panel.open{display:flex}" +
    ".blpw-head{background:" + CRIMSON + ";color:#fff;padding:16px 18px}" +
    ".blpw-head b{font-size:16px;display:block}" +
    ".blpw-head span{font-size:12.5px;opacity:.85}" +
    ".blpw-body{padding:14px 16px;overflow-y:auto;flex:1}" +
    ".blpw-greet{background:#e9e4dc;border-radius:12px;padding:10px 12px;font-size:13.5px;color:#2c2620;margin-bottom:12px}" +
    ".blpw-field{margin-bottom:10px}" +
    ".blpw-field label{display:block;font-size:11.5px;color:#6b6259;margin-bottom:3px;letter-spacing:.4px;text-transform:uppercase}" +
    ".blpw-field input,.blpw-field textarea{width:100%;box-sizing:border-box;border:1px solid #d8d0c4;border-radius:8px;padding:9px 10px;font-size:14px;font-family:inherit;background:#fff;color:#221d18}" +
    ".blpw-field textarea{min-height:70px;resize:vertical}" +
    ".blpw-send{width:100%;background:" + CRIMSON + ";color:#fff;border:none;border-radius:9px;padding:11px;font-size:15px;font-weight:600;cursor:pointer;margin-top:2px}" +
    ".blpw-send:disabled{opacity:.55;cursor:default}" +
    ".blpw-consent{font-size:10.5px;color:#8a8177;line-height:1.45;margin-top:10px}" +
    ".blpw-tabs{display:flex;border-top:1px solid #e3dcd2;background:#fff}" +
    ".blpw-tab{flex:1;border:none;background:none;padding:11px 4px;font-size:13px;cursor:pointer;color:#6b6259;font-family:inherit}" +
    ".blpw-tab.active{color:" + CRIMSON + ";font-weight:600}" +
    ".blpw-faq{background:#fff;border:1px solid #e3dcd2;border-radius:10px;margin-bottom:9px;overflow:hidden}" +
    ".blpw-faq>button{width:100%;text-align:left;border:none;background:none;padding:11px 12px;font-size:13.5px;font-weight:600;color:#221d18;cursor:pointer;font-family:inherit;display:flex;justify-content:space-between;gap:8px}" +
    ".blpw-faq>div{display:none;padding:0 12px 11px;font-size:13px;color:#4c443c;line-height:1.5}" +
    ".blpw-faq.open>div{display:block}" +
    ".blpw-ok{text-align:center;padding:26px 10px;font-size:14.5px;color:#2c2620;line-height:1.55}" +
    ".blpw-err{color:#a02020;font-size:12.5px;margin-top:8px}" +
    ".blpw-hp{position:absolute;left:-5000px;top:-5000px}";

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var btn = document.createElement("button");
  btn.className = "blpw-btn";
  btn.setAttribute("aria-label", "Chat with Brigham Larson Pianos");
  btn.innerHTML = "&#128172;";

  var panel = document.createElement("div");
  panel.className = "blpw-panel";
  panel.innerHTML =
    '<div class="blpw-head"><b>Brigham Larson Pianos</b><span>We are here to help you</span></div>' +
    '<div class="blpw-body"></div>' +
    '<div class="blpw-tabs">' +
    '<button type="button" class="blpw-tab active" data-tab="msg">&#10148; Send Message</button>' +
    '<button type="button" class="blpw-tab" data-tab="faq">? Check FAQs</button>' +
    "</div>";

  var body = panel.querySelector(".blpw-body");
  var sent = false;

  var mounted = false;
  function mount() {
    if (mounted) return;
    mounted = true;
    document.body.appendChild(btn);
    document.body.appendChild(panel);
    renderForm();
  }

  function renderForm() {
    if (sent) return renderOk();
    body.innerHTML =
      '<div class="blpw-greet">Enter your information, and our team will text you shortly</div>' +
      '<form class="blpw-form">' +
      '<div class="blpw-field"><label>Name</label><input name="name" autocomplete="name" maxlength="80"></div>' +
      '<div class="blpw-field"><label>Mobile Phone</label><input name="phone" type="tel" autocomplete="tel" maxlength="20" placeholder="(801) 555-1234"></div>' +
      '<div class="blpw-field"><label>Message</label><textarea name="message" maxlength="1200"></textarea></div>' +
      '<input class="blpw-hp" name="website" tabindex="-1" autocomplete="off">' +
      '<button type="submit" class="blpw-send">Send</button>' +
      '<div class="blpw-err" style="display:none"></div>' +
      '<div class="blpw-consent">By completing this submission, you grant Brigham Larson Pianos permission to send text messages containing offers and other relevant information, potentially utilizing automated technology, to the provided phone number.</div>' +
      "</form>";
    body.querySelector("form").addEventListener("submit", submit);
  }

  function renderOk() {
    body.innerHTML =
      '<div class="blpw-ok">&#127929;<br><b>Thanks — message received!</b><br>Our team will text you back shortly.</div>';
  }

  function renderFaqs() {
    body.innerHTML = FAQS.map(function (f, i) {
      return (
        '<div class="blpw-faq" data-i="' + i + '">' +
        "<button type=\"button\">" + f.q + " <span>&#8964;</span></button>" +
        "<div>" + f.a + "</div></div>"
      );
    }).join("");
    Array.prototype.forEach.call(body.querySelectorAll(".blpw-faq>button"), function (b) {
      b.addEventListener("click", function () {
        b.parentElement.classList.toggle("open");
      });
    });
  }

  function submit(ev) {
    ev.preventDefault();
    var form = ev.target;
    var err = form.querySelector(".blpw-err");
    var name = form.name.value.trim();
    var phone = form.phone.value.trim();
    var message = form.message.value.trim();
    var digits = phone.replace(/\D/g, "");
    err.style.display = "none";
    if (!name || !message || digits.length < 10) {
      err.textContent = !name
        ? "Please tell us your name."
        : digits.length < 10
          ? "Please enter a 10-digit mobile number."
          : "Please write a short message.";
      err.style.display = "block";
      return;
    }
    var sendBtn = form.querySelector(".blpw-send");
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";
    fetch(API_BASE + "/api/webchat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name,
        phone: phone,
        message: message,
        website: form.website.value, // honeypot — bots fill it, humans can't see it
        page: location.href,
        pageTitle: document.title.slice(0, 120),
      }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        sent = true;
        renderOk();
      })
      .catch(function () {
        sendBtn.disabled = false;
        sendBtn.textContent = "Send";
        err.textContent = "Hmm, that didn't go through — please try again, or call us at (801) 701-0113.";
        err.style.display = "block";
      });
  }

  btn.addEventListener("click", function () {
    panel.classList.toggle("open");
    btn.innerHTML = panel.classList.contains("open") ? "&#10005;" : "&#128172;";
  });

  panel.querySelector(".blpw-tabs").addEventListener("click", function (ev) {
    var tab = ev.target.closest(".blpw-tab");
    if (!tab) return;
    Array.prototype.forEach.call(panel.querySelectorAll(".blpw-tab"), function (t) {
      t.classList.toggle("active", t === tab);
    });
    if (tab.dataset.tab === "faq") renderFaqs();
    else renderForm();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
