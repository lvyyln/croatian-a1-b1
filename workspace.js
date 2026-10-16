// Хорватська A1 → B1 — робочий простір завдань: письмо, запис голосу, аудіювання (TTS), читання, картки, нотатки.
// Без залежностей, працює з file:// у Chrome/Edge. Текст: localStorage "hr-ws:<data-key>", аудіо: IndexedDB "hr-b1-audio".
(function () {
  "use strict";

  var WS_PREFIX = "hr-ws:";
  var VOCAB_KEY = "hr-vocab";
  var RATE_KEY = "hr-tts-rate";
  var DB_NAME = "hr-b1-audio";
  var DB_STORE = "takes";
  var SAVE_DELAY = 600;

  var TOOL_TITLE = {
    write: "Письмо",
    speak: "Запис голосу",
    listen: "Аудіювання",
    read: "Читання",
    cards: "Картки",
    notes: "Нотатки",
    drill: "Вправа"
  };

  // ---------- Storage ----------
  function lsGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function lsRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* storage unavailable */ }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(text, className) {
    var b = el("button", className, text);
    b.type = "button";
    return b;
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ---------- IndexedDB (audio takes) ----------
  var dbHandle = null;
  var dbFailed = false;
  var dbWaiting = [];

  function openDb(cb) {
    if (dbHandle) { cb(dbHandle); return; }
    if (dbFailed || !window.indexedDB) { cb(null); return; }
    dbWaiting.push(cb);
    if (dbWaiting.length > 1) return;
    var req;
    try {
      req = window.indexedDB.open(DB_NAME, 1);
    } catch (e) {
      finishOpen(null);
      return;
    }
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        var store = db.createObjectStore(DB_STORE, { keyPath: "id" });
        store.createIndex("key", "key", { unique: false });
      }
    };
    req.onsuccess = function () { finishOpen(req.result); };
    req.onerror = function () { finishOpen(null); };
    req.onblocked = function () { finishOpen(null); };
  }

  function finishOpen(db) {
    dbHandle = db;
    if (!db) dbFailed = true;
    var waiting = dbWaiting;
    dbWaiting = [];
    for (var i = 0; i < waiting.length; i++) waiting[i](db);
  }

  function listTakes(key, cb) {
    openDb(function (db) {
      if (!db) { cb([]); return; }
      try {
        var req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).index("key").getAll(key);
        req.onsuccess = function () {
          var takes = req.result || [];
          takes.sort(function (a, b) { return a.created - b.created; });
          cb(takes);
        };
        req.onerror = function () { cb([]); };
      } catch (e) { cb([]); }
    });
  }

  function addTake(take, cb) {
    openDb(function (db) {
      if (!db) { cb(false); return; }
      try {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put(take);
        tx.oncomplete = function () { cb(true); };
        tx.onerror = function () { cb(false); };
      } catch (e) { cb(false); }
    });
  }

  function deleteTake(id, cb) {
    openDb(function (db) {
      if (!db) { cb(false); return; }
      try {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(id);
        tx.oncomplete = function () { cb(true); };
        tx.onerror = function () { cb(false); };
      } catch (e) { cb(false); }
    });
  }

  function keysWithTakes(cb) {
    openDb(function (db) {
      var found = {};
      if (!db) { cb(found); return; }
      try {
        var req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).index("key").openKeyCursor();
        req.onsuccess = function () {
          var cursor = req.result;
          if (!cursor) { cb(found); return; }
          found[cursor.key] = true;
          cursor.continue();
        };
        req.onerror = function () { cb(found); };
      } catch (e) { cb(found); }
    });
  }

  // ---------- Text-to-speech ----------
  var tts = {
    supported: "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function",
    voice: null,
    checked: false,
    listeners: []
  };

  function pickVoice() {
    if (!tts.supported) return null;
    var voices = window.speechSynthesis.getVoices() || [];
    for (var i = 0; i < voices.length; i++) {
      if ((voices[i].lang || "").toLowerCase().replace("_", "-").indexOf("hr") === 0) return voices[i];
    }
    return null;
  }

  function voicesSettled() {
    tts.voice = pickVoice();
    tts.checked = true;
    var listeners = tts.listeners;
    for (var i = 0; i < listeners.length; i++) listeners[i](!!tts.voice);
  }

  function initVoices() {
    if (!tts.supported) { tts.checked = true; return; }
    tts.voice = pickVoice();
    if (tts.voice) { tts.checked = true; return; }
    var settled = false;
    function onChange() {
      var v = pickVoice();
      if (v || !settled) {
        settled = true;
        voicesSettled();
      }
    }
    try { window.speechSynthesis.addEventListener("voiceschanged", onChange); } catch (e) { window.speechSynthesis.onvoiceschanged = onChange; }
    window.setTimeout(function () { if (!settled) { settled = true; voicesSettled(); } }, 1500);
  }

  // Calls cb(hasCroatianVoice) once voices are known, and again if they change.
  function onVoiceStatus(cb) {
    tts.listeners.push(cb);
    if (tts.checked) cb(!!tts.voice);
  }

  function speechText(text) {
    return String(text).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  }

  function getRate() {
    var r = parseFloat(lsGet(RATE_KEY));
    return r >= 0.6 && r <= 1.2 ? r : 0.9;
  }

  function speak(text, opts) {
    opts = opts || {};
    if (!tts.supported) { if (opts.onend) opts.onend(); return null; }
    var synth = window.speechSynthesis;
    if (tts.current) {
      tts.current.onend = null;
      tts.current.onerror = null;
    }
    synth.cancel();
    var u = new window.SpeechSynthesisUtterance(speechText(text));
    u.lang = "hr-HR";
    if (tts.voice) u.voice = tts.voice;
    u.rate = opts.rate || getRate();
    var finished = false;
    function done() {
      if (finished) return;
      finished = true;
      if (opts.onend) opts.onend();
    }
    u.onend = done;
    u.onerror = done;
    tts.current = u;
    synth.speak(u);
    return u;
  }

  function stopSpeaking() {
    if (tts.supported) window.speechSynthesis.cancel();
  }

  function translateUrl(text) {
    return "https://translate.google.com/?sl=hr&tl=uk&op=translate&text=" + encodeURIComponent(String(text).slice(0, 1500));
  }

  function forvoUrl(word) {
    return "https://forvo.com/word/" + encodeURIComponent(speechText(word).toLowerCase()) + "/#hr";
  }

  // Hint shown when the browser has no Croatian voice. getText() returns text for the fallback link.
  function ttsHint(getText, single) {
    var hint = el("div", "ws-hint");
    hint.hidden = true;
    function render(hasVoice) {
      hint.hidden = hasVoice;
      if (hasVoice) return;
      var text = getText ? getText() : "";
      var link = single && text
        ? '<a href="' + forvoUrl(text) + '" target="_blank" rel="noopener">Forvo ↗</a>'
        : '<a href="' + translateUrl(text) + '" target="_blank" rel="noopener">Google Translate ↗</a>';
      hint.innerHTML = (tts.supported
        ? "Немає хорватського голосу: відкрий сайт у Microsoft Edge або встанови хорватську мову в Windows (Settings → Time &amp; language → Speech)."
        : "Цей браузер не підтримує синтез мовлення. Відкрий сайт у Microsoft Edge або Chrome.") +
        " Тимчасово: " + link;
    }
    onVoiceStatus(render);
    hint.refresh = function () { render(!!tts.voice); };
    return hint;
  }

  // ---------- Reference material ----------
  function refItems(refId) {
    var root = refId ? document.getElementById(refId) : null;
    if (!root) return null;
    var nodes = root.querySelectorAll(".hr");
    var items = [];
    for (var i = 0; i < nodes.length; i++) {
      var parent = nodes[i].parentElement ? nodes[i].parentElement.closest(".hr") : null;
      if (parent && root.contains(parent)) continue;
      var t = nodes[i].textContent.replace(/\s+/g, " ").trim();
      if (t) items.push(t);
    }
    if (!items.length) {
      var whole = root.textContent.replace(/\s+/g, " ").trim();
      var parts = whole.match(/[^.!?…]+[.!?…]*\s*/g) || [];
      for (var j = 0; j < parts.length; j++) if (parts[j].trim()) items.push(parts[j].trim());
    }
    return { root: root, items: items, isList: root.tagName === "TABLE" || !!root.querySelector("table") };
  }

  function weekOf(label, key) {
    var section = label.closest("[data-week]");
    if (section) return section.getAttribute("data-week");
    var m = /^w(\d+)-/.exec(key || "");
    return m ? m[1] : null;
  }

  // ---------- Autosaved textarea ----------
  var pendingSaves = {};

  function flushAll() {
    for (var k in pendingSaves) if (pendingSaves.hasOwnProperty(k)) pendingSaves[k]();
  }
  window.addEventListener("pagehide", flushAll);
  window.addEventListener("beforeunload", flushAll);

  function textArea(task, placeholder, withCounter) {
    var wrap = el("div", "ws-text-wrap");
    var ta = el("textarea", "ws-textarea");
    ta.rows = withCounter ? 6 : 4;
    ta.placeholder = placeholder;
    ta.setAttribute("lang", "hr");
    ta.spellcheck = true;
    ta.value = lsGet(WS_PREFIX + task.key) || "";
    var meta = el("div", "ws-meta");
    var counter = el("span", "ws-count");
    var status = el("span", "ws-saved");
    meta.appendChild(counter);
    meta.appendChild(status);
    wrap.appendChild(ta);
    wrap.appendChild(meta);

    var timer = null;
    var hideTimer = null;

    function count() {
      if (!withCounter) return;
      var words = ta.value.match(/\S+/g);
      var n = words ? words.length : 0;
      counter.textContent = "Слів: " + n;
    }

    function save() {
      if (timer) { window.clearTimeout(timer); timer = null; }
      delete pendingSaves[task.key];
      var value = ta.value;
      var ok;
      if (value.trim()) ok = lsSet(WS_PREFIX + task.key, value);
      else { lsRemove(WS_PREFIX + task.key); ok = true; }
      status.textContent = ok ? "✓ збережено" : "Не вдалося зберегти: сховище недоступне";
      status.classList.toggle("ws-error", !ok);
      status.classList.add("show");
      if (hideTimer) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(function () { status.classList.remove("show"); }, 1800);
      task.hasText = !!value.trim();
      updateMarker(task);
    }

    ta.addEventListener("input", function () {
      count();
      if (timer) window.clearTimeout(timer);
      pendingSaves[task.key] = save;
      timer = window.setTimeout(save, SAVE_DELAY);
    });
    ta.addEventListener("blur", function () { if (timer) save(); });
    count();
    return wrap;
  }

  // ---------- Tools ----------
  function buildWrite(task, panel) {
    panel.appendChild(textArea(task, "Пиши тут хорватською. Зберігається автоматично.", true));
  }

  function buildNotes(task, panel) {
    panel.appendChild(textArea(task, "Нотатки до завдання (зберігаються автоматично)…", false));
  }

  function refBlock(task, panel, opts) {
    var ref = refItems(task.ref);
    if (!task.ref) return null;
    if (!ref || !ref.items.length) {
      panel.appendChild(el("p", "ws-missing", "Матеріал «" + task.ref + "» не знайдено на сторінці."));
      return null;
    }
    var text = el("div", "ws-text" + (ref.isList ? " ws-list" : ""));
    text.setAttribute("lang", "hr");
    var spans = [];
    for (var i = 0; i < ref.items.length; i++) {
      var s = el("span", "ws-sent", ref.items[i]);
      s.setAttribute("data-i", String(i));
      if (opts && opts.clickable) {
        s.tabIndex = 0;
        s.setAttribute("role", "button");
        s.title = "Натисни, щоб почути";
      }
      spans.push(s);
      text.appendChild(s);
      if (!ref.isList) text.appendChild(document.createTextNode(" "));
    }
    return { el: text, spans: spans, items: ref.items };
  }

  function playAll(items, rate, onItem, onDone) {
    var i = 0;
    var stopped = false;
    function next() {
      if (stopped) return;
      if (i >= items.length) { onItem(-1); if (onDone) onDone(); return; }
      onItem(i);
      speak(items[i], { rate: rate(), onend: function () { i++; next(); } });
    }
    next();
    return { stop: function () { stopped = true; stopSpeaking(); onItem(-1); } };
  }

  function markSpeaking(spans, idx) {
    for (var i = 0; i < spans.length; i++) spans[i].classList.toggle("speaking", i === idx);
  }

  function buildSpeak(task, panel) {
    var ref = refBlock(task, panel, { clickable: true });
    if (ref) {
      var refWrap = el("div", "ws-ref");
      var row = el("div", "ws-row");
      var playBtn = button("🔊 Прослухати зразок");
      var player = null;
      playBtn.addEventListener("click", function () {
        if (player) { player.stop(); player = null; playBtn.textContent = "🔊 Прослухати зразок"; return; }
        playBtn.textContent = "■ Стоп";
        player = playAll(ref.items, getRate, function (i) { markSpeaking(ref.spans, i); }, function () {
          player = null;
          playBtn.textContent = "🔊 Прослухати зразок";
        });
      });
      row.appendChild(playBtn);
      refWrap.appendChild(row);
      refWrap.appendChild(ref.el);
      bindSentenceClicks(ref);
      refWrap.appendChild(ttsHint(function () { return ref.items.join(" "); }));
      panel.appendChild(refWrap);
    }
    panel.appendChild(recorder(task));
    panel.appendChild(textArea(task, "Нотатки: що вдалося, що виправити…", false));
  }

  function bindSentenceClicks(ref) {
    function play(target) {
      var i = parseInt(target.getAttribute("data-i"), 10);
      markSpeaking(ref.spans, i);
      speak(ref.items[i], { onend: function () { markSpeaking(ref.spans, -1); } });
    }
    ref.el.addEventListener("click", function (event) {
      var target = event.target.closest(".ws-sent");
      if (!target || String(window.getSelection ? window.getSelection() : "").trim()) return;
      play(target);
    });
    ref.el.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      var target = event.target.closest(".ws-sent");
      if (!target) return;
      event.preventDefault();
      play(target);
    });
  }

  function rateControl(onChange) {
    var label = el("label", "ws-rate");
    var input = el("input");
    input.type = "range";
    input.min = "0.6";
    input.max = "1.2";
    input.step = "0.1";
    input.value = String(getRate());
    var out = el("span", "ws-rate-val", getRate().toFixed(1) + "×");
    label.appendChild(document.createTextNode("Швидкість "));
    label.appendChild(input);
    label.appendChild(out);
    input.addEventListener("input", function () {
      var v = parseFloat(input.value);
      out.textContent = v.toFixed(1) + "×";
      lsSet(RATE_KEY, String(v));
      if (onChange) onChange(v);
    });
    return label;
  }

  function buildListen(task, panel) {
    var ref = refBlock(task, panel, { clickable: true });
    if (!task.ref) panel.appendChild(el("p", "ws-missing", "До цього завдання не прив'язано текст."));
    if (ref) {
      var controls = el("div", "ws-row");
      var playBtn = button("▶ Слухати");
      var stopBtn = button("■ Стоп");
      controls.appendChild(playBtn);
      controls.appendChild(stopBtn);
      controls.appendChild(rateControl());
      var modeLabel = el("label", "ws-check");
      var mode = el("input");
      mode.type = "checkbox";
      modeLabel.appendChild(mode);
      modeLabel.appendChild(document.createTextNode(" По реченню"));
      controls.appendChild(modeLabel);
      panel.appendChild(controls);

      var stepRow = el("div", "ws-row ws-step");
      stepRow.hidden = true;
      var prevBtn = button("◂ Назад");
      var againBtn = button("↻ Ще раз");
      var nextBtn = button("Далі ▸");
      var pos = el("span", "ws-pos");
      stepRow.appendChild(prevBtn);
      stepRow.appendChild(againBtn);
      stepRow.appendChild(nextBtn);
      stepRow.appendChild(pos);
      panel.appendChild(stepRow);

      var reveal = button("Показати текст", "ws-reveal");
      ref.el.hidden = true;
      reveal.addEventListener("click", function () {
        ref.el.hidden = !ref.el.hidden;
        reveal.textContent = ref.el.hidden ? "Показати текст" : "Сховати текст";
      });
      panel.appendChild(reveal);
      panel.appendChild(ref.el);
      bindSentenceClicks(ref);
      panel.appendChild(ttsHint(function () { return ref.items.join(" "); }));

      var player = null;
      var paused = false;
      var step = 0;

      function resetPlay() {
        player = null;
        paused = false;
        playBtn.textContent = "▶ Слухати";
      }

      function playStep() {
        pos.textContent = (step + 1) + " / " + ref.items.length;
        markSpeaking(ref.spans, step);
        speak(ref.items[step], { onend: function () { markSpeaking(ref.spans, -1); } });
      }

      playBtn.addEventListener("click", function () {
        if (mode.checked) { playStep(); return; }
        if (player && !paused) {
          window.speechSynthesis.pause();
          paused = true;
          playBtn.textContent = "▶ Продовжити";
          return;
        }
        if (player && paused) {
          window.speechSynthesis.resume();
          paused = false;
          playBtn.textContent = "⏸ Пауза";
          return;
        }
        playBtn.textContent = "⏸ Пауза";
        player = playAll(ref.items, getRate, function (i) { markSpeaking(ref.spans, i); }, resetPlay);
      });
      stopBtn.addEventListener("click", function () {
        if (player) player.stop();
        else stopSpeaking();
        markSpeaking(ref.spans, -1);
        resetPlay();
      });
      mode.addEventListener("change", function () {
        if (player) player.stop();
        resetPlay();
        stepRow.hidden = !mode.checked;
        step = 0;
        pos.textContent = "1 / " + ref.items.length;
      });
      prevBtn.addEventListener("click", function () { step = Math.max(0, step - 1); playStep(); });
      againBtn.addEventListener("click", playStep);
      nextBtn.addEventListener("click", function () { step = Math.min(ref.items.length - 1, step + 1); playStep(); });
    }
    panel.appendChild(textArea(task, "Що зрозумів(-ла)? Ключові слова, переказ…", false));
  }

  function buildRead(task, panel) {
    var ref = refBlock(task, panel, { clickable: true });
    if (!task.ref) panel.appendChild(el("p", "ws-missing", "До цього завдання не прив'язано текст."));
    var wordInput = null;
    if (ref) {
      var row = el("div", "ws-row");
      row.appendChild(el("span", "ws-help", "Натисни на речення, щоб почути. Виділи слово — воно потрапить у форму «у словник»."));
      row.appendChild(rateControl());
      panel.appendChild(row);
      panel.appendChild(ref.el);
      bindSentenceClicks(ref);
      panel.appendChild(ttsHint(function () { return ref.items.join(" "); }));
      ref.el.addEventListener("mouseup", function () {
        var sel = window.getSelection ? String(window.getSelection()).trim() : "";
        if (sel && sel.length <= 60 && wordInput) {
          wordInput.value = sel.replace(/[.,!?;:«»"„“”()]/g, "").trim();
          wordInput.focus();
        }
      });
    }
    panel.appendChild(textArea(task, "Випиши слова й фрази тут…", false));
    var form = vocabForm(task);
    wordInput = form.word;
    panel.appendChild(form.el);
  }

  function vocabForm(task) {
    var form = el("form", "ws-vocab");
    form.setAttribute("autocomplete", "off");
    var word = el("input");
    word.placeholder = "хорватською";
    word.setAttribute("lang", "hr");
    word.required = true;
    var tr = el("input");
    tr.placeholder = "переклад";
    tr.required = true;
    var submit = el("button", "", "+ у словник");
    submit.type = "submit";
    var msg = el("span", "ws-saved");
    form.appendChild(word);
    form.appendChild(tr);
    form.appendChild(submit);
    form.appendChild(msg);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var w = word.value.trim();
      var t = tr.value.trim();
      if (!w || !t) return;
      var result = addToVocab(w, t, task.week ? "тиждень " + task.week : "");
      msg.textContent = result === "dup" ? "вже є у словнику" : result ? "✓ додано: " + w : "не вдалося зберегти";
      msg.classList.toggle("ws-error", !result);
      msg.classList.add("show");
      if (result === true) { word.value = ""; tr.value = ""; }
      word.focus();
    });
    return { el: form, word: word };
  }

  // Adds a word to the personal dictionary (same shape vocab.html uses). Returns true, "dup" or false.
  function addToVocab(word, tr, tag) {
    var list;
    try {
      var raw = window.localStorage.getItem(VOCAB_KEY);
      list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) list = [];
    } catch (e) { list = []; }
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].word).toLowerCase() === word.toLowerCase()) return "dup";
    }
    list.unshift({ id: newId(), word: word, tr: tr, ex: "", tag: tag || "", added: Date.now() });
    return lsSet(VOCAB_KEY, JSON.stringify(list));
  }

  function buildCards(task, panel) {
    var row = el("div", "ws-row");
    if (task.week) {
      var weekLink = el("a", "ws-btn ws-primary", "Картки тижня " + task.week + " ↗");
      weekLink.href = "cards.html#week=" + task.week;
      row.appendChild(weekLink);
    }
    var dueLink = el("a", "ws-btn", "Повторення (усі тижні) ↗");
    dueLink.href = "cards.html#due";
    row.appendChild(dueLink);
    panel.appendChild(row);
    panel.appendChild(el("p", "ws-help", "Картки відкриваються на окремій сторінці; прогрес інтервального повторення зберігається автоматично."));
  }

  // ---------- Recorder ----------
  function pickMime() {
    if (!window.MediaRecorder || !window.MediaRecorder.isTypeSupported) return "";
    var types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    for (var i = 0; i < types.length; i++) if (window.MediaRecorder.isTypeSupported(types[i])) return types[i];
    return "";
  }

  function recorder(task) {
    var box = el("div", "ws-recorder");
    var row = el("div", "ws-row");
    var recBtn = button("● Записати", "ws-rec");
    var timeEl = el("span", "ws-timer");
    var msg = el("span", "ws-help");
    row.appendChild(recBtn);
    row.appendChild(timeEl);
    row.appendChild(msg);
    box.appendChild(row);
    var list = el("ol", "ws-takes");
    box.appendChild(list);

    var supported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    if (!supported) {
      recBtn.disabled = true;
      msg.textContent = "Запис недоступний у цьому браузері. Відкрий сайт у Chrome або Edge.";
    }

    var media = null;
    var stream = null;
    var chunks = [];
    var started = 0;
    var tick = null;
    var urls = [];

    function renderTakes() {
      listTakes(task.key, function (takes) {
        for (var u = 0; u < urls.length; u++) URL.revokeObjectURL(urls[u]);
        urls = [];
        list.innerHTML = "";
        task.hasTakes = takes.length > 0;
        updateMarker(task);
        if (!takes.length) {
          list.appendChild(el("li", "ws-empty", dbFailed ? "Сховище записів (IndexedDB) недоступне." : "Записів ще немає."));
          return;
        }
        for (var i = 0; i < takes.length; i++) list.appendChild(takeItem(takes[i], i + 1));
      });
    }

    function takeItem(take, n) {
      var li = el("li", "ws-take");
      var url = URL.createObjectURL(take.blob);
      urls.push(url);
      var label = el("span", "ws-take-label", "Спроба " + n + " · " + new Date(take.created).toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }));
      var audio = el("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.src = url;
      var del = button("Видалити", "ws-del");
      del.addEventListener("click", function () {
        if (!window.confirm("Видалити цей запис?")) return;
        deleteTake(take.id, renderTakes);
      });
      li.appendChild(label);
      li.appendChild(audio);
      li.appendChild(del);
      return li;
    }

    function stopTracks() {
      if (stream) {
        var tracks = stream.getTracks();
        for (var i = 0; i < tracks.length; i++) tracks[i].stop();
      }
      stream = null;
    }

    function setIdle() {
      recBtn.textContent = "● Записати";
      recBtn.classList.remove("recording");
      if (tick) window.clearInterval(tick);
      tick = null;
      timeEl.textContent = "";
    }

    function start() {
      msg.textContent = "";
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
        stream = s;
        var mime = pickMime();
        try {
          media = mime ? new window.MediaRecorder(s, { mimeType: mime }) : new window.MediaRecorder(s);
        } catch (e) {
          stopTracks();
          msg.textContent = "Не вдалося почати запис.";
          return;
        }
        chunks = [];
        media.ondataavailable = function (event) { if (event.data && event.data.size) chunks.push(event.data); };
        media.onstop = function () {
          stopTracks();
          setIdle();
          var type = media.mimeType || mime || "audio/webm";
          media = null;
          if (!chunks.length) return;
          var blob = new Blob(chunks, { type: type });
          addTake({ id: newId(), key: task.key, created: Date.now(), blob: blob, mime: type }, function (ok) {
            if (!ok) msg.textContent = "Не вдалося зберегти запис (IndexedDB недоступне).";
            renderTakes();
          });
        };
        media.start();
        started = Date.now();
        recBtn.textContent = "■ Зупинити";
        recBtn.classList.add("recording");
        timeEl.textContent = "0:00";
        tick = window.setInterval(function () {
          var sec = Math.floor((Date.now() - started) / 1000);
          timeEl.textContent = Math.floor(sec / 60) + ":" + ("0" + (sec % 60)).slice(-2);
        }, 500);
      }).catch(function (err) {
        var name = err && err.name;
        msg.textContent = name === "NotAllowedError" || name === "SecurityError"
          ? "Немає доступу до мікрофона. Дозволь мікрофон для цієї сторінки (значок 🔒/🎤 в адресному рядку) і спробуй ще раз."
          : name === "NotFoundError"
            ? "Мікрофон не знайдено. Підключи мікрофон і спробуй ще раз."
            : "Не вдалося увімкнути мікрофон.";
      });
    }

    recBtn.addEventListener("click", function () {
      if (media && media.state === "recording") media.stop();
      else start();
    });

    renderTakes();
    return box;
  }

  // ---------- Drills (closed exercises from hidden .drill-data blocks) ----------
  var DRILL_SUFFIX = ":drill";

  // Text of a (possibly hidden) element with a space between block children.
  function cleanText(node) {
    var copy = node.cloneNode(true);
    var blocks = copy.querySelectorAll("p, li, div, br, tr, td, h3, h4");
    for (var i = 0; i < blocks.length; i++) blocks[i].appendChild(document.createTextNode(" "));
    return copy.textContent.replace(/\s+/g, " ").trim();
  }

  function parseDrill(id) {
    var root = id ? document.getElementById(id) : null;
    if (!root) return null;
    var intro = root.querySelector(".drill-intro");
    var lis = root.querySelectorAll("li[data-answer]");
    var items = [];
    for (var i = 0; i < lis.length; i++) {
      var li = lis[i];
      var type = li.getAttribute("data-type") || "text";
      if (type !== "choice" && type !== "long") type = "text";
      var answers = li.getAttribute("data-answer").split("|").map(function (a) { return a.trim(); }).filter(Boolean);
      items.push({
        type: type,
        html: li.innerHTML,
        prompt: cleanText(li),
        answers: answers,
        options: type === "choice" ? (li.getAttribute("data-options") || "").split("|").map(function (o) { return o.trim(); }).filter(Boolean) : [],
        hint: li.getAttribute("data-hint") || ""
      });
    }
    return { intro: intro ? intro.innerHTML : "", introText: intro ? cleanText(intro) : "", items: items };
  }

  function normalizeAnswer(s) {
    return String(s).toLowerCase()
      .replace(/[‘’‚′`´]/g, "'")
      .replace(/[“”„«»″]/g, '"')
      .replace(/[‐‑‒–—―]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[\s.!?…]+$/, "")
      .trim();
  }

  function foldDiacritics(s) {
    return s.replace(/đ/g, "dj").normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  // "ok" | "near" (only diacritics differ) | "bad" | "empty"; long items are never graded.
  function gradeItem(item, value) {
    if (!value || !String(value).trim()) return "empty";
    var v = normalizeAnswer(value);
    var near = false;
    for (var i = 0; i < item.answers.length; i++) {
      var a = normalizeAnswer(item.answers[i]);
      if (v === a) return "ok";
      if (foldDiacritics(v) === foldDiacritics(a)) near = true;
    }
    return near ? "near" : "bad";
  }

  function loadDrillState(key) {
    try {
      var s = JSON.parse(lsGet(WS_PREFIX + key + DRILL_SUFFIX) || "null");
      return s && Array.isArray(s.answers) ? s : null;
    } catch (e) { return null; }
  }

  function drillHasWork(key) {
    var s = loadDrillState(key);
    if (!s) return false;
    for (var i = 0; i < s.answers.length; i++) if (s.answers[i] && String(s.answers[i]).trim()) return true;
    return false;
  }

  var MARK = { ok: "✓", near: "⚠", bad: "✗", empty: "—" };

  // Plain-text summary of a drill for hr-chat-ctx: user answers with marks, and the key with accepted answers.
  function drillSummary(task) {
    var drill = parseDrill(task.drill);
    if (!drill) return null;
    var state = loadDrillState(task.key) || { answers: [], checked: false };
    var mine = [];
    var key = [];
    for (var i = 0; i < drill.items.length; i++) {
      var item = drill.items[i];
      var value = state.answers[i] || "";
      var mark = item.type === "long" ? "" : " [" + MARK[gradeItem(item, value)] + "]";
      mine.push((i + 1) + ". " + item.prompt + " → " + (value.trim() ? value.trim() : "(без відповіді)") + mark);
      key.push((i + 1) + ". " + item.prompt + " → " + item.answers.join(" | ") + (item.hint ? " (підказка: " + item.hint + ")" : ""));
    }
    return {
      answer: "Мої відповіді у вправі" + (state.checked ? " (перевірено)" : "") + ":\n" + mine.join("\n"),
      ref: "Вправа" + (drill.introText ? ": " + drill.introText : "") + "\nПравильні відповіді (варіанти через |):\n" + key.join("\n")
    };
  }

  function buildDrill(task, panel) {
    var drill = parseDrill(task.drill);
    if (!drill || !drill.items.length) {
      panel.appendChild(el("p", "ws-missing", "Вправу «" + (task.drill || "?") + "» не знайдено на сторінці."));
      return;
    }
    var box = el("div", "drill");
    if (drill.intro) {
      var intro = el("p", "drill-intro");
      intro.innerHTML = drill.intro;
      box.appendChild(intro);
    }
    var list = el("ol", "drill-items");
    box.appendChild(list);
    var state = loadDrillState(task.key) || { answers: [], checked: false };
    var rows = [];
    var timer = null;

    function valueOf(row) {
      if (row.item.type === "choice") {
        for (var i = 0; i < row.radios.length; i++) if (row.radios[i].checked) return row.radios[i].value;
        return "";
      }
      return row.input.value;
    }

    function save() {
      if (timer) { window.clearTimeout(timer); timer = null; }
      delete pendingSaves[task.key + DRILL_SUFFIX];
      var answers = rows.map(valueOf);
      var any = answers.some(function (a) { return a && a.trim(); });
      if (any || state.checked) lsSet(WS_PREFIX + task.key + DRILL_SUFFIX, JSON.stringify({ answers: answers, checked: state.checked }));
      else lsRemove(WS_PREFIX + task.key + DRILL_SUFFIX);
      task.hasDrill = any;
      updateMarker(task);
    }

    function onEdit(row) {
      row.li.className = "drill-item";
      row.fb.hidden = true;
      if (state.checked) {
        state.checked = false;
        score.hidden = true;
        done.hidden = true;
      }
      if (timer) window.clearTimeout(timer);
      pendingSaves[task.key + DRILL_SUFFIX] = save;
      timer = window.setTimeout(save, SAVE_DELAY);
    }

    for (var i = 0; i < drill.items.length; i++) rows.push(drillRow(task, drill.items[i], i, state.answers[i] || "", onEdit));
    for (var r = 0; r < rows.length; r++) list.appendChild(rows[r].li);

    var actions = el("div", "ws-row drill-actions");
    var checkBtn = button("Перевірити", "ws-primary");
    var showBtn = button("Показати відповіді");
    var resetBtn = button("Скинути");
    var score = el("span", "drill-score");
    score.hidden = true;
    actions.appendChild(checkBtn);
    actions.appendChild(showBtn);
    actions.appendChild(resetBtn);
    actions.appendChild(score);
    box.appendChild(actions);
    var done = el("p", "drill-done");
    done.hidden = true;
    box.appendChild(done);

    function answerHtml(item) {
      return item.answers.map(escapeHtml).join(" <span class=\"drill-or\">або</span> ");
    }

    function check() {
      var total = 0;
      var ok = 0;
      var near = 0;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var item = row.item;
        if (item.type === "long") {
          row.li.className = "drill-item drill-long-shown";
          row.fb.innerHTML = '<span class="drill-label">Зразок:</span> <span class="hr">' + answerHtml(item) + "</span>";
          row.fb.hidden = false;
          continue;
        }
        total++;
        var g = gradeItem(item, valueOf(row));
        if (g === "ok") ok++;
        if (g === "near") near++;
        row.li.className = "drill-item drill-" + g;
        if (g === "ok") {
          row.fb.hidden = true;
        } else {
          row.fb.innerHTML = (g === "near" ? '<span class="drill-warn">⚠ майже — перевір діакритику.</span> ' : "") +
            '<span class="drill-label">Правильно:</span> <span class="hr">' + answerHtml(item) + "</span>";
          row.fb.hidden = false;
        }
      }
      score.hidden = total === 0;
      score.textContent = ok + " / " + total + (near ? " · ⚠ " + near : "");
      score.className = "drill-score" + (total && ok === total ? " drill-score-full" : "");
      var checkbox = task.label.querySelector("input[type=checkbox]");
      done.hidden = !(total && ok === total && checkbox && !checkbox.checked);
      done.textContent = "Усе правильно! Можеш позначити завдання як виконане ✓";
      state.checked = true;
      save();
    }

    checkBtn.addEventListener("click", check);
    showBtn.addEventListener("click", function () {
      for (var i = 0; i < rows.length; i++) {
        rows[i].fb.innerHTML = '<span class="drill-label">' + (rows[i].item.type === "long" ? "Зразок:" : "Відповідь:") +
          '</span> <span class="hr">' + answerHtml(rows[i].item) + "</span>";
        rows[i].fb.hidden = false;
      }
    });
    resetBtn.addEventListener("click", function () {
      if (!window.confirm("Стерти всі відповіді у вправі?")) return;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (row.input) row.input.value = "";
        for (var j = 0; j < row.radios.length; j++) row.radios[j].checked = false;
        row.li.className = "drill-item";
        row.fb.hidden = true;
        if (row.hintEl) row.hintEl.hidden = true;
      }
      state.checked = false;
      score.hidden = true;
      done.hidden = true;
      save();
    });

    panel.appendChild(box);
    if (state.checked) check();
  }

  function drillRow(task, item, index, value, onEdit) {
    var li = el("li", "drill-item");
    var prompt = el("div", "drill-prompt");
    prompt.innerHTML = item.html;
    li.appendChild(prompt);
    var row = { item: item, li: li, input: null, radios: [], hintEl: null };
    var field = el("div", "drill-field");
    if (item.type === "choice") {
      var group = el("div", "drill-choices");
      group.setAttribute("role", "radiogroup");
      for (var i = 0; i < item.options.length; i++) {
        var lab = el("label", "drill-choice");
        var radio = el("input");
        radio.type = "radio";
        radio.name = "drill-" + task.key + "-" + index;
        radio.value = item.options[i];
        radio.checked = value === item.options[i];
        radio.addEventListener("change", function () { onEdit(row); });
        lab.appendChild(radio);
        lab.appendChild(document.createTextNode(" " + item.options[i]));
        group.appendChild(lab);
        row.radios.push(radio);
      }
      field.appendChild(group);
    } else {
      var input = el(item.type === "long" ? "textarea" : "input", "drill-input");
      if (item.type === "long") input.rows = 3;
      else input.type = "text";
      input.setAttribute("lang", "hr");
      input.setAttribute("autocomplete", "off");
      input.setAttribute("autocapitalize", "off");
      input.spellcheck = false;
      input.setAttribute("aria-label", "Відповідь " + (index + 1));
      input.value = value;
      input.addEventListener("input", function () { onEdit(row); });
      row.input = input;
      field.appendChild(input);
    }
    if (item.hint) {
      var hintBtn = button("Підказка", "drill-hint-btn");
      var hint = el("span", "drill-hint", item.hint);
      hint.hidden = true;
      hintBtn.addEventListener("click", function () { hint.hidden = !hint.hidden; });
      field.appendChild(hintBtn);
      field.appendChild(hint);
      row.hintEl = hint;
    }
    li.appendChild(field);
    row.fb = el("div", "drill-fb");
    row.fb.hidden = true;
    li.appendChild(row.fb);
    return row;
  }

  // Model answer (data-model) shown on request, for free-writing tasks.
  function modelBlock(task) {
    var src = document.getElementById(task.model);
    if (!src) return el("p", "ws-missing", "Зразок «" + task.model + "» не знайдено на сторінці.");
    var wrap = el("div", "ws-model-wrap");
    var btn = button("Показати зразок");
    var model = el("div", "ws-model");
    model.innerHTML = src.innerHTML;
    model.hidden = true;
    btn.addEventListener("click", function () {
      model.hidden = !model.hidden;
      btn.textContent = model.hidden ? "Показати зразок" : "Сховати зразок";
    });
    wrap.appendChild(btn);
    wrap.appendChild(model);
    return wrap;
  }

  // ---------- Task wiring ----------
  var BUILDERS = {
    write: buildWrite,
    speak: buildSpeak,
    listen: buildListen,
    read: buildRead,
    cards: buildCards,
    notes: buildNotes,
    drill: buildDrill
  };

  function updateMarker(task) {
    var has = !!(task.hasText || task.hasTakes || task.hasDrill);
    task.btn.classList.toggle("has-work", has);
    task.btn.title = has ? "Є збережена робота" : "";
  }

  // Context for chat.html: task wording without minutes, saved answer, reference text.
  function saveChatContext(task) {
    flushAll();
    var copy = task.label.cloneNode(true);
    var drop = copy.querySelectorAll("input, .mins, .min");
    for (var i = 0; i < drop.length; i++) drop[i].parentNode.removeChild(drop[i]);
    var ref = task.ref ? document.getElementById(task.ref) : null;
    var model = task.model ? document.getElementById(task.model) : null;
    var answer = lsGet(WS_PREFIX + task.key) || "";
    var refParts = [];
    if (ref) refParts.push(cleanText(ref));
    if (model) refParts.push("Зразок відповіді:\n" + cleanText(model));
    var drill = task.drill ? drillSummary(task) : null;
    if (drill) {
      answer = answer ? answer + "\n\n" + drill.answer : drill.answer;
      refParts.push(drill.ref);
    }
    var ctx = {
      key: task.key,
      week: task.week ? parseInt(task.week, 10) : null,
      taskText: copy.textContent.replace(/\s+/g, " ").trim(),
      answer: answer,
      refText: refParts.join("\n\n").slice(0, 4000)
    };
    lsSet("hr-chat-ctx", JSON.stringify(ctx));
  }

  function buildPanel(task) {
    var panel = task.panel;
    var head = el("div", "ws-head");
    head.appendChild(el("span", "ws-title", TOOL_TITLE[task.tool]));
    if (task.url) {
      var open = el("a", "ws-open", "Відкрити ↗");
      open.href = task.url;
      open.target = "_blank";
      open.rel = "noopener";
      head.appendChild(open);
    }
    var ask = el("a", "ws-ask", "💬 Запитати AI");
    ask.href = "chat.html#task=" + encodeURIComponent(task.key);
    ask.addEventListener("click", function () { saveChatContext(task); });
    head.appendChild(ask);
    panel.appendChild(head);
    BUILDERS[task.tool](task, panel);
    if (task.model) panel.appendChild(modelBlock(task));
    if (task.drill && task.tool !== "drill") {
      panel.appendChild(el("div", "drill-sep", "Вправа"));
      buildDrill(task, panel);
    }
    task.built = true;
  }

  function toggle(task) {
    if (!task.built) buildPanel(task);
    var open = task.panel.hidden;
    task.panel.hidden = !open;
    task.btn.setAttribute("aria-expanded", open ? "true" : "false");
    task.btn.firstChild.nodeValue = open ? "Сховати ▾" : "Виконати ▸";
    if (!open) {
      stopSpeaking();
      flushAll();
    }
  }

  function initTasks() {
    var labels = document.querySelectorAll("label.task");
    var tasks = [];
    for (var i = 0; i < labels.length; i++) {
      var label = labels[i];
      var input = label.querySelector("input[data-key]");
      if (!input) continue;
      var tool = label.getAttribute("data-tool");
      if (!BUILDERS.hasOwnProperty(tool)) tool = "notes";
      var task = {
        key: input.getAttribute("data-key"),
        tool: tool,
        ref: label.getAttribute("data-ref") || "",
        url: label.getAttribute("data-url") || "",
        label: label,
        built: false,
        hasText: !!(lsGet(WS_PREFIX + input.getAttribute("data-key")) || "").trim(),
        hasTakes: false
      };
      task.week = weekOf(label, task.key);
      task.drill = label.getAttribute("data-drill") || "";
      task.model = label.getAttribute("data-model") || "";
      // Fallback: drill block placed right after the label without data-drill.
      var next = label.nextElementSibling;
      if (!task.drill && tool === "drill" && next && next.classList.contains("drill-data") && next.id) task.drill = next.id;
      task.hasDrill = task.drill ? drillHasWork(task.key) : false;

      var btn = button("Виконати ▸", "ws-toggle ws-tool-" + tool);
      btn.setAttribute("aria-expanded", "false");
      var panel = el("div", "ws-panel ws-panel-" + tool);
      panel.hidden = true;
      panel.id = "ws-" + task.key;
      btn.setAttribute("aria-controls", panel.id);
      task.btn = btn;
      task.panel = panel;
      label.parentNode.insertBefore(btn, label.nextSibling);
      label.parentNode.insertBefore(panel, btn.nextSibling);
      btn.addEventListener("click", (function (t) { return function () { toggle(t); }; })(task));
      updateMarker(task);
      tasks.push(task);
    }

    var hasSpeak = false;
    for (var j = 0; j < tasks.length; j++) if (tasks[j].tool === "speak") hasSpeak = true;
    if (hasSpeak) {
      keysWithTakes(function (found) {
        for (var k = 0; k < tasks.length; k++) {
          if (found[tasks[k].key]) {
            tasks[k].hasTakes = true;
            updateMarker(tasks[k]);
          }
        }
      });
    }
  }

  // Public helpers for cards.html.
  window.HRWS = {
    speak: speak,
    stop: stopSpeaking,
    ttsHint: ttsHint,
    onVoiceStatus: onVoiceStatus,
    forvoUrl: forvoUrl,
    addToVocab: addToVocab,
    escapeHtml: escapeHtml
  };

  initVoices();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initTasks);
  else initTasks();
})();
