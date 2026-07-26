// =========================================================================
// Gacha Luck Tracker — app.js v2  (ระบบโฮชิ + ตู้เป็น List)
// state = {
//   settings : { baseScores{}, dupWeights[4], diffDupWeights[4],
//                metaBonus, maxDifficulty, monthlyPoint, stages:{} },
//   banners  : { id: { name, collabRate } },
//   players  : { id: { name } },
//   rollLog  : { id: { player, bannerId, rolls, hoshi, ts } },
//   pullLog  : { id: { player, bannerId, category, dupTier, meta, stageId, ts } }
// }
// =========================================================================

const CATEGORIES = [
  { key: "limitEndMid",  label: "Limit end / mid" },
  { key: "limitElement", label: "Limit element" },
  { key: "collab",       label: "Collab" },
  { key: "alpha",        label: "Alpha" },
  { key: "otherLimit",   label: "Other limit" },
];

// Normalize banner → always return rates[] (backward compat with old collabRate format)
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
  baseScores:     { limitEndMid: 15, limitElement: 15, collab: 10, alpha: 10, otherLimit: 10 },
  dupWeights:     [1, 0.6, 0.3, 0],
  metaBonus:      10,
  monthlyPoint:   5,
  stages:         {},
};

let state = {
  settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
  banners:  {},
  players:  {},
  rollLog:  {},
  pullLog:  {},
};

let mode = "local"; // "local" | "firebase"
let db   = null;

// -------------------------------------------------------------------------
// Auth (password gate)
// -------------------------------------------------------------------------
let sitePassword = null; // null = ยังไม่โหลดจาก DB

function checkSession() {
  return sessionStorage.getItem("glAuthed") === "1";
}

function resolveAuth(pw) {
  sitePassword = (pw && String(pw).trim()) || "1234";
  if (checkSession()) hideAuthOverlay();
}

function hideAuthOverlay() {
  const el = document.getElementById("authOverlay");
  if (el) el.hidden = true;
}

// -------------------------------------------------------------------------
// Storage layer
// -------------------------------------------------------------------------
const LOCAL_KEY     = "gachaLuckStateV2";
const LOCAL_KEY_OLD = "gachaLuckState";

function loadLocal() {
  try {
    let raw = localStorage.getItem(LOCAL_KEY);

    if (!raw) {
      // ลองอ่านข้อมูลเก่า (v1) แล้ว migrate
      const oldRaw = localStorage.getItem(LOCAL_KEY_OLD);
      if (oldRaw) {
        const old = JSON.parse(oldRaw);
        state.settings = Object.assign({}, DEFAULT_SETTINGS, old.settings || {});
        state.settings.baseScores = Object.assign({}, DEFAULT_SETTINGS.baseScores, (old.settings || {}).baseScores || {});
        state.settings.stages     = (old.settings || {}).stages || {};
        state.players  = old.players  || {};
        state.rollLog  = old.rollLog  || {};   // entries เก่าไม่มี bannerId — OK
        state.pullLog  = old.pullLog  || {};
        state.banners  = {};
        saveLocal();
      }
    } else {
      const parsed = JSON.parse(raw);
      state.settings = Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {});
      state.settings.baseScores = Object.assign({}, DEFAULT_SETTINGS.baseScores, (parsed.settings || {}).baseScores || {});
      state.settings.stages     = (parsed.settings || {}).stages || {};
      state.banners  = parsed.banners  || {};
      state.players  = parsed.players  || {};
      state.rollLog  = parsed.rollLog  || {};
      state.pullLog  = parsed.pullLog  || {};
    }
  } catch (e) {
    console.warn("โหลด localStorage ไม่สำเร็จ", e);
  }
  resolveAuth(localStorage.getItem("glPassword"));
  render();
}

function saveLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
      firebase.auth().signInAnonymously().catch((err) => {
        console.error("Anonymous auth ล้มเหลว", err);
        setConnStatus("error", "เชื่อม Firebase ไม่สำเร็จ (auth) — ใช้ local แทน");
        mode = "local";
        loadLocal();
      });
      firebase.auth().onAuthStateChanged((user) => {
        if (user) {
          setConnStatus("online", "ออนไลน์ (Firebase) — แชร์ข้อมูลแบบสด");
          attachFirebaseListeners();
        }
      });
    } catch (e) {
      console.error(e);
      mode = "local";
      loadLocal();
    }
  } else {
    mode = "local";
    setConnStatus("local", "โหมดเครื่องนี้เครื่องเดียว (ยังไม่ตั้งค่า Firebase)");
    loadLocal();
  }
}

function attachFirebaseListeners() {
  // อ่านรหัสผ่านจาก DB ก่อน (1 ครั้ง)
  db.ref("sitePassword").once("value", snap => {
    resolveAuth(snap.val());
  });

  db.ref("settings").on("value", (snap) => {
    const val = snap.val();
    if (!val) { db.ref("settings").set(DEFAULT_SETTINGS); return; }
    state.settings = Object.assign({}, DEFAULT_SETTINGS, val);
    state.settings.baseScores = Object.assign({}, DEFAULT_SETTINGS.baseScores, val.baseScores || {});
    state.settings.stages = val.stages || {};
    render();
  });
  db.ref("banners").on("value", (snap) => {
    state.banners = snap.val() || {};
    render();
  });
  db.ref("players").on("value", (snap) => {
    state.players = snap.val() || {};
    render();
  });
  db.ref("rollLog").on("value", (snap) => {
    state.rollLog = snap.val() || {};
    render();
  });
  db.ref("pullLog").on("value", (snap) => {
    state.pullLog = snap.val() || {};
    render();
  });
}

function setConnStatus(kind, text) {
  const el = document.getElementById("connStatus");
  el.className = "conn-status conn-" +
    (kind === "online" ? "online" : kind === "error" ? "bad" : "local");
  el.textContent = "โหมด: " + text;
  document.getElementById("footerMode").textContent =
    mode === "firebase"
      ? "เชื่อมต่อ Firebase อยู่"
      : "เก็บข้อมูลใน localStorage เครื่องนี้เท่านั้น";
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

function addPullEntry(entry) {
  entry.ts = Date.now();
  if (mode === "firebase") db.ref("pullLog").push(entry);
  else { state.pullLog[uid()] = entry; saveLocal(); render(); }
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

// -------------------------------------------------------------------------
// Scoring engine
// -------------------------------------------------------------------------
function stagePointsOf(stage, s) {
  // ใหม่: difficulty 1-20 ตรงๆ | เก่า: weight × 20 (backward compat)
  const diffPts = stage.difficulty !== undefined
    ? Number(stage.difficulty)
    : Math.round((stage.weight || 0) * 20);
  return diffPts + (stage.monthly ? (s.monthlyPoint || 0) : 0);
}

function pullScore(pull, s) {
  const base  = s.baseScores[pull.category] || 0;
  const meta  = pull.meta ? s.metaBonus : 0;
  const dupW  = s.dupWeights[Math.min(pull.dupTier, 3)] ?? 0;
  let score   = (base + meta) * dupW;

  // ได้แต้มด่านเฉพาะเมื่อ stageApplies !== false (ค่า default = true สำหรับข้อมูลเก่า)
  if (pull.stageId && pull.stageApplies !== false && s.stages?.[pull.stageId]) {
    score += stagePointsOf(s.stages[pull.stageId], s);
  }
  return score;
}

// -------------------------------------------------------------------------
// Dashboard computation — hoshi uses renormalized probability (rate/rate5star)
// -------------------------------------------------------------------------
function computePlayerStats(playerName) {
  const s = state.settings;
  const playerRolls = Object.values(state.rollLog).filter(r => r.player === playerName);
  const playerPulls = Object.values(state.pullLog).filter(p => p.player === playerName);

  const totalRolls   = playerRolls.reduce((a, r) => a + Number(r.rolls || 0), 0);
  const actualPoints = playerPulls.reduce((a, p) => a + pullScore(p, s), 0);
  const actualHits   = playerPulls.length;

  let expectedHits   = 0;
  let expectedPoints = 0;
  let variance       = 0;
  const bannerMap    = {};  // for tooltip breakdown

  for (const roll of playerRolls) {
    const banner    = roll.bannerId && state.banners[roll.bannerId];
    const rates     = getBannerRates(banner);
    const n         = Number(roll.rolls || 0);
    const isHoshi   = !!roll.hoshi;
    const rate5star = (banner?.rate5star != null) ? Number(banner.rate5star) : 12;
    const bid       = roll.bannerId || "__none__";

    if (!rates.length || !n) continue;

    // init banner breakdown entry
    if (!bannerMap[bid]) {
      bannerMap[bid] = {
        name: banner?.name || "(ไม่ระบุตู้)",
        rate5star,
        normalRolls: 0,
        hoshiRolls:  0,
        rateData: {},
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
    if (isHoshi) bd.hoshiRolls += n;
    else         bd.normalRolls += n;

    let pTotal = 0;
    for (const re of rates) {
      // ปกติ: rate/100 | โฮชิ: rate/rate5star (renormalize เพราะ 5★ ออก 100%)
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

  return {
    player: playerName,
    totalRolls, actualHits, expectedHits,
    actualPoints, expectedPoints,
    deviation: actualPoints - expectedPoints,
    z, breakdown,
  };
}

// -------------------------------------------------------------------------
// Rendering helpers
// -------------------------------------------------------------------------
function fmt(n, d = 2) {
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: d, maximumFractionDigits: d,
  });
}
function fmtDate(ts) {
  return new Date(ts).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}
function playerNames()  { return Object.values(state.players).map(p => p.name); }
function bannerEntries(){ return Object.entries(state.banners); }

function render() {
  renderPlayerSelects();
  renderBannerSelects();
  renderPlayerChips();
  renderBannerChips();
  renderSettingsForm();
  renderStageTable();
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
  const ids = entries.map(([bid]) => bid);
  if (ids.includes(prev)) sel.value = prev;
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
  document.getElementById("setMetaBonus").value   = s.metaBonus;
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
  const base  = s.baseScores[p.category] || 0;
  const meta  = p.meta ? (s.metaBonus || 0) : 0;
  const dupW  = s.dupWeights[Math.min(Number(p.dupTier), 3)] ?? 0;
  const charPts = (base + meta) * dupW;

  const baseStr = meta > 0 ? `(${base} + Meta ${meta})` : `${base}`;
  let lines = [
    `${baseStr} × dup ${dupW}  =  ${fmt(charPts, 1)} pts`,
  ];

  let stagePts = 0;
  if (p.stageId && p.stageApplies !== false && s.stages?.[p.stageId]) {
    const st = s.stages[p.stageId];
    const diff = st.difficulty !== undefined ? Number(st.difficulty) : Math.round((st.weight || 0) * 20);
    const monthly = st.monthly ? (s.monthlyPoint || 0) : 0;
    stagePts = diff + monthly;
    const monthlyStr = monthly > 0 ? ` + monthly ${monthly}` : "";
    lines.push(`+ ด่าน "${st.name}"  ยาก ${diff}${monthlyStr}  =  +${stagePts} pts`);
  } else if (p.stageId && p.stageApplies === false) {
    lines.push(`ด่าน: ซ้ำ — ไม่ได้แต้มด่าน`);
  }

  const total = charPts + stagePts;
  lines.push(`─────────────────────`);
  lines.push(`รวม  ${fmt(total, 1)} pts`);
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
        const score     = pullScore(p, s);
        const tipText   = esc(buildScoreTip(p, s));
        return `<tr>
          <td>${fmtDate(p.ts)}</td>
          <td class="name">${esc(p.player)}</td>
          <td class="name charname-cell">${p.charName ? esc(p.charName) : '<span class="hint small">—</span>'}</td>
          <td>${esc(cat)}</td>
          <td>${dupLabel}</td>
          <td>${p.meta ? "✔" : "—"}</td>
          <td class="name">${stageName}</td>
          <td>${stageGot}</td>
          <td class="score-cell tip-wrap">
            <span class="score-num">${fmt(score, 1)}</span>
            <div class="tip-box">${tipText}</div>
          </td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="9" class="empty-hint">ยังไม่มีตัวละครที่บันทึก</td></tr>`;
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

  const stats = names.map(computePlayerStats).filter(st => st.totalRolls > 0);

  if (!stats.length) {
    tbody.innerHTML = "";
    emptyHint.hidden = false;
    return;
  }
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
// Session pull rows (ตัวละครที่ได้ในเซสชันนี้ก่อนกดบันทึก)
// -------------------------------------------------------------------------
function buildSessionPullRow() {
  const stages    = state.settings.stages || {};
  const stageOpts = Object.entries(stages)
    .map(([id, st]) => `<option value="${id}">${esc(st.name)}</option>`)
    .join("");

  const row = document.createElement("div");
  row.className = "sp-row";
  row.innerHTML = `
    <input type="text" class="sp-charname" placeholder="ชื่อตัวละคร">
    <select class="sp-cat">
      ${CATEGORIES.map(c => `<option value="${c.key}">${c.label}</option>`).join("")}
    </select>
    <select class="sp-dup">
      <option value="0">ดุ๊ป 0 (ใหม่)</option>
      <option value="1">ดุ๊ป 1</option>
      <option value="2">ดุ๊ป 2</option>
      <option value="3">ดุ๊ป 3+</option>
    </select>
    <label class="sp-meta-label"><input type="checkbox" class="sp-meta"> Meta</label>
    <select class="sp-stage">
      <option value="">— ไม่มีด่าน —</option>
      ${stageOpts}
    </select>
    <label class="sp-meta-label sp-stage-bonus" style="display:none">
      <input type="checkbox" class="sp-stage-applies" checked> ได้แต้มด่าน
    </label>
    <button type="button" class="sp-del icon-btn" title="ลบแถวนี้">×</button>
  `;
  const stageSelect  = row.querySelector(".sp-stage");
  const stageBonusLbl = row.querySelector(".sp-stage-bonus");
  stageSelect.addEventListener("change", () => {
    stageBonusLbl.style.display = stageSelect.value ? "" : "none";
  });
  row.querySelector(".sp-del").addEventListener("click", () => row.remove());
  return row;
}

// -------------------------------------------------------------------------
// Banner rate row builder (for settings form)
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
document.addEventListener("DOMContentLoaded", () => {

  // ── Auth form ─────────────────────────────────────────────────────────
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

  // ── Session pull: เพิ่มแถว ────────────────────────────────────────────
  document.getElementById("addSessionPullBtn").addEventListener("click", () => {
    document.getElementById("sessionPullList").appendChild(buildSessionPullRow());
  });

  // ── โฮชิ checkbox: ล็อคโรลให้เป็น 1 เสมอ ─────────────────────────────
  document.getElementById("rollHoshi").addEventListener("change", e => {
    const countInput = document.getElementById("rollCount");
    if (e.target.checked) {
      countInput.value    = 1;
      countInput.disabled = true;
    } else {
      countInput.disabled = false;
    }
  });

  // ── Roll form (บันทึกโรล + session pulls พร้อมกัน) ───────────────────
  document.getElementById("rollForm").addEventListener("submit", e => {
    e.preventDefault();
    const player   = document.getElementById("rollPlayerSelect").value;
    const bannerId = document.getElementById("rollBannerSelect").value;
    const hoshi    = document.getElementById("rollHoshi").checked;
    const rolls    = hoshi ? 1 : Number(document.getElementById("rollCount").value);
    if (!player || !bannerId || !rolls || rolls <= 0) return;

    // รวบรวม session pulls — กรอง Normal ที่ไม่มีด่านออก
    const spRows    = [...document.getElementById("sessionPullList").querySelectorAll(".sp-row")];
    const pullItems = spRows
      .map((row, i) => {
        const stageId = row.querySelector(".sp-stage").value || null;
        const stageApplies = stageId
          ? row.querySelector(".sp-stage-applies").checked
          : true;
        return {
          player,
          bannerId,
          charName: row.querySelector(".sp-charname").value.trim(),
          category: row.querySelector(".sp-cat").value,
          dupTier:  Number(row.querySelector(".sp-dup").value),
          meta:     row.querySelector(".sp-meta").checked,
          stageId,
          stageApplies,
          ts:       Date.now() + i + 1,
        };
      })
      .filter(item => item.category === "collab" || item.stageId);

    // ── ยืนยันก่อนบันทึก ────────────────────────────────────────────────
    const bannerObj   = state.banners[bannerId];
    const bannerLabel = bannerObj ? `${bannerObj.name} (${bannerRatesSummary(bannerObj)})` : "ไม่ระบุ";
    const hoshiLabel  = hoshi ? "  🌟 โฮชิ\n" : "";
    const pullSummary = pullItems.length
      ? pullItems.map(p => {
          const cat = CATEGORIES.find(c => c.key === p.category)?.label || p.category;
          const nameStr = p.charName ? `${p.charName} — ` : "";
          return `  • ${nameStr}${cat} ดุ๊ป${p.dupTier}${p.meta ? " [Meta]" : ""}${p.stageId ? " [มีด่าน]" : ""}`;
        }).join("\n")
      : "  (ไม่มีตัวที่ได้)";

    const msg = [
      "บันทึกข้อมูลต่อไปนี้?",
      "",
      `ผู้เล่น : ${player}`,
      `ตู้      : ${bannerLabel}`,
      `โรล     : ${rolls}`,
      hoshiLabel.trim() ? hoshiLabel.trim() : null,
      "",
      "ตัวที่ได้:",
      pullSummary,
      "",
      "⚠️  บันทึกแล้วแก้ไขย้อนหลังไม่ได้",
    ].filter(l => l !== null).join("\n");

    if (!confirm(msg)) return;

    // ── บันทึก ────────────────────────────────────────────────────────────
    if (mode === "firebase") {
      db.ref("rollLog").push({ player, bannerId, rolls, hoshi, ts: Date.now() });
      pullItems.forEach(p => db.ref("pullLog").push(p));
    } else {
      state.rollLog[uid()] = { player, bannerId, rolls, hoshi, ts: Date.now() };
      pullItems.forEach(p => { state.pullLog[uid()] = p; });
      saveLocal();
      render();
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

  // ── Banner rate add button ─────────────────────────────────────────────
  document.getElementById("addBannerRateBtn").addEventListener("click", () => {
    addBannerRateRow();
  });

  // ── Banner form submit ─────────────────────────────────────────────────
  document.getElementById("bannerForm").addEventListener("submit", e => {
    e.preventDefault();
    const name = document.getElementById("bannerName").value.trim();
    if (!name) return;

    const rateRows = [...document.querySelectorAll("#bannerRateRows .banner-rate-row")];
    const rates    = rateRows
      .map(row => ({
        category: row.querySelector(".br-cat").value,
        rate:     Number(row.querySelector(".br-rate").value || 0),
      }))
      .filter(r => r.rate > 0);

    if (!rates.length) {
      alert("กรุณาใส่อัตรา (%) อย่างน้อย 1 ประเภท");
      return;
    }

    const rate5star  = Number(document.getElementById("bannerRate5star").value || 12);
    const totalRate  = rates.reduce((sum, r) => sum + r.rate, 0);
    if (totalRate > rate5star) {
      alert(`อัตรารวม (${fmt(totalRate, 2)}%) เกินอัตรา 5★+ (${rate5star}%) — กรุณาตรวจสอบ`);
      return;
    }

    addBanner({ name, rate5star, rates });
    document.getElementById("bannerName").value         = "";
    document.getElementById("bannerRate5star").value    = "12";
    document.getElementById("bannerRateRows").innerHTML = "";
    addBannerRateRow(); // reset with one empty row
  });

  document.getElementById("bannerList").addEventListener("click", e => {
    const id = e.target.dataset.removeBanner;
    if (id && confirm("ลบตู้นี้? (roll/pull log ที่อ้างถึงตู้นี้จะยังอยู่แต่จะไม่มีชื่อตู้)"))
      removeBanner(id);
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
  const bindSetting = (id, setter, isNumber = true) => {
    document.getElementById(id).addEventListener("change", e => {
      setter(isNumber ? Number(e.target.value) : e.target.value);
      persistSettings();
    });
  };
  bindSetting("setMetaBonus",    v => (state.settings.metaBonus   = v));
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

  // ── Global floating tooltip (position:fixed — ไม่โดน overflow บัง) ────
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
      // แสดงเหนือ cell; ถ้าชิดขอบบนให้แสดงใต้แทน
      let top  = r.top - th - 10;
      let left = r.left;
      if (top < 8)                              top  = r.bottom + 10;
      if (left + tw > window.innerWidth - 8)   left = window.innerWidth - tw - 8;
      if (left < 8)                             left = 8;
      tipEl.style.top  = top  + "px";
      tipEl.style.left = left + "px";
    }, true);

    document.addEventListener("mouseleave", e => {
      if (e.target.closest(".tip-wrap")) tipEl.style.display = "none";
    }, true);
  })();

  initStore();
});
