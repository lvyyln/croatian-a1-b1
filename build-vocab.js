// Генерує vocab-data.js зі словникових таблиць phase-1/2/3.html (table.vocab[data-week], рядки td.hr + td.uk).
// Запуск: node build-vocab.js   (без npm-залежностей)
"use strict";

var fs = require("fs");
var path = require("path");

var DIR = __dirname;
var PAGES = ["phase-1.html", "phase-2.html", "phase-3.html"];
var OUT = path.join(DIR, "vocab-data.js");

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

function cellText(html) {
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

// Week of the closest <section ... data-week="N"> opened before the table.
function enclosingWeek(html, index) {
  var re = /<section\b[^>]*>/gi;
  var week = null;
  var m;
  while ((m = re.exec(html)) && m.index < index) {
    var w = attr(m[0], "data-week");
    if (w) week = w;
  }
  return week;
}

function extract(html, file, vocab) {
  var tableRe = /<table\b[^>]*>[\s\S]*?<\/table>/gi;
  var m;
  var found = 0;
  while ((m = tableRe.exec(html))) {
    var openTag = /^<table\b[^>]*>/i.exec(m[0])[0];
    if (!hasClass(openTag, "vocab")) continue;
    var week = attr(openTag, "data-week") || enclosingWeek(html, m.index);
    if (!week || !/^\d+$/.test(week)) {
      console.warn(file + ": vocab table without week at offset " + m.index + " — skipped");
      continue;
    }
    var rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    var r;
    while ((r = rowRe.exec(m[0]))) {
      var cells = [];
      var cellRe = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
      var c;
      while ((c = cellRe.exec(r[1]))) cells.push({ tag: "<td" + c[1] + ">", text: cellText(c[2]) });
      if (cells.length < 2) continue;
      var hr = null;
      var uk = null;
      for (var i = 0; i < cells.length; i++) {
        if (hr === null && hasClass(cells[i].tag, "hr")) hr = cells[i].text;
        else if (uk === null && hasClass(cells[i].tag, "uk")) uk = cells[i].text;
      }
      if (hr === null) hr = cells[0].text;
      if (uk === null) uk = cells[1].text;
      if (!hr || !uk) continue;
      var list = vocab[week] || (vocab[week] = []);
      var dup = list.some(function (x) { return x.hr === hr; });
      if (!dup) {
        list.push({ hr: hr, uk: uk });
        found++;
      }
    }
  }
  return found;
}

var vocab = {};
PAGES.forEach(function (page) {
  var file = path.join(DIR, page);
  if (!fs.existsSync(file)) {
    console.warn(page + ": not found — skipped");
    return;
  }
  var n = extract(fs.readFileSync(file, "utf8"), page, vocab);
  console.log(page + ": " + n + " words");
});

var ordered = {};
Object.keys(vocab).map(Number).sort(function (a, b) { return a - b; }).forEach(function (w) { ordered[w] = vocab[w]; });

var weeks = Object.keys(ordered);
var total = weeks.reduce(function (sum, w) { return sum + ordered[w].length; }, 0);
var body = "// Згенеровано build-vocab.js — не редагуй вручну. Тижнів: " + weeks.length + ", слів: " + total + ".\n" +
  "window.HR_VOCAB = {" + weeks.map(function (w) {
    return "\n" + JSON.stringify(w) + ": [\n" + ordered[w].map(function (x) { return "  " + JSON.stringify(x); }).join(",\n") + "\n]";
  }).join(",") + "\n};\n";
fs.writeFileSync(OUT, body, "utf8");
console.log("vocab-data.js: " + weeks.length + " weeks, " + total + " words" +
  (weeks.length ? " (" + weeks.map(function (w) { return w + ":" + ordered[w].length; }).join(" ") + ")" : ""));
