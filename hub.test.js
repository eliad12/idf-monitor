// Run: node hub.test.js
const assert = require("assert");
const H = require("./hub.js");

// create / edit / delete
const s = H.emptyStore();
const a = H.upsert(s.contacts, { displayName: "דנה", organization: "כאן", tags: "תקשורת" }, 1000);
assert.ok(a.id && a.createdAt === 1000 && s.contacts.length === 1);
H.upsert(s.contacts, { ...a, phone: "050" }, 2000);
assert.equal(s.contacts.length, 1); assert.equal(s.contacts[0].phone, "050"); assert.equal(s.contacts[0].createdAt, 1000);
assert.ok(H.remove(s.contacts, a.id) && s.contacts.length === 0 && !H.remove(s.contacts, "nope"));

// task buckets: overdue / today / week / urgent, done and cancelled are not open
const now = new Date(2026, 10, 26, 12, 0).getTime();
const at = (d, h) => new Date(2026, 10, d, h, 0).toISOString();
const tasks = [
  { id: 1, title: "late", dueAt: at(26, 9), status: "פתוחה" },
  { id: 2, title: "later today", dueAt: at(26, 18), status: "פתוחה", priority: "גבוהה" },
  { id: 3, title: "in 3 days", dueAt: at(29, 10), status: "בתהליך" },
  { id: 4, title: "done", dueAt: at(26, 18), status: "הושלמה", updatedAt: now },
  { id: 5, title: "cancelled", dueAt: at(26, 9), status: "בוטלה" },
];
const b = H.taskBuckets(tasks, now);
assert.deepEqual(b.overdue.map(t => t.id), [1]);
assert.deepEqual(b.today.map(t => t.id), [1, 2]);
assert.deepEqual(b.week.map(t => t.id), [1, 2, 3]);
assert.deepEqual(b.urgent.map(t => t.id), [2]);
assert.deepEqual(b.doneToday.map(t => t.id), [4]);
assert.equal(b.open.length, 3);

// knowledge: unverified or stale items always carry a warning
const day = 86400000, nowK = Date.parse("2026-11-26");
assert.equal(H.knowledgeWarning({ status: "מאומת", verifiedAt: "2026-11-20" }, nowK), "");
assert.match(H.knowledgeWarning({ status: "מאומת", verifiedAt: "2026-09-01" }, nowK), /לבדוק שוב/);
assert.match(H.knowledgeWarning({ status: "ממתין לאימות", verifiedAt: "2026-11-25" }, nowK), /לא להציג כעדכני/);
assert.match(H.knowledgeWarning({ status: "פג תוקף" }, nowK), /לא להשתמש/);
assert.match(H.knowledgeWarning({ status: "מאומת" }, nowK), /אין תאריך/);
assert.ok(H.BUILTIN_KNOWLEDGE.every(k => k.url.startsWith("https://") && k.sourceName && k.verifiedAt && k.status === "מאומת"));

// templates: every built-in is fillable and stamped as a draft by the UI
const t = H.BUILTIN_TEMPLATES[0];
assert.deepEqual(H.templateFields(t.body), ["כותרת", "פתיח", "גוף", "ציטוט מאושר (אם קיים)", "פרטי קשר מאושרים"]);
assert.match(H.fillTemplate("א: {{x}} ב: {{ y }}", { x: "1", y: " 2 " }), /א: 1 ב: 2/);
assert.equal(H.fillTemplate("{{missing}}", {}), "");
assert.equal(H.BUILTIN_TEMPLATES.length, 8);

// global search: grouped by kind, empty groups dropped, built-ins included
const st = H.emptyStore();
H.upsert(st.contacts, { displayName: "יוסי", organization: "ynet" });
H.upsert(st.tasks, { title: "לשלוח תגובה ל-ynet" });
const g = H.searchAll(st, "YNET", [{ title: "ynet מדווח", source: "ynet" }], { knowledge: H.BUILTIN_KNOWLEDGE, templates: H.BUILTIN_TEMPLATES });
assert.deepEqual(Object.keys(g).sort(), ["articles", "contacts", "tasks"]);
assert.ok(H.searchAll(st, "פיקוד", [], { knowledge: H.BUILTIN_KNOWLEDGE }).knowledge.length >= 3);
assert.deepEqual(H.searchAll(st, "  "), {});

// backup import: merge by id, newer wins, nothing local is lost
const base = H.emptyStore(), inc = H.emptyStore();
base.tasks = [{ id: "a", title: "old", updatedAt: 1 }, { id: "b", title: "local only", updatedAt: 5 }];
inc.tasks = [{ id: "a", title: "new", updatedAt: 9 }, { id: "c", title: "backup only", updatedAt: 3 }];
const m = H.mergeStores(base, inc);
assert.deepEqual(m.tasks.map(x => x.title), ["new", "local only", "backup only"]);

console.log("hub test ok");
