// Генерує course-data.js з тижнів phase-1/2/3.html (section.week[data-week], .week-header h2, .week-header .badge).
// Лише читає сторінки. Запуск: node build-course.js   (без npm-залежностей)
"use strict";

var fs = require("fs");
var path = require("path");

var DIR = __dirname;
var PAGES = ["phase-1.html", "phase-2.html", "phase-3.html"];
var OUT = path.join(DIR, "course-data.js");

var NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", bdquo: "„", shy: "" };

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, ent) {
    if (ent[0] === "#") {
      var code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return isNaN(code) ? m : String.fromCodePoint(code);
    }
    var key = ent.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED, key) ? NAMED[key] : m;
  });
}

function text(html) {
  return decode(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function attr(tag, name) {
  var m = new RegExp("\\s" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i").exec(tag);
  if (!m) return null;
  return m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
}

function hasClass(tag, cls) {
  var c = attr(tag, "class");
  return !!c && (" " + c.replace(/\s+/g, " ") + " ").indexOf(" " + cls + " ") !== -1;
}

function trimSeparators(s) {
  return s.replace(/^[\s·:—–-]+|[\s·:—–-]+$/g, "").trim();
}

// h2 forms: "Укр · <span class="hr">Hrv</span>", "<span class="hr">Hrv</span> · Укр", or "Укр" + <p class="hr week-sub">Hrv</p>.
function parseWeek(chunk) {
  var week = { title: "", titleHr: "", grammar: "" };
  var h2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(chunk);
  if (h2) {
    var inner = h2[1];
    var span = /<span\b[^>]*class\s*=\s*"[^"]*\bhr\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(inner);
    if (span) {
      week.titleHr = text(span[1]);
      week.title = trimSeparators(text(inner.replace(span[0], "")));
    } else {
      week.title = trimSeparators(text(inner));
    }
  }
  if (!week.titleHr) {
    var pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    var p;
    while ((p = pRe.exec(chunk))) {
      var open = /^<p\b[^>]*>/i.exec(p[0])[0];
      if (hasClass(open, "week-sub")) { week.titleHr = text(p[1]); break; }
    }
  }
  var header = /<div\b[^>]*class\s*=\s*"[^"]*\bweek-header\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(chunk);
  var scope = header ? header[1] : chunk;
  var badgeRe = /<span\b[^>]*>([\s\S]*?)<\/span>/gi;
  var b;
  while ((b = badgeRe.exec(scope))) {
    var bOpen = /^<span\b[^>]*>/i.exec(b[0])[0];
    if (hasClass(bOpen, "badge")) { week.grammar = text(b[1]); break; }
  }
  return week;
}

function extract(html, phase, weeks) {
  var re = /<section\b[^>]*>/gi;
  var starts = [];
  var m;
  while ((m = re.exec(html))) {
    if (!hasClass(m[0], "week")) continue;
    var n = attr(m[0], "data-week");
    if (n && /^\d+$/.test(n)) starts.push({ index: m.index, week: n });
  }
  for (var i = 0; i < starts.length; i++) {
    var end = i + 1 < starts.length ? starts[i + 1].index : html.length;
    var w = parseWeek(html.slice(starts[i].index, end));
    w.phase = phase;
    weeks[starts[i].week] = w;
  }
  return starts.length;
}

function main() {
  var weeks = {};
  var total = 0;
  PAGES.forEach(function (file, i) {
    var full = path.join(DIR, file);
    if (!fs.existsSync(full)) { console.warn("skip (missing): " + file); return; }
    var count = extract(fs.readFileSync(full, "utf8"), i + 1, weeks);
    console.log(file + ": " + count + " weeks");
    total += count;
  });
  var keys = Object.keys(weeks).sort(function (a, b) { return a - b; });
  var lines = keys.map(function (k) { return JSON.stringify(k) + ": " + JSON.stringify(weeks[k]); });
  var out = "// Згенеровано build-course.js — не редагуй вручну. Тижнів: " + total + ".\n" +
    "window.HR_COURSE = {\nweeks: {\n" + lines.join(",\n") + "\n}\n};\n";
  fs.writeFileSync(OUT, out, "utf8");
  console.log("wrote " + path.basename(OUT) + " (" + total + " weeks)");
}

main();
