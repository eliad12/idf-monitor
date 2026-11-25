// Run: node stories.test.js
const assert = require("assert");
const { clusterStories } = require("./stories.js");
const t = [
  { title: 'צה"ל חיסל את מפקד חמאס בצפון רצועת עזה', source: "ynet", ts: 5 },
  { title: "בצפון רצועת עזה: חוסל מפקד חמאס בכיר", source: "וואלה", ts: 4 },
  { title: "מפקד בכיר בחמאס חוסל בתקיפה בצפון הרצועה", source: "כאן", ts: 3 },
  { title: 'הרמטכ"ל ביקר בבסיס חיל האוויר', source: "מעריב", ts: 2 },
  { title: "IDF strike kills Hamas security chief in Gaza", source: "JP", ts: 2 },
  { title: "Defense minister seeks to censor report on Gaza", source: "TOI", ts: 1 },
];
const c = clusterStories(t);
assert.equal(c.length, 1, "one story with 3+ sites");
assert.deepEqual([...c[0].sources].sort(), ["ynet", "וואלה", "כאן"].sort());
// sharing only region names (Gaza, Hamas) is not the same story
assert.equal(clusterStories(t.slice(4), { minSources: 2 }).length, 0);
console.log("stories test ok");
