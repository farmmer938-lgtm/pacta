// Pacta site v3: theme, live countdowns, copy buttons, live pre-flight checker, control-plane inspector, index filter + drawers,
// request builder. No wallet, no third-party trackers (the optional first-party beacon, b.js, is separate). Data comes from this site's own /api/v1/*.json files; the one exception is the
// pre-flight checker, which calls Pacta's own free API (data-api on .pf) only after an explicit submit or preset click.
// Record text is inserted with textContent (never innerHTML). Every control works without a mail client.
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function short(h, a, b) { return h.slice(0, a) + "…" + h.slice(-b); }
  // v4.4 (R-V4): link markers are inline Lucide arrows (aria-hidden), never a raw → / ↗ glyph: the self-hosted Inter subset has
  // no arrows, so a raw glyph shows as a missing-glyph box wherever the OS lacks a fallback font. Same markup as ui.arrow().
  var ARROW_D = { right: "M5 12h14M12 5l7 7-7 7", "up-right": "M7 7h10v10M7 17 17 7" };
  function arrowIcon(kind) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg"), p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    s.setAttribute("class", "i ia"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true");
    p.setAttribute("d", ARROW_D[kind] || ARROW_D.right); s.appendChild(p);
    return s;
  }
  // a link whose visible text is the label followed by the arrow (kind "up-right" for external links)
  function arrowLink(attrs, label, kind) { return el("a", attrs, [String(label), arrowIcon(kind)]); }
  // v4.2: a staging build (build_site.py --base-path) records its mount on <html data-base-path>; runtime site links follow it
  // same rule as build_site.valid_base_path(): segments of [A-Za-z0-9._-], never a standalone "." or ".." (no escaping the mount)
  var BASE = (function () { var b = document.documentElement.getAttribute("data-base-path") || ""; return /^(?:\/(?!\.{1,2}(?:\/|$))[A-Za-z0-9._-]+)+$/.test(b) ? b : ""; })();
  function siteUrl(u) { var m = /^https:\/\/pacta\.wtf(\/[^\s"<>]*)$/.exec(String(u)); return BASE && m ? BASE + m[1] : String(u); }
  function num(n) { return Number(n).toLocaleString("en-US"); }

  // ---- theme: Paper (default) / Slate ---------------------------------------------------------------
  // ---- theme: Light / Dark / System (U2) on a .dark class; System follows prefers-color-scheme, also when it changes ----------
  function applyTheme(pref) {
    var dark = pref === "dark" || (pref === "system" && systemDark());
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.setAttribute("data-theme-pref", pref);
    $$("[data-theme-set]").forEach(function (b) { b.setAttribute("aria-checked", String(b.getAttribute("data-theme-set") === pref)); });
    var btn = $("[data-theme-btn]"); if (btn) btn.setAttribute("aria-label", "Theme: " + (pref === "system" ? "System" : pref === "dark" ? "Dark" : "Light"));
  }
  function initTheme() {
    applyTheme(themePref());
    var root = $("[data-theme-menu]"), btn = $("[data-theme-btn]"), menu = $("#theme-menu");
    if (btn && menu) {
      var close = function (focusBtn) { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); if (focusBtn) btn.focus(); };
      var open = function () {
        menu.hidden = false; btn.setAttribute("aria-expanded", "true");
        var cur = $('[aria-checked="true"]', menu) || $("[data-theme-set]", menu); if (cur) cur.focus();
      };
      btn.addEventListener("click", function () { if (menu.hidden) open(); else close(false); });
      menu.addEventListener("click", function (ev) {
        var it = ev.target && ev.target.closest ? ev.target.closest("[data-theme-set]") : null; if (!it) return;
        var pref = it.getAttribute("data-theme-set");
        if (pref !== "light" && pref !== "dark") pref = "system";
        try { if (pref === "system") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, pref); } catch (e) { /* private mode */ }
        applyTheme(pref); close(true);
      });
      menu.addEventListener("keydown", function (ev) {
        var items = $$("[data-theme-set]", menu), i = items.indexOf(document.activeElement);
        if (ev.key === "Escape") { ev.preventDefault(); close(true); }
        else if (ev.key === "ArrowDown") { ev.preventDefault(); items[(i + 1) % items.length].focus(); }
        else if (ev.key === "ArrowUp") { ev.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
        else if (ev.key === "Tab") close(false);
      });
      document.addEventListener("click", function (ev) { if (!menu.hidden && root && !root.contains(ev.target)) close(false); });
    }
    try {
      var mq = window.matchMedia("(prefers-color-scheme: dark)"), follow = function () { if (themePref() === "system") applyTheme("system"); };
      if (mq.addEventListener) mq.addEventListener("change", follow); else if (mq.addListener) mq.addListener(follow);
    } catch (e) { /* no matchMedia */ }
  }

  // ---- countdowns (an ETA is when execution becomes possible, not a guarantee) -----------------------
  function fmt(sec) {
    var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
    return (d ? d + "d " : "") + h + "h " + m + "m";
  }
  // the hero livebar names the next queued ETA that has not elapsed yet (the static build names the earliest one)
  function advanceLivebar(now) {
    var lb = $(".livebar[data-etas]"); if (!lb) return;
    var next = (lb.getAttribute("data-etas") || "").split(";").map(function (x) {
      var i = x.indexOf("|"); return { eta: parseInt(x.slice(0, i), 10), p: x.slice(i + 1) };
    }).filter(function (o) { return o.eta > now && o.p; })[0];
    var p = $(".lb-p", lb), cd = $(".countdown", lb), wrap = $(".lb-next", lb);
    if (!p || !cd || !wrap) return;
    if (next) { p.textContent = next.p; cd.setAttribute("data-eta", String(next.eta)); }
    else { wrap.textContent = "Next: every queued operation is past its ETA; check the Radar for execution state"; }
  }
  function tick() {
    var now = Math.floor(Date.now() / 1000);
    advanceLivebar(now);
    $$("[data-eta]").forEach(function (n) {
      var eta = parseInt(n.getAttribute("data-eta"), 10);
      if (!eta) return;
      n.textContent = eta > now ? "Execution window opens in " + fmt(eta - now) : "Window open — verify execution state";
    });
  }

  // ---- live timelock re-check (read-only): one GET to the free /v1/briefs/live-timelocks on timelock briefs and #radar.
  //      Badges (data-ops) change only through textContent + class; any failure keeps the static block-pinned state.
  //      No polling, no reload, no markup from the network. --------------------------------------------------------------
  var OP_LABEL = { executed: "EXECUTED", ready: "READY · EXECUTABLE NOW", pending: "PENDING", unknown: "CANCELLED OR UNKNOWN", mixed: "MIXED" };
  var OP_STATES = ["executed", "ready", "pending", "unknown", "mixed"];
  var LIVE_TL_RE = /^https:\/\/pacta-x402\.pacta\.workers\.dev\/v1\/briefs\/live-timelocks(\?[a-z_=&.-]*)?$/;
  function liveOpState(op) {
    var l = op && typeof op.live === "object" && op.live ? op.live : {};
    if (l.isOperationDone === true || l.status === "done") return "executed";
    if (l.status === "ready" && l.isOperationPending !== false) return "ready";
    if (l.status === "pending") return "pending";
    if (l.status === "unset") return "unknown";
    return null;
  }
  function setOpState(b, st) {
    b.textContent = OP_LABEL[st];
    OP_STATES.forEach(function (c) { b.classList.toggle(c, c === st); });
    b.setAttribute("data-opstate", st);
    b.setAttribute("data-live", "1");
  }
  function applyLiveTimelocks(j) {
    if (!j || typeof j !== "object" || !Array.isArray(j.operations)) return null;
    var by = {}, blk = null;
    j.operations.forEach(function (op) {
      var id = op && typeof op.opId === "string" ? op.opId.toLowerCase() : "", st = liveOpState(op);
      if (/^0x[0-9a-f]{64}$/.test(id) && st) by[id] = st;
      var n = op && op.block ? op.block.number : null;
      if (typeof n === "number" && isFinite(n) && n > 0 && (blk === null || n > blk)) blk = Math.floor(n);
    });
    var updated = 0;
    $$("[data-ops]").forEach(function (b) {
      var ids = (b.getAttribute("data-ops") || "").toLowerCase().split(/\s+/).filter(Boolean);
      var sts = ids.map(function (i) { return by[i]; });
      if (!sts.length || sts.some(function (s) { return !s; })) return;     // every operation must have been re-read
      var before = b.getAttribute("data-opstate"), st = sts.every(function (s) { return s === sts[0]; }) ? sts[0] : "mixed";
      setOpState(b, st);
      updated++;
      var banner = b.closest(".poststatus"), clause = banner && $(".ps-clause", banner);
      if (banner && st !== before) {
        OP_STATES.forEach(function (c) { banner.classList.toggle(c, c === st); });
        if (clause) clause.textContent = "(live re-check" + (blk !== null ? " at block #" + blk.toLocaleString("en-US") : "") + ": " + OP_LABEL[st]
          + "; the finalized-block reading below is superseded)";
      }
    });
    if (updated) radarCounts();
    if (updated && blk !== null) {
      $$("[data-live-line]").forEach(function (n) {
        n.textContent = "Live re-check at the latest block #" + blk.toLocaleString("en-US") + " via the free /v1/briefs/live-timelocks.";
      });
    }
    return blk;
  }
  // Radar header counts follow the badges: executed operations are never counted as queued (re-derived after a live re-check).
  // M4: radar header counts follow the rows (one per radar.json item, by state). N5 (v4.3): executed rows are counted by their
  // operations so the line never reads as a total: "1 ready · 1 pending · Executed (2 ops)" (same text as build_site.radar_counts_text)
  var RADAR_ORDER = ["ready", "pending", "mixed", "unknown", "executed"];
  var RADAR_WORD = { ready: "ready", pending: "pending", mixed: "mixed", unknown: "cancelled or unknown", executed: "executed" };
  function opsWord(n) { return n + (n === 1 ? " op" : " ops"); }
  function radarPart(s, rows, ops) {
    if (s === "executed") return "Executed (" + opsWord(ops) + ")";
    return rows + " " + RADAR_WORD[s] + (ops !== rows ? " (" + opsWord(ops) + ")" : "");
  }
  function radarCounts() {
    var out = $("[data-radar-counts]"); if (!out) return;
    var by = {}, ops = {};
    $$("#radar tr[data-radar-row]").forEach(function (tr) {
      var b = $("[data-ops]", tr), n = b ? (b.getAttribute("data-ops") || "").split(/\s+/).filter(Boolean).length : 0;
      var st = b ? b.getAttribute("data-opstate") : tr.getAttribute("data-radar-row");
      if (!RADAR_WORD[st]) st = "unknown";
      tr.setAttribute("data-radar-row", st); tr.classList.toggle("is-executed", st === "executed");
      by[st] = (by[st] || 0) + 1; ops[st] = (ops[st] || 0) + n;
    });
    out.textContent = RADAR_ORDER.filter(function (s) { return by[s]; }).map(function (s) { return radarPart(s, by[s], ops[s]); }).join(" · ");
  }
  function initLiveTimelocks() {
    var host = $("[data-live-timelocks]");
    if (!host || typeof fetch !== "function" || !$("[data-ops]")) { liveSettled(false, null); return; }
    var url = host.getAttribute("data-live-timelocks") || "";
    if (!LIVE_TL_RE.test(url)) { liveSettled(false, null); return; }
    $$("[data-live-status-text]").forEach(function (n) { n.textContent = "Checking live chain state…"; });
    $$("[data-live-status] .spinner").forEach(function (n) { n.hidden = false; });
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var done = false, guard = setTimeout(function () {
      if (done) return;
      done = true; LIVE_FAILED = true;
      if (ctl) { try { ctl.abort(); } catch (e) { /* already settled */ } }
      liveSettled(false, null); freshness();
    }, 9000);
    function settle(ok, blk) { if (done) return; done = true; clearTimeout(guard); liveSettled(ok, blk); freshness(); }
    var init = { cache: "no-store", headers: { Accept: "application/json" } };
    if (ctl) init.signal = ctl.signal;
    fetch(url, init)
      .then(function (r) { if (done) return null; return r && r.status === 200 ? r.json() : null; })
      .then(function (j) {
        if (done) return;   // the fallback already showed the pinned snapshot: a late payload never changes a badge
        if (j && typeof j === "object" && Array.isArray(j.operations)) {
          var blk = applyLiveTimelocks(j); LIVE_OK_AT = Math.floor(Date.now() / 1000); LIVE_FAILED = false; settle(true, blk);
        } else { LIVE_FAILED = true; settle(false, null); }
      }, function () { LIVE_FAILED = true; settle(false, null); /* offline / blocked / timeout: keep the static state */ })
      .catch(function () { LIVE_FAILED = true; settle(false, null); /* malformed payload: keep the static state */ });
  }
  // V01: the hero form drives the full #pf-form checker (same validation, timeout and states) and scrolls to the result
  // /for-protocols/: live badge preview + copyable Markdown / HTML for the selected protocol (attributes and textContent only)
  function initBadgeWidget() {
    var w = $("[data-badge-widget]"); if (!w) return;
    var sel = $("[data-bw-select]", w), img = $("[data-bw-img]", w), base = w.getAttribute("data-base") || "https://pacta.wtf";
    if (!sel || !img) return;
    sel.addEventListener("change", function () {
      var slug = String(sel.value || ""); if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return;
      var name = sel.options && sel.selectedIndex >= 0 && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : slug;
      img.setAttribute("src", "../badges/" + slug + ".svg");
      var pres = $$(".term pre", w);
      if (pres[0]) pres[0].textContent = "[![Pacta Control Plane](" + base + "/badges/" + slug + ".svg)](" + base + "/protocols/" + slug + "/)";
      if (pres[1]) pres[1].textContent = '<a href="' + base + "/protocols/" + slug + '/"><img src="' + base + "/badges/" + slug + '.svg" alt="Pacta Control Plane: ' + name + '" height="20"></a>';
    });
  }
  // ---- Website Edge v3: protocol scorecards (#scorecards) ------------------------------------------------------------------
  var SC_STATE = { g: "Strong", b: "Moderate", a: "Weak", n: "Not determined", u: "Uncompared" };
  var SC_GRADE = { delta: "Delta", protective: "Protective", aligned: "Aligned", observed: "Observed" };
  var SC_VARIANT = { delta: "warning", protective: "info", aligned: "neutral", observed: "outline" };
  var SC_LETTER = { g: "S", b: "M", a: "W", n: "—", u: "—" };
  var SC_RADIUS = { g: 1, b: 0.78, a: 0.56, n: 1, u: 1 };
  var SC_CHAIN = { ethereum: "Ethereum", base: "Base" };
  var SVG_NS = "http://www.w3.org/2000/svg";
  // the same geometry as tools/scorecard.py rosette_svg(): five 72-degree slices clockwise from 12 o'clock
  // the same geometry as tools/scorecard.py rosette_svg(): five 72-degree slices clockwise from 12 o'clock inside a hairline ring;
  // slice length is the colour-independent cue (strong 100 %, moderate 78 %, weak 56 %, hollow full slice when not determined)
  function rosette(fs, size, name, interactive) {
    if (typeof document.createElementNS !== "function") return null;
    var svg = document.createElementNS(SVG_NS, "svg"), c = size / 2, r = size / 2 - 1.5;
    svg.setAttribute("class", "rosette" + (interactive ? " rosette-i" : "")); svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", "0 0 " + size + " " + size); svg.setAttribute("role", "img");
    if (interactive) {   // one keyboard stop (>= 24 px) whose Tooltip lists the five factors; slices show their own on hover
      svg.setAttribute("tabindex", "0");
      svg.setAttribute("data-tip", fs.map(function (f) { return String(f.label) + ": " + SC_STATE[/^[gbanu]$/.test(f.state) ? f.state : "n"]; }).join("\n"));
    }
    svg.setAttribute("aria-label", (name ? name + " control-plane rosette: " : "Control-plane rosette: ")
      + fs.map(function (f) { return f.label + " " + String(SC_STATE[f.state] || "").toLowerCase(); }).join("; "));
    var ring = document.createElementNS(SVG_NS, "circle");
    ring.setAttribute("class", "r-ring"); ring.setAttribute("cx", c.toFixed(1)); ring.setAttribute("cy", c.toFixed(1)); ring.setAttribute("r", r.toFixed(1));
    svg.appendChild(ring);
    fs.forEach(function (f, i) {
      var st = /^[gbanu]$/.test(f.state) ? f.state : "n", rr = r * SC_RADIUS[st];
      var a0 = (-90 + 72 * i + 1.5) * Math.PI / 180, a1 = (-90 + 72 * (i + 1) - 1.5) * Math.PI / 180;
      var p = document.createElementNS(SVG_NS, "path"), lbl = String(f.label) + ": " + SC_STATE[st];
      p.setAttribute("class", "r-" + st);
      p.setAttribute("d", "M" + c.toFixed(1) + " " + c.toFixed(1) + "L" + (c + rr * Math.cos(a0)).toFixed(1) + " " + (c + rr * Math.sin(a0)).toFixed(1)
        + "A" + rr.toFixed(1) + " " + rr.toFixed(1) + " 0 0 1 " + (c + rr * Math.cos(a1)).toFixed(1) + " " + (c + rr * Math.sin(a1)).toFixed(1) + "Z");
      if (interactive) p.setAttribute("data-tip", lbl);
      if (interactive) { var t = document.createElementNS(SVG_NS, "title"); t.textContent = lbl; p.appendChild(t); }
      svg.appendChild(p);
    });
    return svg;
  }
  function gradePill(card) {
    var g = SC_GRADE[card.grade] ? card.grade : "observed";
    var w = el("span", {}, [el("span", { "class": "grade g-" + g, "data-slot": "badge", "data-variant": SC_VARIANT[g], text: SC_GRADE[g] })]);
    if (card.reconciled) w.appendChild(el("span", { "class": "grade-sub", text: "Reconciled" }));
    return w;
  }
  function factorList(card) {
    var dl = el("dl", { "class": "factors" });
    (card.factors || []).forEach(function (f) {
      var st = /^[gbanu]$/.test(f.state) ? f.state : "n";
      var dd = el("dd", {}, [el("b", { text: SC_STATE[st] }), " · " + String(f.value || "")]);
      if (f.evidence) dd.appendChild(el("small", { "class": "ev", text: "Evidence: " + String(f.evidence) }));
      dl.appendChild(el("div", { "data-factor": String(f.key), "data-state": st }, [
        el("dt", {}, [el("span", { "class": "fdot r-" + st, "aria-hidden": "true", text: SC_LETTER[st] }), String(f.label)]), dd]));
    });
    return dl;
  }
  // a drawer's live RPC re-read of the protocol's lead record, pinned to a fresh eth_blockNumber (same rules as the inspector)
  function scLive(box) {
    if (!box || box.getAttribute("data-live-ready")) return;
    box.setAttribute("data-live-ready", "1");
    var ch = box.getAttribute("data-probe-chain") === "base" ? "base" : "ethereum", target = box.getAttribute("data-probe-target") || "";
    var slot = box.getAttribute("data-probe-kind") === "eth_getStorageAt", sos = box.getAttribute("data-probe-sos") || "";
    var data = box.getAttribute("data-probe-data") || sos, sig = box.getAttribute("data-probe-sig") || "call";
    if (!ADDR_RE.test(target)) return;
    box.appendChild(liveVerifyBtn("Verify live on RPC", function () {
      return liveBlock(ch).then(function (b) {
        var call = slot ? rpcCall(ch, "eth_getStorageAt", [target, sos, b.hex]) : rpcCall(ch, "eth_call", [{ to: target, data: data }, b.hex]);
        return call.then(function (x) {
          return ["Live at block #" + b.n + " (" + b.hex + "): " + (slot ? "slot " + sos : sig), "Raw: " + String(x.result),
            "Decoded: " + decodeWord(x.result), hosts(b, x) + " · " + (b.ms + x.ms) + " ms"];
        });
      });
    }));
  }
  function scRows(card, prefix) {
    var nets = (card.chains || []).map(function (c) { return SC_CHAIN[c] || c; }).join(" · ");
    var slug = String(card.slug), did = "sc-d-" + slug, pre = /^(\.\.\/)*$/.test(prefix || "") ? (prefix || "") : "";
    var tog = el("button", { "class": "sc-toggle", type: "button", "aria-expanded": "false", "aria-controls": did, text: String(card.name) });
    var ros = rosette(card.factors || [], 32, card.name, false);
    var row = el("tr", { "class": "sc-row", "data-slug": slug, "data-grade": String(card.grade), "data-baskets": (card.baskets || []).join(" "),
      "data-search": String(card.search || "") }, [
      el("td", {}, [tog, el("span", { "class": "sc-chain", text: nets })]), el("td", {}, [gradePill(card)]),
      el("td", {}, ros ? [ros] : [String(SC_GRADE[card.grade] || "")]), el("td", { "class": "sc-find", text: String(card.summary_short || card.finding || "") }),
      el("td", { "class": "sc-chev" }, [el("span", { "class": "chev", "aria-hidden": "true" }, [svgIcon("m6 9 6 6 6-6")])])]);
    var p = card.probe || {}, n = card.records, eas = card.easAttested !== false;
    var noun = eas ? (n === 1 ? "attested check" : "attested checks") : (n === 1 ? "block-pinned check" : "block-pinned checks");
    var live = el("div", { "class": "sc-live", "data-probe-chain": String(p.chain || ""), "data-probe-target": String(p.target_contract || ""),
      "data-probe-kind": String(p.check_type || ""), "data-probe-sos": String(p.selector_or_slot || ""), "data-probe-data": String(p.repro_calldata || ""),
      "data-probe-sig": String(p.call_signature || "") });
    var big = rosette(card.factors || [], 72, card.name, true);
    var dr = el("div", { "class": "sc-dr" }, [
      el("div", { "class": "sc-ros" }, [big, el("span", { "class": "sc-meta", text: "Hover or focus a slice" })]),
      el("div", {}, [scEvidence(card), factorList(card)]),
      el("p", { "class": "sc-meta", text: (eas ? "Base EAS attested" : "RPC-observed, not EAS-attested") + " · " + n + " " + noun + " · pinned block #" + num(card.pinnedBlock) }),
      live]);
    if (p.target_contract) dr.appendChild(term(castCmd(p), "Reproduce on any archive node", "Copy the cast reproduction for " + String(card.name)));
    dr.appendChild(el("p", { "class": "links" }, [arrowLink({ href: pre + "protocols/" + slug + "/" }, "Full scorecard for " + String(card.name))]));
    var drawer = el("tr", { "class": "sc-drawer", id: did, hidden: "" }, [el("td", { colspan: "5" }, [dr])]);
    return [row, drawer];
  }
  function initScorecards() {
    var root = $("#scorecards"); if (!root) return;
    var body = $("[data-sc-body]", root), q = $("#sc-q", root), qclr = $("[data-sc-qclear]", root), bsel = $("[data-sc-basket]", root);
    var empty = $("[data-sc-empty]", root), more = $("[data-sc-all]", root);
    if (!body) return;
    var prefix = body.getAttribute("data-prefix") || "", filt = "all", bkt = "all", hydrated = body.hasAttribute("data-full"), loading = null;
    function rows() { return $$("tr.sc-row", body); }
    function drawerOf(r) { return $("#" + "sc-d-" + r.getAttribute("data-slug")); }
    function setOpen(r, open) {
      var d = drawerOf(r), t = $(".sc-toggle", r); if (!d) return;
      d.hidden = !open; r.classList.toggle("open", open);
      if (t) t.setAttribute("aria-expanded", String(open));
      if (open) scLive($(".sc-live", d));
    }
    function closeAll() { rows().forEach(function (r) { setOpen(r, false); }); }
    function apply() {
      var t = q ? String(q.value || "").trim().toLowerCase() : "", shown = 0;
      rows().forEach(function (r) {
        var g = r.getAttribute("data-grade"), bs = (r.getAttribute("data-baskets") || "").split(" ");
        var ok = (filt === "all" || g === filt) && (bkt === "all" || bs.indexOf(bkt) >= 0) && (!t || (r.getAttribute("data-search") || "").indexOf(t) >= 0);
        r.hidden = !ok; if (ok) shown++;
        if (!ok) setOpen(r, false);
      });
      if (shown === 0) closeAll();   // F02: zero matches never leave a stale drawer open
      if (empty) empty.hidden = shown !== 0;
      if (qclr) qclr.hidden = !(q && q.value);
      return shown;
    }
    function hydrate() {
      if (hydrated) return Promise.resolve(true);
      if (loading) return loading;
      if (typeof fetch !== "function") return Promise.resolve(false);
      loading = fetch(body.getAttribute("data-src") || "api/v1/scorecards.json").then(function (res) { return res.json(); }).then(function (d) {
        var cards = d && Array.isArray(d.protocols) ? d.protocols : [];
        if (!cards.length) return false;
        body.textContent = "";
        cards.forEach(function (c) { scRows(c, prefix).forEach(function (n) { body.appendChild(n); }); });
        hydrated = true;
        if (more) more.hidden = true;
        return true;
      }).catch(function () { loading = null; return false; });
      return loading;
    }
    function then(fn) { return function () { var a = arguments; body.setAttribute("data-all", ""); hydrate().then(function () { fn.apply(null, a); }); }; }
    // U4: the whole row is the trigger (the name stays the focusable button); links inside the row keep their own behaviour
    body.addEventListener("click", function (ev) {
      var t = ev.target; if (!t || !t.closest) return;
      var r = t.closest("tr.sc-row"); if (!r || t.closest("a")) return;
      var d = drawerOf(r); if (!d) return;
      setOpen(r, d.hidden);
    });
    if (q) {
      q.addEventListener("focus", function () { hydrate(); });
      q.addEventListener("input", then(function () { apply(); }));
    }
    if (qclr) qclr.addEventListener("click", function () { if (q) { q.value = ""; q.focus(); } apply(); });
    if (bsel) bsel.addEventListener("change", then(function () { bkt = String(bsel.value || "all"); apply(); }));
    $$("[data-sc-f]", root).forEach(function (b) {
      b.addEventListener("click", then(function () {
        filt = b.getAttribute("data-sc-f") || "all";
        $$("[data-sc-f]", root).forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
        apply();
      }));
    });
    if (more) more.addEventListener("click", then(function () { apply(); }));
    var clr = empty && $("[data-sc-clear]", empty);
    if (clr) clr.addEventListener("click", function () {
      filt = "all"; bkt = "all"; if (q) q.value = ""; if (bsel) bsel.value = "all";
      $$("[data-sc-f]", root).forEach(function (o) { o.setAttribute("aria-pressed", String(o.getAttribute("data-sc-f") === "all")); });
      apply();
    });
  }
  // hero receipt strip: the pinned, attested receipt renders instantly (text only); the live check runs through the checker
  // V6: the hero examples load their pinned receipt into the proof card (text and attributes only) and run the live check
  // N1 (v4.3): a "Try:" click also fills the checker (#pf-form chain + address, any previous error cleared) and submits it at
  // once, so the verdict-first result renders in #pf-out right under the form. One click = one live check.
  function tryReceipt(b) {
    var form = $("#pf-form"), a = b.getAttribute("data-pf-address") || "";
    if (!form || !ADDR_RE.test(a)) return;
    var ch = $('select[name="chain"]', form), ad = $('input[name="address"]', form), err = $("#pf-addr-error");
    if (ch) ch.value = b.getAttribute("data-pf-chain") === "base" ? "base" : "ethereum";
    if (ad) { ad.value = a; ad.setAttribute("value", a); ad.removeAttribute("aria-invalid"); }   // property + attribute: DOM snapshots agree
    if (err) { err.textContent = ""; err.hidden = true; }
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    // P2-2 (v4.4): bring the form into view (scroll-margin-top clears the sticky top bar), so the filled address and the result
    // card right under it are seen together
    if (form.scrollIntoView) { try { form.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { /* old browsers */ } }
  }
  function initReceipts() {
    var card = $("[data-proof-card]"), chips = $$("[data-receipt]");
    chips.forEach(function (b) {
      b.addEventListener("click", function () {
        chips.forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
        tryReceipt(b);
        if (!card) return;
        var set = function (sel, v) { var n = $(sel, card); if (n) n.textContent = v; };
        set("[data-pc-name]", b.getAttribute("data-r-name") || "");
        set("[data-pc-docs]", b.getAttribute("data-r-docs") || "");
        set("[data-pc-chain]", b.getAttribute("data-r-chain") || "");
        set("[data-pc-block]", (b.getAttribute("data-r-net") || "") + " #" + num(b.getAttribute("data-r-block") || 0));
        var uid = b.getAttribute("data-r-uid") || "", u = $("[data-pc-uid]", card);
        if (u && /^0x[0-9a-fA-F]{64}$/.test(uid)) {
          if (u.tagName === "A") { u.setAttribute("href", "https://base.easscan.org/attestation/view/" + uid); u.setAttribute("title", uid); }
          u.textContent = short(uid, 10, 6);
        }
        var h = $("[data-pc-href]", card), href = b.getAttribute("data-r-href") || "";
        if (h && /^(\.\.\/)*protocols\/[a-z0-9-]+\/$/.test(href)) h.setAttribute("href", href);
      });
    });
  }
  function initHeroCheck() {
    var f = $("[data-hero-check]"), pf = $("#pf-form"); if (!f || !pf) return;
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var ch = $('select[name="chain"]', pf), ad = $('input[name="address"]', pf);
      if (ch) ch.value = ($('select[name="chain"]', f) || {}).value === "base" ? "base" : "ethereum";
      if (ad) ad.value = String(($('input[name="address"]', f) || {}).value || "").trim();
      pf.dispatchEvent(new Event("submit", { cancelable: true }));
      var hin = $('input[name="address"]', f);   // the checker validates synchronously: mirror its aria state onto the hero input
      if (hin && ad && ad.getAttribute("aria-invalid") === "true") { hin.setAttribute("aria-invalid", "true"); hin.setAttribute("aria-describedby", "pf-msg"); }
      else if (hin) { hin.removeAttribute("aria-invalid"); hin.removeAttribute("aria-describedby"); }
      var box = $(".pf"); if (box) { try { box.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { /* old browsers */ } }
    });
  }
  function initRefresh() {
    $$("[data-radar-refresh]").forEach(function (b) { b.addEventListener("click", function () { initLiveTimelocks(); initAges(); }); });
  }

  // ---- first-party beacon hooks: b.js defines window.pactaBeacon (and applies DNT / https / redaction); without it
  //      nothing is sent. copy_mcp_url / copy_curl by what a copy button copies, copy_skill_md, primary CTAs. --------
  function initBeaconHooks() {
    document.addEventListener("click", function (ev) {
      var B = window.pactaBeacon, x = ev.target, c, a, q, t;
      if (typeof B !== "function" || !x || !x.closest) return;
      if ((c = x.closest(".copy"))) {
        q = c.getAttribute("data-copy");
        if (q === null) { t = c.closest(".term"); t = t && t.querySelector("pre"); q = t ? t.textContent : ""; }
        if (/\/mcp\b/.test(q)) B("copy_mcp_url"); else if (/^curl /.test(q)) B("copy_curl");
      } else if ((a = x.closest("a"))) {
        if (/SKILL\.md$/.test(a.getAttribute("href") || "")) B("copy_skill_md");
        else if (a.closest('a.primary,a[data-variant="default"],.memo-foot a,a[data-cta]')) B("cta_click");
      }
    }, true);
  }

  // ---- copy to clipboard (works on http(s) and file://) ---------------------------------------------
  function copyText(text) {
    function legacy() {
      return new Promise(function (resolve, reject) {
        var ta = el("textarea", { readonly: "", style: "position:fixed;top:-1000px;opacity:0" });
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy") ? resolve() : reject(); } catch (e) { reject(e); } finally { ta.remove(); }
      });
    }
    // the async Clipboard API can be refused (permissions, embedded contexts): fall back to the selection copy
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(null, legacy);
    return legacy();
  }

  function flash(btn, ok) {
    var s = $("span", btn) || btn;
    if (!btn.hasAttribute("data-label")) btn.setAttribute("data-label", s.textContent);
    clearTimeout(btn._t);
    btn.classList.toggle("done", ok);
    s.textContent = ok ? "Copied" : "Press Ctrl+C";
    btn._t = setTimeout(function () { s.textContent = btn.getAttribute("data-label"); btn.classList.remove("done"); }, 1600);
  }
  function initCopy() {
    document.addEventListener("click", function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest("[data-copy],[data-copy-from],[data-copy-term]") : null;
      if (!b) return;
      ev.preventDefault(); ev.stopPropagation();
      var src = b.hasAttribute("data-copy-term") ? $("pre", b.closest(".term")) : $("#" + b.getAttribute("data-copy-from"));
      var text = b.hasAttribute("data-copy") ? b.getAttribute("data-copy") : (src ? src.textContent : "");
      if (b.hasAttribute("data-copy-prefix")) text = b.getAttribute("data-copy-prefix") + "\n" + text;   // e.g. "To: <address>" + the brief
      copyText(text).then(function () {
        flash(b, true);
        toast("Copied to clipboard");
        var st = $("#req-status"); if (st && b.closest("#req-form, .req-side")) st.textContent = "Copied. Paste it into an email to " + REQ_TO + " from any mail app.";
      }, function () { flash(b, false); toast("Copy failed: select the text and press Ctrl+C"); });
    });
  }

  // ---- data -------------------------------------------------------------------------------------------
  var DATA = null, BYID = {};
  function loadData() {
    return fetch(document.documentElement.getAttribute("data-api") || "api/v1/index.json")
      .then(function (r) { return r.json(); })
      .then(function (d) { DATA = d; d.entries.forEach(function (e) { BYID[e.id] = e; }); return d; });
  }

  // ---- homepage hydration (V04): the static page ships a curated sample; the full record set comes from /api/v1/index.json on
  //      interaction (search, filter, basket, Show all, a #r- link, Open in inspector). Mirrors index_rows() in build_site.py.
  var EXPL = { ethereum: ["Etherscan", "https://etherscan.io"], base: ["Basescan", "https://basescan.org"] };
  var CHAIN_LABEL = { ethereum: "Ethereum Mainnet (chain id 1)", base: "Base Mainnet (chain id 8453)" };
  function ensureData() { return DATA ? Promise.resolve(DATA) : loadData(); }
  function sortedEntries(d) {
    return d.entries.map(function (e, i) { return [e, i]; }).sort(function (x, y) {
      var a = x[0], b = y[0], pa = a.protocol.toLowerCase(), pb = b.protocol.toLowerCase();
      return (b.sprint - a.sprint) || (pa < pb ? -1 : pa > pb ? 1 : 0) || (x[1] - y[1]);
    }).map(function (x) { return x[0]; });
  }
  function explorerLink(e) {
    var x = EXPL[chainOf(e)];
    return arrowLink({ href: x[1] + "/block/" + e.block_number, target: "_blank", rel: "noopener" }, x[0], "up-right");
  }
  function searchText(e) {
    return ["protocol", "category", "surface", "target_contract", "target_label", "onchain_observed", "classification", "sprint"]
      .map(function (k) { return e[k] === undefined || e[k] === null ? "" : String(e[k]); }).join(" ").toLowerCase();
  }
  function indexRow(e) {
    var proofEl = e.base_eas_uid ? arrowLink({ href: "https://base.easscan.org/attestation/view/" + e.base_eas_uid, target: "_blank", rel: "noopener" }, "EAS", "up-right")
      : el("span", { "class": "muted", text: "Hash-pinned" });
    var row = el("tr", { "data-class": e.classification, "class": "rec", "data-id": e.id, "data-search": searchText(e) }, [
      el("td", {}, [el("b", { "class": "ell", text: e.protocol }), el("span", { "class": "sub ell", text: e.category })]),
      el("td", { "class": "hide-s" }, [el("span", { "class": "ell", text: e.target_label }), el("span", { "class": "sub" }, hexref(e.target_contract))]),
      el("td", {}, [badge(e.classification)]),
      el("td", { "class": "hide-m num nowrap" }, [secs(e.observed_delay_seconds) + " ", el("span", { "class": "muted", text: "/ " + secs(e.documented_delay_seconds) })]),
      el("td", { "class": "hide-m nowrap" }, [el("span", { "class": "num", text: "S" + e.sprint + " · #" + num(e.block_number) }), el("span", { "class": "sub" }, [proofEl])]),
      el("td", { "class": "x" }, [el("a", { "class": "inspect-btn", href: "#r-" + e.id, "aria-expanded": "false", "aria-controls": "r-" + e.id, text: "Details" })])]);
    var repo = "https://github.com/Fractal-Neurons/pacta/blob/main/";
    var kv = el("dl", { "class": "kv" }, [
      el("dt", { text: "Pinned block" }), el("dd", {}, [CHAIN_LABEL[chainOf(e)] + " ", el("span", { "class": "num", text: "#" + num(e.block_number) }), " · ", explorerLink(e), " · "].concat(hexref(e.block_hash, 8, 6))),
      el("dt", { text: "Delay" }), el("dd", {}, [delayCmp(e)]),
      el("dt", { text: "Summary" }), el("dd", {}, [arrowLink({ href: repo + e.summary_doc, target: "_blank", rel: "noopener" }, "Sprint " + e.sprint + " summary", "up-right")]),
      el("dt", { text: "SHA-256" }), el("dd", {}, hexref(e.summary_sha256, 10, 6)),
      el("dt", { text: "Proof" }), el("dd", {}, [proof(e)])]);
    var drawer = el("tr", { "class": "drawer", id: "r-" + e.id }, [el("td", { colspan: "6" }, [el("div", { "class": "drawer-in" }, [
      el("div", {}, [el("p", { "class": "drawer-title", text: e.surface }), el("span", { "class": "label", text: "On-chain observation" }),
        el("p", { "class": "obs-text" }, prose(e.onchain_observed || "")),
        el("p", { "class": "obs-text" }, [el("span", { "class": "label", text: "Documented" }), el("br")].concat(prose(e.documented_reference || ""))),
        el("p", { "class": "obs-text" }, [el("button", { "class": "linkish", type: "button", "data-inspect": e.id, text: "Open in inspector ↑" })])]),
      el("div", {}, [kv, term(castCmd(e))])])])]);
    return [row, drawer];
  }

  // ---- record rendering (mirrors sheet() in tools/build_site.py) -------------------------------------
  var CLS = { parameter_delta: ["delta", "Parameter delta"], protective_delta: ["protect", "Protective delta"], aligned_baseline: ["", "Aligned baseline"] };
  function badge(c, text, extra) { var k = CLS[c] || CLS.aligned_baseline; return el("span", { "class": ("badge " + (extra || k[0])).trim(), text: text || k[1] }); }
  // Exact compact duration: 0 -> 0s, 1 -> 1s, 86400 -> 1d, 129600 -> 1d 12h (mirrors secs() in tools/build_site.py)
  function secs(s) {
    if (s === null || s === undefined) return "—";
    var parts = []; s = Math.floor(s);
    [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]].forEach(function (u) {
      if (s >= u[1]) { parts.push(Math.floor(s / u[1]) + u[0]); s = s % u[1]; }
    });
    return parts.join(" ") || "0s";
  }
  function copyBtn(v, label) {
    return el("button", { "class": "copy", "data-slot": "button", "data-variant": "ghost", "data-size": "sm", type: "button", "data-copy": v,
      "aria-label": "Copy " + String(v) }, [el("span", { text: label || "Copy" })]);
  }
  function hexref(v, a, b) { return [el("span", { "class": "addr", title: v, text: short(v, a || 6, b || 4) }), copyBtn(v)]; }
  function delayCmp(e) {
    var o = e.observed_delay_seconds, d = e.documented_delay_seconds;
    if ((o === null || o === undefined) && (d === null || d === undefined)) return el("span", { "class": "muted", text: "No timelock delay in this record" });
    var warn = o !== null && o !== undefined && d !== null && d !== undefined && o !== d;
    return el("span", { "class": "cmp" }, [
      el("span", { "class": "chip obs" + (warn ? " warn" : "") }, [el("i", { text: "Observed" }), el("b", { text: secs(o) })]),
      el("span", { "class": "vs", text: "vs" }),
      el("span", { "class": "chip" }, [el("i", { text: "Docs" }), el("b", { text: secs(d) })])]);
  }
  function multisig(text) {
    var seen = []; (text.match(/\b\d+-of-\d+\b/g) || []).forEach(function (x) { if (seen.indexOf(x) < 0) seen.push(x); });
    return seen.length ? seen.join(" · ") : null;
  }
  function proxyAdmin(text) {
    var m = text.match(/ProxyAdmin \((0x[0-9a-fA-F]{40})\)/) || text.match(/admin\(\) = [A-Za-z ]*\((0x[0-9a-fA-F]{40})\)/);
    return m ? m[1] : null;
  }
  // Runnable as-is: full signature + every argument (call_signature / call_args in /api/v1/index.json).
  // A record's chain (index.json records without one are Ethereum Mainnet); the RPC variable is never taken from the feed.
  function chainOf(e) { return e && e.chain === "base" ? "base" : "ethereum"; }
  function castCmd(e) {
    var rpc = '--rpc-url "' + (chainOf(e) === "base" ? "$BASE_RPC_URL" : "$ETH_RPC_URL") + '"';
    var first = e.check_type === "eth_getStorageAt"
      ? "cast storage " + e.target_contract + " \\\n  " + e.selector_or_slot + " \\\n  --block " + e.block_number + " " + rpc
      : "cast call " + e.target_contract + ' \\\n  "' + (e.call_signature || e.selector_or_slot) + '"' +
        (e.call_args && e.call_args.length ? " " + e.call_args.join(" ") : "") + " \\\n  --block " + e.block_number + " " + rpc;
    return first + "\ncast block " + e.block_number + " --field hash " + rpc + "\n# expect " + e.block_hash;
  }
  function term(cmd, title, what) {
    var b = el("button", { "class": "copy", "data-slot": "button", "data-variant": "ghost", "data-size": "sm", type: "button", "data-copy-term": "",
      "aria-label": what || ("Copy command: " + (title || "command")) }, [el("span", { text: "Copy" })]);
    return el("div", { "class": "term" }, [el("div", { "class": "term-h" }, [el("span", { text: title || "Reproduce on any archive node" }), b]),
      el("pre", { text: cmd })]);
  }
  function proof(e) {
    if (e.base_eas_uid) return arrowLink({ href: "https://base.easscan.org/attestation/view/" + e.base_eas_uid, target: "_blank", rel: "noopener" }, "Base EAS attestation " + short(e.base_eas_uid, 6, 4), "up-right");
    return el("span", { text: "Pending Base EAS batch attestation · pinned by block hash and summary SHA-256" });
  }
  // 32-byte hashes in prose are shortened with the full value in a tooltip (mirrors prose() in build_site.py)
  function prose(text) {
    var out = [], last = 0, re = /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g, m;
    while ((m = re.exec(text))) {
      out.push(text.slice(last, m.index));
      out.push(el("span", { "class": "hx", title: m[0], text: short(m[0], 8, 6) }));
      last = m.index + m[0].length;
    }
    out.push(text.slice(last));
    return out;
  }
  // "What differs" (mirrors tools/control_diff.py for one record): Safe thresholds paired by k (then n), timelock delays compared;
  // a flagged record with no structured pair lists its surface with the first observed / documented sentence. Text only.
  function thresholds(t) {
    var out = [], re = /\b(\d{1,2})\s*-?\s*of\s*-?\s*(\d{1,2})\b/gi, m;
    while ((m = re.exec(t || ""))) { var k = +m[1], n = +m[2], key = k + "-of-" + n; if (k <= n && out.indexOf(key) < 0) out.push(key); }
    return out;
  }
  function fmtDelay(s) {
    if (typeof s !== "number") return null;
    if (s === 0) return "0 s (no delay)";
    var u = [["d", 86400], ["h", 3600], ["min", 60]];
    for (var i = 0; i < u.length; i++) if (s % u[i][1] === 0) return (s / u[i][1]) + " " + u[i][0];
    return s + " s";
  }
  function firstSentence(t) {
    t = String(t || "").replace(/\s+/g, " ").trim();
    var m = t.match(/^(.+?[.;])(?:\s|$)/); t = m ? m[1] : t;
    return t.length <= 220 ? t : t.slice(0, 219).replace(/\s+$/, "") + "…";
  }
  function whatDiffers(e) {
    if (e.classification !== "parameter_delta" && e.classification !== "protective_delta") return null;
    var changed = [], matched = [], paired = false, obs = thresholds(e.onchain_observed), doc = thresholds(e.documented_reference);
    doc.forEach(function (d) {
      if (obs.indexOf(d) >= 0) { matched.push(["Safe threshold", d]); return; }
      var dk = d.split("-of-"), o = obs.filter(function (x) { return x.split("-of-")[0] === dk[0] && doc.indexOf(x) < 0; })[0]
        || obs.filter(function (x) { return x.split("-of-")[1] === dk[1] && doc.indexOf(x) < 0; })[0];
      if (o) { changed.push(["Safe threshold", o, d]); paired = true; }
    });
    var od = fmtDelay(e.observed_delay_seconds), dd = fmtDelay(e.documented_delay_seconds);
    if (od && dd) { if (e.observed_delay_seconds === e.documented_delay_seconds) matched.push(["Timelock delay", od]); else { changed.push(["Timelock delay", od, dd]); paired = true; } }
    if (!paired) changed.push([e.surface || e.id, firstSentence(e.onchain_observed), firstSentence(e.documented_reference)]);
    return { changed: changed, matched: matched };
  }
  function whatDiffersBox(e) {
    var wd = whatDiffers(e); if (!wd) return null;
    var box = el("div", { "class": "whatdiffers", "data-what-differs": "" }, [el("h2", { "class": "wd-h", text: "What differs" }),
      el("p", { "class": "wd-l", text: "Changed / discrepant" })]);
    var ul = el("ul", { "class": "wd-changed" });
    wd.changed.forEach(function (c) {
      ul.appendChild(el("li", { "data-wd-changed": "" }, [el("b", { text: c[0] }), ": ", el("span", { "class": "obs", text: c[1] }), " observed vs ",
        el("span", { "class": "doc", text: c[2] }), " documented"]));
    });
    box.appendChild(ul);
    if (wd.matched.length) {
      box.appendChild(el("p", { "class": "wd-l", text: "Matched" }));
      var um = el("ul", { "class": "wd-matched" });
      wd.matched.forEach(function (m) { um.appendChild(el("li", { "data-wd-matched": "", text: m[0] + ": " + m[1] })); });
      box.appendChild(um);
    }
    return box;
  }
  function renderSheet(e) {
    var panel = $("#insp-panel"); if (!panel || !e) return;
    var obs = e.onchain_observed || "", ms = multisig(obs), pa = proxyAdmin(obs);
    var repo = "https://github.com/Fractal-Neurons/pacta/blob/main/";
    var rows = [
      ["Category", [e.category]],
      ["Target contract", [e.target_label + " · "].concat(hexref(e.target_contract))],
      ["Timelock delay", [delayCmp(e)]]];
    if (ms) rows.push(["Safe quorum", [el("span", { "class": "mono", text: ms })]]);
    if (pa) rows.push(["EIP-1967 ProxyAdmin", hexref(pa)]);
    rows.push(["Pinned block", [chainOf(e) === "base" ? "Base " : "", el("span", { "class": "num", text: "#" + num(e.block_number) }), " · Sprint " + e.sprint + " ",
      badge(null, "Scanner-pinned (L1 finalized)", "final")]]);
    rows.push(["Canonical block hash", hexref(e.block_hash, 8, 6)]);
    rows.push(["Proof", [proof(e)]]);
    rows.push(["Summary", [arrowLink({ href: repo + e.summary_doc, target: "_blank", rel: "noopener" }, e.summary_doc.split("/").pop(), "up-right"), " · SHA-256 "].concat(hexref(e.summary_sha256, 8, 4))]);
    var dl = el("dl", { "class": "kv" });
    rows.forEach(function (r) { dl.appendChild(el("dt", { text: r[0] })); dl.appendChild(el("dd", {}, r[1])); });
    panel.textContent = "";
    panel.appendChild(el("div", { "class": "sheet-h" }, [el("h3", { text: e.protocol }), badge(e.classification)]));
    panel.appendChild(el("p", { "class": "sheet-sub", text: e.surface }));
    var wdb = whatDiffersBox(e); if (wdb) panel.appendChild(wdb);
    panel.appendChild(dl);
    panel.appendChild(el("p", { "class": "obs-text" }, prose(obs)));
    panel.appendChild(term(castCmd(e)));
    panel.appendChild(el("p", { "class": "pf-section", text: "Pinned documentation comparison above; replay the same read live:" }));
    panel.appendChild(liveVerifyBtn("Verify live on RPC", function () {
      var ch = chainOf(e), slot = e.check_type === "eth_getStorageAt";
      return liveBlock(ch).then(function (b) {
        var call = slot ? rpcCall(ch, "eth_getStorageAt", [e.target_contract, e.selector_or_slot, b.hex])
          : rpcCall(ch, "eth_call", [{ to: e.target_contract, data: e.repro_calldata || e.selector_or_slot }, b.hex]);
        return call.then(function (x) {
          return ["Live at block #" + b.n + " (" + b.hex + "): " + (slot ? "slot " + e.selector_or_slot : (e.call_signature || "call")),
            "Raw: " + String(x.result), "Decoded: " + decodeWord(x.result), hosts(b, x) + " · " + (b.ms + x.ms) + " ms"];
        });
      });
    }));
  }

  // ---- inspector workbench ---------------------------------------------------------------------------
  function initInspector() {
    var list = $("#insp-list"); if (!list) return;
    var q = $("#insp-q"), count = $("#insp-count"), filt = "all", hydrated = false, bkt = "all";
    var bRules = {};
    $$("[data-insp-basket]").forEach(function (b) {
      var k = b.getAttribute("data-insp-basket"), rx = b.getAttribute("data-basket-re");
      try { bRules[k] = { re: rx ? new RegExp(rx, "i") : null, chain: b.getAttribute("data-basket-chain") }; } catch (e) { /* skip */ }
    });
    function inBasket(e) {
      if (bkt === "all") return true;
      var r = bRules[bkt]; if (!r || !e) return false;
      return !!((r.re && r.re.test(e.category || "")) || (r.chain && chainOf(e) === r.chain));
    }
    var links = $$("a[data-id]", list);
    function inspItem(e) {
      var dc = (CLS[e.classification] || CLS.aligned_baseline)[0];
      return el("li", {}, [el("a", { href: "#r-" + e.id, "data-id": e.id, "data-class": e.classification }, [
        el("span", { "class": ("dot " + dc).trim() }), el("span", { "class": "p", text: e.protocol }), el("span", { "class": "sp", text: "S" + e.sprint }),
        el("span", { "class": "s", text: e.surface })])]);
    }
    function hydrate() {
      if (hydrated) return Promise.resolve();
      return ensureData().then(function (d) {
        if (hydrated) return;
        hydrated = true;
        var cur = links.filter(function (a) { return a.getAttribute("aria-current") === "true"; })[0];
        var curId = cur ? cur.getAttribute("data-id") : null;
        list.textContent = "";
        sortedEntries(d).forEach(function (e) { list.appendChild(inspItem(e)); });
        links = $$("a[data-id]", list);
        links.forEach(function (a) { a.setAttribute("aria-current", String(a.getAttribute("data-id") === curId)); });
        $$("[data-insp-all]").forEach(function (b) { b.hidden = true; });
      });
    }
    function select(id, scroll) {
      var e = BYID[id]; if (!e) return false;
      links.forEach(function (a) { a.setAttribute("aria-current", String(a.getAttribute("data-id") === id)); });
      renderSheet(e);
      if (scroll) $("#inspector").scrollIntoView({ behavior: "smooth", block: "start" });
      return true;
    }
    var panel = $("#insp-panel"), empty = null;
    function clearFilters() {
      if (q) q.value = ""; filt = "all"; bkt = "all";
      $$("[data-insp-basket]").forEach(function (o) { o.setAttribute("aria-pressed", String(o.getAttribute("data-insp-basket") === "all")); });
      $$(".bench-filter button").forEach(function (o) { o.setAttribute("aria-pressed", String(o.getAttribute("data-f") === "all")); });
      apply();
    }
    function showEmpty(on) {
      if (!panel) return;
      if (on && !empty) {
        empty = el("div", { "class": "insp-empty", "data-insp-empty": "" }, [el("p", { text: "No record matches these filters." })]);
        var btn = el("button", { type: "button", "class": "btn sm", "data-insp-clear": "", text: "Clear filters" });
        btn.addEventListener("click", clearFilters);
        empty.appendChild(btn);
        panel.parentNode.appendChild(empty);
      }
      if (empty) empty.hidden = !on;
      panel.hidden = !!on;
    }
    function apply() {
      var t = (q && q.value || "").trim().toLowerCase(), shown = 0;
      links.forEach(function (a) {
        var e = BYID[a.getAttribute("data-id")];
        var hay = e ? JSON.stringify(e).toLowerCase() : a.textContent.toLowerCase();
        var ok = (filt === "all" || a.getAttribute("data-class") === filt) && (!t || hay.indexOf(t) >= 0) && inBasket(e);
        a.parentNode.hidden = !ok; if (ok) shown++;
      });
      if (count) count.textContent = shown + " of " + links.length + " records";
      var vis = links.filter(function (a) { return !a.parentNode.hidden; });
      showEmpty(vis.length === 0);
      var cur = links.filter(function (a) { return a.getAttribute("aria-current") === "true"; })[0];
      if (vis.length && (!cur || cur.parentNode.hidden)) select(vis[0].getAttribute("data-id"), false);
    }
    list.addEventListener("click", function (ev) {
      var a = ev.target.closest("a[data-id]"); if (!a || !DATA) return;   // without data, the link opens the index drawer
      ev.preventDefault(); select(a.getAttribute("data-id"), false);
    });
    list.addEventListener("keydown", function (ev) {
      if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
      var vis = links.filter(function (a) { return !a.parentNode.hidden; }), i = vis.indexOf(document.activeElement);
      if (i < 0) return; ev.preventDefault();
      var n = vis[Math.max(0, Math.min(vis.length - 1, i + (ev.key === "ArrowDown" ? 1 : -1)))]; n.focus(); select(n.getAttribute("data-id"), false);
    });
    function hydrated_(fn) { return function () { var self = this, args = arguments; hydrate().then(function () { fn.apply(self, args); }, function () { fn.apply(self, args); }); }; }
    if (q) {
      q.addEventListener("focus", function () { hydrate().catch(function () { /* the sample keeps working */ }); });
      q.addEventListener("input", hydrated_(function () {
        apply();
        var first = links.filter(function (a) { return !a.parentNode.hidden; })[0];
        if (first && q.value.trim()) select(first.getAttribute("data-id"), false);
      }));
    }
    $$(".bench-filter button").forEach(function (b) {
      b.addEventListener("click", hydrated_(function () {
        filt = b.getAttribute("data-f");
        $$(".bench-filter button").forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
        apply();
      }));
    });
    $$("[data-insp-all]").forEach(function (b) { b.addEventListener("click", hydrated_(function () { apply(); })); });
    $$("[data-insp-basket]").forEach(function (b) {
      b.addEventListener("click", hydrated_(function () {
        bkt = b.getAttribute("data-insp-basket") || "all";
        $$("[data-insp-basket]").forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
        apply();
      }));
    });
    document.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-inspect]"); if (!b || !DATA) return;
      ev.preventDefault(); select(b.getAttribute("data-inspect"), true);
    });
  }

  // ---- public index: filter + inline drawers ---------------------------------------------------------
  function initIndex() {
    var tbody = $("#matrix tbody"), rows = $$("#matrix tbody tr.rec"); if (!rows.length || !tbody) return;
    var q = $("#matrix-q"), count = $("#matrix-count"), cls = "all", hydrated = false;
    function hydrate() {
      if (hydrated) return Promise.resolve();
      return ensureData().then(function (d) {
        if (hydrated) return;
        hydrated = true;
        tbody.textContent = "";
        sortedEntries(d).forEach(function (e) { indexRow(e).forEach(function (n) { tbody.appendChild(n); }); });
        rows = $$("#matrix tbody tr.rec");
        $$("[data-ix-all]").forEach(function (b) { b.hidden = true; });
      });
    }
    function drawer(r) { return document.getElementById("r-" + r.getAttribute("data-id")); }
    function toggle(r, open) {
      var d = drawer(r); if (!d) return;
      open = open === undefined ? !d.classList.contains("open") : open;
      d.classList.toggle("open", open); r.classList.toggle("open", open);
      var b = $(".inspect-btn", r); if (b) { b.setAttribute("aria-expanded", String(open)); b.textContent = open ? "Close" : "Details"; }
    }
    function apply() {
      var t = (q && q.value || "").trim().toLowerCase(), shown = 0;
      rows.forEach(function (r) {
        var ok = (cls === "all" || r.getAttribute("data-class") === cls) && (!t || r.getAttribute("data-search").indexOf(t) >= 0);
        r.hidden = !ok; if (!ok) toggle(r, false); else shown++;
      });
      if (count) count.textContent = shown + " of " + rows.length + " records shown";
    }
    tbody.addEventListener("click", function (ev) {
      var r = ev.target.closest("tr.rec"); if (!r) return;
      if (ev.target.closest("a:not(.inspect-btn),button")) return;
      ev.preventDefault(); toggle(r);
    });
    function after(fn) { return function () { var a = arguments; hydrate().then(function () { fn.apply(null, a); }, function () { fn.apply(null, a); }); }; }
    if (q) q.addEventListener("input", after(apply));
    $$("#index .seg button").forEach(function (b) {
      b.addEventListener("click", after(function () {
        cls = b.getAttribute("data-class");
        $$("#index .seg button").forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
        apply();
      }));
    });
    $$("[data-ix-all]").forEach(function (b) { b.addEventListener("click", after(apply)); });
    function openRow(id, smooth) {
      var r = rows.filter(function (x) { return x.getAttribute("data-id") === id; })[0];   // no selector parsing
      if (r) { r.hidden = false; toggle(r, true); r.scrollIntoView(smooth ? { behavior: "smooth", block: "center" } : { block: "center" }); return; }
      if (hydrated) return;
      hydrate().then(function () { if (rows.some(function (x) { return x.getAttribute("data-id") === id; })) openRow(id, smooth); }, function () { /* sample only */ });
    }
    function openFromHash() {
      var m = location.hash.match(/^#r-(.+)$/); if (!m) return;
      var id = m[1];
      try { id = decodeURIComponent(id); } catch (e) { /* keep the raw fragment */ }
      openRow(id, false);
    }
    document.addEventListener("click", function (ev) {
      var a = ev.target.closest("a[data-open]"); if (!a) return;
      ev.preventDefault();
      openRow(a.getAttribute("data-open"), true);
    });
    window.addEventListener("hashchange", openFromHash);
    openFromHash();
    apply();
  }

  // ---- request builder: brief + GitHub intake + Gmail compose + copy ---------------------------------
  // Tracks: 24h dossier (default), $500 re-verification, Continuous Control-Plane Monitoring, high-throughput API SLA, free community queue. The
  // public data itself is free for everyone, so nothing here gates access. GitHub dropdown strings must match
  // .github/ISSUE_TEMPLATE/request-scan.yml. Paid tracks settle by Option A (commercial invoice, default) or Option B
  // (direct on-chain USDC to the Pacta treasury, an EOA).
  var REQ_TO = "pacta@dri.network";
  var TRACK = {
    community: ["Community queue (free; unscheduled, typically 6–8 weeks)", "Community queue (free; unscheduled, typically 6–8 weeks)",
                "Pacta community queue request", ""],
    "rapid-500": ["Rapid Single-Gap Re-Verification ($500 USDC, 24h SLA)", "Rapid Single-Gap Re-Verification ($500 USDC, 24h SLA)",
                  "Pacta rapid single-gap re-verification request", "$500 USDC (24h SLA)"],
    clearance: ["Full Protocol Control-Plane Dossier ($2,500–$5,000 USDC, 24h SLA)",
                "Full Protocol Control-Plane Dossier ($2,500–$5,000 USDC, 24h SLA)",
                "Pacta 24h dossier request", "$2,500–$5,000 USDC (24h SLA)"],
    continuous: ["Continuous Control-Plane Monitoring ($1,500 USDC per month)",
                 "Continuous Control-Plane Monitoring ($1,500 USDC per month)",
                 "Pacta Continuous Control-Plane Monitoring request", "$1,500 USDC per month"],
    api_sla: ["Enterprise / High-Throughput API SLA (priced on scope)",
              "Enterprise / High-Throughput API SLA (priced on scope)",
              "Pacta enterprise API SLA request", "the scoped amount (quoted on the invoice)"]
  };
  var SETTLE = {
    invoice: ["Option A — formal commercial invoice (PDF) & counterparty settlement (no upfront transfer; invoice on scope confirmation)",
              "Option A: formal commercial invoice (PDF) and counterparty settlement"],
    direct: ["Option B — direct on-chain USDC settlement", "Option B: direct on-chain USDC settlement"]
  };
  var TX_RE = /^0x[0-9a-fA-F]{64}$/;
  function own(o, k) { return typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k); }
  // ---- URL prefill (/request/?tier=…&protocol=…&forum=…&settlement=…, also /?…#request): closed enums and sanitised
  //      text only, written with .value / .checked, never as markup. PREFILL-BEGIN
  var BAD_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;
  function cleanText(v, max) { return String(v || "").replace(BAD_CHARS, "").replace(/\s+/g, " ").trim().slice(0, max); }
  function cleanForum(v) {
    var s = String(v || "").trim(), u;
    if (!s || s.length > 300 || /[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/.test(s)) return "";
    try { u = new URL(s); } catch (e) { return ""; }
    return u.protocol === "https:" && !u.username && !u.password && u.hostname ? s : "";
  }
  function readPrefill(search) {
    var q, out = {};
    try { q = new URLSearchParams(search || ""); } catch (e) { return out; }
    var t = q.get("tier"), st = q.get("settlement"), p = cleanText(q.get("protocol"), 80), f = cleanForum(q.get("forum"));
    if (own(TRACK, t)) out.tier = t;
    if (own(SETTLE, st)) out.settlement = st;
    if (p) out.protocol = p;
    if (f) out.forum = f;
    return out;
  }
  // PREFILL-END
  function initRequest() {
    var form = $("#req-form"); if (!form) return;
    var out = $("#req-brief"), gh = $("#req-gh"), gm = $("#req-gmail"), st = $("#req-status"), pay = $("#req-pay");
    var txField = $("#req-tx-field"), txHint = $("#req-tx-hint"), txIn = $("#req-tx"), sum = $("#req-pay-sum"), direct = $("#req-direct");
    var done = $("#req-done"), send = $("#req-send"), api = form.getAttribute("data-api") || "";
    var treasury = form.getAttribute("data-treasury") || "";
    function val(n) { var x = form.elements[n]; return x ? String(x.value || "").trim() : ""; }
    function tier() { var x = $('input[name="tier"]:checked', form); return x && own(TRACK, x.value) ? x.value : "clearance"; }
    function settlement() { var x = $('input[name="settlement"]:checked', document); return x && own(SETTLE, x.value) ? x.value : "invoice"; }
    var combo = initCombo(form, function () { update(); });
    function protocols() { return combo.values().map(function (x) { return x.name; }); }
    function fieldErr(inputId, errId, text) {
      var inp = $("#" + inputId), m = $("#" + errId);
      if (m) { m.textContent = text || ""; m.hidden = !text; }
      if (inp) { if (text) inp.setAttribute("aria-invalid", "true"); else inp.removeAttribute("aria-invalid"); }
    }
    function update() {
      if (!out) return;
      var t = tier(), paid = t !== "community", s = settlement(), dir = paid && s === "direct";
      var ps = protocols(), org = val("org"), scope = val("scope"), contact = val("contact");
      var forum = val("forum"), tx = dir ? val("tx") : "", txOk = !tx || TX_RE.test(tx);
      var subj = TRACK[t][2] + (org ? " — " + org : "");
      var lines = ["Subject: " + subj, "",
        "Track: " + TRACK[t][0],
        "Organization: " + (org || "(not given)"),
        "Protocols in scope: " + (ps.length ? ps.join(", ") : "(none selected)")];
      if (scope) lines.push("Scope:", scope);
      if (forum) lines.push("Forum proposal: " + forum);
      if (paid) {
        lines.push("Settlement: " + SETTLE[s][0]);
        if (dir) {
          lines.push("Payment: " + (tx ? tx + (txOk ? "" : "  (check: not a 0x-prefixed 32-byte transaction hash)")
                                       : "not yet sent; please confirm scope first") + " — " + TRACK[t][3] +
                     " in USDC to the Pacta treasury (direct settlement EOA) " + treasury + " on Base or Ethereum");
        }
      }
      lines.push("Contact: " + (contact || "(not given)"));
      lines.push("", "Sent from " + location.href.split("#")[0]);
      out.textContent = lines.join("\n");
      if (pay) pay.hidden = !paid;
      if (sum) sum.textContent = paid ? TRACK[t][0].replace(/ \((.*)\)$/, " · $1") : "";
      if (direct) direct.hidden = !dir;
      if (txField) txField.hidden = !dir;
      if (txIn) { if (txOk) txIn.removeAttribute("aria-invalid"); else txIn.setAttribute("aria-invalid", "true"); }
      if (txHint) txHint.textContent = txOk ? "A 66-character hash starting with 0x." : "That does not look like a transaction hash (0x + 64 hex characters).";
      var title = "[Pacta Scope] " + (org || (ps.length ? ps.slice(0, 3).join(", ") : TRACK[t][2].replace(/^Pacta | request$/g, "")));
      var p = new URLSearchParams({ template: "request-scan.yml", title: title });
      p.set("repo_or_portfolio_url", forum || scope.split(/\s+/).filter(function (w) { return /^https?:\/\//.test(w); })[0] || "");
      p.set("commitments_and_addresses", ["Protocols: " + (ps.join(", ") || "-"), scope].filter(Boolean).join("\n"));
      p.set("package_tier", TRACK[t][1]);
      if (paid) p.set("settlement_preference", SETTLE[s][1]);
      if (forum) p.set("forum_proposal_url", forum);
      if (dir && tx && txOk) p.set("payment_tx_hash", tx);
      p.set("contact_channel", contact);
      if (gh) gh.href = "https://github.com/Fractal-Neurons/pacta/issues/new?" + p.toString();
      if (gm) gm.href = "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(REQ_TO) + "&su=" + encodeURIComponent(subj) +
        "&body=" + encodeURIComponent(lines.slice(2).join("\n"));
    }
    // the request body, or null with every problem shown next to its field
    function payload() {
      var t = tier(), sel = combo.values(), org = val("org"), scope = val("scope"), forum = val("forum"), contact = val("contact"), ok = true;
      var subj = "";
      if (sel.length) {
        var parts = [], i;
        for (i = 0; i < sel.length; i++) {
          var next = (sel[i].slug || cleanSubject(sel[i].name).toLowerCase());
          if ((parts.concat([next]).join(", ") + (i < sel.length - 1 ? " and " + (sel.length - i - 1) + " more" : "")).length > 120) break;
          parts.push(next);
        }
        subj = parts.join(", ") + (parts.length < sel.length ? " and " + (sel.length - parts.length) + " more" : "");
      } else subj = cleanSubject(org).slice(0, 120);
      if (subj.length < 2) { fieldErr("req-proto-q", "req-proto-err", "Choose at least one protocol, or name your organization."); ok = false; }
      else fieldErr("req-proto-q", "req-proto-err", "");
      if (org && /[@<>]/.test(org)) { fieldErr("req-org", "req-org-err", "Keep contact details and markup out of the organization name."); ok = false; }
      else fieldErr("req-org", "req-org-err", "");
      if (PII_RE.test(scope)) { fieldErr("req-scope", "req-scope-err", "Remove emails, @handles, IP addresses or HTML from Scope; put a contact in Contact."); ok = false; }
      else fieldErr("req-scope", "req-scope-err", "");
      var cleanForumUrl = forum ? cleanForum(forum) : "";
      if (forum && (!cleanForumUrl || cleanForumUrl.length > 200)) { fieldErr("req-forum", "req-forum-err", "Use a public https:// link of up to 200 characters."); ok = false; }
      else fieldErr("req-forum", "req-forum-err", "");
      var c = contact.replace(/^github:/i, "");
      if (contact && (JUNK_CONTACT.test(contact) || contact.length > 120 || !(EMAIL_RE.test(c) || TG_RE.test(c) || GH_RE.test(c)))) {
        fieldErr("req-contact", "req-contact-err", "Use a work email, a @telegram handle or a GitHub username, or leave it empty."); ok = false;
      } else fieldErr("req-contact", "req-contact-err", "");
      if (!ok) return null;
      var cap = cutWords(TRACK[t][0] + (scope ? ": " + scope.replace(BAD_CHARS, "") : "."), 280);
      var body = { caller_agent: "pacta-web", requester_role: val("requester_role"), caller_purpose: val("caller_purpose"),
        request_type: val("request_type"), target_subject: subj, requested_capability: cap, urgency_track: URGENCY[t] };
      Object.keys(REQ_ENUMS).forEach(function (k) { if (REQ_ENUMS[k].indexOf(body[k]) < 0) body[k] = REQ_ENUMS[k][k === "requester_role" ? 5 : k === "caller_purpose" ? 6 : 0]; });
      if (cleanForumUrl) body.forum_proposal_url = cleanForumUrl;
      if (contact) body.contact_handle = contact;
      return body;
    }
    function busy(on) {
      if (!send) return;
      send.disabled = on; send.setAttribute("aria-busy", String(on));
      var sp = $(".spinner", send), l = $("[data-req-label]", send);
      if (sp) sp.hidden = !on; if (l) l.textContent = on ? "Sending…" : "Send request";
    }
    function status(t, bad) { if (st) { st.textContent = t; st.style.color = bad ? "var(--destructive)" : ""; } }
    function showDone(j) {
      if (!done) return;
      var set = function (sel, v) { var n = $(sel, done); if (n) n.textContent = v; };
      var up = j.status === "upvoted_existing";
      set("[data-req-id]", String(j.request_id));
      set("[data-req-st]", up ? "Added your vote to an existing request" : "Queued");
      set("[data-req-votes]", typeof j.demand_votes === "number" ? String(j.demand_votes) : "1");
      set("[data-req-done-title]", up ? "Request recorded" : "Request received");
      set("[data-req-done-text]", up ? "Someone asked for the same scope; your request was added to it." : "Your request is in the queue. Keep the ID for follow-up.");
      var fr = $("[data-req-fast-row]", done), fa = $("[data-req-fast]", done), fu = String(j.fast_track_url || "");
      if (fr && fa && /^https:\/\/[^\s"<>]+$/.test(fu)) { fa.setAttribute("href", fu); fr.hidden = false; } else if (fr) fr.hidden = true;
      form.hidden = true; done.hidden = false;
      try { done.focus(); } catch (e) { /* focus is best effort */ }
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();   // no navigation, no inline handler (CSP-safe)
      status("", false);
      var body = payload();
      if (!body) { status("Fix the highlighted fields, then send again.", true); var f = $('[aria-invalid="true"]', form); if (f) f.focus(); return; }
      if (!REQ_API_RE.test(api) || typeof fetch !== "function") { status("This browser cannot send the form; open a GitHub issue or copy the brief instead.", true); return; }
      busy(true);
      var init = { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) };
      try { if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") init.signal = AbortSignal.timeout(15000); } catch (x) { /* none */ }
      fetch(api, init).then(function (res) { return res.json().then(function (j) { return { status: res.status, j: j }; }, function () { return { status: res.status, j: {} }; }); })
        .then(function (x) {
          busy(false);
          var j = x.j || {};
          if (x.status === 200 && /^REQ-\d{4}-[A-Za-z0-9]+$/.test(String(j.request_id || ""))) { showDone(j); return; }
          if (x.status === 429) status("Too many requests from this network (HTTP 429). Wait a few minutes, or open a GitHub issue.", true);
          else status("The API answered HTTP " + x.status + (j.detail ? ": " + String(j.detail) : j.error ? ": " + String(j.error) : "") + ". Fix the form, or open a GitHub issue.", true);
        }, function () { busy(false); status("Could not reach the API. Open a GitHub issue or copy the brief instead.", true); });
    });
    var again = done && $("[data-req-again]", done);
    if (again) again.addEventListener("click", function () { done.hidden = true; form.hidden = false; status("", false); var f = $('input[name="tier"]:checked', form); if (f) f.focus(); });
    function pick(name, v) {
      var r = $$('input[name="' + name + '"]').filter(function (x) { return x.value === v; })[0];
      if (r) r.checked = true;
      return !!r;
    }
    function preselect(t) { if (pick("tier", t)) update(); }
    function prefill(o) {
      if (o.tier) pick("tier", o.tier);
      if (o.settlement) pick("settlement", o.settlement);
      if (o.protocol) {
        var orgIn = form.elements.org, hit = combo.select(o.protocol);
        if (orgIn && !String(orgIn.value || "").trim()) {
          var v = combo.values(); orgIn.value = hit && v.length ? v[v.length - 1].name : o.protocol;
        }
      }
      if (o.forum && form.elements.forum) form.elements.forum.value = o.forum;
    }
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    document.addEventListener("change", function (ev) { if (ev.target && ev.target.getAttribute && ev.target.getAttribute("name") === "settlement" && !form.contains(ev.target)) update(); });
    if (gh) gh.addEventListener("click", function () { status("Opened in a new tab. If nothing appeared, use Copy brief.", false); });
    if (gm) gm.addEventListener("click", function () { status("Opened in a new tab. If nothing appeared, use Copy brief.", false); });
    document.addEventListener("click", function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest("a[data-tier]") : null; if (!a) return;
      if ((a.getAttribute("href") || "").charAt(0) === "#") { preselect(a.getAttribute("data-tier")); }
    });
    prefill(readPrefill(location.search));
    update();
  }

  // ---- live pre-flight checker (free API; runs only on an explicit submit / preset click) ---------------
  var ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
  var SLOT_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  var SLOT_BEACON = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
  var SLOT_PROXIABLE = "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7";
  // V7: amber is for warnings only; neutral and good verdicts get the neutral badge
  var VERDICT_VARIANT = { IMMUTABLE_NO_ADMIN: "neutral", TIMELOCK_PROTECTED: "neutral", UNDEPLOYED_OR_EOA: "neutral", ZERO_DELAY_TIMELOCK_RISK: "warning",
    MULTISIG_NO_TIMELOCK: "warning", INSTANT_EOA_ADMIN_RISK: "warning", UNCLASSIFIED_CONTRACT_CONTROLLER: "warning" };
  function pfCasts(r) {
    var rpc = r.chain === "base" ? "$BASE_RPC_URL" : "$ETH_RPC_URL", b = " --block " + r.pinnedBlock + " --rpc-url " + rpc, c = [];
    c.push("cast block " + r.pinnedBlock + " --field hash --rpc-url " + rpc + (/^0x[0-9a-f]{64}$/.test(String(r.pinnedBlockHash || "")) ? "   # expect " + r.pinnedBlockHash : ""));
    c.push("cast code " + r.address + b);
    c.push("cast storage " + r.address + " " + (r.proxyType === "eip1822" ? SLOT_PROXIABLE : r.proxyType === "eip1967_beacon" ? SLOT_BEACON : SLOT_IMPL) + b);
    if (r.proxyType === "eip1967_beacon" && ADDR_RE.test(String(r.beacon || ""))) {
      c.push("cast call " + r.beacon + ' "implementation()(address)"' + b);
      c.push("cast call " + r.beacon + ' "owner()(address)"' + b);
    }
    c.push("cast call " + r.address + ' "owner()(address)"' + b);
    var k = r.controller || {};
    if (k.address && k.kind === "multisig_safe") {
      c.push("cast call " + k.address + ' "getThreshold()(uint256)"' + b);
      c.push("cast call " + k.address + ' "getOwners()(address[])"' + b);
    }
    if (k.address && k.kind === "timelock") c.push("cast call " + k.address + ' "getMinDelay()(uint256)"' + b);
    return c;
  }
  // Plain-English verdicts (the raw enum stays one click away, with the full JSON)
  var VERDICT_TEXT = { IMMUTABLE_NO_ADMIN: "No standard upgrade or admin authority detected", TIMELOCK_PROTECTED: "Changes wait behind a timelock",
    ZERO_DELAY_TIMELOCK_RISK: "Timelock with a zero delay: changes can land instantly", MULTISIG_NO_TIMELOCK: "A multisig can change it with no delay",
    INSTANT_EOA_ADMIN_RISK: "A single key can change it instantly", UNCLASSIFIED_CONTRACT_CONTROLLER: "Controller needs further review",
    UNDEPLOYED_OR_EOA: "No contract code at this address (EOA or not deployed)" };
  function verdictText(v) { return VERDICT_TEXT[v] || String(v); }
  function rawDetails(r) {
    return el("details", { "class": "acc pf-raw", "data-slot": "accordion-item", "data-pf-raw": "" }, [
      el("summary", { "data-slot": "accordion-trigger", text: "Raw verdict and JSON" }),
      el("div", { "data-slot": "accordion-content" }, [el("p", {}, [el("code", { text: String(r.verdict) })]), el("pre", { "class": "pf-json", text: JSON.stringify(r, null, 2) })])]);
  }
  // ---- one-click "Verify live on RPC": CORS public endpoints, first answer wins (fallback on error), latency in ms; text only
  var LIVE_RPCS = { ethereum: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
    base: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"] };
  function rpcCall(chain, method, params) {
    var urls = LIVE_RPCS[chain === "base" ? "base" : "ethereum"], i = 0;
    function attempt() {
      var url = urls[i], t0 = Date.now();
      var opts = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }) };
      if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") { try { opts.signal = AbortSignal.timeout(8000); } catch (e) { /* none */ } }
      return fetch(url, opts).then(function (res) { return res.json(); }).then(function (j) {
        if (!j || j.error || j.result === undefined) throw new Error(j && j.error ? String(j.error.message || "rpc error") : "no result");
        return { result: j.result, ms: Date.now() - t0, rpc: url.replace(/^https:\/\//, "") };
      }).catch(function (e) { i++; if (i < urls.length) return attempt(); throw e; });
    }
    return attempt();
  }
  // every live read is pinned to one fresh block: eth_blockNumber first, then the read(s) at that exact hex block number
  var EIP1967_ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
  function liveBlock(chain) {
    return rpcCall(chain, "eth_blockNumber", []).then(function (x) {
      var hx = String(x.result).toLowerCase();
      if (!/^0x[0-9a-f]{1,16}$/.test(hx)) throw new Error("bad eth_blockNumber");
      return { hex: hx, n: parseInt(hx, 16), rpc: x.rpc, ms: x.ms };
    });
  }
  function hosts(a, b) { return a.rpc === b.rpc ? a.rpc : a.rpc + " + " + b.rpc; }
  // first 32-byte ABI word as uint256 (decimal) and, when it is a left-padded 20-byte value, as an address
  function decodeWord(hex) {
    var h = String(hex || "").replace(/^0x/i, "").toLowerCase();
    if (!/^[0-9a-f]*$/.test(h)) return "not hex";
    if (!h.length) return "empty (0 bytes)";
    var w = h.length >= 64 ? h.slice(0, 64) : (new Array(65 - h.length).join("0") + h);
    var dec = typeof BigInt === "function" ? BigInt("0x" + w).toString() : (/^0{51}/.test(w) ? String(parseInt(w, 16)) : "n/a");
    var t = "uint256 " + dec;
    if (/^0{24}/.test(w) && !/^0{32}/.test(w)) t += " = address 0x" + w.slice(24);
    if (h.length > 64) t += " (first of " + Math.ceil(h.length / 64) + " words)";
    return t;
  }
  function liveVerifyBtn(label, job) {
    var wrap = el("div", { "class": "live-verify", "data-live-verify": "" });
    var btn = el("button", { type: "button", "class": "btn sm", "data-live-verify-btn": "", text: label });
    var res = el("p", { "class": "live-verify-out", "data-live-verify-out": "", "aria-live": "polite" });
    btn.addEventListener("click", function () {
      if (typeof fetch !== "function") { res.textContent = "This browser cannot call an RPC; use the cast commands."; return; }
      res.textContent = "Calling a public RPC…";
      job().then(function (t) {
        res.textContent = "";
        [].concat(t).forEach(function (line) { res.appendChild(el("span", { "class": "lv-line", text: String(line) })); });
      }, function (e) { res.textContent = "Live RPC check failed (" + String(e && e.message || e) + "); use the cast commands."; });
    });
    wrap.appendChild(btn); wrap.appendChild(res);
    return wrap;
  }
  function pfRow(k, v) { return el("div", {}, [el("dt", { text: k }), el("dd", {}, [v])]); }
  function pfAddr(v) { return ADDR_RE.test(String(v || "")) ? el("span", {}, hexref(v, 8, 6)) : "none"; }
  // confidence framing next to the score: coverage (indexed_verified / unindexed_bytecode_heuristic), confidence, method, limits
  function pfAssess(out, r) {
    var a = r && r.assessment; if (!a || typeof a !== "object") return;
    var cov = a.coverage === "indexed_verified" ? "Indexed & verified record" : "Unindexed: bytecode heuristic only";
    out.appendChild(el("p", { "class": "pf-assess", "data-pf-assess": "" }, [el("b", { text: "Confidence " + String(a.confidence || "n/a") }),
      " · " + cov + (a.method ? " · " + String(a.method) : "")]));
    if (Array.isArray(a.limits) && a.limits.length) out.appendChild(el("p", { "class": "pf-assess", text: "Limits: " + a.limits.map(String).join(" ") }));
  }
  // the catalog classification in the site's one vocabulary (/methodology/#docs-vs-chain); a protocol whose records are mixed is
  // Delta as soon as one changed parameter is a parameter_delta (a protocol is Delta if any of its records is Delta)
  var DVC = { parameter_delta: ["Delta", "warning"], protective_delta: ["Protective", "info"], aligned_baseline: ["Aligned", "neutral"],
    rpc_observed: ["Observed", "outline"] };
  function docsVsChain(m) {
    var c = String(m.classification || ""), wd = m.whatDiffers || {};
    if (Object.prototype.hasOwnProperty.call(DVC, c)) return DVC[c];
    if (Array.isArray(wd.changed) && wd.changed.some(function (x) { return x && x.classification === "parameter_delta"; })) return DVC.parameter_delta;
    return null;
  }
  // v4.5 G-P2-6: a Changed line stays <= 140 characters (the full quote is on the record page) and a threshold line names its Safe
  // when the record's own text does ("Matched: Security Council Safe threshold 3-of-5")
  var WD_MAX = 140;
  function clip(s, max) {
    s = String(s); if (s.length <= max) return s;
    var c = s.slice(0, max - 1), i = c.lastIndexOf(" ");
    return (i > max / 2 ? c.slice(0, i) : c).replace(/[\s,;:(]+$/, "") + "…";
  }
  function safeLabel(value, texts) {
    var v = String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), name = "([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+){0,3})";
    var re = new RegExp(name + " (?:Safe |multisig )?" + v + "(?![0-9])|(?:^|[^0-9])" + v + " " + name);
    for (var i = 0; i < texts.length; i++) {
      var m = re.exec(String(texts[i] || "")), n = m ? String(m[1] || m[2] || "").replace(/ (Safe|Multisig|multisig)$/, "") : "";
      if (n && !/^(Safe|The|A|An|Multisig|Gnosis)$/.test(n)) return n;
    }
    return "";
  }
  function wdTexts(wd, rid) {
    var t = [];
    (wd.changed || []).forEach(function (c) { if (c && c.recordId === rid) t.push(c.parameter, c.observed, c.documented); });
    (wd.matched || []).forEach(function (c) { if (c && c.recordId === rid && c.parameter !== "Safe threshold") t.push(c.parameter); });
    return t;
  }
  function wdLine(kind, c, wd) {
    var lbl = c.parameter === "Safe threshold" ? safeLabel(kind === "Matched" ? c.value : c.documented, wdTexts(wd, c.recordId)) : "";
    var p = lbl ? lbl + " Safe threshold" : String(c.parameter);
    var line = kind === "Changed" ? "Changed: " + p + " " + String(c.observed) + " observed vs " + String(c.documented) + " documented"
      : "Matched: " + p + (lbl ? " " : ": ") + String(c.value);
    return kind === "Changed" && line.length > WD_MAX ? clip("Changed: " + p, WD_MAX) : clip(line, WD_MAX);
  }
  // R-V1 (v4.4): the indexed record answers "is this protocol's documentation accurate?", so it sits right under the metrics
  function pfMatch(out, m) {
    if (!m || typeof m !== "object" || !/^https:\/\/pacta\.wtf\/protocols\/[a-z0-9-]+\/$/.test(String(m.url || ""))) return;
    var dv = docsVsChain(m);
    var head = el("p", { "class": "pf-match-head" }, [el("b", { text: "Indexed by Pacta: " + String(m.name || m.slug) })]);
    if (dv) head.appendChild(el("span", { "data-slot": "badge", "data-variant": dv[1], "data-pf-dvc": "", text: "Docs vs chain: " + dv[0] }));
    var box = el("div", { "class": "pf-match", "data-pf-match": "" }, [head]);
    var wd = m.whatDiffers;
    if (wd && Array.isArray(wd.changed)) {
      wd.changed.forEach(function (c) { box.appendChild(el("p", { "data-pf-changed": "", text: wdLine("Changed", c, wd) })); });
      (wd.matched || []).forEach(function (c) { box.appendChild(el("p", { "data-pf-matched": "", text: wdLine("Matched", c, wd) })); });
    }
    box.appendChild(el("p", { "class": "pf-match-foot" }, [m.pinnedBlock ? "Record pinned at block " + num(m.pinnedBlock) + " · " : "",
      arrowLink({ href: siteUrl(m.url) }, "Full record")]));
    out.appendChild(box);
  }
  // live RPC unavailable for an indexed target: the Worker answers from the pinned catalog record (never a dead end)
  // live RPC unavailable for an indexed target: the Worker answers from the pinned catalog record (never a dead end)
  function pfFallback(out, b) {
    out.textContent = "";
    var card = el("div", { "data-slot": "card", "class": "pf-card", "data-pf-result": "" }, [
      el("div", { "class": "pf-verdict-row" }, [el("span", { "data-slot": "badge", "data-variant": "outline", text: "Pinned record" }),
        el("p", { "class": "pf-verdict-title pf-verdict", text: "Live RPC unavailable: showing the block-pinned record" })])]);
    pfAssess(card, b);
    card.appendChild(el("p", { text: String(b.summary || "") }));
    pfMatch(card, b.catalogMatch);
    out.appendChild(card);
  }
  // v4.4 (F3b): controller kinds in words, never a raw snake_case enum (the raw JSON stays one click away)
  var CTL_LABEL = { multisig_safe: "Safe multisig", timelock: "Timelock", eoa: "Single key (EOA)", contract: "Contract",
    access_control: "Role-based access control", none: "None" };
  function ctlLabel(kind) {
    var k = String(kind || "none");
    return Object.prototype.hasOwnProperty.call(CTL_LABEL, k) ? CTL_LABEL[k] : k.replace(/_/g, " ");
  }
  // U5 / R-V1 (v4.4): verdict, then score / confidence / coverage, then the indexed docs-vs-chain record (when the address is in the
  // catalog), one visible scope sentence, the summary and the facts; methodology and limits, cast commands and raw JSON are collapsed
  function pfRender(out, r) {
    out.textContent = "";
    var caps = r.capabilities || {}, k = r.controller || {}, v = String(r.verdict || ""), variant = VERDICT_VARIANT[v] || "warning";
    var capList = Object.keys(caps).filter(function (x) { return caps[x] === true; });
    var risk = typeof r.riskScore === "number" ? String(r.riskScore) + "/100" : "n/a";
    var a = r.assessment && typeof r.assessment === "object" ? r.assessment : {};
    var ctl = ctlLabel(k.kind);
    if (typeof k.safeThreshold === "number") ctl += " (" + k.safeThreshold + "-of-" + (typeof k.safeOwnerCount === "number" ? k.safeOwnerCount : "?") + ")";
    if (typeof k.timelockDelaySec === "number") ctl += " (" + secs(k.timelockDelaySec) + " delay)";
    if (typeof k.roleAdminCount === "number") ctl += " (" + k.roleAdminCount + " DEFAULT_ADMIN_ROLE members)";
    var addr = ADDR_RE.test(String(r.address || "")) ? String(r.address) : "";
    var card = el("div", { "data-slot": "card", "class": "pf-card", "data-pf-result": "" });
    card.appendChild(el("p", { "class": "pf-section", text: "Live contract check · " + (r.chain === "base" ? "Base" : "Ethereum") + " · block " + num(r.pinnedBlock) }));
    card.appendChild(el("div", { "class": "pf-verdict-row" }, [el("span", { "data-slot": "badge", "data-variant": variant, "data-pf-badge": "", text: variant === "warning" ? "Warning" : "Result" }),
      el("p", { "class": "pf-verdict-title pf-verdict", "data-pf-verdict": "", text: verdictText(v) })]));
    card.appendChild(el("dl", { "class": "pf-metrics" }, [
      el("div", {}, [el("dt", { text: "Heuristic score" }), el("dd", { "data-pf-risk": "", text: risk })]),
      el("div", {}, [el("dt", { text: "Confidence" }), el("dd", { text: String(a.confidence || "n/a") })]),
      el("div", {}, [el("dt", { text: "Covers" }), el("dd", { text: "This address only" })])]));
    pfMatch(card, r.catalogMatch);
    card.appendChild(el("p", { "class": "pf-scope", "data-pf-scope": "", text: "The verdict and heuristic score cover only this one contract address"
      + (addr ? " (" + short(addr, 6, 4) + ")" : "") + ", not the whole protocol." }));
    if (r.summary) card.appendChild(el("p", { "class": "s", text: String(r.summary) }));
    card.appendChild(el("dl", { "class": "pf-dl" }, [
      pfRow("Chain / block", (r.chain === "base" ? "Base" : "Ethereum") + " · block " + num(r.pinnedBlock)),
      pfRow("Contract", pfAddr(r.address)),
      pfRow("Proxy", r.isProxy ? "yes" : "no"),
      pfRow("Implementation", pfAddr(r.implementation)),
      pfRow("Controller", ADDR_RE.test(String(k.address || "")) ? el("span", {}, [ctl + " ", pfAddr(k.address)]) : ctl),
      pfRow("Zero-delay upgrade", r.canUpgradeZeroDelay === true ? "yes" : r.canUpgradeZeroDelay === false ? "no" : "unknown"),
      pfRow("Capabilities", capList.length ? capList.map(function (x) { return String(x).replace(/_/g, " "); }).join(", ") : "none seen"),
      pfRow("Paused", r.paused === true ? "yes" : r.paused === false ? "no" : "n/a"),
      pfRow("Pinned block hash", /^0x[0-9a-f]{64}$/.test(String(r.pinnedBlockHash || "")) ? el("span", {}, hexref(r.pinnedBlockHash, 10, 6)) : "n/a"),
      pfRow("Checked at (UTC)", typeof r.checkedAt === "string" ? r.checkedAt : (typeof r.blockTimestamp === "number" ? new Date(r.blockTimestamp * 1000).toISOString() : "n/a"))]));
    var acc = el("div", { "data-slot": "accordion" }), lim = el("div", { "data-slot": "accordion-content" });
    pfAssess(lim, r);
    lim.appendChild(el("p", { "class": "pf-assess", text: "A protocol's Docs-vs-chain status is on its scorecard: a protocol can be Delta while one of its "
      + "contracts has no admin, and an Aligned protocol can still have a contract a multisig can change." }));
    lim.appendChild(el("p", { "class": "pf-assess" }, [arrowLink({ href: siteUrl("https://pacta.wtf/methodology/#live-checker") },
      "How the heuristic score differs from Docs vs chain")]));
    acc.appendChild(el("details", { "class": "acc pf-limits", "data-slot": "accordion-item", "data-pf-limits": "" },
      [el("summary", { "data-slot": "accordion-trigger", text: "Methodology & single-address scope limits" }), lim]));
    if (r.isContract !== false && addr && /^\d+$/.test(String(r.pinnedBlock)))
      acc.appendChild(accItem("Reproduce with cast (pinned block)", [term(pfCasts(r).join("\n"), "Foundry cast", "Copy the cast commands for " + addr)]));
    acc.appendChild(rawDetails(r));
    card.appendChild(acc);
    if (/^\d+$/.test(String(r.pinnedBlock)))
      card.appendChild(liveVerifyBtn("Verify live on RPC", function () {
        var ch = r.chain === "base" ? "base" : "ethereum", want = String(r.pinnedBlockHash || "").toLowerCase();
        function fail(what) { return function (e) { return what + " failed (" + String(e && e.message || e) + ")"; }; }
        var pinned = rpcCall(ch, "eth_getBlockByNumber", ["0x" + Number(r.pinnedBlock).toString(16), false]).then(function (x) {
          var h = String(x.result && x.result.hash).toLowerCase();
          return "Pinned block #" + r.pinnedBlock + " hash " + h + (want ? (h === want ? " matches the pinned hash" : " differs from the pinned hash " + want) : "")
            + " · " + x.rpc + " · " + x.ms + " ms";
        }, fail("Pinned block check"));
        var live = !addr ? Promise.resolve("Live read skipped: no contract address") : liveBlock(ch).then(function (b) {
          return rpcCall(ch, "eth_getCode", [addr, b.hex]).then(function (c) {
            var bytes = Math.max(0, String(c.result).length - 2) / 2, ms = b.ms + c.ms;
            var head = "Live at block #" + b.n + " (" + b.hex + "): eth_getCode " + bytes + " bytes";
            if (!bytes) return [head + " (no contract code)", hosts(b, c) + " · " + ms + " ms"];
            var what = r.isProxy ? "EIP-1967 admin slot" : "owner()";
            var read = r.isProxy ? rpcCall(ch, "eth_getStorageAt", [addr, EIP1967_ADMIN_SLOT, b.hex])
              : rpcCall(ch, "eth_call", [{ to: addr, data: "0x8da5cb5b" }, b.hex]);
            return read.then(function (y) {
              return [head, what + ": " + String(y.result), "Decoded: " + decodeWord(y.result), hosts(b, y) + " · " + (ms + y.ms) + " ms"];
            }, function (e) { return [head, what + ": no answer (" + String(e && e.message || e) + ")", hosts(b, c) + " · " + ms + " ms"]; });
          });
        }, fail("Live block read"));
        return Promise.all([pinned, live]).then(function (x) { return [].concat(x[0], x[1]); });
      }));
    out.appendChild(card);
  }
  // U3/A3: noValidate form; 0x + 40 hex validated on blur and submit; the error is a visible message the input points to
  // (aria-invalid + aria-describedby); the button is disabled with a spinner while the check runs
  function initPreflight() {
    var box = $(".pf"), form = $("#pf-form"), out = $("#pf-out");
    if (!box || !form || !out) return;
    var api = box.getAttribute("data-api") || "", chainSel = $('select[name="chain"]', form), addr = $('input[name="address"]', form);
    if (!chainSel || !addr || !/^https:\/\//.test(api)) return;
    var err = $("#pf-addr-error"), btn = $("#pf-submit"), spin = btn ? $(".spinner", btn) : null, lbl = btn ? $("[data-pf-label]", btn) : null;
    var help = addr.getAttribute("aria-describedby") || "pf-help";
    var seq = 0, ctl = null, timer = null, PF_TIMEOUT_MS = 10000;
    function busy(on) {
      if (!btn) return;
      btn.disabled = on; btn.setAttribute("aria-busy", String(on));
      if (spin) spin.hidden = !on;
      if (lbl) lbl.textContent = on ? "Checking…" : "Check contract";
    }
    function invalid(text) {
      if (text) {
        if (err) { err.textContent = text; err.hidden = false; }
        addr.setAttribute("aria-invalid", "true"); addr.setAttribute("aria-describedby", "pf-addr-error");
      } else {
        if (err) { err.textContent = ""; err.hidden = true; }
        addr.removeAttribute("aria-invalid"); addr.setAttribute("aria-describedby", help);
      }
    }
    function problem(a) {
      if (!a) return "Enter a contract address.";
      if (!/^0x/i.test(a)) return "A contract address starts with 0x.";
      if (!ADDR_RE.test(a)) return "Enter 0x followed by 40 hexadecimal characters (" + Math.max(0, a.length - 2) + " entered).";
      return "";
    }
    function val() { return String(addr.value || "").trim(); }
    function msg(t, kind) {
      out.textContent = "";
      var p = el("p", { "class": "pf-msg", id: "pf-msg", role: "status" }, [el("span", { text: t })]);
      if (kind) p.setAttribute("data-pf-state", kind);
      if (kind === "loading") p.insertBefore(el("span", { "class": "spinner", "aria-hidden": "true" }), p.firstChild);
      out.appendChild(p);
      if (kind && kind !== "loading") {
        var retry = el("button", { type: "button", "data-slot": "button", "data-variant": "outline", "data-size": "sm", "data-pf-retry": "", text: "Retry" });
        retry.addEventListener("click", function () { run(); });
        p.appendChild(retry);
      }
    }
    addr.addEventListener("blur", function () { var a = val(); invalid(a ? problem(a) : ""); });
    addr.addEventListener("input", function () { if (addr.getAttribute("aria-invalid") === "true") { var a = val(); invalid(a ? problem(a) : ""); } });
    function run() {
      // Every submit (valid or not) supersedes the previous one: bump seq and abort any in-flight request BEFORE the
      // input checks, so a stale response can never overwrite a later validation message.
      var my = ++seq;
      if (ctl) { try { ctl.abort(); } catch (e) { /* already settled */ } ctl = null; }
      if (timer) { clearTimeout(timer); timer = null; }
      var a = val(), ch = chainSel.value === "base" ? "base" : "ethereum", p = problem(a);
      if (p) { invalid(p); busy(false); out.textContent = ""; addr.focus(); return; }
      invalid("");
      if (typeof fetch !== "function") { msg("This browser cannot call the API; use the cURL quickstart.", "http"); return; }
      // First-party beacon hook (docs/b.js); optional: the checker works the same without it.
      if (typeof window.pactaBeacon === "function") { try { window.pactaBeacon("live_checker_submit", ch + ":" + a.toLowerCase()); } catch (e) { /* ignore */ } }
      var opts = { headers: { Accept: "application/json" } }, timedOut = false;
      if (typeof AbortController === "function") {
        ctl = new AbortController(); opts.signal = ctl.signal;
        var mine = ctl;
        timer = setTimeout(function () { timedOut = true; try { mine.abort(); } catch (e) { /* settled */ } }, PF_TIMEOUT_MS);
      }
      busy(true);
      msg("Checking " + short(a, 6, 4) + " on " + ch + " at the latest block…", "loading");
      // optional free-tier attribution (non-personal): the browser demo names itself; no location, no personal data
      fetch(api + "/v1/check/preflight?chain=" + ch + "&address=" + a + "&caller_agent=pacta-wtf-checker&requester_role=individual_user&caller_purpose=general_research", opts)
        .then(function (res) { return res.json().then(function (b) { return { status: res.status, body: b }; }); })
        .then(function (x) {
          if (my !== seq) return;
          if (timer) { clearTimeout(timer); timer = null; }
          busy(false);
          var b = x.body || {}, r = b.verdict ? b : (b.result && b.result.verdict ? b.result : null);
          if (x.status === 200 && b.source === "pinned_catalog_fallback") pfFallback(out, b);
          else if (x.status === 200 && r) pfRender(out, r);
          else if (x.status === 429) msg("Rate limited: HTTP 429" + (b.error ? " (" + String(b.error) + ")" : "") + (b.detail ? ": " + String(b.detail) : "") + ". Wait a minute, then retry.", "ratelimit");
          else if (x.status === 400) { out.textContent = ""; invalid("The API rejected this address" + (b.detail ? ": " + String(b.detail) : ".")); }
          else msg("The API answered HTTP " + x.status + (b.error ? " (" + String(b.error) + ")" : "") + (b.detail ? ": " + String(b.detail) : "."), "http");
        })
        .catch(function () {
          if (my !== seq) return;
          if (timer) { clearTimeout(timer); timer = null; }
          busy(false);
          if (timedOut) msg("The check timed out after " + (PF_TIMEOUT_MS / 1000) + " s. The address is kept; retry, or use the cURL quickstart.", "timeout");
          else msg("Network error: could not reach the API. Retry, or use the cURL quickstart.", "network");
        });
    }
    form.addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    // "Try:" examples ([data-receipt][data-pf-address]) fill this form and submit it from initReceipts (N1)
  }

  // /protocols/: two independent, combinable filter groups (Status x Chain) intersected with the text search; "Clear all" resets
  // the three; 0 matches renders a one-click recovery prompt. Rows are only shown / hidden; every label is textContent.
  function initProtocolFilter() {
    var root = $("[data-pfilter-root]"), q = $("#proto-q"), count = $("#proto-count");
    if (!root || !q) return;
    var rows = $$("#proto-table tbody tr"), sBtns = $$("[data-pfilter-status]", root), cBtns = $$("[data-pfilter-chain]", root);
    var clear = $("#proto-clear"), active = $("#proto-active"), empty = $("#proto-empty"), st = "all", chn = "all", bkt = "all";
    var bBtns = $$("[data-pfilter-basket]", root);
    function label(btns, attr, v) {
      var b = btns.filter(function (x) { return x.getAttribute(attr) === v; })[0];
      var n = b && $(".num", b);
      return b ? String(b.textContent).slice(0, b.textContent.length - (n ? n.textContent.length : 0)).trim() : v;
    }
    function words() { return q.value.toLowerCase().split(" ").filter(Boolean); }
    function apply() {
      var w = words(), shown = 0;
      rows.forEach(function (tr) {
        var hay = tr.getAttribute("data-psearch") || "", ch = (tr.getAttribute("data-pchains") || "").split(" ");
        var bks = (tr.getAttribute("data-pbaskets") || "").split(" ");
        var ok = (st === "all" || tr.getAttribute("data-ptier") === st) && (chn === "all" || ch.indexOf(chn) >= 0) && (bkt === "all" || bks.indexOf(bkt) >= 0)
          && w.every(function (x) { return hay.indexOf(x) >= 0; });
        tr.hidden = !ok;
        if (ok) shown++;
      });
      sBtns.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-pfilter-status") === st)); });
      cBtns.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-pfilter-chain") === chn)); });
      bBtns.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-pfilter-basket") === bkt)); });
      if (count) count.textContent = shown + " of " + rows.length + " protocols shown";
      var parts = [];
      if (st !== "all") parts.push("Docs vs chain: " + label(sBtns, "data-pfilter-status", st));
      if (chn !== "all") parts.push("Chain: " + label(cBtns, "data-pfilter-chain", chn));
      if (bkt !== "all") parts.push("Basket: " + label(bBtns, "data-pfilter-basket", bkt));
      if (q.value.trim()) parts.push("Search: “" + q.value.trim() + "”");
      if (active) active.textContent = parts.length ? "Active filters · " + parts.join(" · ") : "";
      if (clear) clear.hidden = !parts.length;
      if (empty) {
        empty.textContent = "";
        empty.hidden = shown !== 0;
        if (!shown) {
          var who = (chn !== "all" ? label(cBtns, "data-pfilter-chain", chn) + " " : "") + (st !== "all" ? label(sBtns, "data-pfilter-status", st) + " " : "") + "protocols";
          empty.appendChild(el("span", { text: "No " + who + (q.value.trim() ? " match “" + q.value.trim() + "”" : " match these filters") + " —" }));
          if (chn !== "all") empty.appendChild(el("button", { type: "button", "class": "linkish", "data-precover": "chain", text: "Switch to All chains" }));
          if (st !== "all") empty.appendChild(el("button", { type: "button", "class": "linkish", "data-precover": "status", text: "All statuses" }));
          if (q.value.trim()) empty.appendChild(el("button", { type: "button", "class": "linkish", "data-precover": "search", text: "Clear search" }));
        }
      }
    }
    function reset(what) {
      if (what === "chain" || what === "all") chn = "all";
      if (what === "status" || what === "all") st = "all";
      if (what === "search" || what === "all") q.value = "";
      if (what === "basket" || what === "all") bkt = "all";
      apply();
    }
    sBtns.forEach(function (b) { b.addEventListener("click", function () { st = b.getAttribute("data-pfilter-status") || "all"; apply(); }); });
    cBtns.forEach(function (b) { b.addEventListener("click", function () { chn = b.getAttribute("data-pfilter-chain") || "all"; apply(); }); });
    bBtns.forEach(function (b) { b.addEventListener("click", function () { bkt = b.getAttribute("data-pfilter-basket") || "all"; apply(); }); });
    if (clear) clear.addEventListener("click", function () { reset("all"); });
    if (empty) empty.addEventListener("click", function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest("[data-precover]") : null;
      if (t) reset(t.getAttribute("data-precover"));
    });
    q.addEventListener("input", apply);
    apply();
  }

  // pinned-snapshot ages: fills the empty [data-age="<unix ts>"] next to every observed UTC timestamp with "(Xh Ym ago)"
  function initAges() {
    var now = Math.floor(Date.now() / 1000);
    $$("[data-age]").forEach(function (n) {
      var t = parseInt(n.getAttribute("data-age"), 10);
      n.textContent = t && t <= now + 300 ? " (" + fmt(Math.max(0, now - t)) + " ago)" : "";
    });
    freshness();
  }
  // Freshness honesty: "Last live re-check" shows when the free live re-check last succeeded; when it has failed, or is older
  // than 15 minutes, the visible fallback says the page is showing the pinned historical snapshot.
  var LIVE_OK_AT = 0, LIVE_FAILED = false, STALE_S = 15 * 60;
  function freshness() {
    var now = Math.floor(Date.now() / 1000), stale = LIVE_FAILED || !LIVE_OK_AT || now - LIVE_OK_AT > STALE_S;
    $$("[data-last-recheck]").forEach(function (n) {
      n.textContent = LIVE_OK_AT ? "Last live re-check: " + fmt(Math.max(0, now - LIVE_OK_AT)) + " ago" : (LIVE_FAILED ? "Last live re-check: failed" : "Last live re-check: not yet");
    });
    $$("[data-snapshot-fallback]").forEach(function (n) { n.hidden = !stale; });
  }

  var THEME_KEY = "pacta-theme";
  function themePref() {
    var t = null; try { t = localStorage.getItem(THEME_KEY); } catch (e) { /* private mode */ }
    if (t === "slate") t = "dark";
    if (t === "paper") t = "light";
    return t === "light" || t === "dark" ? t : "system";
  }

  function systemDark() { try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { return false; } }

  // ---- R4: hamburger Sheet below 768 px (dialog: focus moves in, Tab is trapped, Escape / overlay / link closes) -------------
  function initSheet() {
    var sheet = $("#nav-sheet"), openBtn = $("[data-sheet-open]"); if (!sheet || !openBtn) return;
    var last = null;
    function focusables() { return $$("a[href],button:not([disabled])", sheet); }
    function open() {
      last = document.activeElement; sheet.hidden = false; document.body.classList.add("sheet-open");
      openBtn.setAttribute("aria-expanded", "true");
      var f = $('[data-slot="button"][data-sheet-close]', sheet) || focusables()[0]; if (f) f.focus();
    }
    function close() {
      if (sheet.hidden) return;
      sheet.hidden = true; document.body.classList.remove("sheet-open"); openBtn.setAttribute("aria-expanded", "false");
      if (last && last.focus) last.focus();
    }
    openBtn.addEventListener("click", open);
    sheet.addEventListener("click", function (ev) {
      var t = ev.target && ev.target.closest ? ev.target : null; if (!t) return;
      if (t.closest("[data-sheet-close]") || t.closest("a[href]")) close();
    });
    sheet.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { ev.preventDefault(); close(); return; }
      if (ev.key !== "Tab") return;
      var f = focusables(); if (!f.length) return;
      if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f[f.length - 1].focus(); }
      else if (!ev.shiftKey && document.activeElement === f[f.length - 1]) { ev.preventDefault(); f[0].focus(); }
    });
    window.addEventListener("resize", function () { if (window.innerWidth >= 768) close(); });
  }

  // ---- Tabs (MCP / cURL / Python): roving tabindex, arrow keys, Home / End; panels hidden only once JavaScript runs ---------
  function initTabs() {
    $$("[data-tabs]").forEach(function (root) {
      var tabs = $$('[role="tab"]', root);
      function select(t, focus) {
        tabs.forEach(function (x) {
          var on = x === t, p = document.getElementById(x.getAttribute("aria-controls") || "");
          x.setAttribute("aria-selected", String(on)); x.setAttribute("tabindex", on ? "0" : "-1");
          if (p) { if (on) p.removeAttribute("data-inactive"); else p.setAttribute("data-inactive", ""); }
        });
        if (focus) t.focus();
      }
      tabs.forEach(function (t, i) {
        t.addEventListener("click", function () { select(t, false); });
        t.addEventListener("keydown", function (ev) {
          var j = ev.key === "ArrowRight" ? i + 1 : ev.key === "ArrowLeft" ? i - 1 : ev.key === "Home" ? 0 : ev.key === "End" ? tabs.length - 1 : null;
          if (j === null) return;
          ev.preventDefault(); select(tabs[(j + tabs.length) % tabs.length], true);
        });
      });
    });
  }

  // ---- Tooltip: any [data-tip] (rosette slices) shows its label on hover and on keyboard focus (A1) ---------------------------
  function initTooltips() {
    var tip = null;
    function show(t) {
      var label = t.getAttribute("data-tip"); if (!label) return;
      if (!tip) { tip = el("div", { "class": "tip", role: "tooltip", id: "pacta-tip" }); document.body.appendChild(tip); }
      tip.textContent = label; tip.hidden = false;
      var r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      var left = Math.max(8, Math.min(document.documentElement.clientWidth - w - 8, r.left + r.width / 2 - w / 2));
      var top = r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8;
      tip.style.left = Math.round(left + window.scrollX) + "px"; tip.style.top = Math.round(top + window.scrollY) + "px";
      t.setAttribute("aria-describedby", "pacta-tip");
    }
    function hide(t) { if (tip) tip.hidden = true; if (t && t.removeAttribute) t.removeAttribute("aria-describedby"); }
    function tgt(ev) { return ev.target && ev.target.closest ? ev.target.closest("[data-tip]") : null; }
    document.addEventListener("mouseover", function (ev) { var t = tgt(ev); if (t) show(t); });
    document.addEventListener("mouseout", function (ev) { var t = tgt(ev); if (t) hide(t); });
    document.addEventListener("focusin", function (ev) { var t = tgt(ev); if (t) show(t); });
    document.addEventListener("focusout", function (ev) { var t = tgt(ev); if (t) hide(t); });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") hide(null); });
  }

  // ---- A4: "Copied" is announced through the aria-live toaster (Sonner-style toast) ------------------------------------------
  function toast(text) {
    var host = $("#toaster"); if (!host) return;
    host.textContent = "";
    host.appendChild(el("div", { "data-slot": "toast" }, [text]));
    clearTimeout(host._t);
    host._t = setTimeout(function () { host.textContent = ""; }, 2400);
  }

  function svgIcon(d) {
    if (typeof document.createElementNS !== "function") return el("span", {});
    var s = document.createElementNS(SVG_NS, "svg");
    [["class", "i"], ["viewBox", "0 0 24 24"], ["aria-hidden", "true"], ["focusable", "false"]].forEach(function (a) { s.setAttribute(a[0], a[1]); });
    var p = document.createElementNS(SVG_NS, "path"); p.setAttribute("d", d); s.appendChild(p);
    return s;
  }

  function scEvidence(card) {
    var ev = card.evidence || {}, eas = card.easAttested !== false;
    return el("div", { "class": "sc-ev" }, [
      el("p", { "class": "sc-full" }, [el("b", { text: "Docs say: " }), String(ev.documented || "")]),
      el("p", { "class": "sc-full" }, [el("b", { text: eas ? "Chain says: " : "Chain (pinned; docs not compared): " }), String(ev.observed || card.finding || "")])]);
  }

  // T1: the radar's state badges stay skeletons until the live re-check settles (success, failure or timeout), then appear once
  function liveSettled(ok, blk) {
    $$("[data-live-pending]").forEach(function (n) { n.removeAttribute("data-live-pending"); });
    if (ok && blk) {   // v4.4 (F5): the footer pill and the "Next:" line follow the live read
      $$("[data-prov-pill]").forEach(function (n) { n.textContent = "Live-checked · #" + blk.toLocaleString("en-US"); n.setAttribute("data-live", "1"); });
      $$(".livebar .lb-asof").forEach(function (n) { n.hidden = true; });
    }
    $$("[data-live-status]").forEach(function (n) {
      var t = $("[data-live-status-text]", n), sp = $(".spinner", n); if (sp) sp.hidden = true;
      // N5 (v4.3): the radar header cites one block (the finalized read); the live block number goes on the provenance line
      if (t) t.textContent = ok ? "Live state confirmed" + (blk ? " at the latest block" : "") : "Live check unavailable: showing the pinned snapshot";
    });
  }

  function accItem(title, kids) {
    return el("details", { "class": "acc", "data-slot": "accordion-item" }, [el("summary", { "data-slot": "accordion-trigger", text: title }),
      el("div", { "data-slot": "accordion-content" }, kids)]);
  }

  // U6: the exact POST /v1/requests wire schema (the Worker rejects unknown keys): closed enums, bounded plain text, no PII outside
  // contact_handle. urgency_track follows the chosen track.
  var REQ_ENUMS = {
    requester_role: ["protocol_team", "risk_curator_analyst", "institutional_allocator", "defi_developer", "security_researcher", "individual_user", "autonomous_agent"],
    caller_purpose: ["collateral_due_diligence", "governance_monitoring", "security_audit", "pre_trade_safety", "yield_allocation", "integration_testing", "general_research"],
    request_type: ["doc_or_data_discrepancy", "missing_protocol", "missing_check_surface", "unsupported_chain", "mcp_or_api_feature"]
  };
  var URGENCY = { community: "community_queue_free", "rapid-500": "active_due_diligence", clearance: "issuer_24h_clearance_5k",
    continuous: "active_due_diligence", api_sla: "api_high_volume_sla" };
  var REQ_API_RE = /^https:\/\/pacta-x402\.pacta\.workers\.dev\/v1\/requests$/;
  var EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/, TG_RE = /^@[A-Za-z0-9_]{3,32}$/, GH_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
  var PII_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(^|[\s(])@[A-Za-z0-9_]{2,}|\b\d{1,3}(?:\.\d{1,3}){3}\b|<[^>]*>/;
  var JUNK_CONTACT = /^(none|n\/?a|na|-+|null|user@example\.com|test@test\.com|email@example\.com)$/i;

  function cleanSubject(v) { return String(v || "").replace(/[:@<>]/g, " ").replace(BAD_CHARS, "").replace(/\s+/g, " ").trim(); }

  function cutWords(s, max) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    if (s.length <= max) return s;
    var c = s.slice(0, max - 1), i = c.lastIndexOf(" ");
    return (i > 20 ? c.slice(0, i) : c).replace(/[\s,;:.(-]+$/, "") + "…";
  }

  // Command + Popover combobox (multi-select) for the protocols in scope: type to filter, arrows / Enter to toggle, chips to remove
  function initCombo(form, onChange) {
    var root = $("[data-combo]", form), none = { values: function () { return []; }, select: function () { return false; }, input: null };
    if (!root) return none;
    var input = $("#req-proto-q", root), list = $("#req-proto-list", root), chips = $("[data-combo-chips]", root);
    if (!input || !list || !chips) return none;
    var emptyLi = $('[data-slot="command-empty"]', list), items = $$('[role="option"]', list), active = -1, selected = [];
    function visible() { return $$('[role="option"]', list).filter(function (i) { return !i.hidden; }); }   // in ranked (DOM) order
    function setActive(i) {
      var v = visible(); items.forEach(function (x) { x.removeAttribute("data-active"); }); active = i;
      if (i >= 0 && v[i]) {
        v[i].setAttribute("data-active", "true"); input.setAttribute("aria-activedescendant", v[i].id);
        try { v[i].scrollIntoView({ block: "nearest" }); } catch (e) { /* old browsers */ }
      } else input.removeAttribute("aria-activedescendant");
    }
    function render() {
      chips.textContent = "";
      selected.forEach(function (it) {
        var name = it.getAttribute("data-name") || "";
        var x = el("button", { type: "button", "aria-label": "Remove " + name }, [svgIcon("M18 6 6 18M6 6l12 12")]);
        x.addEventListener("click", function () { toggle(it); input.focus(); });
        chips.appendChild(el("span", { "class": "chip-x" }, [el("span", { text: name }), x]));
      });
      items.forEach(function (it) { it.setAttribute("aria-selected", String(selected.indexOf(it) >= 0)); });
      onChange();
    }
    function toggle(it) { var i = selected.indexOf(it); if (i >= 0) selected.splice(i, 1); else selected.push(it); render(); }
    function open() { list.hidden = false; input.setAttribute("aria-expanded", "true"); }
    function close() { list.hidden = true; input.setAttribute("aria-expanded", "false"); setActive(-1); }
    // v4.5 G-P2-3: rank 0 = name or slug starts with the query, 1 = a word of the name does, 2 = substring, 3 = a contract address
    function rank(it, t) {
      var nm = String(it.getAttribute("data-name") || "").toLowerCase(), sl = String(it.getAttribute("data-slug") || "");
      if (nm.indexOf(t) === 0 || sl.indexOf(t) === 0) return 0;
      if ((" " + nm.replace(/[^a-z0-9]+/g, " ")).indexOf(" " + t) >= 0) return 1;
      if (nm.indexOf(t) >= 0 || sl.indexOf(t) >= 0) return 2;
      if (/^0x[0-9a-f]{4,40}$/.test(t) && (" " + String(it.getAttribute("data-q") || "")).indexOf(" " + t) >= 0) return 3;
      return -1;
    }
    function filter() {
      var t = String(input.value || "").trim().toLowerCase(), n = 0, order = [];
      items.forEach(function (it, i) {
        var r = t ? rank(it, t) : 0;
        it.hidden = r < 0; if (r >= 0) { n++; order.push([r, i, it]); }
      });
      order.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
      order.forEach(function (x) { x[2].remove(); list.appendChild(x[2]); });
      if (emptyLi) emptyLi.hidden = n !== 0;
      setActive(n ? 0 : -1);
    }
    input.addEventListener("focus", function () { filter(); open(); });
    input.addEventListener("input", function () { filter(); open(); });
    input.addEventListener("keydown", function (ev) {
      var v = visible();
      if (ev.key === "ArrowDown") { ev.preventDefault(); open(); setActive(Math.min(v.length - 1, active + 1)); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive(Math.max(0, active - 1)); }
      else if (ev.key === "Enter") { ev.preventDefault(); if (!list.hidden && v[active]) toggle(v[active]); }
      else if (ev.key === "Escape") { if (!list.hidden) { ev.preventDefault(); close(); } }
      else if (ev.key === "Backspace" && !input.value && selected.length) toggle(selected[selected.length - 1]);
    });
    list.addEventListener("mousedown", function (ev) { ev.preventDefault(); });   // keep focus in the input
    list.addEventListener("click", function (ev) {
      var it = ev.target && ev.target.closest ? ev.target.closest('[role="option"]') : null; if (!it) return;
      toggle(it); input.value = ""; filter(); close();   // G-P2-3: a mouse pick closes the list (aria-expanded="false") and clears the query
    });
    document.addEventListener("click", function (ev) { if (!root.contains(ev.target)) close(); });
    return {
      input: input,
      values: function () { return selected.map(function (it) { return { name: it.getAttribute("data-name") || "", slug: it.getAttribute("data-slug") || "" }; }); },
      select: function (v) {
        var low = String(v).toLowerCase();
        var it = items.filter(function (x) { return x.getAttribute("data-slug") === v || String(x.getAttribute("data-name") || "").toLowerCase() === low; })[0];
        if (it && selected.indexOf(it) < 0) { selected.push(it); render(); }
        return !!it;
      }
    };
  }

  document.addEventListener("DOMContentLoaded", function () {
    // v4.3: every feature starts on its own, so one that throws can never leave a later one (the "Try:" examples, the
    // checker, the radar) unbound; the error is re-thrown asynchronously, so it still reaches the console
    [initTheme, initSheet, initTabs, initTooltips, initCopy, initBeaconHooks, tick, initIndex, initRequest, initInspector, initPreflight,
     initLiveTimelocks, initProtocolFilter, initAges, initRefresh, initHeroCheck, initBadgeWidget, initScorecards, initReceipts].forEach(function (f) {
      try { f(); } catch (e) { setTimeout(function () { throw e; }, 0); }
    });
    setInterval(tick, 30000);
    setInterval(initAges, 60000);
    if ($("#insp-list")) loadData().catch(function () { /* static sheet and drawer links keep working */ });
  });
})();
