// =========================================================================
// Gacha Luck Tracker — app.js v3
// + Character Database (เพิ่มตัวละครก่อน pull)
// + Breaker factor (+10 default)
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
};

let mode = "local";
let db   = null;

// -------------------------------------------------------------------------
// Auth
// -------------------------------------------------------------------------
let sitePassword = null;

function checkSession() { return sessionStorage.getItem("glAuthed") === "1"; }
function resolveAuth(pw) {
  sitePassword = (pw && String(pw).trim()) || "1234";
  if (checkSession()) hideAuthOverlay();
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
    }
  } catch (e) { console.warn("โหลด localStorage ล้มเหลว", e); }
  resolveAuth(localStorage.getItem("glPassword"));
  render();
}

function saveLocal() { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); }

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

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
}
function removePlayer(id) {
  if (mode === "firebase") db.ref("players/" + id).remove();
  else { delete state.players[id]; saveLocal(); render(); }
}

function addBanner(banner) {
  const id = uid();
  if (mode === "firebase") db.ref("banners/" + id).set(banner);
  else { state.banners[id] = banner; saveLocal(); render(); }
}
function removeBanner(id) {
  if (mode === "firebase") db.ref("banners/" + id).remove();
  else { delete state.banners[id]; saveLocal(); render(); }
}

function addCharacter(char) {
   const id = uid();
   if (mode === "firebase") {
     state.characters[id] = char;
     db.ref("characters/" + id).set(char);
   } else {
     state.characters[id] = char;
     saveLocal();
   }
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
   render();
}
function removeCharacter(id) {
  if (mode === "firebase") db.ref("characters/" + id).remove();
  else { delete state.characters[id]; saveLocal(); render(); }
}

function addStage(stage) {
  const id = uid();
  state.settings.stages = state.settings.stages || {};
  state.settings.stages[id] = stage;
  persistSettings();
}
function removeStage(id) {
  if (state.settings.stages) delete state.settings.stages[id];
  persistSettings();
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
  const dupW    = s.dupWeights[Math.min(Number(pull.dupTier), 3)] ?? 0;
  let score     = (base + meta + breaker) * dupW;
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
function computePlayerStats(playerName) {
  const s = state.settings;
  const playerRolls = Object.values(state.rollLog).filter(r => r.player === playerName);
  const playerPulls = Object.values(state.pullLog).filter(p => p.player === playerName);

  const totalRolls   = playerRolls.reduce((a, r) => a + Number(r.rolls || 0), 0);
  const actualPoints = playerPulls.reduce((a, p) => a + getPullScore(p, s), 0);
  const actualHits   = playerPulls.length;

  let expectedHits   = 0;
  let expectedPoints = 0;
  let variance       = 0;
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
    for (const re of rates) {
      const cr    = isHoshi
        ? (rate5star > 0 ? Number(re.rate) / rate5star : 0)
        : Number(re.rate) / 100;
      const base  = s.baseScores[re.category] || 0;
      const total = n * cr * base;
      expectedHits   += n * cr;
      expectedPoints += total;
      pTotal         += cr;
      if (bd.rateData[re.category]) {
        if (isHoshi) bd.rateData[re.category].hoshiTotal  += total;
        else         bd.rateData[re.category].normalTotal += total;
      }
    }
    variance += n * pTotal * Math.max(1 - pTotal, 0);
  }

  const breakdown = Object.values(bannerMap).map(bd => ({
    ...bd,
    total: Object.values(bd.rateData).reduce((acc, r) => acc + r.normalTotal + r.hoshiTotal, 0),
  }));

  const sd = Math.sqrt(variance);
  const z  = variance > 0 ? (actualHits - expectedHits) / sd : 0;

  return { player: playerName, totalRolls, actualHits, expectedHits,
           actualPoints, expectedPoints, deviation: actualPoints - expectedPoints, z, breakdown };
}

// -------------------------------------------------------------------------
// Rendering helpers
// -------------------------------------------------------------------------
function fmt(n, d = 2) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtDate(ts) {
  return new Date(ts).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}
function playerNames()   { return Object.values(state.players).map(p => p.name); }
function bannerEntries() { return Object.entries(state.banners); }

function render() {
  renderPlayerSelects();
  renderBannerSelects();
  renderPlayerChips();
  renderBannerChips();
  renderSettingsForm();
  renderStageTable();
  renderCharacterList();
  renderRollLogTable();
  renderPullLogTable();
  renderDashboard();
}

function renderPlayerSelects() {
  const names = playerNames();
  const sel   = document.getElementById("rollPlayerSelect");
  const prev  = sel.value;
  sel.innerHTML = names.length
    ? names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("")
    : `<option value="">— เพิ่มผู้เล่นในแท็บตั้งค่าก่อน —</option>`;
  if (names.includes(prev)) sel.value = prev;
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
  ul.innerHTML  = entries.length
    ? entries.map(([id, p]) =>
        `<li>${esc(p.name)} <button data-remove-player="${id}" title="ลบ">×</button></li>`
      ).join("")
    : `<li class="hint small">ยังไม่มีผู้เล่น</li>`;
}

function renderBannerChips() {
  const ul      = document.getElementById("bannerList");
  const entries = bannerEntries();
  ul.innerHTML  = entries.length
    ? entries.map(([id, b]) => {
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

function renderStageTable() {
  const tbody   = document.getElementById("stageBody");
  const stages  = state.settings.stages || {};
  const entries = Object.entries(stages);
  tbody.innerHTML = entries.length
    ? entries.map(([id, st]) => {
        const diffDisplay = st.difficulty !== undefined ? st.difficulty : `${fmt(st.weight, 2)} (เก่า)`;
        const pts = stagePointsOf(st, state.settings);
        return `<tr>
          <td class="name">${esc(st.name)}</td>
          <td>${diffDisplay}</td>
          <td>${st.monthly ? "✔" : "—"}</td>
          <td>${fmt(pts, 0)}</td>
          <td><button class="icon-btn" data-remove-stage="${id}" title="ลบ">×</button></td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="5" class="empty-hint">ยังไม่มีด่าน</td></tr>`;
}

function renderCharacterList() {
  const tbody = document.getElementById("charBody");
  if (!tbody) return;
  const entries = Object.entries(state.characters).sort((a, b) => a[1].name.localeCompare(b[1].name, "th"));
  tbody.innerHTML = entries.length
    ? entries.map(([id, c]) => {
        const catLabel = CATEGORIES.find(x => x.key === c.category)?.label || c.category;
        const role     = getCharRole(c);
        const roleBadge = role === "meta"
          ? '<span class="hoshi-badge" style="background:#c4920a">Meta</span>'
          : role === "breaker"
          ? '<span class="hoshi-badge" style="background:#7c4dff">Breaker</span>'
          : "—";
        return `<tr>
          <td class="name charname-cell">${esc(c.name)}</td>
          <td>${esc(catLabel)}</td>
          <td>${roleBadge}</td>
          <td>
            <button class="btn-sm btn-secondary" data-edit-char="${id}">แก้ไข</button>
            <button class="icon-btn" data-remove-char="${id}" title="ลบ">×</button>
          </td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="4" class="empty-hint">ยังไม่มีตัวละคร — เพิ่มด้านบน</td></tr>`;
}

function renderRollLogTable() {
  const tbody = document.getElementById("rollLogBody");
  const rows  = Object.values(state.rollLog).sort((a, b) => b.ts - a.ts).slice(0, 100);
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
        </tr>`;
      }).join("")
    : `<tr><td colspan="5" class="empty-hint">ยังไม่มีข้อมูล</td></tr>`;
}

function buildScoreTip(p, s) {
  const base    = s.baseScores[p.category] || 0;
  const meta    = p.meta    ? (s.metaBonus    || 0) : 0;
  const breaker = p.breaker ? (s.breakerBonus || 0) : 0;
  const dupW    = s.dupWeights[Math.min(Number(p.dupTier), 3)] ?? 0;
  const charPts = (base + meta + breaker) * dupW;

  const bonuses = [];
  if (meta > 0)    bonuses.push(`Meta ${meta}`);
  if (breaker > 0) bonuses.push(`Breaker ${breaker}`);
  const baseStr = bonuses.length ? `${base} + ${bonuses.join(" + ")}` : `${base}`;

  let lines = [`(${baseStr}) × dup ${dupW}  =  ${fmt(charPts, 1)} pts`];

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
  const rows = Object.values(state.pullLog).sort((a, b) => b.ts - a.ts).slice(0, 300);
  tbody.innerHTML = rows.length
    ? rows.map(p => {
        const cat       = CATEGORIES.find(c => c.key === p.category)?.label || p.category;
        const stage     = p.stageId && s.stages?.[p.stageId];
        const stageName = stage ? esc(stage.name) : `<span class="hint small">—</span>`;
        const stageGot  = p.stageId ? (p.stageApplies !== false ? "✔" : "✘") : "—";
        const dupLabel  = `${p.dupTier}${Number(p.dupTier) >= 3 ? "+" : ""}`;
        const score     = getPullScore(p, s);
        const tipText   = esc(buildScoreTip(p, s));
        return `<tr>
          <td>${fmtDate(p.ts)}</td>
          <td class="name">${esc(p.player)}</td>
          <td class="name charname-cell">${p.charName ? esc(p.charName) : '<span class="hint small">—</span>'}</td>
          <td>${esc(cat)}</td>
          <td>${dupLabel}</td>
          <td>${p.meta    ? "✔" : "—"}</td>
          <td>${p.breaker ? '<span class="hoshi-badge" style="background:#7c4dff;font-size:10px">B</span>' : "—"}</td>
          <td class="name">${stageName}</td>
          <td>${stageGot}</td>
          <td class="score-cell tip-wrap">
            <span class="score-num">${fmt(score, 1)}</span>
            <div class="tip-box">${tipText}</div>
          </td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="10" class="empty-hint">ยังไม่มีตัวละครที่บันทึก</td></tr>`;
}

function buildExpectedTip(breakdown, expectedPoints) {
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
  parts.push(`รวมทั้งหมด  ${fmt(expectedPoints, 1)} pts`);
  parts.push("");
  parts.push("ปกติ : rolls × rate%       × Base");
  parts.push("โฮชิ : 1roll × (rate/5★%) × Base");
  return esc(parts.join("\n"));
}

function renderDashboard() {
  const names     = playerNames();
  const tbody     = document.getElementById("dashboardBody");
  const emptyHint = document.getElementById("dashboardEmpty");
  const stats     = names.map(computePlayerStats).filter(st => st.totalRolls > 0);

  if (!stats.length) { tbody.innerHTML = ""; emptyHint.hidden = false; return; }
  emptyHint.hidden = true;

  const sortedByZ = [...stats].sort((a, b) => a.z - b.z);
  const rankOf    = new Map(sortedByZ.map((st, i) => [st.player, i + 1]));

  tbody.innerHTML = stats.map(st => {
    const rank      = rankOf.get(st.player);
    const zClass    = st.z <= -2 ? "z-bad" : st.z >= 2 ? "z-good" : "";
    const rankClass = rank === 1 ? "rank-1" : "";
    const devClass  = st.deviation < 0 ? "z-bad" : st.deviation > 0 ? "z-good" : "";
    const expTip    = buildExpectedTip(st.breakdown, st.expectedPoints);
    return `<tr>
      <td class="name">${esc(st.player)}</td>
      <td>${st.totalRolls}</td>
      <td>${st.actualHits}</td>
      <td>${fmt(st.actualPoints, 1)}</td>
      <td class="tip-wrap">${fmt(st.expectedPoints, 1)}<div class="tip-box exp-tip">${expTip}</div></td>
      <td class="${devClass}">${fmt(st.deviation, 1)}</td>
      <td class="${zClass}">${fmt(st.z, 2)}</td>
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
        const roleTag = role === "meta" ? " ⭐" : role === "breaker" ? " 🔨" : "";
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

  // ── Auth ──────────────────────────────────────────────────────────────
  document.getElementById("authForm").addEventListener("submit", e => {
    e.preventDefault();
    const errEl = document.getElementById("authError");
    if (sitePassword === null) {
      errEl.textContent = "⏳ กำลังโหลด กรุณารอสักครู่…";
      errEl.hidden = false;
      return;
    }
    const val = document.getElementById("authInput").value;
    if (val === sitePassword) {
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
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
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
  document.getElementById("rollForm").addEventListener("submit", e => {
    e.preventDefault();
    const player   = document.getElementById("rollPlayerSelect").value;
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
          const flags = [p.meta?"Meta":null, p.breaker?"Breaker":null, p.stageId?"มีด่าน":null].filter(Boolean).join(", ");
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
      if (e.target.closest(".tip-wrap")) tipEl.style.display = "none";
    }, true);
  })();

  initStore();
});
