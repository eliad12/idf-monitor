// "Hot stories": groups headlines about the same event from different sites. Loaded by index.html; tested by stories.test.js
const STOP = new Set(("של את על עם לא זה כי אחרי נגד מול בין גם הוא היא הם הן כל אל או יותר בתוך לאחר אך רק עוד כך מה מי איך למה היום אתמול כעת לפי דרך אשר שלא אין יש היה היו להיות "
  + "פיקוד העורף פקער התרעה התרעות home front command "
  + "צהל צבא חיילי חיילים לוחמי לוחמים כוחות דובר הצבא ישראל ישראלי ישראלית חדשות צפו תיעוד דיווח בלעדי עדכון "
  + "the a an of to in on for and or with by from at as is are was were be has have had it its this that after over into new says said "
  + "idf israel israeli israels military army forces troops soldiers soldier defense report reports live watch video").split(/\s+/));
const PREFIX = /^[והבלמשכ]{1,2}(?=[א-ת]{3,})/;
function tokens(title) {
  const words = title.toLowerCase().replace(/[״"'`׳.,:;!?()\[\]{}|\-–—…“”‘’]/g, " ").split(/\s+/);
  const out = new Set();
  for (let w of words) {
    if (/[א-ת]/.test(w)) w = w.replace(PREFIX, "");
    if (w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)) out.add(w);
  }
  return out;
}
// region/actor names appear in many unrelated stories: they never count as a match on their own
const WEAK = new Set("עזה רצועה רצועת הרצועה לבנון חמאס חיזבאללה איראן יהודה שומרון סוריה תימן gaza strip hamas lebanon hezbollah iran west bank syria yemen".split(" "));
function similarity(a, b) {
  let shared = 0, long = false;
  for (const t of a) if (b.has(t) && !WEAK.has(t)) { shared++; if (t.length >= 4) long = true; }
  return long ? shared / Math.min(a.size, b.size) * (shared >= 2) : 0;
}
// greedy, newest first: an article joins the story whose recent members it resembles most (no chaining through a third article)
function clusterStories(items, { minSources = 3, threshold = 0.3 } = {}) {
  const clusters = [];
  for (const m of [...items].sort((a, b) => b.ts - a.ts)) {
    const t = tokens(m.title.split("\n")[0]);
    let best = null, bestScore = threshold;
    for (const c of clusters) {
      const score = Math.max(...c.toks.slice(0, 6).map(x => similarity(t, x)));
      if (score >= bestScore) { best = c; bestScore = score; }
    }
    if (best) { best.items.push(m); best.toks.push(t); } else clusters.push({ items: [m], toks: [t] });
  }
  return clusters.map(c => ({ items: c.items, sources: new Set(c.items.map(m => m.source)) }))
    .filter(g => g.sources.size >= minSources)
    .sort((a, b) => b.sources.size - a.sources.size || b.items[0].ts - a.items[0].ts);
}
if (typeof module !== "undefined") module.exports = { tokens, clusterStories };
