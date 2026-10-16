// Хорватська A1 → B1 — прогрес, навігація, дашборд (без залежностей, офлайн)
(function () {
  "use strict";

  var PREFIX = "hr-b1:";
  var WEEKS = 36;

  function storageGet(key) {
    try { return window.localStorage.getItem(PREFIX + key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(PREFIX + key, value); } catch (e) { /* storage unavailable */ }
  }
  function storageRemove(key) {
    try { window.localStorage.removeItem(PREFIX + key); } catch (e) { /* storage unavailable */ }
  }
  function storageKeys() {
    var keys = [];
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) keys.push(k);
      }
    } catch (e) { /* storage unavailable */ }
    return keys;
  }

  function phaseOfWeek(n) {
    if (n <= 12) return 1;
    if (n <= 24) return 2;
    return 3;
  }

  function percent(done, total) {
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }

  function progressBarHtml(pct) {
    return '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct +
      '"><div class="progress-bar" style="width:' + pct + '%"></div></div>';
  }

  // ---------- Active nav link ----------
  function markActiveNav() {
    var file = window.location.pathname.split("/").pop() || "index.html";
    var links = document.querySelectorAll(".topnav a");
    for (var i = 0; i < links.length; i++) {
      var href = (links[i].getAttribute("href") || "").split("#")[0];
      if (href === file) links[i].classList.add("active");
    }
  }

  // ---------- Checkbox persistence ----------
  function initCheckboxes() {
    var inputs = document.querySelectorAll("input[data-key]");
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      var key = input.getAttribute("data-key");
      input.checked = storageGet(key) === "1";
      syncTaskClass(input);
      input.addEventListener("change", onCheckboxChange);
    }
  }

  function onCheckboxChange(event) {
    var input = event.target;
    var key = input.getAttribute("data-key");
    if (input.checked) storageSet(key, "1");
    else storageRemove(key);
    syncTaskClass(input);
    var week = input.closest(".week");
    if (week) renderWeekProgress(week);
  }

  function syncTaskClass(input) {
    var label = input.closest(".task");
    if (label) label.classList.toggle("done", input.checked);
  }

  // ---------- Per-week totals & progress ----------
  function initWeeks() {
    var weeks = document.querySelectorAll("section.week[data-week]");
    for (var i = 0; i < weeks.length; i++) {
      var n = weeks[i].getAttribute("data-week");
      var total = weeks[i].querySelectorAll('input[type="checkbox"][data-key^="w' + n + '-t"]').length;
      storageSet("total:" + n, String(total));
      renderWeekProgress(weeks[i]);
    }
  }

  function renderWeekProgress(week) {
    var target = week.querySelector(".week-progress");
    if (!target) return;
    var n = week.getAttribute("data-week");
    var boxes = week.querySelectorAll('input[type="checkbox"][data-key^="w' + n + '-t"]');
    var done = 0;
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) done++;
    var pct = percent(done, boxes.length);
    target.innerHTML = progressBarHtml(pct) + '<span class="progress-count">' + done + " / " + boxes.length + "</span>";
  }

  // ---------- Dashboard (index.html) ----------
  function weekStats() {
    var doneByWeek = {};
    var keys = storageKeys();
    var re = /^hr-b1:w(\d+)-t\d+$/;
    for (var i = 0; i < keys.length; i++) {
      var m = re.exec(keys[i]);
      if (m && storageGet(keys[i].slice(PREFIX.length)) === "1") {
        doneByWeek[m[1]] = (doneByWeek[m[1]] || 0) + 1;
      }
    }
    var stats = [];
    for (var n = 1; n <= WEEKS; n++) {
      var rawTotal = storageGet("total:" + n);
      var total = rawTotal === null ? null : parseInt(rawTotal, 10) || 0;
      var done = doneByWeek[n] || 0;
      if (total !== null && done > total) done = total;
      stats.push({ week: n, phase: phaseOfWeek(n), total: total, done: done });
    }
    return stats;
  }

  function weekStatus(s) {
    if (s.total === null || s.total === 0) return "locked";
    if (s.done >= s.total) return "done";
    if (s.done > 0) return "partial";
    return "todo";
  }

  var STATUS_LABEL = {
    done: "виконано",
    partial: "у процесі",
    todo: "не розпочато",
    locked: "не відкрито"
  };

  function renderDashboard() {
    var grid = document.getElementById("week-grid");
    var overall = document.getElementById("overall-progress");
    if (!grid && !overall) return;

    var stats = weekStats();
    var sum = { done: 0, total: 0, opened: 0, finished: 0 };
    var phases = { 1: { done: 0, total: 0 }, 2: { done: 0, total: 0 }, 3: { done: 0, total: 0 } };

    for (var i = 0; i < stats.length; i++) {
      var s = stats[i];
      if (s.total === null) continue;
      sum.done += s.done;
      sum.total += s.total;
      sum.opened++;
      if (weekStatus(s) === "done") sum.finished++;
      phases[s.phase].done += s.done;
      phases[s.phase].total += s.total;
    }

    if (overall) {
      var pct = percent(sum.done, sum.total);
      overall.innerHTML = progressBarHtml(pct);
      var label = document.getElementById("overall-label");
      if (label) {
        label.textContent = pct + "% · " + sum.done + " з " + sum.total + " завдань у відкритих тижнях · " +
          "тижнів завершено: " + sum.finished + " з " + WEEKS;
      }
    }

    for (var p = 1; p <= 3; p++) {
      var el = document.getElementById("phase-progress-" + p);
      if (!el) continue;
      var ppct = percent(phases[p].done, phases[p].total);
      el.innerHTML = progressBarHtml(ppct);
      var pl = document.getElementById("phase-label-" + p);
      if (pl) {
        pl.textContent = phases[p].total > 0
          ? ppct + "% (" + phases[p].done + " / " + phases[p].total + ")"
          : "ще не відкрито";
      }
    }

    if (grid) {
      var html = "";
      for (var j = 0; j < stats.length; j++) {
        var w = stats[j];
        var status = weekStatus(w);
        var detail = w.total === null ? STATUS_LABEL[status] : STATUS_LABEL[status] + ", " + w.done + " / " + w.total;
        html += '<a class="week-cell cell-' + status + ' cell-phase-' + w.phase + '" href="phase-' + w.phase +
          ".html#week-" + w.week + '" title="Тиждень ' + w.week + ": " + detail + '" aria-label="Тиждень ' +
          w.week + ": " + detail + '"><span>' + w.week + "</span></a>";
      }
      grid.innerHTML = html;
    }
  }

  // ---------- Reset ----------
  function initReset() {
    var btn = document.getElementById("reset-progress");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (!window.confirm("Скинути весь збережений прогрес? Цю дію не можна скасувати.")) return;
      var keys = storageKeys();
      for (var i = 0; i < keys.length; i++) {
        try { window.localStorage.removeItem(keys[i]); } catch (e) { /* storage unavailable */ }
      }
      var inputs = document.querySelectorAll("input[data-key]");
      for (var k = 0; k < inputs.length; k++) {
        inputs[k].checked = false;
        syncTaskClass(inputs[k]);
      }
      initWeeks();
      renderDashboard();
    });
  }

  // ---------- Backup (index.html): all "hr-" localStorage keys in one JSON ----------
  function allSiteKeys() {
    var keys = [];
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf("hr-") === 0) keys.push(k);
      }
    } catch (e) { /* storage unavailable */ }
    return keys.sort();
  }

  function rawGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function parseJson(raw, fallback) {
    try {
      var v = raw ? JSON.parse(raw) : fallback;
      return v && typeof v === "object" ? v : fallback;
    } catch (e) { return fallback; }
  }

  var SECRET_FIELD = /key|token|secret|password/i;

  // Drops API keys and similar secrets from AI settings before they leave the browser.
  function stripSecrets(raw) {
    var settings = parseJson(raw, null);
    if (!settings || Array.isArray(settings)) return raw;
    for (var f in settings) {
      if (settings.hasOwnProperty(f) && SECRET_FIELD.test(f)) delete settings[f];
    }
    return JSON.stringify(settings);
  }

  function exportBackup() {
    var data = {};
    var keys = allSiteKeys();
    var count = 0;
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === "hr-chat-ctx") continue;
      data[keys[i]] = keys[i] === "hr-ai-settings" ? stripSecrets(rawGet(keys[i])) : rawGet(keys[i]);
      count++;
    }
    var payload = { app: "croatian-b1", version: 1, exported: new Date().toISOString(), data: data };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "croatian-b1-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    return count;
  }

  // Incoming settings never carry a key, so the local one is kept.
  function mergeSettings(localRaw, incomingRaw) {
    var local = parseJson(localRaw, {});
    var incoming = parseJson(stripSecrets(incomingRaw), {});
    if (Array.isArray(local)) local = {};
    for (var f in incoming) if (incoming.hasOwnProperty(f)) local[f] = incoming[f];
    return JSON.stringify(local);
  }

  function mergeVocab(localRaw, incomingRaw) {
    var local = parseJson(localRaw, []);
    var incoming = parseJson(incomingRaw, []);
    if (!Array.isArray(local)) local = [];
    if (!Array.isArray(incoming)) return JSON.stringify(local);
    var known = {};
    for (var i = 0; i < local.length; i++) if (local[i] && local[i].id) known[local[i].id] = true;
    for (var j = 0; j < incoming.length; j++) {
      var w = incoming[j];
      if (w && w.id && w.word && !known[w.id]) {
        local.push(w);
        known[w.id] = true;
      }
    }
    local.sort(function (a, b) { return (b.added || 0) - (a.added || 0); });
    return JSON.stringify(local);
  }

  function mergeCards(localRaw, incomingRaw) {
    var local = parseJson(localRaw, {});
    var incoming = parseJson(incomingRaw, {});
    for (var id in incoming) {
      if (!incoming.hasOwnProperty(id) || !incoming[id]) continue;
      if (!local[id] || (incoming[id].due || 0) > (local[id].due || 0)) local[id] = incoming[id];
    }
    return JSON.stringify(local);
  }

  // Merge: never deletes local keys. Differing task texts (hr-ws:*) are replaced only after one confirm.
  function importBackup(text) {
    var parsed = JSON.parse(text);
    var data;
    if (Array.isArray(parsed)) data = { "hr-vocab": JSON.stringify(parsed) };
    else if (parsed && parsed.data && typeof parsed.data === "object") data = parsed.data;
    else throw new Error("unknown format");

    var conflicts = [];
    var count = 0;
    for (var key in data) {
      if (!data.hasOwnProperty(key) || key.indexOf("hr-") !== 0 || typeof data[key] !== "string") continue;
      var local = rawGet(key);
      var value = data[key];
      if (key === "hr-vocab") value = mergeVocab(local, value);
      else if (key === "hr-cards") value = mergeCards(local, value);
      else if (key === "hr-ai-settings") value = mergeSettings(local, value);
      else if (key === "hr-chat-ctx") continue;
      else if ((key.indexOf("hr-ws:") === 0 || key === "hr-chat") && local && local.trim() && local !== value) {
        conflicts.push(key);
        continue;
      }
      try { window.localStorage.setItem(key, value); count++; } catch (e) { /* storage unavailable */ }
    }
    if (conflicts.length && window.confirm("Записів, що відрізняються від збережених у цьому браузері (тексти завдань, історія AI-чату): " + conflicts.length +
      ". Замінити їх версіями з файлу?\n(Скасувати — залишити поточні.)")) {
      for (var c = 0; c < conflicts.length; c++) {
        try { window.localStorage.setItem(conflicts[c], data[conflicts[c]]); count++; } catch (e) { /* storage unavailable */ }
      }
    }
    return count;
  }

  function initBackup() {
    var exportBtn = document.getElementById("backup-export");
    var importBtn = document.getElementById("backup-import-btn");
    var input = document.getElementById("backup-import");
    var status = document.getElementById("backup-status");
    if (!exportBtn || !importBtn || !input) return;
    exportBtn.addEventListener("click", function () {
      var n = exportBackup();
      if (status) status.textContent = "Експортовано записів: " + n;
    });
    importBtn.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () {
      var file = input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var n = importBackup(reader.result);
          window.alert("Імпортовано записів: " + n);
          window.location.reload();
        } catch (e) {
          window.alert("Не вдалося прочитати файл резервної копії.");
        }
        input.value = "";
      };
      reader.readAsText(file);
    });
  }

  function init() {
    markActiveNav();
    initCheckboxes();
    initWeeks();
    renderDashboard();
    initReset();
    initBackup();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
