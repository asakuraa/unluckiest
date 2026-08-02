// =========================================================================
// Gacha Luck Tracker — app.js v3
// + Character Database (เพิ่มตัวละครก่อน pull)
// + Breaker factor (+10 default)
// + Low performance factor (0.5 default)
// + Meta bonus → 20 default
// + scoreSnapshot (คะแนนไม่เปลี่ยนตาม settings หลังบันทึก)
// =========================================================================

const CATEGORIES = [
  { key: "limitEndMid",  label: "Limit end / mid" },
  { key: "limitElement", label: "Limit element" },
  { key: "collab",       label: "Collab" },
  { key: "alpha",        label: "Alpha" },
  { key: "otherLimit",   label: "Other limit" },
];

function getBannerRates(b) {
  if (!b) return [];
  if (Array.isArray(b.rates) && b.rates.length) return b.rates;
  if (b.collabRate !== undefined) return [{ category: "collab", rate: Number(b.collabRate) }];
  return [];
}

function bannerRatesSummary(b) {
  return getBannerRates(b)
    .filter(r => Number(r.rate) > 0)
    .map(r => {
      const label = CATEGORIES.find(c => c.key === r.category)?.label || r.category;
      return `${r.rate}% ${label}`;
    })
    .join(" + ") || "—";
}

const DEFAULT_SETTINGS = {
  baseScores:   { limitEndMid: 15, limitElement: 15, collab: 10, alpha: 10, otherLimit: 10 },
  dupWeights:   [1, 0.6, 0.3, 0],
  metaBonus:    20,
  breakerBonus: 10,
  lowPerformanceMultiplier: 0.5,
  monthlyPoint: 5,
  stages:       {},
};

let state = {
  settings:   JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
  banners:    {},
  characters: {},
  players:    {},
  rollLog:    {},
  pullLog:    {},
  orbLog:     {},
  auditLog:   {},
};

let mode = "local";
let db   = null;

// -------------------------------------------------------------------------
// Auth
// -------------------------------------------------------------------------
let sitePassword = null;
let authPlayerName = sessionStorage.getItem("glPlayer") || "";
let authSetupPlayer = null;
let authNewMode = false;
let authRequireOldPassword = false;
const pageSize = 10;
const ORB_WEIGHT = 0.3;
const listPages = { banners: 1, stages: 1, rolls: 1, pulls: 1, characters: 1, audit: 1, orbs: 1 };
const tableSorts = {
  dashboard: { key: "player", dir: "asc" },
  orbs:      { key: "ts", dir: "desc" },
  rolls:     { key: "ts", dir: "desc" },
  pulls:     { key: "ts", dir: "desc" },
  audit:     { key: "ts", dir: "desc" },
  characters:{ key: "runtime", dir: "desc" },
  stages:    { key: "runtime", dir: "desc" },
};
const dashboardFilters = {
  includeOrbs: sessionStorage.getItem("glDashIncludeOrbs") !== "0",
  bannerIds: (() => {
    const raw = sessionStorage.getItem("glDashBannerIds");
    if (raw) {
      try { return (JSON.parse(raw) || []).map(String).filter(Boolean); } catch {}
    }
    const legacy = sessionStorage.getItem("glDashBannerId") || "";
    return legacy ? [legacy] : [];
  })(),
};

function checkSession() { return sessionStorage.getItem("glAuthed") === "1"; }
function resolveAuth(pw) {
  sitePassword = (pw && String(pw).trim()) || "1234";
  if (checkSession()) hideAuthOverlay();
}
async function passwordHash(password) {
  const data = new TextEncoder().encode(String(password));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function findPlayerByName(name) {
  const wanted = String(name || "").trim().toLocaleLowerCase();
  return Object.entries(state.players).find(([, p]) =>
    p && String(p.name || "").trim().toLocaleLowerCase() === wanted
  ) || null;
}
function savePlayerPassword(name, hash) {
  const found = findPlayerByName(name);
  if (!found) return Promise.reject(new Error("Player not found"));
  const [id, player] = found;
  const updated = { ...player, passwordHash: hash };
  if (mode === "firebase") {
    const result = db.ref("players/" + id).set(updated);
    recordAudit("password", "player", id, player.name);
    return result;
  }
  state.players[id] = updated;
  saveLocal();
  recordAudit("password", "player", id, player.name);
  render();
  return Promise.resolve();
}
function completeAuth(name) {
  authPlayerName = name || "";
  sessionStorage.setItem("glPlayer", authPlayerName);
  sessionStorage.setItem("glAuthed", "1");
  hideAuthOverlay();
  renderPlayerSelects();
}
function showPasswordSetup(name, optional = false, requireOld = false) {
  authSetupPlayer = name;
  authRequireOldPassword = requireOld;
  document.getElementById("authOverlay").hidden = false;
  document.getElementById("authForm").hidden = true;
  document.getElementById("createUserForm").hidden = true;
  document.getElementById("showCreateUserBtn").hidden = true;
  document.getElementById("passwordSetupForm").hidden = false;
  document.getElementById("passwordSetupText").textContent = optional
    ? `ตั้งรหัสผ่านส่วนตัวสำหรับ ${name} หรือใช้งานต่อด้วยรหัสผ่านระบบก็ได้`
    : requireOld ? `กรุณาใส่รหัสผ่านเดิมก่อนตั้งรหัสผ่านใหม่` : `ตั้งรหัสผ่านส่วนตัวสำหรับ ${name}`;
  document.getElementById("oldPasswordInput").hidden = !requireOld;
  document.getElementById("oldPasswordInput").required = requireOld;
  document.getElementById("newPasswordInput").hidden = requireOld;
  document.getElementById("newPasswordInput").required = !requireOld;
  document.getElementById("newPasswordConfirmInput").hidden = requireOld;
  document.getElementById("newPasswordConfirmInput").required = !requireOld;
  const passwordSubmit = document.querySelector('#passwordSetupForm button[type="submit"]');
  passwordSubmit.hidden = false;
  passwordSubmit.textContent = requireOld ? "ตรวจสอบรหัสผ่านเดิม" : "บันทึกรหัสผ่าน";
  document.getElementById("skipPasswordSetupBtn").hidden = requireOld;
  document.getElementById(requireOld ? "oldPasswordInput" : "newPasswordInput").focus();
}
function closeAuthOverlay() {
  document.getElementById("passwordSetupForm").hidden = true;
  document.getElementById("authForm").hidden = false;
  document.getElementById("createUserForm").hidden = true;
  document.getElementById("showCreateUserBtn").hidden = false;
  document.getElementById("oldPasswordInput").hidden = true;
  document.getElementById("oldPasswordInput").required = false;
  document.getElementById("newPasswordInput").hidden = false;
  document.getElementById("newPasswordInput").required = true;
  document.getElementById("newPasswordConfirmInput").hidden = false;
  document.getElementById("newPasswordConfirmInput").required = true;
  document.querySelector('#passwordSetupForm button[type="submit"]').hidden = false;
  document.getElementById("skipPasswordSetupBtn").hidden = false;
  hideAuthOverlay();
}
function hideAuthOverlay() {
  const el = document.getElementById("authOverlay");
  if (el) el.hidden = true;
}

// -------------------------------------------------------------------------
// Storage
// -------------------------------------------------------------------------
const LOCAL_KEY     = "gachaLuckStateV3";
const LOCAL_KEY_V2  = "gachaLuckStateV2";
const LOCAL_KEY_OLD = "gachaLuckState";

function mergeSettings(val) {
  const s = Object.assign({}, DEFAULT_SETTINGS, val || {});
  s.baseScores = Object.assign({}, DEFAULT_SETTINGS.baseScores, (val || {}).baseScores || {});
  s.stages     = (val || {}).stages || {};
  return s;
}

function loadLocal() {
  try {
    let raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) raw = localStorage.getItem(LOCAL_KEY_V2);

    if (!raw) {
      const oldRaw = localStorage.getItem(LOCAL_KEY_OLD);
      if (oldRaw) {
        const old = JSON.parse(oldRaw);
        state.settings   = mergeSettings(old.settings);
        state.players    = old.players  || {};
        state.rollLog    = old.rollLog  || {};
        state.pullLog    = old.pullLog  || {};
        state.orbLog     = old.orbLog   || {};
        state.auditLog   = old.auditLog || {};
        state.banners    = {};
        state.characters = {};
        saveLocal();
      }
    } else {
      const p = JSON.parse(raw);
      state.settings   = mergeSettings(p.settings);
      state.banners    = p.banners    || {};
      state.characters = p.characters || {};
      state.players    = p.players    || {};
      state.rollLog    = p.rollLog    || {};
      state.pullLog    = p.pullLog    || {};
      state.orbLog     = p.orbLog     || {};
      state.auditLog   = p.auditLog   || {};
    }
  } catch (e) { console.warn("โหลด localStorage ล้มเหลว", e); }
  resolveAuth(localStorage.getItem("glPassword"));
  render();
}

function saveLocal() { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); }

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function recordAudit(action, entity, entityId, details) {
  const entry = {
    ts: Date.now(),
    actor: authPlayerName || "system",
    action,
    entity,
    entityId: entityId || "",
    details: details || "",
  };
  if (mode === "firebase") db.ref("auditLog").push(entry);
  else { state.auditLog[uid()] = entry; saveLocal(); render(); }
}

// -------------------------------------------------------------------------
// Firebase / init
// -------------------------------------------------------------------------
function initStore() {
  if (window.FIREBASE_ENABLED) {
    mode = "firebase";
    try {
      firebase.initializeApp(window.FIREBASE_CONFIG);
      db = firebase.database();
      firebase.auth().signInAnonymously().catch(err => {
        console.error("Anonymous auth ล้มเหลว", err);
        setConnStatus("error", "เชื่อม Firebase ไม่สำเร็จ — ใช้ local แทน");
        mode = "local"; loadLocal();
      });
      firebase.auth().onAuthStateChanged(user => {
        if (user) {
          setConnStatus("online", "ออนไลน์ (Firebase) — แชร์ข้อมูลแบบสด");
          attachFirebaseListeners();
        }
      });
    } catch (e) { console.error(e); mode = "local"; loadLocal(); }
  } else {
    mode = "local";
    setConnStatus("local", "โหมดเครื่องนี้เครื่องเดียว (ยังไม่ตั้งค่า Firebase)");
    loadLocal();
  }
}

function attachFirebaseListeners() {
  db.ref("sitePassword").once("value", snap => resolveAuth(snap.val()));

  db.ref("settings").on("value", snap => {
    const val = snap.val();
    if (!val) { db.ref("settings").set(DEFAULT_SETTINGS); return; }
    state.settings = mergeSettings(val);
    render();
  });
  db.ref("banners").on("value", snap => { state.banners = snap.val() || {}; render(); });
  db.ref("characters").on("value", snap => { state.characters = snap.val() || {}; render(); });
  db.ref("players").on("value", snap => { state.players = snap.val() || {}; render(); });
  db.ref("rollLog").on("value", snap => { state.rollLog = snap.val() || {}; render(); });
  db.ref("pullLog").on("value", snap => { state.pullLog = snap.val() || {}; render(); });
  db.ref("orbLog").on("value", snap => { state.orbLog = snap.val() || {}; render(); });
  db.ref("auditLog").on("value", snap => { state.auditLog = snap.val() || {}; render(); });
}

function setConnStatus(kind, text) {
  const el = document.getElementById("connStatus");
  el.className = "conn-status conn-" + (kind === "online" ? "online" : kind === "error" ? "bad" : "local");
  el.textContent = "โหมด: " + text;
  document.getElementById("footerMode").textContent =
    mode === "firebase" ? "เชื่อมต่อ Firebase อยู่" : "เก็บข้อมูลใน localStorage เครื่องนี้เท่านั้น";
}

function persistSettings() {
  if (mode === "firebase") db.ref("settings").set(state.settings);
  else { saveLocal(); render(); }
}

// -------------------------------------------------------------------------
// CRUD helpers
// -------------------------------------------------------------------------
function addPlayer(name) {
  const id = uid();
  if (mode === "firebase") db.ref("players/" + id).set({ name });
  else { state.players[id] = { name }; saveLocal(); render(); }
  recordAudit("add", "player", id, name);
}
function removePlayer(id) {
  if (mode === "firebase") db.ref("players/" + id).remove();
  else { delete state.players[id]; saveLocal(); render(); }
  recordAudit("delete", "player", id, "");
}

function addBanner(banner) {
  const id = uid();
  if (mode === "firebase") db.ref("banners/" + id).set(banner);
  else { state.banners[id] = banner; saveLocal(); render(); }
  recordAudit("add", "banner", id, banner.name);
}
function removeBanner(id) {
  if (mode === "firebase") db.ref("banners/" + id).remove();
  else { delete state.banners[id]; saveLocal(); render(); }
  recordAudit("delete", "banner", id, "");
}

function addCharacter(char) {
   char = { ts: Date.now(), ...char };
   const id = uid();
   if (mode === "firebase") {
     state.characters[id] = char;
     db.ref("characters/" + id).set(char);
   } else {
     state.characters[id] = char;
     saveLocal();
   }
   recordAudit("add", "character", id, char.name);
   render();
}
function updateCharacter(id, data) {
   if (mode === "firebase") {
     state.characters[id] = { ...state.characters[id], ...data };
     db.ref("characters/" + id).update(data);
   } else {
     state.characters[id] = { ...state.characters[id], ...data };
     saveLocal();
   }
   recordAudit("update", "character", id, data.name || state.characters[id]?.name || "");
   render();
}
function removeCharacter(id) {
  if (mode === "firebase") db.ref("characters/" + id).remove();
  else { delete state.characters[id]; saveLocal(); render(); }
  recordAudit("delete", "character", id, "");
}

function removeOwnLog(kind, id) {
  const source = kind === "roll" ? state.rollLog : state.pullLog;
  const entry = source?.[id];
  if (!entry || entry.player !== authPlayerName) return;
  const reason = prompt("Reason for removing this record (required):", "");
  if (reason === null || !reason.trim()) {
    alert("A reason is required.");
    return;
  }
  const entity = kind === "roll" ? "roll" : "pull";
  const details = JSON.stringify({ reason: reason.trim(), removedRecord: entry });
  if (mode === "firebase") db.ref(`${kind}Log/${id}`).remove();
  else {
    delete source[id];
    saveLocal();
    render();
  }
  recordAudit("delete", entity, id, details);
}

function addStage(stage) {
  const id = uid();
  state.settings.stages = state.settings.stages || {};
  state.settings.stages[id] = { ts: Date.now(), ...stage };
  persistSettings();
  recordAudit("add", "stage", id, stage.name);
}
function removeStage(id) {
  if (state.settings.stages) delete state.settings.stages[id];
  persistSettings();
  recordAudit("delete", "stage", id, "");
}

function addOrbReward(player, expected, actual) {
  const id = uid();
  const entry = { player, expected, actual, ts: Date.now() };
  if (mode === "firebase") db.ref("orbLog/" + id).set(entry);
  else { state.orbLog[id] = entry; saveLocal(); render(); }
  recordAudit("add", "orb_reward", id, `${player}: ${expected} expected, ${actual} actual`);
}

// backward compat: char เก่ามี breaker:bool → แปลงเป็น role string
function getCharRole(c) {
  if (c.role !== undefined) return c.role;
  return c.breaker ? "breaker" : "";
}

// -------------------------------------------------------------------------
// Scoring engine
// -------------------------------------------------------------------------
function stagePointsOf(stage, s) {
  const diffPts = stage.difficulty !== undefined
    ? Number(stage.difficulty)
    : Math.round((stage.weight || 0) * 20);
  return diffPts + (stage.monthly ? (s.monthlyPoint || 0) : 0);
}

function pullScore(pull, s) {
  const base    = s.baseScores[pull.category] || 0;
  const meta    = pull.meta    ? (s.metaBonus    || 0) : 0;
  const breaker = pull.breaker ? (s.breakerBonus || 0) : 0;
  const performance = pull.lowPerformance ? (s.lowPerformanceMultiplier ?? 0.5) : 1;
  const dupW    = s.dupWeights[Math.min(Number(pull.dupTier), 3)] ?? 0;
  let score     = (base + meta + breaker) * dupW * performance;
  if (pull.stageId && pull.stageApplies !== false && s.stages?.[pull.stageId]) {
    score += stagePointsOf(s.stages[pull.stageId], s);
  }
  return score;
}

// snapshot-aware: ใช้ค่าที่บันทึกไว้ถ้ามี
function getPullScore(pull, s) {
  return pull.scoreSnapshot !== undefined ? pull.scoreSnapshot : pullScore(pull, s);
}

// -------------------------------------------------------------------------
// Dashboard computation
// -------------------------------------------------------------------------
function computePlayerStats(playerName, opts = {}) {
  const s = state.settings;
  const bannerIds = Array.isArray(opts.bannerIds) ? opts.bannerIds.filter(Boolean) : [];
  const bannerSet = bannerIds.length ? new Set(bannerIds) : null;
  const includeOrbs = opts.includeOrbs !== false;

  const playerRolls = Object.values(state.rollLog).filter(r =>
    r.player === playerName && (!bannerSet || bannerSet.has(r.bannerId))
  );
  const playerPulls = Object.values(state.pullLog).filter(p =>
    p.player === playerName && (!bannerSet || bannerSet.has(p.bannerId))
  );
  const playerOrbs  = includeOrbs
    ? Object.values(state.orbLog || {}).filter(o => o.player === playerName)
    : [];

  const totalRolls   = playerRolls.reduce((a, r) => a + Number(r.rolls || 0), 0);
  const pullActualPoints = playerPulls.reduce((a, p) => a + getPullScore(p, s), 0);
  const actualHits   = playerPulls.length;
  const orbExpected  = playerOrbs.reduce((a, o) => a + Number(o.expected || 0), 0);
  const orbActual    = playerOrbs.reduce((a, o) => a + Number(o.actual || 0), 0);

  let expectedHits   = 0;
  let expectedPoints = 0;
  let variance       = 0;
  let scoreVariance  = 0;
  const bannerMap    = {};

  for (const roll of playerRolls) {
    const banner    = roll.bannerId && state.banners[roll.bannerId];
    const rates     = getBannerRates(banner);
    const n         = Number(roll.rolls || 0);
    const isHoshi   = !!roll.hoshi;
    const rate5star = (banner?.rate5star != null) ? Number(banner.rate5star) : 12;
    const bid       = roll.bannerId || "__none__";

    if (!rates.length || !n) continue;

    if (!bannerMap[bid]) {
      bannerMap[bid] = {
        name: banner?.name || "(ไม่ระบุตู้)", rate5star,
        normalRolls: 0, hoshiRolls: 0, rateData: {},
      };
      for (const re of rates) {
        const label = CATEGORIES.find(c => c.key === re.category)?.label || re.category;
        bannerMap[bid].rateData[re.category] = {
          label, rate: Number(re.rate),
          base: s.baseScores[re.category] || 0,
          normalTotal: 0, hoshiTotal: 0,
        };
      }
    }

    const bd = bannerMap[bid];
    if (isHoshi) bd.hoshiRolls += n; else bd.normalRolls += n;

    let pTotal = 0;
    let scoreMeanPerRoll = 0;
    let scoreSecondPerRoll = 0;
    for (const re of rates) {
      const cr    = isHoshi
        ? (rate5star > 0 ? Number(re.rate) / rate5star : 0)
        : Number(re.rate) / 100;
      const base  = s.baseScores[re.category] || 0;
      const total = n * cr * base;
      expectedHits   += n * cr;
      expectedPoints += total;
      pTotal         += cr;
      scoreMeanPerRoll += cr * base;
      scoreSecondPerRoll += cr * base * base;
      if (bd.rateData[re.category]) {
        if (isHoshi) bd.rateData[re.category].hoshiTotal  += total;
        else         bd.rateData[re.category].normalTotal += total;
      }
    }
    variance += n * pTotal * Math.max(1 - pTotal, 0);
    scoreVariance += n * Math.max(scoreSecondPerRoll - scoreMeanPerRoll * scoreMeanPerRoll, 0);
  }

  const breakdown = Object.values(bannerMap).map(bd => ({
    ...bd,
    total: Object.values(bd.rateData).reduce((acc, r) => acc + r.normalTotal + r.hoshiTotal, 0),
  }));
  const actualPoints = pullActualPoints + (orbActual * ORB_WEIGHT);
  expectedPoints += (orbExpected * ORB_WEIGHT);
  const orbVariance = playerOrbs.length * ((300 - 100) ** 2 / 12) * (ORB_WEIGHT ** 2);
  const scoreSd = Math.sqrt(scoreVariance + orbVariance);
  const deviation = actualPoints - expectedPoints;

  const z = scoreSd > 0 ? deviation / scoreSd : 0;

  return { player: playerName, totalRolls, actualHits, expectedHits,
           actualPoints, expectedPoints, deviation, z,
           scoreSd, scoreVariance, orbVariance, orbCount: playerOrbs.length,
           orbExpected, orbActual, orbDifference: orbActual - orbExpected, breakdown };
}

// -------------------------------------------------------------------------
// Rendering helpers
// -------------------------------------------------------------------------
function fmt(n, d = 2) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function timestampValue(ts) {
  if (ts === null || ts === undefined || ts === "") return 0;
  if (typeof ts === "object") {
    if (ts[".sv"] !== undefined) return ts[".sv"] === "timestamp" ? Date.now() : timestampValue(ts[".sv"]);
    if (ts.seconds !== undefined) return Number(ts.seconds) * 1000 + Math.floor(Number(ts.nanoseconds || 0) / 1e6);
    if (ts._seconds !== undefined) return Number(ts._seconds) * 1000 + Math.floor(Number(ts._nanoseconds || 0) / 1e6);
    if (ts.value !== undefined) return timestampValue(ts.value);
    if (ts.timestamp !== undefined) return timestampValue(ts.timestamp);
  }
  if (typeof ts === "number") {
    if (ts > 1e17) return ts / 1e6;
    if (ts > 1e14) return ts / 1e3;
    return ts < 1e12 ? ts * 1000 : ts;
  }
  const numeric = Number(ts);
  if (Number.isFinite(numeric)) {
    if (numeric > 1e17) return numeric / 1e6;
    if (numeric > 1e14) return numeric / 1e3;
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(ts));
  return Number.isFinite(parsed) ? parsed : 0;
}
function recordTimestamp(record, seen = new Set()) {
  if (!record || typeof record !== "object" || seen.has(record)) return 0;
  seen.add(record);
  const direct = record.ts ?? record.timestamp ?? record.timeStamp ?? record.createdAt ?? record.created_at;
  const parsed = timestampValue(direct);
  if (parsed) return parsed;
  for (const [key, value] of Object.entries(record)) {
    if (/^(ts|timestamp|timestamped|createdat|created_at)$/i.test(key)) {
      const keyed = timestampValue(value);
      if (keyed) return keyed;
    }
    if (value && typeof value === "object") {
      const nested = recordTimestamp(value, seen);
      if (nested) return nested;
    }
  }
  return 0;
}
function fmtDate(ts) {
  const value = timestampValue(ts);
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}
function playerNames()   { return Object.values(state.players).map(p => p.name); }
function bannerEntries() { return Object.entries(state.banners); }
function pageItems(items, kind) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  listPages[kind] = Math.min(Math.max(listPages[kind] || 1, 1), totalPages);
  const start = (listPages[kind] - 1) * pageSize;
  return { rows: items.slice(start, start + pageSize), totalPages };
}

function sortableValue(row, key, kind) {
  if (kind === "characters" || kind === "stages") {
    const value = row[1] || {};
    if (key === "runtime") return Number(value.__runtimeOrder || 0);
    if (key === "name") return value.name || "";
    if (key === "ts") return recordTimestamp(value);
    if (kind === "stages" && key === "difficulty") return Number(value.difficulty ?? value.weight ?? 0);
    if (kind === "stages" && key === "points") return Number(stagePointsOf(value, state.settings) || 0);
    return value[key] ?? "";
  }
  if (key === "player" && kind === "dashboard") return row.player || "";
  if (key === "name" && kind === "dashboard") return row.player || "";
  if (key === "score" && kind === "dashboard") return Number(row.actualPoints || 0);
  if (key === "expected" && kind === "dashboard") return Number(row.expectedPoints || 0);
  if (key === "deviation" && kind === "dashboard") return Number(row.deviation || 0);
  if (key === "z" && kind === "dashboard") return Number(row.z || 0);
  if (key === "rank" && kind === "dashboard") return Number(row.rank || 0);
  if (key === "difference" && kind === "orbs") return Number(row.actual || 0) - Number(row.expected || 0);
  if (key === "score" && kind === "pulls") return Number(getPullScore(row, state.settings) || 0);
  if (key === "flag" && kind === "pulls") return row.meta ? "Meta" : row.breaker ? "Breaker" : row.lowPerformance ? "Low performance" : "";
  const value = row?.[key];
  if (key === "ts") return recordTimestamp(row);
  if (typeof value === "number") return value;
  return String(value ?? "");
}

function sortedTableRows(rows, kind) {
  const sort = tableSorts[kind];
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const av = sortableValue(a, sort.key, kind);
    const bv = sortableValue(b, sort.key, kind);
    let result;
    if (typeof av === "number" && typeof bv === "number") result = av - bv;
    else result = String(av).localeCompare(String(bv), "th", { numeric: true, sensitivity: "base" });
    return sort.dir === "desc" ? -result : result;
  });
}

function addRuntimeOrder(entries) {
  return entries.map(([id, value], index) => [id, { ...value, __runtimeOrder: index + 1 }]);
}

function toggleTableSort(kind, key) {
  const current = tableSorts[kind] || { key, dir: "asc" };
  tableSorts[kind] = current.key === key
    ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
    : { key, dir: key === "ts" ? "desc" : "asc" };
  render();
}

function updateSortIndicators() {
  document.querySelectorAll("th[data-sort][data-sort-kind]").forEach(th => {
    const kind = th.dataset.sortKind;
    const sort = tableSorts[kind];
    const label = th.dataset.sortLabel || th.textContent.replace(/[↕↑↓]$/, "").trim();
    th.dataset.sortLabel = label;
    th.textContent = sort?.key === th.dataset.sort
      ? `${label} ${sort.dir === "asc" ? "↑" : "↓"}`
      : `${label} ↕`;
    th.setAttribute("aria-sort", sort?.key === th.dataset.sort
      ? (sort.dir === "asc" ? "ascending" : "descending")
      : "none");
  });
}

function initializeSortableHeaders() {
  const columns = {
    dashboardBody: ["player", "totalRolls", "actualHits", "score", "expected", "deviation", "z", "rank"],
    orbLogBody: ["ts", "player", "expected", "actual", "difference"],
    rollLogBody: ["ts", "player", "bannerId", "rolls", "hoshi"],
    pullLogBody: ["ts", "player", "charName", "category", "dupTier", "flag", "stageId", "stageApplies", "score"],
    auditBody: ["ts", "actor", "action", "entity", "details"],
    charBody: ["runtime", "name", "category", "role"],
    stageBody: ["runtime", "name", "difficulty", "monthly", "points"],
  };
  Object.entries(columns).forEach(([bodyId, keys]) => {
    const body = document.getElementById(bodyId);
    const table = body?.closest("table");
    if (!table) return;
    let headers = [...table.querySelectorAll("thead th")];
    if (bodyId === "charBody" && headers.length === 4) {
      const th = document.createElement("th");
      th.textContent = "Runtime";
      headers[0].before(th);
      headers = [...table.querySelectorAll("thead th")];
    }
    if (bodyId === "stageBody" && headers.length === 5) {
      const th = document.createElement("th");
      th.textContent = "Runtime";
      headers[0].before(th);
      headers = [...table.querySelectorAll("thead th")];
    }
    if (bodyId === "pullLogBody" && headers.length === 10 && !headers[5].dataset.flagColumn) {
      headers[5].textContent = "Flag";
      headers[5].dataset.flagColumn = "1";
      headers[6].remove();
      headers = [...table.querySelectorAll("thead th")];
    }
    if ((bodyId === "rollLogBody" && headers.length === 5) || (bodyId === "pullLogBody" && headers.length === 9)) {
      const th = document.createElement("th");
      th.textContent = "";
      th.dataset.actionColumn = "1";
      headers[headers.length - 1].after(th);
      headers = [...table.querySelectorAll("thead th")];
    }
    keys.forEach((key, i) => {
      if (!headers[i]) return;
      headers[i].dataset.sortKind = bodyId === "charBody" ? "characters"
        : bodyId === "stageBody" ? "stages"
        : bodyId === "orbLogBody" ? "orbs"
        : bodyId === "rollLogBody" ? "rolls"
        : bodyId === "pullLogBody" ? "pulls"
        : bodyId.replace("Body", "");
      headers[i].dataset.sort = key;
    });
  });
}
function renderPager(kind, totalPages) {
  const el = document.getElementById(kind + "Pager");
  if (!el) return;
  const page = listPages[kind];
  el.innerHTML = totalPages > 1
    ? `<button type="button" class="btn-secondary btn-sm" data-page-kind="${kind}" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>‹</button>
       <span class="hint small">${page} / ${totalPages}</span>
       <button type="button" class="btn-secondary btn-sm" data-page-kind="${kind}" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>›</button>`
    : "";
}

function render() {
  renderAuthPlayerSelect();
  renderLoginUserSelect();
  renderPlayerSelects();
  renderOrbPlayerSelect();
  renderDashboardFilters();
  renderBannerSelects();
  renderPlayerChips();
  renderBannerChips();
  renderSettingsForm();
  renderCharRoleSelect();
  renderStageTable();
  renderCharacterList();
  renderRollLogTable();
  renderPullLogTable();
  renderOrbLogTable();
  renderAuditTable();
  renderDashboard();
  initializeSortableHeaders();
  updateSortIndicators();
}

function renderAuthPlayerSelect() {
  const sel = document.getElementById("authPlayerSelect");
  if (!sel || authNewMode) return;
  const names = playerNames();
  sel.innerHTML = names.length
    ? names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("")
    : `<option value="">No nicknames yet — create one below</option>`;
  if (names.includes(authPlayerName)) sel.value = authPlayerName;
}

function renderLoginUserSelect() {
  const sel = document.getElementById("authUsernameInput");
  if (!sel || sel.tagName !== "SELECT") return;
  const entries = Object.entries(state.players || {})
    .map(([, p]) => p?.name)
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b), "th"));
  const current = sel.value;
  sel.innerHTML = `<option value="" disabled ${current ? "" : "selected"}>— เลือกชื่อผู้ใช้ —</option>` +
    (entries.length ? entries.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("") : "");
  if (entries.includes(current)) sel.value = current;
}

function renderDashboardFilters() {
  const bannerSelect = document.getElementById("dashBannerFilter");
  const includeOrbs = document.getElementById("dashIncludeOrbs");
  if (!bannerSelect || !includeOrbs) return;

  includeOrbs.checked = !!dashboardFilters.includeOrbs;

  const entries = bannerEntries();
  bannerSelect.innerHTML = entries.length
    ? entries.map(([bid, b]) => `<option value="${bid}">${esc(b.name)}</option>`).join("")
    : "";

  const selected = new Set((dashboardFilters.bannerIds || []).map(String));
  [...bannerSelect.options].forEach(opt => { opt.selected = selected.has(opt.value); });
}

function renderAuditTable() {
  const tbody = document.getElementById("auditBody");
  if (!tbody) return;
  const allRows = sortedTableRows(Object.values(state.auditLog || {}), "audit");
  const page = pageItems(allRows, "audit");
  renderPager("audit", page.totalPages);
  tbody.innerHTML = page.rows.length
    ? page.rows.map(entry => `<tr>
        <td>${fmtDate(entry.ts)}</td>
        <td class="name">${esc(entry.actor || "system")}</td>
        <td>${esc(entry.action || "")}</td>
        <td>${esc(entry.entity || "")}</td>
        <td class="name">${esc(entry.details || entry.entityId || "")}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="empty-hint">ยังไม่มีบันทึก Audit</td></tr>`;
}

function renderOrbLogTable() {
  const tbody = document.getElementById("orbLogBody");
  if (!tbody) return;
  const allRows = sortedTableRows(Object.values(state.orbLog || {}), "orbs");
  const page = pageItems(allRows, "orbs");
  renderPager("orbs", page.totalPages);
  const expected = allRows.reduce((sum, row) => sum + Number(row.expected || 0), 0);
  const actual = allRows.reduce((sum, row) => sum + Number(row.actual || 0), 0);
  document.getElementById("orbExpectedTotal").textContent = fmt(expected, 2);
  document.getElementById("orbActualTotal").textContent = fmt(actual, 2);
  document.getElementById("orbDifferenceTotal").textContent = fmt(actual - expected, 2);
  tbody.innerHTML = page.rows.length
    ? page.rows.map(row => `<tr>
        <td>${fmtDate(row.ts)}</td>
        <td class="name">${esc(row.player)}</td>
        <td>${fmt(row.expected, 2)}</td>
        <td>${fmt(row.actual, 2)}</td>
        <td>${fmt(Number(row.actual) - Number(row.expected), 2)}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="empty-hint">ยังไม่มีข้อมูล Orb</td></tr>`;
}

function renderPlayerSelects() {
  const names = playerNames();
  const sel   = document.getElementById("rollPlayerSelect");
  if (!sel) return;
  if (authPlayerName && names.includes(authPlayerName)) {
    sel.innerHTML = `<option value="${esc(authPlayerName)}">${esc(authPlayerName)}</option>`;
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  const prev  = sel.value;
  sel.innerHTML = names.length
    ? names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("")
    : `<option value="">— เพิ่มผู้เล่นในแท็บตั้งค่าก่อน —</option>`;
  if (names.includes(prev)) sel.value = prev;
}

function renderOrbPlayerSelect() {
  const sel = document.getElementById("orbPlayerSelect");
  if (!sel) return;
  const names = playerNames();
  const loggedInPlayer = authPlayerName && names.includes(authPlayerName) ? authPlayerName : "";
  sel.innerHTML = loggedInPlayer
    ? `<option value="${esc(loggedInPlayer)}">${esc(loggedInPlayer)}</option>`
    : names.length
    ? names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("")
    : `<option value="">ยังไม่มีผู้เล่น</option>`;
  sel.disabled = !!loggedInPlayer;
}

function renderBannerSelects() {
  const entries = bannerEntries();
  const sel     = document.getElementById("rollBannerSelect");
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = entries.length
    ? entries.map(([bid, b]) =>
        `<option value="${bid}">${esc(b.name)} (${esc(bannerRatesSummary(b))})</option>`
      ).join("")
    : `<option value="">— เพิ่มตู้ในแท็บตั้งค่าก่อน —</option>`;
  if (entries.map(([bid]) => bid).includes(prev)) sel.value = prev;
}

function renderPlayerChips() {
  const ul      = document.getElementById("playerList");
  const entries = Object.entries(state.players);
  ul.innerHTML = entries.length
    ? entries.map(([, p]) => `<li>${esc(p.name)}</li>`).join("")
    : `<li class="hint small">à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¸¡à¸µà¸œà¸¹à¹‰à¹€à¸¥à¹ˆà¸™</li>`;
}

function renderBannerChips() {
  const ul      = document.getElementById("bannerList");
  const entries = bannerEntries();
  const page = pageItems(entries, "banners");
  const visibleEntries = page.rows;
  renderPager("banners", page.totalPages);
  ul.innerHTML  = entries.length
    ? visibleEntries.map(([id, b]) => {
        const r5 = b.rate5star !== undefined ? `5★ ${b.rate5star}%` : `5★ 12%`;
        return `<li>
          <span class="banner-chip-name">${esc(b.name)}</span>
          <span class="rate-badge">${esc(r5)}</span>
          <span class="rate-badge">${esc(bannerRatesSummary(b))}</span>
          <button data-remove-banner="${id}" title="ลบตู้">×</button>
        </li>`;
      }).join("")
    : `<li class="hint small">ยังไม่มีตู้ — เพิ่มด้านบน</li>`;
}

function renderSettingsForm() {
  const s = state.settings;
  document.getElementById("setMetaBonus").value    = s.metaBonus;
  document.getElementById("setBreakerBonus").value = s.breakerBonus ?? 10;
  document.getElementById("setLowPerformanceMultiplier").value = s.lowPerformanceMultiplier ?? 0.5;
  document.getElementById("setMonthlyPoint").value = s.monthlyPoint;

  document.getElementById("baseScoreRows").innerHTML = CATEGORIES.map(c =>
    `<div class="kv-row"><span>${c.label}</span>
     <input type="number" data-base="${c.key}" value="${s.baseScores[c.key]}"></div>`
  ).join("");

  document.getElementById("dupWeightRows").innerHTML = [0,1,2,3].map(i =>
    `<div class="kv-row"><span>ดุ๊ปที่ ${i}${i===3?"+":""}</span>
     <input type="number" step="0.05" data-dup="${i}" value="${s.dupWeights[i]}"></div>`
  ).join("");
}

function renderCharRoleSelect() {
  const select = document.getElementById("newCharRole");
  if (!select) return;
  const metaBonus = state.settings.metaBonus ?? 20;
  const breakerBonus = state.settings.breakerBonus ?? 10;
  const lowPerformanceMultiplier = state.settings.lowPerformanceMultiplier ?? 0.5;
  select.innerHTML = `
    <option value="">Normal</option>
    <option value="meta">Meta (+${metaBonus})</option>
    <option value="breaker">Breaker (+${breakerBonus})</option>
    <option value="lowPerformance">Low performance (×${lowPerformanceMultiplier})</option>
  `;
}

function renderStageTable() {
  const tbody   = document.getElementById("stageBody");
  const stages  = state.settings.stages || {};
  const entries = sortedTableRows(addRuntimeOrder(Object.entries(stages)), "stages");
  const page = pageItems(entries, "stages");
  renderPager("stages", page.totalPages);
  tbody.innerHTML = entries.length
    ? page.rows.map(([id, st]) => {
        const diffDisplay = st.difficulty !== undefined ? st.difficulty : `${fmt(st.weight, 2)} (เก่า)`;
        const pts = stagePointsOf(st, state.settings);
        return `<tr>
          <td>#${st.__runtimeOrder}</td>
          <td class="name">${esc(st.name)}</td>
          <td>${diffDisplay}</td>
          <td>${st.monthly ? "✔" : "—"}</td>
          <td>${fmt(pts, 0)}</td>
          <td><button class="icon-btn" data-remove-stage="${id}" title="ลบ">×</button></td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="6" class="empty-hint">ยังไม่มีด่าน</td></tr>`;
}

function renderCharacterList() {
  const tbody = document.getElementById("charBody");
  if (!tbody) return;
  const entries = sortedTableRows(addRuntimeOrder(Object.entries(state.characters)), "characters");
  const page = pageItems(entries, "characters");
  renderPager("characters", page.totalPages);
  tbody.innerHTML = entries.length
    ? page.rows.map(([id, c]) => {
        const catLabel = CATEGORIES.find(x => x.key === c.category)?.label || c.category;
        const role     = getCharRole(c);
        const roleBadge = role === "meta"
          ? '<span class="hoshi-badge" style="background:#c4920a">Meta</span>'
          : role === "breaker"
          ? '<span class="hoshi-badge" style="background:#7c4dff">Breaker</span>'
          : role === "lowPerformance"
          ? '<span class="hoshi-badge" style="background:#b23a48">Low performance</span>'
          : "—";
        return `<tr>
          <td>#${c.__runtimeOrder}</td>
          <td class="name charname-cell">${esc(c.name)}</td>
          <td>${esc(catLabel)}</td>
          <td>${roleBadge}</td>
          <td>
            <button class="btn-sm btn-secondary" data-edit-char="${id}">แก้ไข</button>
            <button class="icon-btn" data-remove-char="${id}" title="ลบ">×</button>
          </td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="5" class="empty-hint">ยังไม่มีตัวละคร — เพิ่มด้านบน</td></tr>`;
}

function renderRollLogTable() {
  const tbody = document.getElementById("rollLogBody");
  const allRows = sortedTableRows(Object.entries(state.rollLog).map(([id, row]) => ({ ...row, __logId: id })), "rolls");
  const page = pageItems(allRows, "rolls");
  const rows = page.rows;
  renderPager("rolls", page.totalPages);
  tbody.innerHTML = rows.length
    ? rows.map(r => {
        const banner     = r.bannerId && state.banners[r.bannerId];
        const bannerName = banner ? esc(banner.name) : `<span class="hint small">—</span>`;
        return `<tr>
          <td>${fmtDate(r.ts)}</td>
          <td class="name">${esc(r.player)}</td>
          <td class="name">${bannerName}</td>
          <td>${r.rolls}</td>
          <td>${r.hoshi ? '<span class="hoshi-badge">โฮชิ</span>' : '—'}</td>
          <td>${r.player === authPlayerName ? `<button class="icon-btn" data-remove-roll="${esc(r.__logId)}" title="Remove">×</button>` : ""}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="6" class="empty-hint">ยังไม่มีข้อมูล</td></tr>`;
}

function buildScoreTip(p, s) {
  const base    = s.baseScores[p.category] || 0;
  const meta    = p.meta    ? (s.metaBonus    || 0) : 0;
  const breaker = p.breaker ? (s.breakerBonus || 0) : 0;
  const performance = p.lowPerformance ? (s.lowPerformanceMultiplier ?? 0.5) : 1;
  const dupW    = s.dupWeights[Math.min(Number(p.dupTier), 3)] ?? 0;
  const charPts = (base + meta + breaker) * dupW * performance;

  const bonuses = [];
  if (meta > 0)    bonuses.push(`Meta ${meta}`);
  if (breaker > 0) bonuses.push(`Breaker ${breaker}`);
  if (p.lowPerformance) bonuses.push(`Low performance ×${performance}`);
  const baseStr = bonuses.length ? `${base} + ${bonuses.join(" + ")}` : `${base}`;

  const performanceStr = p.lowPerformance ? ` × performance ${performance}` : "";
  let lines = [`(${baseStr})${performanceStr} × dup ${dupW}  =  ${fmt(charPts, 1)} pts`];

  let stagePts = 0;
  if (p.stageId && p.stageApplies !== false && s.stages?.[p.stageId]) {
    const st      = s.stages[p.stageId];
    const diff    = st.difficulty !== undefined ? Number(st.difficulty) : Math.round((st.weight || 0) * 20);
    const monthly = st.monthly ? (s.monthlyPoint || 0) : 0;
    stagePts      = diff + monthly;
    lines.push(`+ ด่าน "${st.name}"  ยาก ${diff}${monthly > 0 ? ` + monthly ${monthly}` : ""}  =  +${stagePts} pts`);
  } else if (p.stageId && p.stageApplies === false) {
    lines.push(`ด่าน: ซ้ำ — ไม่ได้แต้มด่าน`);
  }

  const total = charPts + stagePts;
  lines.push(`─────────────────────`);
  if (p.scoreSnapshot !== undefined) {
    lines.push(`รวม (snapshot)  ${fmt(p.scoreSnapshot, 1)} pts`);
  } else {
    lines.push(`รวม  ${fmt(total, 1)} pts`);
  }
  return lines.join("\n");
}

function renderPullLogTable() {
  const tbody = document.getElementById("pullLogBody");
  if (!tbody) return;
  const s    = state.settings;
  const allRows = sortedTableRows(Object.entries(state.pullLog).map(([id, row]) => ({ ...row, __logId: id })), "pulls");
  const page = pageItems(allRows, "pulls");
  const rows = page.rows;
  renderPager("pulls", page.totalPages);
  tbody.innerHTML = rows.length
    ? rows.map(p => {
        const cat       = CATEGORIES.find(c => c.key === p.category)?.label || p.category;
        const stage     = p.stageId && s.stages?.[p.stageId];
        const stageName = stage ? esc(stage.name) : `<span class="hint small">—</span>`;
        const stageGot  = p.stageId ? (p.stageApplies !== false ? "✔" : "✘") : "—";
        const dupLabel  = `${p.dupTier}${Number(p.dupTier) >= 3 ? "+" : ""}`;
        const flag       = p.meta
          ? '<span class="hoshi-badge" style="background:#c4920a;font-size:10px">Meta</span>'
          : p.breaker
          ? '<span class="hoshi-badge" style="background:#7c4dff;font-size:10px">Breaker</span>'
          : p.lowPerformance
          ? '<span class="hoshi-badge" style="background:#b23a48;font-size:10px">Low performance</span>'
          : "—";
        const score     = getPullScore(p, s);
        const tipText   = esc(buildScoreTip(p, s));
        return `<tr>
          <td>${fmtDate(p.ts)}</td>
          <td class="name">${esc(p.player)}</td>
          <td class="name charname-cell">${p.charName ? esc(p.charName) : '<span class="hint small">—</span>'}</td>
          <td>${esc(cat)}</td>
          <td>${dupLabel}</td>
          <td>${flag}</td>
          <td class="name">${stageName}</td>
          <td>${stageGot}</td>
          <td class="score-cell tip-wrap">
            <span class="score-num">${fmt(score, 1)}</span>
            <div class="tip-box">${tipText}</div>
          </td>
          <td>${p.player === authPlayerName ? `<button class="icon-btn" data-remove-pull="${esc(p.__logId)}" title="Remove">×</button>` : ""}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="10" class="empty-hint">ยังไม่มีตัวละครที่บันทึก</td></tr>`;
}

function buildExpectedTip(breakdown, expectedPoints, orbExpected = 0) {
  if (!breakdown.length) return esc("ยังไม่มีข้อมูลตู้");
  const parts = [];
  for (const bd of breakdown) {
    const totalRolls = bd.normalRolls + bd.hoshiRolls;
    const hoshiNote  = bd.hoshiRolls > 0 ? `  (โฮชิ ${bd.hoshiRolls} roll)` : "";
    parts.push(`[${bd.name}  ×  ${totalRolls} โรล${hoshiNote}]`);
    for (const re of Object.values(bd.rateData)) {
      if (bd.normalRolls > 0) {
        const prob    = re.rate / 100;
        const perRoll = prob * re.base;
        parts.push(`  ${re.label}  ${re.rate}%×${re.base}pts=${fmt(perRoll,4)}/roll × ${bd.normalRolls} = ${fmt(re.normalTotal,1)}`);
      }
      if (bd.hoshiRolls > 0) {
        const prob    = bd.rate5star > 0 ? re.rate / bd.rate5star : 0;
        const perRoll = prob * re.base;
        parts.push(`  ${re.label}  [โฮชิ] ${re.rate}/${bd.rate5star}%=${fmt(prob*100,1)}%×${re.base}pts=${fmt(perRoll,4)}/roll × ${bd.hoshiRolls} = ${fmt(re.hoshiTotal,1)}`);
      }
    }
    parts.push(`  รวมตู้นี้:  ${fmt(bd.total, 1)} pts`);
    parts.push("─────────────────────────────────────────");
  }
  if (orbExpected > 0) parts.push(`Orb expected (÷2.5): ${fmt(orbExpected * ORB_WEIGHT, 2)}`);
  parts.push(`รวมทั้งหมด  ${fmt(expectedPoints, 1)} pts`);
  parts.push("");
  parts.push("ปกติ : rolls × rate%       × Base");
  parts.push("โฮชิ : 1roll × (rate/5★%) × Base");
  return esc(parts.join("\n"));
}

function buildZTip(st) {
  const parts = [];
  parts.push("Z-score (คะแนน):  z = (คะแนนจริง - คะแนนคาดหวัง) / SD");
  parts.push(`deviation = ${fmt(st.deviation, 2)} pts`);
  parts.push(`SD        = ${fmt(st.scoreSd || 0, 2)} pts`);
  parts.push(`z         = ${fmt(st.z, 2)}`);
  parts.push("");
  parts.push("Variance:");
  parts.push(`pullVar = ${fmt(st.scoreVariance || 0, 2)}`);
  parts.push(`orbVar  = ${fmt(st.orbVariance || 0, 2)}  (n=${st.orbCount || 0}, weight=${ORB_WEIGHT})`);
  parts.push("SD = sqrt(pullVar + orbVar)");
  if ((st.orbCount || 0) > 0) parts.push("orbVar = n × ((300-100)^2/12) × weight^2");
  parts.push("");
  if (st.breakdown?.length) {
    const names = st.breakdown.map(b => b.name).filter(Boolean);
    const list = names.length > 6 ? names.slice(0, 6).join(", ") + ", …" : names.join(", ");
    parts.push(`ตู้ที่ใช้: ${list}`);
  } else {
    parts.push("ตู้ที่ใช้: (ไม่มีข้อมูลตู้)");
  }
  return esc(parts.join("\n"));
}

function renderDashboard() {
  const names     = playerNames();
  const tbody     = document.getElementById("dashboardBody");
  const emptyHint = document.getElementById("dashboardEmpty");
  const stats     = names.map(n => computePlayerStats(n, dashboardFilters))
    .filter(st => st.totalRolls > 0 || st.orbExpected > 0);

  if (!stats.length) { tbody.innerHTML = ""; emptyHint.hidden = false; return; }
  emptyHint.hidden = true;

  const sortedByZ = [...stats].sort((a, b) => a.z - b.z);
  const rankOf    = new Map(sortedByZ.map((st, i) => [st.player, i + 1]));
  stats.forEach(st => { st.rank = rankOf.get(st.player); });

  tbody.innerHTML = sortedTableRows(stats, "dashboard").map(st => {
    const rank      = rankOf.get(st.player);
    const zClass    = st.z <= -2 ? "z-bad" : st.z >= 2 ? "z-good" : "";
    const rankClass = rank === 1 ? "rank-1" : "";
    const devClass  = st.deviation < 0 ? "z-bad" : st.deviation > 0 ? "z-good" : "";
    const expTip    = buildExpectedTip(st.breakdown, st.expectedPoints, st.orbExpected);
    const zTip      = buildZTip(st);
    return `<tr>
      <td class="name">${esc(st.player)}</td>
      <td>${st.totalRolls}</td>
      <td>${st.actualHits}</td>
      <td>${fmt(st.actualPoints, 1)}</td>
      <td class="tip-wrap">${fmt(st.expectedPoints, 1)}<div class="tip-box exp-tip">${expTip}</div></td>
      <td class="${devClass}">${fmt(st.deviation, 1)}</td>
      <td class="tip-wrap ${zClass}">${fmt(st.z, 2)}<div class="tip-box">${zTip}</div></td>
      <td class="${rankClass}">${rank}</td>
    </tr>`;
  }).join("");
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// -------------------------------------------------------------------------
// Session pull rows
// -------------------------------------------------------------------------
function buildSessionPullRow() {
  const chars     = Object.entries(state.characters)
    .sort((a, b) => a[1].name.localeCompare(b[1].name, "th"));
  const stages    = state.settings.stages || {};
  const stageOpts = Object.entries(stages)
    .map(([id, st]) => `<option value="${id}">${esc(st.name)}</option>`)
    .join("");

  const charOpts = chars.length
    ? chars.map(([id, c]) => {
        const catLabel = CATEGORIES.find(x => x.key === c.category)?.label || c.category;
        const role = getCharRole(c);
        const roleTag = role === "meta" ? " ⭐" : role === "breaker" ? " 🔨" : role === "lowPerformance" ? " ↓" : "";
        return `<option value="${id}">${esc(c.name)} (${esc(catLabel)})${roleTag}</option>`;
      }).join("")
    : "";

  const row = document.createElement("div");
  row.className = "sp-row";
  row.innerHTML = `
    <select class="sp-char">
      <option value="">— เลือกตัวละคร —</option>
      ${charOpts || '<option value="" disabled>ยังไม่มีตัวละคร เพิ่มในแท็บตั้งค่าก่อน</option>'}
    </select>
    <select class="sp-dup">
      <option value="0">ดุ๊ป 0 (ใหม่)</option>
      <option value="1">ดุ๊ป 1</option>
      <option value="2">ดุ๊ป 2</option>
      <option value="3">ดุ๊ป 3+</option>
    </select>
    <select class="sp-stage">
      <option value="">— ไม่มีด่าน —</option>
      ${stageOpts}
    </select>
    <label class="sp-meta-label sp-stage-bonus" style="display:none">
      <input type="checkbox" class="sp-stage-applies" checked> ได้แต้มด่าน
    </label>
    <button type="button" class="sp-del icon-btn" title="ลบแถวนี้">×</button>
  `;
  const stageSelect   = row.querySelector(".sp-stage");
  const stageBonusLbl = row.querySelector(".sp-stage-bonus");
  stageSelect.addEventListener("change", () => {
    stageBonusLbl.style.display = stageSelect.value ? "" : "none";
  });
  row.querySelector(".sp-del").addEventListener("click", () => row.remove());
  return row;
}

// -------------------------------------------------------------------------
// Banner rate row builder
// -------------------------------------------------------------------------
function addBannerRateRow(defaultCat = "", defaultRate = "") {
  const container = document.getElementById("bannerRateRows");
  const div = document.createElement("div");
  div.className = "banner-rate-row";
  div.innerHTML = `
    <select class="br-cat">
      ${CATEGORIES.map(c =>
        `<option value="${c.key}"${c.key === defaultCat ? " selected" : ""}>${c.label}</option>`
      ).join("")}
    </select>
    <input type="number" class="br-rate" placeholder="%" step="0.1" min="0" max="100"
           value="${defaultRate}">
    <button type="button" class="br-del icon-btn" title="ลบ">×</button>
  `;
  div.querySelector(".br-del").addEventListener("click", () => div.remove());
  container.appendChild(div);
}

// -------------------------------------------------------------------------
// Event wiring
// -------------------------------------------------------------------------
let editingCharId = null;

document.addEventListener("DOMContentLoaded", () => {

  const orbCard = document.querySelector(".orb-card");
  const pullHistory = document.getElementById("pullsPager")?.parentElement;
  if (orbCard && pullHistory) pullHistory.after(orbCard);
  if (orbCard) {
    orbCard.classList.add("orb-collapsed");
    orbCard.querySelector("h3")?.addEventListener("click", () => orbCard.classList.toggle("orb-collapsed"));
  }

  document.addEventListener("click", e => {
    if (!(e.target instanceof Element)) return;
    const button = e.target.closest("[data-page-kind]");
    if (!button || button.disabled) return;
    listPages[button.dataset.pageKind] = Number(button.dataset.page);
    render();
  });

  document.getElementById("dashIncludeOrbs")?.addEventListener("change", e => {
    dashboardFilters.includeOrbs = !!e.target.checked;
    sessionStorage.setItem("glDashIncludeOrbs", dashboardFilters.includeOrbs ? "1" : "0");
    render();
  });
  document.getElementById("dashBannerFilter")?.addEventListener("change", e => {
    const sel = e.target;
    const ids = [...sel.selectedOptions].map(o => String(o.value)).filter(Boolean);
    dashboardFilters.bannerIds = ids;
    sessionStorage.setItem("glDashBannerIds", JSON.stringify(ids));
    render();
  });

  // ── Auth ──────────────────────────────────────────────────────────────
  document.getElementById("authPlayerSelect").hidden = true;
  document.getElementById("authNewPlayerBtn").hidden = true;
  document.getElementById("authNewPlayerFields").hidden = true;
  document.getElementById("authConfirmInput").hidden = true;
  const authError = document.getElementById("authError");
  const clearAuthError = () => { authError.hidden = true; authError.textContent = ""; };
  document.querySelectorAll("#authOverlay input, #authOverlay select").forEach(el => el.addEventListener("input", clearAuthError));
  setInterval(() => { if (!authError.hidden) clearAuthError(); }, 5000);
  document.getElementById("showCreateUserBtn").addEventListener("click", () => {
    document.getElementById("authForm").hidden = true;
    document.getElementById("createUserForm").hidden = false;
    document.getElementById("showCreateUserBtn").hidden = true;
    document.getElementById("createUsernameInput").focus();
  });
  document.getElementById("backToLoginBtn").addEventListener("click", () => {
    document.getElementById("createUserForm").hidden = true;
    document.getElementById("authForm").hidden = false;
    document.getElementById("showCreateUserBtn").hidden = false;
  });
  document.getElementById("createUserForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = document.getElementById("authError");
    const name = document.getElementById("createUsernameInput").value.trim();
    const pw = document.getElementById("createPasswordInput").value;
    const confirmPw = document.getElementById("createPasswordConfirmInput").value;
    if (!name) { errEl.textContent = "กรุณาใส่ชื่อผู้ใช้"; errEl.hidden = false; return; }
    if (!pw || pw !== confirmPw) { errEl.textContent = "รหัสผ่านไม่ตรงกัน"; errEl.hidden = false; return; }
    if (findPlayerByName(name)) { errEl.textContent = "มีชื่อผู้ใช้นี้อยู่แล้ว"; errEl.hidden = false; return; }
    const player = { name, passwordHash: await passwordHash(pw) };
    const id = uid();
    if (mode === "firebase") db.ref("players/" + id).set(player);
    else { state.players[id] = player; saveLocal(); render(); }
    completeAuth(name);
  });

  document.getElementById("authNewPlayerBtn").addEventListener("click", () => {
    authNewMode = !authNewMode;
    document.getElementById("authPlayerSelect").hidden = authNewMode;
    document.getElementById("authNewPlayerFields").hidden = !authNewMode;
    document.getElementById("authConfirmInput").hidden = !authNewMode;
    document.getElementById("authNewPlayerBtn").textContent = authNewMode ? "Use existing nickname" : "+ Create new nickname";
    if (authNewMode) document.getElementById("authNewPlayerName").focus();
    else renderAuthPlayerSelect();
  });

  document.getElementById("authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = document.getElementById("authError");
    if (sitePassword === null) { errEl.textContent = "กำลังโหลดการตั้งค่ารหัสผ่าน กรุณารอสักครู่"; errEl.hidden = false; return; }
    const val = document.getElementById("authInput").value;
    const name = document.getElementById("authUsernameInput").value.trim();
    if (authNewMode) {
      if (!name) { errEl.textContent = "Enter a nickname"; errEl.hidden = false; return; }
      if (!val || val !== document.getElementById("authConfirmInput").value) { errEl.textContent = "รหัสผ่านไม่ตรงกัน"; errEl.hidden = false; return; }
      if (findPlayerByName(name)) { errEl.textContent = "That nickname already exists"; errEl.hidden = false; return; }
      const player = { name, passwordHash: await passwordHash(val) };
      const id = uid();
      if (mode === "firebase") db.ref("players/" + id).set(player);
      else { state.players[id] = player; saveLocal(); render(); }
      completeAuth(name);
      return;
    }
    if (!name) { errEl.textContent = "กรุณาใส่ชื่อผู้ใช้"; errEl.hidden = false; return; }
    const found = findPlayerByName(name);
    if (!found) { errEl.textContent = "ไม่พบชื่อผู้ใช้นี้ในระบบ"; errEl.hidden = false; return; }
    const canonicalName = found[1].name;
    const storedHash = found?.[1]?.passwordHash;
    const validPersonal = storedHash && storedHash === await passwordHash(val);
    if (validPersonal || (!storedHash && val === sitePassword)) {
      completeAuth(canonicalName);
      if (!storedHash && val === sitePassword) showPasswordSetup(canonicalName, true);
      return;
    }
    if (sitePassword === null) {
      errEl.textContent = "⏳ กำลังโหลด กรุณารอสักครู่…";
      errEl.hidden = false;
      return;
    }
    const legacyVal = document.getElementById("authInput").value;
    if (false && legacyVal === sitePassword) {
      sessionStorage.setItem("glAuthed", "1");
      hideAuthOverlay();
    } else {
      errEl.textContent = "❌ รหัสผ่านไม่ถูกต้อง";
      errEl.hidden = false;
      document.getElementById("authInput").value = "";
      document.getElementById("authInput").focus();
    }
  });

  // ── Tabs ──────────────────────────────────────────────────────────────
  document.getElementById("passwordSetupForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = document.getElementById("authError");
    if (authRequireOldPassword) {
      const found = findPlayerByName(authSetupPlayer);
      const storedHash = found?.[1]?.passwordHash;
      const oldPassword = document.getElementById("oldPasswordInput").value;
      const oldValid = storedHash
        ? storedHash === await passwordHash(oldPassword)
        : oldPassword === sitePassword;
      if (!oldValid) { errEl.textContent = "รหัสผ่านเดิมไม่ถูกต้อง"; errEl.hidden = false; return; }
      authRequireOldPassword = false;
      document.getElementById("oldPasswordInput").hidden = true;
      document.getElementById("oldPasswordInput").required = false;
      document.getElementById("newPasswordInput").hidden = false;
      document.getElementById("newPasswordInput").required = true;
      document.getElementById("newPasswordConfirmInput").hidden = false;
      document.getElementById("newPasswordConfirmInput").required = true;
      document.querySelector('#passwordSetupForm button[type="submit"]').hidden = false;
      document.querySelector('#passwordSetupForm button[type="submit"]').textContent = "บันทึกรหัสผ่าน";
      document.getElementById("skipPasswordSetupBtn").hidden = false;
      document.getElementById("passwordSetupText").textContent = `ตั้งรหัสผ่านใหม่สำหรับ ${authSetupPlayer}`;
      document.getElementById("newPasswordInput").focus();
      return;
    }
    const pw = document.getElementById("newPasswordInput").value;
    const confirmPw = document.getElementById("newPasswordConfirmInput").value;
    if (!pw || pw !== confirmPw) { errEl.textContent = "รหัสผ่านไม่ตรงกัน"; errEl.hidden = false; return; }
    await savePlayerPassword(authSetupPlayer, await passwordHash(pw));
    closeAuthOverlay();
  });
  document.getElementById("skipPasswordSetupBtn").addEventListener("click", closeAuthOverlay);
  document.getElementById("changePasswordBtn").addEventListener("click", () => {
    if (!checkSession() || !authPlayerName) return;
    document.getElementById("authOverlay").hidden = false;
    showPasswordSetup(authPlayerName, false, true);
  });
  document.getElementById("logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem("glAuthed");
    sessionStorage.removeItem("glPlayer");
    authPlayerName = "";
    document.getElementById("authOverlay").hidden = false;
    document.getElementById("authForm").hidden = false;
    document.getElementById("createUserForm").hidden = true;
    document.getElementById("passwordSetupForm").hidden = true;
    document.getElementById("showCreateUserBtn").hidden = false;
    document.getElementById("authUsernameInput").value = "";
    document.getElementById("authInput").value = "";
    renderPlayerSelects();
    document.getElementById("authUsernameInput").focus();
  });

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });

  document.addEventListener("click", e => {
    const th = e.target.closest?.("th[data-sort][data-sort-kind]");
    if (th) toggleTableSort(th.dataset.sortKind, th.dataset.sort);
    const removeRoll = e.target.closest?.("[data-remove-roll]");
    if (removeRoll) removeOwnLog("roll", removeRoll.dataset.removeRoll);
    const removePull = e.target.closest?.("[data-remove-pull]");
    if (removePull) removeOwnLog("pull", removePull.dataset.removePull);
  });

  // ── Session pull: เพิ่มแถว ─────────────────────────────────────────────
  document.getElementById("addSessionPullBtn").addEventListener("click", () => {
    document.getElementById("sessionPullList").appendChild(buildSessionPullRow());
  });

  // ── โฮชิ checkbox ─────────────────────────────────────────────────────
  document.getElementById("rollHoshi").addEventListener("change", e => {
    const countInput = document.getElementById("rollCount");
    if (e.target.checked) { countInput.value = 1; countInput.disabled = true; }
    else { countInput.disabled = false; }
  });

  // ── Roll form ─────────────────────────────────────────────────────────
  document.getElementById("orbForm").addEventListener("submit", e => {
    e.preventDefault();
    const player = authPlayerName || document.getElementById("orbPlayerSelect").value;
    const expected = Number(document.getElementById("orbExpected").value);
    const actual = Number(document.getElementById("orbActual").value);
    if (!player || expected < 100 || expected > 300 || actual < 100 || actual > 300) return;
    addOrbReward(player, expected, actual);
    document.getElementById("orbExpected").value = "";
    document.getElementById("orbActual").value = "";
  });

  document.getElementById("rollForm").addEventListener("submit", e => {
    e.preventDefault();
    const player   = authPlayerName || document.getElementById("rollPlayerSelect").value;
    const bannerId = document.getElementById("rollBannerSelect").value;
    const hoshi    = document.getElementById("rollHoshi").checked;
    const rolls    = hoshi ? 1 : Number(document.getElementById("rollCount").value);
    if (!player || !bannerId || !rolls || rolls <= 0) return;

    const s       = state.settings;
    const spRows  = [...document.getElementById("sessionPullList").querySelectorAll(".sp-row")];
    const pullItems = spRows
      .map((row, i) => {
        const charId = row.querySelector(".sp-char").value;
        if (!charId) return null;
        const char = state.characters[charId];
        if (!char) return null;

        const stageId      = row.querySelector(".sp-stage").value || null;
        const stageApplies = stageId ? row.querySelector(".sp-stage-applies").checked : true;
        const dupTier      = Number(row.querySelector(".sp-dup").value);
        const role         = getCharRole(char);

        const entry = {
          player, bannerId,
          charId,
          charName:  char.name,
          category:  char.category,
          meta:      role === "meta",
          breaker:   role === "breaker",
          lowPerformance: role === "lowPerformance",
          dupTier, stageId, stageApplies,
          ts: Date.now() + i + 1,
        };
        entry.scoreSnapshot = pullScore(entry, s);
        return entry;
      })
      .filter(item => item !== null);

    // ── ยืนยันก่อนบันทึก ────────────────────────────────────────────────
    const bannerObj   = state.banners[bannerId];
    const bannerLabel = bannerObj ? `${bannerObj.name} (${bannerRatesSummary(bannerObj)})` : "ไม่ระบุ";
    const hoshiLine   = hoshi ? "  🌟 โฮชิ" : null;
    const pullSummary = pullItems.length
      ? pullItems.map(p => {
          const cat   = CATEGORIES.find(c => c.key === p.category)?.label || p.category;
          const flags = [p.meta?"Meta":null, p.breaker?"Breaker":null, p.lowPerformance?"Low performance":null, p.stageId?"มีด่าน":null].filter(Boolean).join(", ");
          return `  • ${p.charName} — ${cat} ดุ๊ป${p.dupTier}${flags?` [${flags}]`:""}  (${fmt(p.scoreSnapshot,1)} pts)`;
        }).join("\n")
      : "  (ไม่มีตัวที่ได้)";

    const msg = [
      "บันทึกข้อมูลต่อไปนี้?",
      "",
      `ผู้เล่น : ${player}`,
      `ตู้      : ${bannerLabel}`,
      `โรล     : ${rolls}`,
      hoshiLine, "",
      "ตัวที่ได้:", pullSummary, "",
      "⚠️  บันทึกแล้วแก้ไขย้อนหลังไม่ได้",
    ].filter(l => l !== null).join("\n");

    if (!confirm(msg)) return;

    // ── บันทึก ───────────────────────────────────────────────────────────
    if (mode === "firebase") {
      db.ref("rollLog").push({ player, bannerId, rolls, hoshi, ts: Date.now() });
      pullItems.forEach(p => db.ref("pullLog").push(p));
    } else {
      state.rollLog[uid()] = { player, bannerId, rolls, hoshi, ts: Date.now() };
      pullItems.forEach(p => { state.pullLog[uid()] = p; });
      saveLocal(); render();
    }
    recordAudit("add", "roll", "", `${player} (${rolls} rolls)`);

    document.getElementById("sessionPullList").innerHTML = "";
    document.getElementById("rollCount").value           = 1;
    document.getElementById("rollCount").disabled        = false;
    document.getElementById("rollHoshi").checked         = false;
  });

  // ── Player form ────────────────────────────────────────────────────────
  document.getElementById("playerForm").addEventListener("submit", e => {
    e.preventDefault();
    const input = document.getElementById("newPlayerName");
    const name  = input.value.trim();
    if (!name) return;
    if (playerNames().includes(name)) { alert("มีชื่อนี้อยู่แล้ว"); return; }
    addPlayer(name);
    input.value = "";
  });
  document.getElementById("playerList").addEventListener("click", e => {
    return;
    const id = e.target.dataset.removePlayer;
    if (id && confirm("ลบผู้เล่นนี้? (ประวัติ log เดิมจะยังอยู่แต่จะไม่โผล่ในดรอปดาวน์)"))
      removePlayer(id);
  });

  // ── Banner rate add / form ──────────────────────────────────────────────
  document.getElementById("addBannerRateBtn").addEventListener("click", () => addBannerRateRow());
  document.getElementById("bannerForm").addEventListener("submit", e => {
    e.preventDefault();
    const name     = document.getElementById("bannerName").value.trim();
    if (!name) return;
    const rateRows = [...document.querySelectorAll("#bannerRateRows .banner-rate-row")];
    const rates    = rateRows
      .map(row => ({ category: row.querySelector(".br-cat").value, rate: Number(row.querySelector(".br-rate").value || 0) }))
      .filter(r => r.rate > 0);
    if (!rates.length) { alert("กรุณาใส่อัตรา (%) อย่างน้อย 1 ประเภท"); return; }
    const rate5star = Number(document.getElementById("bannerRate5star").value || 12);
    const totalRate = rates.reduce((sum, r) => sum + r.rate, 0);
    if (totalRate > rate5star) { alert(`อัตรารวม (${fmt(totalRate,2)}%) เกินอัตรา 5★+ (${rate5star}%)`); return; }
    addBanner({ name, rate5star, rates });
    document.getElementById("bannerName").value         = "";
    document.getElementById("bannerRate5star").value    = "12";
    document.getElementById("bannerRateRows").innerHTML = "";
    addBannerRateRow();
  });
  document.getElementById("bannerList").addEventListener("click", e => {
    const id = e.target.dataset.removeBanner;
    if (id && confirm("ลบตู้นี้? (roll/pull log ที่อ้างถึงตู้นี้จะยังอยู่แต่จะไม่มีชื่อตู้)"))
      removeBanner(id);
  });

  // ── Character form ────────────────────────────────────────────────────
  document.getElementById("charForm").addEventListener("submit", e => {
    e.preventDefault();
    const name     = document.getElementById("newCharName").value.trim();
    const category = document.getElementById("newCharCategory").value;
    const role     = document.getElementById("newCharRole").value;
    if (!name) return;
    if (editingCharId) {
      updateCharacter(editingCharId, { name, category, role });
      editingCharId = null;
      document.getElementById("charSubmitBtn").textContent = "+ เพิ่มตัวละคร";
      document.getElementById("charCancelBtn").hidden = true;
    } else {
      addCharacter({ name, category, role });
    }
    e.target.reset();
  });
  document.getElementById("charCancelBtn").addEventListener("click", () => {
    editingCharId = null;
    document.getElementById("charForm").reset();
    document.getElementById("charSubmitBtn").textContent = "+ เพิ่มตัวละคร";
    document.getElementById("charCancelBtn").hidden = true;
  });
  document.getElementById("charBody").addEventListener("click", e => {
    const editId   = e.target.dataset.editChar;
    const removeId = e.target.dataset.removeChar;
    if (editId) {
      const c = state.characters[editId];
      if (!c) return;
      document.getElementById("newCharName").value        = c.name;
      document.getElementById("newCharCategory").value   = c.category;
      document.getElementById("newCharRole").value       = getCharRole(c);
      document.getElementById("charSubmitBtn").textContent = "บันทึก";
      document.getElementById("charCancelBtn").hidden = false;
      editingCharId = editId;
      document.getElementById("newCharName").focus();
    }
    if (removeId && confirm("ลบตัวละครนี้? (pull log ที่บันทึกไปแล้วจะยังอยู่ แต่ snapshot คะแนนไม่เปลี่ยน)")) {
      removeCharacter(removeId);
    }
  });

  // ── Stage form ────────────────────────────────────────────────────────
  document.getElementById("stageForm").addEventListener("submit", e => {
    e.preventDefault();
    const name       = document.getElementById("stageName").value.trim();
    const difficulty = Number(document.getElementById("stageDifficulty").value);
    const monthly    = document.getElementById("stageMonthly").checked;
    if (!name || difficulty < 1 || difficulty > 20) return;
    addStage({ name, difficulty, monthly });
    e.target.reset();
  });
  document.getElementById("stageBody").addEventListener("click", e => {
    const id = e.target.dataset.removeStage;
    if (id && confirm("ลบด่านนี้?")) removeStage(id);
  });

  // ── Settings live-edit ────────────────────────────────────────────────
  const bindSetting = (id, setter) => {
    document.getElementById(id).addEventListener("change", e => {
      setter(Number(e.target.value));
      persistSettings();
    });
  };
  bindSetting("setMetaBonus",    v => (state.settings.metaBonus    = v));
  bindSetting("setBreakerBonus", v => (state.settings.breakerBonus = v));
  bindSetting("setLowPerformanceMultiplier", v => (state.settings.lowPerformanceMultiplier = v));
  bindSetting("setMonthlyPoint", v => (state.settings.monthlyPoint = v));

  document.getElementById("baseScoreRows").addEventListener("change", e => {
    const key = e.target.dataset.base;
    if (!key) return;
    state.settings.baseScores[key] = Number(e.target.value);
    persistSettings();
  });
  document.getElementById("dupWeightRows").addEventListener("change", e => {
    const i = e.target.dataset.dup;
    if (i === undefined) return;
    state.settings.dupWeights[Number(i)] = Number(e.target.value);
    persistSettings();
  });

  // ── Initial empty banner rate row ─────────────────────────────────────
  addBannerRateRow();

  // ── Global floating tooltip ───────────────────────────────────────────
  (function () {
    const tipEl = document.createElement("div");
    tipEl.className = "global-tip";
    tipEl.style.display = "none";
    document.body.appendChild(tipEl);

    document.addEventListener("mouseenter", e => {
      if (!(e.target instanceof Element)) return;
      const wrap = e.target.closest(".tip-wrap");
      if (!wrap) return;
      const src = wrap.querySelector(".tip-box");
      if (!src) return;
      tipEl.innerHTML = src.innerHTML;
      tipEl.style.display = "block";
      const r  = wrap.getBoundingClientRect();
      const tw = tipEl.offsetWidth;
      const th = tipEl.offsetHeight;
      let top  = r.top - th - 10;
      let left = r.left;
      if (top < 8)                            top  = r.bottom + 10;
      if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
      if (left < 8)                           left = 8;
      tipEl.style.top  = top  + "px";
      tipEl.style.left = left + "px";
    }, true);

    document.addEventListener("mouseleave", e => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest(".tip-wrap")) tipEl.style.display = "none";
    }, true);
  })();

  initStore();
});
