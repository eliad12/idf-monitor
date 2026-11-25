// Personal work hub for the Home Front Command system (spec: dashboard, tasks, contacts, knowledge,
// templates, emergency mode, global search, media/inquiry log). All personal data stays on this device,
// encrypted with a key derived from the HFC password (own salt, never the data-file key).
// Pure logic is at the top and exported for `node hub.test.js`; the UI part only runs in the browser.
(function () {
  "use strict";
  const DAY = 86400000;
  const STALE_DAYS = 30;   // a knowledge item not re-checked for this long gets a warning
  const DRAFT_STAMP = "טיוטה – נדרש אישור לפני שימוש/פרסום";
  const SENSITIVE = "אין להזין מידע מסווג, מבצעי או רגיש";

  // ---------- schemas: one generic form/list drives every kind of item ----------
  const SCHEMAS = {
    tasks: { one: "משימה", fields: [
      { k: "title", label: "כותרת", req: true },
      { k: "description", label: "תיאור", type: "textarea", warn: true },
      { k: "dueAt", label: "מועד יעד", type: "datetime-local" },
      { k: "priority", label: "עדיפות", type: "select", options: ["נמוכה", "רגילה", "גבוהה"], def: "רגילה" },
      { k: "status", label: "סטטוס", type: "select", options: ["פתוחה", "בתהליך", "ממתינה", "הושלמה", "בוטלה"], def: "פתוחה" },
      { k: "category", label: "קטגוריה", type: "select", options: ["תוכן", "תיאום", "למידה", "מעקב", "אדמיניסטרציה"], def: "תוכן" },
      { k: "reminderAt", label: "תזכורת", type: "datetime-local", hint: "התזכורת מופיעה רק כשהאפליקציה פתוחה" },
    ] },
    contacts: { one: "איש קשר", fields: [
      { k: "displayName", label: "שם לתצוגה", req: true },
      { k: "roleLabel", label: "תפקיד / תחום", hint: "ללא פרטים מבצעיים" },
      { k: "organization", label: "ארגון", hint: "רשות, גוף, מערכת תקשורת וכו׳" },
      { k: "phone", label: "טלפון", type: "tel", hint: "רק אם מותר לשמור" },
      { k: "email", label: "דוא״ל", type: "email" },
      { k: "tags", label: "תגיות", hint: "מופרדות בפסיק: תקשורת, הפקה, רשות" },
      { k: "favorite", label: "מועדף", type: "checkbox" },
      { k: "notes", label: "הערות", type: "textarea", warn: true },
    ] },
    knowledge: { one: "פריט ידע", fields: [
      { k: "title", label: "כותרת", req: true },
      { k: "category", label: "קטגוריה", type: "select", options: ["היכרות עם פיקוד העורף", "מושגים מקצועיים", "מידע לציבור", "חומרי הסברה", "שאלות ותשובות", "קישורים רשמיים"], def: "מידע לציבור" },
      { k: "summary", label: "תקציר / תוכן", type: "textarea", warn: true },
      { k: "url", label: "קישור", type: "url" },
      { k: "sourceName", label: "מקור", req: true, hint: "שם הגוף שפרסם" },
      { k: "publishedAt", label: "תאריך פרסום", type: "date" },
      { k: "verifiedAt", label: "תאריך בדיקה אחרונה", type: "date", req: true },
      { k: "status", label: "סטטוס אימות", type: "select", options: ["טיוטה", "ממתין לאימות", "מאומת", "פג תוקף", "הוסר"], def: "ממתין לאימות" },
      { k: "tags", label: "תגיות" },
    ] },
    templates: { one: "תבנית", fields: [
      { k: "title", label: "שם התבנית", req: true },
      { k: "body", label: "נוסח", type: "textarea", hint: "שדות למילוי בסוגריים כפולים, למשל {{כותרת}}" },
    ] },
    media: { one: "פרסום", fields: [
      { k: "title", label: "כותרת", req: true },
      { k: "outlet", label: "גוף תקשורת" },
      { k: "url", label: "קישור", type: "url" },
      { k: "publishedAt", label: "תאריך", type: "date" },
      { k: "topic", label: "נושא" },
      { k: "summary", label: "תקציר / הערות", type: "textarea", warn: true },
      { k: "status", label: "סטטוס", type: "select", options: ["חדש", "בבדיקה", "הועבר לגורם מוסמך", "טופל", "נסגר"], def: "חדש" },
      { k: "tags", label: "תגיות" },
    ] },
    inquiries: { one: "פנייה", fields: [
      { k: "date", label: "תאריך", type: "date", req: true },
      { k: "topic", label: "נושא כללי", req: true },
      { k: "channel", label: "ערוץ", type: "select", options: ["טלפון", "דוא״ל", "הודעה", "פגישה", "אחר"], def: "טלפון" },
      { k: "status", label: "סטטוס טיפול", type: "select", options: ["חדש", "בבדיקה", "הועבר לגורם מוסמך", "טופל", "נסגר"], def: "חדש" },
      { k: "reminderAt", label: "תזכורת", type: "datetime-local" },
      { k: "notes", label: "הערות", type: "textarea", warn: true },
    ] },
    docs: { one: "טיוטה", fields: [
      { k: "title", label: "כותרת", req: true },
      { k: "body", label: "נוסח", type: "textarea", warn: true },
    ] },
  };

  // Built-in templates: structure only (no wording of our own), each stamped as a draft.
  const BUILTIN_TEMPLATES = [
    ["הודעה לתקשורת", ["כותרת", "פתיח", "גוף", "ציטוט מאושר (אם קיים)", "פרטי קשר מאושרים"]],
    ["פנייה לעיתונאי", ["נמען", "הקשר", "בקשה", "מועד תגובה"]],
    ["הודעת תיאום", ["מטרה", "מועד", "משתתפים", "מה נדרש"]],
    ["סיכום פעילות", ["מטרת הפעילות", "תיאור כללי שאושר", "תוצרים", "משימות המשך"]],
    ["דוח יומי אישי", ["משימות שבוצעו", "משימות פתוחות", "חסמים", "תוכנית למחר"]],
    ["שאלות ותשובות", ["שאלה", "תשובה מאושרת", "מקור", "תאריך אימות"]],
    ["כיתוב לתמונה / פוסט", ["מסר", "הקשר ציבורי", "קרדיט", "אישור פרסום"]],
    ["תסריט סרטון", ["פתיח", "מסרים", "רצף סצנות", "קריינות", "קרדיטים"]],
  ].map(([title, fields], i) => ({ id: "tpl" + (i + 1), title, builtIn: true,
    body: fields.map(f => `${f}:\n{{${f}}}`).join("\n\n") }));

  // Official links, each opened and checked on 2026-11-26 (the spec requires checking before showing).
  const CHECKED = "2026-11-26";
  const BUILTIN_KNOWLEDGE = [
    ["פיקוד העורף – פורטל החירום הלאומי", "https://www.oref.org.il/", "פיקוד העורף", "האתר הרשמי: הנחיות, התגוננות ומידע לציבור."],
    ["אפליקציית פיקוד העורף (Google Play)", "https://play.google.com/store/apps/details?id=com.ioref.meserhadashtv", "Google Play", "האפליקציה הרשמית להתרעות ולהנחיות."],
    ["אתר צה״ל", "https://www.idf.il/", "צה״ל", "האתר הרשמי של צה״ל."],
    ["טלגרם פיקוד העורף", "https://t.me/PikudHaOref_all", "פיקוד העורף", "הערוץ הרשמי בטלגרם."],
    ["Home Front Command (English) – טלגרם", "https://t.me/HomeFrontCommand", "פיקוד העורף", "הערוץ הרשמי באנגלית."],
    ["פיקוד העורף ב-X", "https://x.com/PikudHaOref", "פיקוד העורף", "החשבון הרשמי ב-X."],
    ["טלגרם צה״ל", "https://t.me/idf_telegram", "צה״ל", "הערוץ הרשמי של צה״ל בטלגרם."],
    ["פייסבוק – דובר צה״ל", "https://www.facebook.com/IDFspokeperson", "דובר צה״ל", "עמוד הפייסבוק הרשמי של דובר צה״ל."],
    ["אינסטגרם – דובר צה״ל, תא״ל אפי דפרין", "https://www.instagram.com/doveridf/", "Instagram", "החשבון האישי של דובר צה״ל."],
  ].map(([title, url, sourceName, summary], i) => ({ id: "kb" + (i + 1), builtIn: true, title, url, sourceName, summary,
    category: "קישורים רשמיים", status: "מאומת", verifiedAt: CHECKED }));

  // ---------- pure logic ----------
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const emptyStore = () => ({ v: 1, tasks: [], contacts: [], knowledge: [], templates: [], docs: [], media: [], inquiries: [], layout: null, backupAt: null });

  function upsert(list, item, now = Date.now()) {
    const it = { ...item, updatedAt: now, id: item.id || newId(), createdAt: item.createdAt || now };
    const i = list.findIndex(x => x.id === it.id);
    if (i >= 0) list[i] = it; else list.unshift(it);
    return it;
  }
  const remove = (list, id) => { const i = list.findIndex(x => x.id === id); if (i >= 0) list.splice(i, 1); return i >= 0; };

  /** "" when fine, otherwise the warning to show next to a knowledge item. */
  function knowledgeWarning(item, now = Date.now()) {
    if (item.status !== "מאומת") return item.status === "פג תוקף" || item.status === "הוסר" ? `${item.status} – לא להשתמש` : `${item.status || "לא מאומת"} – לא להציג כעדכני`;
    if (!item.verifiedAt) return "אין תאריך בדיקה";
    const days = Math.floor((now - Date.parse(item.verifiedAt)) / DAY);
    return days > STALE_DAYS ? `נבדק לפני ${days} ימים – לבדוק שוב לפני שימוש` : "";
  }

  const isOpen = t => t.status !== "הושלמה" && t.status !== "בוטלה";
  function taskBuckets(tasks, now = Date.now()) {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    const today = d.getTime(), tomorrow = today + DAY, week = today + 7 * DAY;
    const due = t => (t.dueAt ? Date.parse(t.dueAt) : NaN);
    return {
      overdue: tasks.filter(t => isOpen(t) && due(t) < now),
      today: tasks.filter(t => isOpen(t) && due(t) >= today && due(t) < tomorrow),
      week: tasks.filter(t => isOpen(t) && due(t) >= today && due(t) < week),
      open: tasks.filter(isOpen),
      urgent: tasks.filter(t => isOpen(t) && t.priority === "גבוהה"),
      doneToday: tasks.filter(t => t.status === "הושלמה" && t.updatedAt >= today),
    };
  }

  const fillTemplate = (body, values) => body.replace(/\{\{([^}]+)\}\}/g, (_, k) => (values[k.trim()] ?? "").trim());
  const templateFields = body => [...new Set([...body.matchAll(/\{\{([^}]+)\}\}/g)].map(m => m[1].trim()))];

  /** Global search: results grouped by kind, each with the text fields that matched. */
  function searchAll(store, q, articles = [], builtins = {}) {
    q = (q || "").trim().toLowerCase();
    if (!q) return {};
    const hit = (x, keys) => keys.some(k => String(x[k] ?? "").toLowerCase().includes(q));
    const groups = {
      contacts: store.contacts.filter(x => hit(x, ["displayName", "roleLabel", "organization", "tags", "notes", "email"])),
      knowledge: [...(builtins.knowledge || []), ...store.knowledge].filter(x => hit(x, ["title", "summary", "sourceName", "tags", "category"])),
      templates: [...(builtins.templates || []), ...store.templates].filter(x => hit(x, ["title", "body"])),
      docs: store.docs.filter(x => hit(x, ["title", "body"])),
      media: [...store.media, ...store.inquiries].filter(x => hit(x, ["title", "outlet", "topic", "summary", "tags", "notes"])),
      tasks: store.tasks.filter(x => hit(x, ["title", "description", "category"])),
      articles: articles.filter(x => hit(x, ["title", "source"])).slice(0, 30),
    };
    for (const k of Object.keys(groups)) if (!groups[k].length) delete groups[k];
    return groups;
  }

  /** Import a backup: items merge by id and the newer `updatedAt` wins, so nothing local is lost. */
  function mergeStores(base, incoming) {
    const out = { ...emptyStore(), ...base };
    for (const k of ["tasks", "contacts", "knowledge", "templates", "docs", "media", "inquiries"]) {
      const byId = new Map((base[k] || []).map(x => [x.id, x]));
      for (const x of incoming[k] || []) { const cur = byId.get(x.id); if (!cur || (x.updatedAt || 0) > (cur.updatedAt || 0)) byId.set(x.id, x); }
      out[k] = [...byId.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }
    return out;
  }

  const pure = { SCHEMAS, BUILTIN_TEMPLATES, BUILTIN_KNOWLEDGE, DRAFT_STAMP, emptyStore, upsert, remove, knowledgeWarning, taskBuckets,
    fillTemplate, templateFields, searchAll, mergeStores, isOpen };
  if (typeof module !== "undefined") { module.exports = pure; return; }

  // ======================================================================================
  // Browser part
  // ======================================================================================
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const ITERS = 300000;
  let store = null, hubKey = null, state = "locked";   // locked | open | mismatch
  const LS = k => KEY(k);   // per-system localStorage key from the app

  async function derive(pw, salt) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERS }, base, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  }
  const blob = () => { try { return JSON.parse(localStorage[LS("hub")] || "null"); } catch { return null; } };
  async function open(key, rec) {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(rec.iv) }, key, unb64(rec.ct));
    return { ...emptyStore(), ...JSON.parse(new TextDecoder().decode(pt)) };
  }
  async function seal(key, data, salt) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(data)));
    return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }
  function save() {
    if (state !== "open") return;
    store.updatedAt = Date.now();
    const rec = blob(), salt = rec ? unb64(rec.salt) : unb64(localStorage[LS("hubSalt")]);
    seal(hubKey, store, salt).then(r => { localStorage[LS("hub")] = JSON.stringify(r); }).catch(() => toast("השמירה נכשלה"));
  }

  /** Called by the app right after the HFC password was accepted. Never overwrites data that fails to open. */
  async function onPassword(pw, remember) {
    const rec = blob();
    if (!rec && !localStorage[LS("hubSalt")]) localStorage[LS("hubSalt")] = b64(crypto.getRandomValues(new Uint8Array(16)));
    const salt = rec ? unb64(rec.salt) : unb64(localStorage[LS("hubSalt")]);
    const key = await derive(pw, salt);
    if (rec) {
      try { store = await open(key, rec); } catch { state = "mismatch"; hubKey = key; render(); return; }   // password changed since
    } else store = emptyStore();
    hubKey = key; state = "open";
    if (remember) localStorage[LS("hubKey")] = b64(await crypto.subtle.exportKey("raw", key));
    if (!rec) save();
    navigator.storage?.persist?.();
    render();
  }
  async function restore() {
    const raw = localStorage[LS("hubKey")], rec = blob();
    if (!raw) return;
    try {
      hubKey = await crypto.subtle.importKey("raw", unb64(raw), "AES-GCM", true, ["encrypt", "decrypt"]);
      store = rec ? await open(hubKey, rec) : emptyStore(); state = "open"; navigator.storage?.persist?.();
    } catch { hubKey = null; state = "locked"; }
  }
  /** Re-key after a password change: open with the old password, save under the current one. */
  async function rekey(oldPw) {
    const rec = blob(), salt = unb64(rec.salt);
    const old = await derive(oldPw, salt);
    store = await open(old, rec);
    state = "open"; save();
    if (localStorage[LS("idfKey")]) localStorage[LS("hubKey")] = b64(await crypto.subtle.exportKey("raw", hubKey));
  }
  const logout = () => { localStorage.removeItem(LS("hubKey")); };

  // ---------- small UI helpers (el, $, toast, empty, fillHighlighted come from the app) ----------
  const fmtDate = v => v ? new Date(v).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit" }) : "";
  const fmtDT = v => v ? new Date(v).toLocaleString("he-IL", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const btn = (cls, text, on) => { const b = el("button", cls, text); b.onclick = e => { e.stopPropagation(); on(e); }; return b; };
  const link = (cls, text, href) => { const a = el("a", cls, text); a.href = href; if (/^https?:/.test(href)) { a.target = "_blank"; a.rel = "noopener"; } a.onclick = e => e.stopPropagation(); return a; };
  const section = (title, ...kids) => { const s = el("div", "hcard"); if (title) s.append(el("h3", null, title)); s.append(...kids); return s; };
  const hb = t => { const b = el("b"); fillHighlighted(b, t || ""); return b; };
  const knowledgeAll = () => [...BUILTIN_KNOWLEDGE, ...store.knowledge];
  const templatesAll = () => [...BUILTIN_TEMPLATES, ...store.templates];

  // generic add/edit sheet driven by SCHEMAS
  function openForm(kind, item = {}, after) {
    const S = SCHEMAS[kind], form = el("form", "hform"), sheet = $("hubSheet");
    form.append(el("h3", null, (item.id ? "עריכת " : "הוספת ") + S.one));
    const inputs = {};
    for (const f of S.fields) {
      const wrap = el("label", "hf" + (f.type === "checkbox" ? " chk" : ""));
      const lab = el("span", null, f.label + (f.req ? " *" : ""));
      let inp;
      if (f.type === "textarea") { inp = el("textarea"); inp.rows = kind === "templates" || kind === "docs" ? 8 : 3; }
      else if (f.type === "select") { inp = el("select"); f.options.forEach(o => inp.add(new Option(o, o))); }
      else { inp = el("input"); inp.type = f.type || "text"; }
      const v = item[f.k] ?? f.def ?? "";
      if (f.type === "checkbox") inp.checked = !!v; else inp.value = Array.isArray(v) ? v.join(", ") : v;
      if (f.req) inp.required = true;
      inputs[f.k] = inp;
      if (f.type === "checkbox") wrap.append(inp, lab); else wrap.append(lab, inp);
      if (f.hint || f.warn) wrap.append(el("small", f.warn ? "warnline" : null, f.warn ? "⚠️ " + SENSITIVE : f.hint));
      form.append(wrap);
    }
    const err = el("p", "err"), row = el("div", "btnrow");
    const ok = el("button", "primary", "שמירה"); ok.type = "submit";
    row.append(ok, btn("ghost", "ביטול", () => { sheet.hidden = true; }));
    if (item.id) row.append(btn("ghost danger", "מחיקה", () => { sheet.hidden = true; confirmDelete(kind, item); }));
    form.append(err, row);
    form.onsubmit = e => {
      e.preventDefault();
      const out = { ...item };
      for (const f of S.fields) out[f.k] = f.type === "checkbox" ? inputs[f.k].checked : inputs[f.k].value.trim();
      const missing = S.fields.find(f => f.req && !out[f.k]);
      if (missing) { err.textContent = `חסר: ${missing.label}`; return; }
      if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) { err.textContent = "כתובת הדוא״ל לא תקינה"; return; }
      if (out.url && !/^https?:\/\//.test(out.url)) { err.textContent = "קישור צריך להתחיל ב-https://"; return; }
      const saved = upsert(store[kind], out); save(); sheet.hidden = true; toast("נשמר ✓"); after?.(saved); render();
    };
    $("hubSheetBody").replaceChildren(form);
    sheet.hidden = false;
    setTimeout(() => form.querySelector("input, textarea")?.focus(), 60);
  }
  function confirmDelete(kind, item) {
    if (!confirm(`למחוק את "${item.title || item.displayName || item.topic}"? אי אפשר לשחזר.`)) return;
    remove(store[kind], item.id); save(); toast("נמחק"); render();
  }

  // ---------- rows ----------
  function taskRow(t) {
    const r = el("div", "hrow2 task" + (isOpen(t) ? "" : " done") + (t.priority === "גבוהה" && isOpen(t) ? " urgent" : ""));
    const box = el("input"); box.type = "checkbox"; box.checked = !isOpen(t); box.setAttribute("aria-label", "סימון כהושלמה");
    box.onclick = e => { e.stopPropagation(); upsert(store.tasks, { ...t, status: box.checked ? "הושלמה" : "פתוחה" }); save(); render(); };
    const body = el("div", "hbody");
    body.append(hb(t.title));
    const due = t.dueAt ? Date.parse(t.dueAt) : 0;
    const meta = [t.priority === "גבוהה" ? "🔴 דחוף" : "", due ? (due < Date.now() && isOpen(t) ? "⏰ באיחור · " : "📅 ") + fmtDT(t.dueAt) : "", t.category, t.status !== "פתוחה" ? t.status : ""].filter(Boolean).join(" · ");
    body.append(el("small", null, meta));
    r.append(box, body, btn("ibtn", "✎", () => openForm("tasks", t)));
    r.onclick = () => openForm("tasks", t);
    return r;
  }
  function contactRow(c) {
    const r = el("div", "hrow2");
    const av = el("span", "av", (c.displayName || "?").trim()[0]);
    const body = el("div", "hbody");
    body.append(hb((c.favorite ? "⭐ " : "") + c.displayName), el("small", null, [c.roleLabel, c.organization].filter(Boolean).join(" · ")));
    r.append(av, body);
    if (c.phone) r.append(link("ibtn", "📞", "tel:" + c.phone.replace(/[^\d+]/g, "")));
    if (c.email) r.append(link("ibtn", "✉️", "mailto:" + c.email));
    r.onclick = () => openForm("contacts", c);
    return r;
  }
  function knowledgeRow(k) {
    const r = el("div", "hrow2 kb");
    const body = el("div", "hbody");
    const warn = knowledgeWarning(k);
    body.append(hb(k.title));
    if (k.summary) body.append(el("p", "ksum", k.summary));
    const meta = el("small", "kmeta");
    meta.append(el("span", "kstat " + (warn ? "bad" : "ok"), warn ? "⚠️ " + warn : "✓ " + k.status),
      ` · מקור: ${k.sourceName || "לא צוין"} · נבדק: ${fmtDate(k.verifiedAt) || "—"}`);
    body.append(meta);
    r.append(el("span", "av kav", k.category === "קישורים רשמיים" ? "🔗" : k.category === "שאלות ותשובות" ? "❓" : "📘"), body);
    if (k.url) r.append(link("ibtn", "↗", k.url));
    r.onclick = () => k.builtIn ? (k.url && window.open(k.url, "_blank", "noopener")) : openForm("knowledge", k);
    return r;
  }
  function mediaRow(m, kind) {
    const r = el("div", "hrow2");
    const body = el("div", "hbody");
    body.append(hb(m.title || m.topic), el("small", null, [m.outlet || m.channel, fmtDate(m.publishedAt || m.date), m.status].filter(Boolean).join(" · ")));
    r.append(el("span", "av", kind === "inquiries" ? "☎️" : "📰"), body);
    if (m.url) r.append(link("ibtn", "↗", m.url));
    r.onclick = () => openForm(kind, m);
    return r;
  }

  // ---------- templates: fill fields, live preview with the draft stamp ----------
  function useTemplate(t, doc) {
    const fields = templateFields(t.body), values = doc?.values || {};
    const wrap = el("div", "hform"), sheet = $("hubSheet");
    wrap.append(el("h3", null, "📝 " + t.title), el("p", "stamp", DRAFT_STAMP));
    const inputs = {};
    for (const f of fields) {
      const l = el("label", "hf"), ta = el("textarea"); ta.rows = 2; ta.value = values[f] || "";
      ta.oninput = upd; inputs[f] = ta; l.append(el("span", null, f), ta); wrap.append(l);
    }
    wrap.append(el("small", "warnline", "⚠️ " + SENSITIVE));
    const prev = el("pre", "tprev");
    function text() { return `${DRAFT_STAMP}\n\n${t.title}\n\n` + fillTemplate(t.body, Object.fromEntries(fields.map(f => [f, inputs[f].value]))); }
    function upd() { prev.textContent = text(); }
    upd();
    const row = el("div", "btnrow");
    row.append(
      btn("primary", "העתקה", async () => { await navigator.clipboard.writeText(text()); toast("הועתק – זו טיוטה, נדרש אישור לפני שימוש"); }),
      btn("ghost", "שמירה כטיוטה", () => {
        const vals = Object.fromEntries(fields.map(f => [f, inputs[f].value]));
        upsert(store.docs, { ...(doc || {}), title: doc?.title || `${t.title} – ${fmtDate(Date.now())}`, templateId: t.id, values: vals, body: text() });
        save(); toast("הטיוטה נשמרה"); render();
      }),
      btn("ghost", "הדפסה / PDF", () => printText(t.title, text())));
    wrap.append(el("h4", null, "תצוגה מקדימה"), prev, row);
    $("hubSheetBody").replaceChildren(wrap); sheet.hidden = false;
  }
  function printText(title, text) {
    const w = window.open("", "_blank");
    if (!w) return toast("הדפדפן חסם חלון חדש");
    const esc = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    w.document.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>body{font:16px/1.7 Arial,sans-serif;margin:40px;color:#111}pre{white-space:pre-wrap;font:inherit}.st{border:2px solid #c2410c;color:#c2410c;display:inline-block;padding:4px 10px;border-radius:6px;font-weight:700}</style>
      </head><body><div class="st">${esc(DRAFT_STAMP)}</div><pre>${esc(text.replace(DRAFT_STAMP + "\n\n", ""))}</pre></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  }

  // ---------- panels ----------
  const PANELS = { home: "בית", search: "חיפוש", tasks: "משימות", knowledge: "ידע", more: "עוד", contacts: "אנשי קשר", templates: "תבניות", emergency: "מצב חירום", mediahub: "פרסומים ופניות" };
  const MEDIA = ["news", "tg", "trends", "saved", "social", "mediahub"];
  const navFor = name => ["home", "search", "tasks", "knowledge"].includes(name) ? name : "more";
  let current = "home", taskView = "today", kbCat = "", searchQ = "", searchType = "";

  function lockedView() {
    const f = el("form", "hcard hlock");
    if (state === "mismatch") {
      f.append(el("h3", null, "🔑 המידע האישי נעול בסיסמה הקודמת"),
        el("p", null, "נראה שהסיסמה של המערכת הוחלפה. כדי לפתוח את המשימות, אנשי הקשר והטיוטות, הקלידי את הסיסמה הקודמת. המידע לא נמחק."));
    } else {
      f.append(el("h3", null, "🔒 המידע האישי נעול"), el("p", null, "כדי לפתוח את המשימות, אנשי הקשר והטיוטות, הקלידי שוב את הסיסמה של מערכת פיקוד העורף."));
    }
    const pw = el("input"); pw.type = "password"; pw.placeholder = "סיסמה"; pw.autocomplete = "current-password";
    const err = el("p", "err"), ok = el("button", "primary", "פתיחה"); ok.type = "submit";
    f.append(pw, ok, err);
    f.onsubmit = async e => {
      e.preventDefault(); ok.disabled = true; err.textContent = "";
      try {
        if (state === "mismatch") { await rekey(pw.value); toast("המידע נפתח ועבר לסיסמה החדשה ✓"); render(); }
        else if (await window.verifyAppPassword(pw.value)) await onPassword(pw.value, !!localStorage[KEY("idfKey")]);
        else err.textContent = "הסיסמה לא נכונה";
      } catch { err.textContent = "הסיסמה לא נכונה"; }
      ok.disabled = false;
    };
    return f;
  }

  function homePanel() {
    const out = [];
    const tb = taskBuckets(store.tasks);
    const stats = el("div", "hstats");
    [["⏰", tb.overdue.length, "באיחור", "bad"], ["📅", tb.today.length, "להיום", ""], ["🔴", tb.urgent.length, "דחופות", ""], ["✅", tb.doneToday.length, "הושלמו היום", "ok"]]
      .forEach(([em, n, l, c]) => { const s = el("button", "hstat " + c); s.append(el("span", null, em), el("b", null, n), el("small", null, l)); s.onclick = () => { taskView = l === "באיחור" ? "overdue" : l === "הושלמו היום" ? "done" : "today"; go("tasks"); }; stats.append(s); });
    const cards = {
      tasks: section("✅ משימות להיום", stats, ...[...tb.overdue, ...tb.today.filter(t => !tb.overdue.includes(t))].slice(0, 5).map(taskRow),
        ...(tb.overdue.length + tb.today.length ? [] : [el("p", "muted", "אין משימות להיום 🎉")]), btn("textbtn", "+ משימה חדשה", () => openForm("tasks", { dueAt: todayAt(17) }))),
      upcoming: section("📆 בשבוע הקרוב", ...(tb.week.length ? tb.week.slice(0, 5).map(taskRow) : [el("p", "muted", "אין מועדים בשבוע הקרוב")])),
      shortcuts: section("⚡ קיצורי דרך", (() => {
        const g = el("div", "hquick");
        const fav = store.contacts.find(c => c.favorite && c.phone);
        g.append(btn("hq", "➕ משימה", () => openForm("tasks", { dueAt: todayAt(17) })), btn("hq", "📝 תבנית חדשה", () => go("templates")),
          btn("hq", "🔍 חיפוש", () => go("search")), btn("hq", "👥 איש קשר", () => openForm("contacts")), btn("hq red", "🆘 מצב חירום", () => go("emergency")));
        if (fav) g.prepend(link("hq", `📞 ${fav.displayName}`, "tel:" + fav.phone.replace(/[^\d+]/g, "")));
        return g;
      })()),
      media: section("📡 עדכונים מהתקשורת", ...mediaPreview(), btn("textbtn", "למרכז התקשורת ←", () => go("news"))),
      review: section("🔎 לבדיקה", ...(() => {
        const bad = knowledgeAll().filter(k => knowledgeWarning(k));
        return bad.length ? [el("p", null, `${bad.length} פריטי ידע לא מאומתים או ישנים`), btn("textbtn", "לפריטים ←", () => { kbCat = "__bad"; go("knowledge"); })] : [el("p", "muted", "כל פריטי הידע מאומתים ✓")];
      })()),
      saved: section("⭐ נשמר לאחרונה", ...(() => {
        const recent = [...Object.values(typeof saved !== "undefined" ? saved : {}).map(m => ({ title: m.title, outlet: m.source, url: m.link, ts: (m.ts || 0) * 1000 })), ...store.media.map(m => ({ ...m, ts: m.updatedAt }))]
          .sort((a, b) => b.ts - a.ts).slice(0, 3);
        return recent.length ? recent.map(m => mediaRow(m, "media")) : [el("p", "muted", "עוד לא נשמר כלום")];
      })()),
    };
    const order = store.layout && store.layout.length ? store.layout.filter(k => cards[k]) : Object.keys(cards);
    Object.keys(cards).forEach(k => { if (!order.includes(k)) order.push(k); });
    out.push(syncBar());
    order.forEach((k, i) => {
      const c = cards[k];
      if (editLayout) {
        const ctl = el("div", "lay");
        ctl.append(btn("ibtn", "▲", () => moveCard(order, i, -1)), btn("ibtn", "▼", () => moveCard(order, i, 1)));
        c.prepend(ctl);
      }
      out.push(c);
    });
    out.push(btn("textbtn center", editLayout ? "✓ סיום סידור" : "⇅ סידור הכרטיסים", () => { editLayout = !editLayout; render(); }));
    return out;
  }
  let editLayout = false;
  function moveCard(order, i, d) {
    const j = i + d; if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]]; store.layout = order; save(); render();
  }
  function todayAt(h) { const d = new Date(); d.setHours(h, 0, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  function mediaPreview() {
    const items = (typeof data !== "undefined" ? data.items : []).filter(m => m.hit && m.kind !== "telegram").slice(0, 3);
    if (!items.length) return [el("p", "muted", "אין כרגע כתבות חדשות")];
    return items.map(m => { const r = el("div", "hrow2"); const b = el("div", "hbody"); b.append(el("b", null, m.title), el("small", null, `${m.source} · ${ago(m.ts)}`)); r.append(el("span", "av", "📰"), b); r.onclick = () => window.open(m.link, "_blank", "noopener"); return r; });
  }
  function syncBar() {
    const s = el("div", "hsync");
    const iosTab = /iPhone|iPad/.test(navigator.userAgent) && !(matchMedia("(display-mode: standalone)").matches || navigator.standalone);
    s.append(el("span", null, navigator.onLine ? "🟢 מחובר" : "🔴 לא מחובר – מוצג המידע שנשמר במכשיר"),
      el("span", null, `💾 נשמר במכשיר הזה בלבד · גיבוי אחרון: ${store.backupAt ? fmtDate(store.backupAt) : "עוד לא"}`));
    if (iosTab) s.append(el("span", "bad", "⚠️ באייפון, מידע של אתר שלא הותקן למסך הבית עלול להימחק. מומלץ להוסיף למסך הבית ולגבות."));
    return s;
  }

  function tasksPanel() {
    const tb = taskBuckets(store.tasks);
    const views = { today: ["היום", [...tb.overdue, ...tb.today.filter(t => !tb.overdue.includes(t))]], week: ["השבוע", tb.week], month: ["החודש", null], all: ["כל הפתוחות", tb.open], overdue: ["באיחור", tb.overdue], done: ["הושלמו", store.tasks.filter(t => !isOpen(t))] };
    const segc = el("div", "seg hseg");
    Object.entries(views).forEach(([k, [l]]) => { const b = el("button", null, l); b.setAttribute("aria-pressed", taskView === k); b.onclick = () => { taskView = k; render(); }; segc.append(b); });
    const list = taskView === "month" ? [monthGrid()] : (views[taskView][1].length ? views[taskView][1].map(taskRow) : empty("✅", "אין משימות כאן", ""));
    return [btn("primary addbtn", "+ משימה חדשה", () => openForm("tasks", { dueAt: todayAt(17) })), segc, ...list];
  }
  let monthOffset = 0, pickedDay = null;
  function monthGrid() {
    const now = new Date(), first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const wrap = el("div", "hcard"), head = el("div", "mhead");
    head.append(btn("ibtn", "›", () => { monthOffset--; render(); }), el("b", null, first.toLocaleDateString("he-IL", { month: "long", year: "numeric" })), btn("ibtn", "‹", () => { monthOffset++; render(); }));
    const grid = el("div", "mgrid");
    "אבגדהוש".split("").forEach(d => grid.append(el("span", "mdow", d + "׳")));
    for (let i = 0; i < first.getDay(); i++) grid.append(el("span"));
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const day = new Date(first.getFullYear(), first.getMonth(), d), key = day.toDateString();
      const n = store.tasks.filter(t => t.dueAt && new Date(t.dueAt).toDateString() === key && isOpen(t)).length;
      const c = el("button", "mday" + (key === new Date().toDateString() ? " today" : "") + (pickedDay === key ? " picked" : ""), d);
      if (n) c.append(el("i", null, n));
      c.onclick = () => { pickedDay = pickedDay === key ? null : key; render(); };
      grid.append(c);
    }
    wrap.append(head, grid);
    if (pickedDay) {
      const list = store.tasks.filter(t => t.dueAt && new Date(t.dueAt).toDateString() === pickedDay);
      wrap.append(el("h4", null, new Date(pickedDay).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })), ...(list.length ? list.map(taskRow) : [el("p", "muted", "אין משימות ביום הזה")]));
    }
    return wrap;
  }

  function contactsPanel() {
    const q = el("input", "hsearch"); q.type = "search"; q.placeholder = "חיפוש לפי שם, ארגון או תגית"; q.value = contactQ;
    q.oninput = () => { contactQ = q.value; renderList(); };
    const list = el("div");
    function renderList() {
      const s = contactQ.trim().toLowerCase();
      const items = store.contacts.filter(c => !s || [c.displayName, c.organization, c.roleLabel, c.tags].join(" ").toLowerCase().includes(s))
        .sort((a, b) => (b.favorite - a.favorite) || a.displayName.localeCompare(b.displayName, "he"));
      list.replaceChildren(...(items.length ? items.map(contactRow) : empty("👥", store.contacts.length ? "לא נמצאו אנשי קשר" : "עוד אין אנשי קשר", "שמרי רק פרטים שמותר לשמור.")));
    }
    renderList();
    return [btn("primary addbtn", "+ איש קשר", () => openForm("contacts")), q, list];
  }
  let contactQ = "";

  function knowledgePanel() {
    const cats = ["", ...SCHEMAS.knowledge.fields[1].options, "__bad"];
    const chips = el("div", "chips");
    cats.forEach(c => { const b = el("button", "chip", c === "" ? "הכל" : c === "__bad" ? "⚠️ לבדיקה" : c); b.setAttribute("aria-pressed", kbCat === c); b.onclick = () => { kbCat = c; render(); }; chips.append(b); });
    const items = knowledgeAll().filter(k => !kbCat || (kbCat === "__bad" ? knowledgeWarning(k) : k.category === kbCat));
    return [btn("primary addbtn", "+ פריט ידע", () => openForm("knowledge", { verifiedAt: new Date().toISOString().slice(0, 10) })),
      el("p", "note", "כל פריט מציג מקור, תאריך בדיקה וסטטוס. הנחיות לציבור – רק מהמקור הרשמי, לא כטקסט קבוע."), chips,
      ...(items.length ? items.map(knowledgeRow) : empty("📚", "אין פריטים כאן", ""))];
  }

  function templatesPanel() {
    const rows = templatesAll().map(t => {
      const r = el("div", "hrow2"); const b = el("div", "hbody");
      b.append(el("b", null, t.title), el("small", null, (t.builtIn ? "תבנית מובנית · " : "תבנית שלי · ") + templateFields(t.body).length + " שדות"));
      r.append(el("span", "av", "📝"), b);
      if (!t.builtIn) r.append(btn("ibtn", "✎", () => openForm("templates", t)), btn("ibtn", "🗑", () => confirmDelete("templates", t)));
      r.onclick = () => useTemplate(t); return r;
    });
    const docs = store.docs.map(d => {
      const r = el("div", "hrow2"); const b = el("div", "hbody");
      b.append(el("b", null, d.title), el("small", null, "טיוטה · עודכנה " + fmtDate(d.updatedAt)));
      r.append(el("span", "av", "📄"), b,
        btn("ibtn", "⧉", () => { upsert(store.docs, { ...d, id: null, title: d.title + " (עותק)" }); save(); render(); }),
        btn("ibtn", "🗑", () => confirmDelete("docs", d)));
      const t = templatesAll().find(x => x.id === d.templateId);
      r.onclick = () => t ? useTemplate(t, d) : openForm("docs", d); return r;
    });
    return [el("p", "stamp", DRAFT_STAMP), el("h3", "hsec", "תבניות"), ...rows,
      btn("textbtn", "+ תבנית משלי", () => openForm("templates", { body: "כותרת:\n{{כותרת}}\n\nגוף:\n{{גוף}}" })),
      el("h3", "hsec", "הטיוטות שלי"), ...(docs.length ? docs : [el("p", "muted", "עוד אין טיוטות")])];
  }

  function emergencyPanel() {
    const kb = knowledgeAll();
    const ok = k => !knowledgeWarning(k);
    const links = kb.filter(k => k.category === "קישורים רשמיים" && ok(k));
    const qa = kb.filter(k => k.category === "שאלות ותשובות" && ok(k));
    const mat = kb.filter(k => k.category === "חומרי הסברה" && ok(k));
    const favs = store.contacts.filter(c => c.favorite);
    const urgent = taskBuckets(store.tasks).urgent;
    const big = el("div", "egrid");
    links.slice(0, 6).forEach(k => big.append(link("ebtn", "🔗 " + k.title, k.url)));
    return [
      el("div", "ehead", "🆘 מצב חירום – גישה מהירה למקורות ולכלים מאושרים"),
      el("p", "note", "אין כאן התרעות בזמן אמת. למידע עדכני – רק מהמקורות הרשמיים. עודכן לאחרונה: " + fmtDT(store.updatedAt || Date.now())),
      section("מקורות רשמיים", big),
      section("שאלות ותשובות מאומתות", ...(qa.length ? qa.map(knowledgeRow) : [el("p", "muted", "אין עדיין שאלות ותשובות מאומתות. אפשר להוסיף במרכז הידע.")])),
      section("חומרי הסברה מאושרים", ...(mat.length ? mat.map(knowledgeRow) : [el("p", "muted", "אין עדיין חומרי הסברה מאומתים.")])),
      section("תבניות (טיוטה)", ...BUILTIN_TEMPLATES.slice(0, 4).map(t => btn("hq", "📝 " + t.title, () => useTemplate(t)))),
      section("אנשי קשר מועדפים", ...(favs.length ? favs.map(contactRow) : [el("p", "muted", "סמני אנשי קשר כמועדפים כדי שיופיעו כאן.")])),
      section("משימות דחופות", ...(urgent.length ? urgent.map(taskRow) : [el("p", "muted", "אין משימות דחופות")])),
    ];
  }

  function searchPanel() {
    const q = el("input", "hsearch big"); q.type = "search"; q.placeholder = "חיפוש בכל המערכת: אנשי קשר, ידע, תבניות, משימות, כתבות"; q.value = searchQ;
    const res = el("div");
    const NAMES = { contacts: "👥 אנשי קשר", knowledge: "📚 ידע", templates: "📝 תבניות", docs: "📄 טיוטות", media: "📰 פרסומים ופניות", tasks: "✅ משימות", articles: "📡 כתבות מהניטור" };
    function draw() {
      const groups = searchAll(store, searchQ, typeof data !== "undefined" ? data.items : [], { knowledge: BUILTIN_KNOWLEDGE, templates: BUILTIN_TEMPLATES });
      hl = searchQ.trim();   // highlight matches in the rows built below
      if (!searchQ.trim()) { res.replaceChildren(...empty("🔍", "מה מחפשים?", "חיפוש לפי שם, כותרת, תגית, תוכן או מקור.")); return; }
      const chips = el("div", "chips");
      [["", "הכל"], ...Object.keys(groups).map(k => [k, `${NAMES[k]} ${groups[k].length}`])].forEach(([k, l]) => {
        const b = el("button", "chip", l); b.setAttribute("aria-pressed", searchType === k); b.onclick = () => { searchType = k; draw(); }; chips.append(b);
      });
      const out = [chips];
      for (const [k, items] of Object.entries(groups)) {
        if (searchType && searchType !== k) continue;
        out.push(el("h3", "hsec", NAMES[k]));
        items.slice(0, 20).forEach(x => out.push(
          k === "contacts" ? contactRow(x) : k === "knowledge" ? knowledgeRow(x) : k === "tasks" ? taskRow(x) :
          k === "articles" ? (() => { const r = el("div", "hrow2"); const b = el("div", "hbody"); const t = el("b"); fillHighlighted(t, x.title); b.append(t, el("small", null, `${x.source} · ${ago(x.ts)}`)); r.append(el("span", "av", "📡"), b); r.onclick = () => window.open(x.link, "_blank", "noopener"); return r; })() :
          k === "media" ? mediaRow(x, x.topic && !x.title ? "inquiries" : "media") :
          (() => { const r = el("div", "hrow2"); const b = el("div", "hbody"); const t = el("b"); fillHighlighted(t, x.title); b.append(t); r.append(el("span", "av", "📝"), b); r.onclick = () => k === "docs" ? openForm("docs", x) : useTemplate(x); return r; })()));
      }
      if (!Object.keys(groups).length) out.push(...empty("🤷", "לא נמצא כלום", "אפשר לנסות מילה אחרת, או ליצור פריט חדש:"),
        (() => { const g = el("div", "hquick"); g.append(btn("hq", "+ משימה", () => openForm("tasks", { title: searchQ })), btn("hq", "+ איש קשר", () => openForm("contacts", { displayName: searchQ })), btn("hq", "+ פריט ידע", () => openForm("knowledge", { title: searchQ, verifiedAt: new Date().toISOString().slice(0, 10) }))); return g; })());
      res.replaceChildren(...out);
      hl = "";
    }
    q.oninput = () => { searchQ = q.value; searchType = ""; draw(); };
    draw();
    setTimeout(() => q.focus(), 80);
    return [q, res];
  }

  function mediahubPanel() {
    return [el("p", "note", "תיעוד ידני של פרסומים ופניות תקשורתיות. בלי פרטי אירוע או מידע שאינו פומבי."),
      btn("primary addbtn", "+ פרסום", () => openForm("media", { publishedAt: new Date().toISOString().slice(0, 10) })),
      el("h3", "hsec", "📰 פרסומים"), ...(store.media.length ? store.media.map(m => mediaRow(m, "media")) : [el("p", "muted", "עוד אין פרסומים")]),
      btn("primary addbtn", "+ פנייה", () => openForm("inquiries", { date: new Date().toISOString().slice(0, 10) })),
      el("h3", "hsec", "☎️ פניות"), ...(store.inquiries.length ? store.inquiries.map(m => mediaRow(m, "inquiries")) : [el("p", "muted", "עוד אין פניות")])];
  }

  function morePanel() {
    const tile = (em, t, s, on) => { const b = btn("tile", "", on); b.append(el("span", "em", em), el("b", null, t), el("small", null, s)); return b; };
    const g = el("div", "tiles");
    g.append(
      tile("📡", "מרכז תקשורת", "כתבות, טלגרם, מגמות", () => go("news")),
      tile("🗂️", "פרסומים ופניות", "תיעוד ידני", () => go("mediahub")),
      tile("👥", "אנשי קשר", `${store.contacts.length} אנשי קשר`, () => go("contacts")),
      tile("📝", "תבניות", "טיוטות מוכנות", () => go("templates")),
      tile("🆘", "מצב חירום", "גישה מהירה", () => go("emergency")),
      tile("⚙️", "הגדרות", "תצוגה, התראות, יציאה", () => { $("settingsBtn").click(); }));
    const backup = section("💾 גיבוי ושחזור",
      el("p", "muted", "המידע האישי שמור רק במכשיר הזה. גיבוי יוצר קובץ מוצפן; לשחזור צריך את הסיסמה."),
      (() => { const r = el("div", "btnrow"); r.append(btn("ghost", "⬇️ ייצוא גיבוי", exportBackup), btn("ghost", "⬆️ ייבוא גיבוי", importBackup)); return r; })());
    const notice = section("🛡️ שימוש בטוח", el("p", null, "האפליקציה מיועדת למידע ציבורי או למידע שאושר במפורש לשימוש בה. אין להזין מידע מסווג, מבצעי, פרטי פריסה או מידע אישי רגיש. היא אינה מחליפה את המערכות הרשמיות ואינה מאושרת לשימוש במידע צבאי פנימי."),
      el("p", "muted", "עם \"זכרי אותי\", מפתח ההצפנה נשמר במכשיר: ההצפנה מגינה מפני מי שאין לו את המכשיר, לא מפני מי שמחזיק אותו פתוח."));
    const alertsToggle = section("🚨 היסטוריית התרעות",
      el("p", "muted", "מקור לא רשמי (אפליקציית צופר). לפי האפיון, כבוי כברירת מחדל ולא מוצג במצב חירום."),
      (() => { const s = el("button", "switch"); s.setAttribute("role", "switch"); s.setAttribute("aria-checked", localStorage[LS("showAlerts")] === "1"); s.setAttribute("aria-label", "הצגת היסטוריית התרעות");
        s.onclick = () => { localStorage[LS("showAlerts")] = localStorage[LS("showAlerts")] === "1" ? "0" : "1"; s.setAttribute("aria-checked", localStorage[LS("showAlerts")] === "1"); renderNews(); }; return s; })());
    return [g, backup, alertsToggle, notice];
  }

  async function exportBackup() {
    const rec = blob(); if (!rec) return toast("אין עדיין מה לגבות");
    store.backupAt = Date.now(); save();
    await new Promise(r => setTimeout(r, 200));
    const a = el("a"); a.href = URL.createObjectURL(new Blob([localStorage[LS("hub")]], { type: "application/json" }));
    a.download = `hfc-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    toast("הגיבוי המוצפן ירד למכשיר ✓");
  }
  function importBackup() {
    const inp = el("input"); inp.type = "file"; inp.accept = "application/json,.json";
    inp.onchange = async () => {
      try {
        const rec = JSON.parse(await inp.files[0].text());
        let incoming;
        try { incoming = await open(hubKey, rec); }   // same password + same salt
        catch {
          const pw = prompt("הגיבוי נוצר עם סיסמה אחרת או במכשיר אחר. הקלידי את הסיסמה שהייתה בשימוש אז:");
          if (!pw) return;
          incoming = await open(await derive(pw, unb64(rec.salt)), rec);
        }
        store = mergeStores(store, incoming); save(); toast("הגיבוי שוחזר ומוזג ✓"); render();
      } catch { toast("לא הצלחתי לפתוח את הגיבוי (סיסמה שגויה או קובץ לא תקין)"); }
    };
    inp.click();
  }

  // reminders: discreet, only while the app is open
  setInterval(() => {
    if (state !== "open") return;
    const due = [...store.tasks, ...store.inquiries].filter(t => t.reminderAt && !t.reminded && Date.parse(t.reminderAt) <= Date.now());
    if (!due.length) return;
    due.forEach(t => { t.reminded = true; }); save();
    toast("⏰ יש לך תזכורת", 5000);
    if ("Notification" in window && Notification.permission === "granted") {
      navigator.serviceWorker?.getRegistration().then(r => r ? r.showNotification("יש לך תזכורת", { icon: "icon-192.png", tag: "hub-reminder" }) : new Notification("יש לך תזכורת"));
    }
    render();
  }, 30000);

  // ---------- mounting ----------
  const go = name => { location.hash = name; };
  function render() {
    if (!$("tab-home")) return;
    for (const p of ["home", "search", "tasks", "knowledge", "more", "contacts", "templates", "emergency", "mediahub"]) {
      const sec = $("tab-" + p);
      if (sec.hidden && p !== current) continue;
      sec.replaceChildren(...(state !== "open" ? [lockedView()] : {
        home: homePanel, search: searchPanel, tasks: tasksPanel, knowledge: knowledgePanel, more: morePanel,
        contacts: contactsPanel, templates: templatesPanel, emergency: emergencyPanel, mediahub: mediahubPanel }[p]()));
    }
  }
  function onTab(name) {
    current = name;
    $("mediaNav").hidden = !MEDIA.includes(name);
    $("mediaNav").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.t === name));
    render();
  }
  async function init() {
    const main = document.querySelector("main");
    // the media sub-navigation (the existing monitoring) and the hub panels
    const mn = el("div", "chips medianav"); mn.id = "mediaNav"; mn.hidden = true;
    [["news", "📰 כתבות"], ["tg", "✈️ טלגרם"], ["trends", "📈 מגמות"], ["saved", "⭐ שמורים"], ["social", "📱 רשתות"], ["mediahub", "🗂️ פרסומים ופניות"]]
      .forEach(([t, l]) => { const b = el("button", "chip", l); b.dataset.t = t; b.onclick = () => go(t); mn.append(b); });
    main.prepend(mn);
    for (const [id, name] of Object.entries(PANELS)) {
      const s = el("section"); s.id = "tab-" + id; s.setAttribute("role", "tabpanel"); s.setAttribute("aria-label", name); s.hidden = true; s.className = "hubpanel";
      main.append(s);
    }
    // a generic sheet for forms and templates
    const sh = el("div"); sh.id = "hubSheet"; sh.hidden = true;
    const scrim = el("div", "scrim"); scrim.onclick = () => { sh.hidden = true; };
    const sheet = el("div", "sheet"); sheet.setAttribute("role", "dialog");
    const body = el("div"); body.id = "hubSheetBody";
    sheet.append(el("div", "grab"), body); sh.append(scrim, sheet); document.body.append(sh);
    // HFC bottom navigation per the spec: home, search, tasks, knowledge, more
    const nav = document.querySelector(".nav-in");
    nav.querySelectorAll("button").forEach(b => b.classList.add("idf-only"));
    [["home", "🏠", "בית"], ["search", "🔍", "חיפוש"], ["tasks", "✅", "משימות"], ["knowledge", "📚", "ידע"], ["more", "☰", "עוד"]].forEach(([t, ic, l]) => {
      const b = el("button"); b.setAttribute("role", "tab"); b.dataset.tab = t;
      b.append(el("span", "ico", ic), el("span", null, l)); b.onclick = () => go(t); nav.append(b);
    });
    addEventListener("keydown", e => { if (e.key === "Escape") sh.hidden = true; });
    await restore();
    render();
  }

  window.Hub = { init, onTab, navFor, onPassword, logout, render, isLocked: () => state !== "open", ...pure };
})();
