// =========================================================================
// Gacha Luck Tracker — app.js
// โครงสร้างข้อมูล (ไม่ว่าจะเก็บบน Firebase Realtime DB หรือ localStorage):
// state = {
//   settings: { evRate, evCategory, baseScores{}, dupWeights[4], diffDupWeights[4],
//               metaBonus, maxDifficulty, monthlyPoint, stages:{id:{name,weight,monthly}} },
//   players: { id: {name} },
//   rollLog: { id: {player, rolls, ts} },   // append-only
//   pullLog: { id: {player, category, dupTier, meta, stageId, ts} } // append-only
// }
// =========================================================================

const CATEGORIES = [
  { key: "limitEndMid", label: "Limit end / mid" },
  { key: "limitElement", label: "Limit element" },
  { key: "collab", label: "Collab" },
  { key: "alpha", label: "Alpha" },
  { key: "otherLimit", label: "Other limit" },
];

const DEFAULT_SETTINGS = {
  evRate: 7.2, // เก็บเป็น % เพื่อให้แก้ในฟอร์มง่าย หารร้อยตอนคำนวณ
  evCategory: "collab",
  baseScores: { limitEndMid: 15, limitElement: 15, collab: 10, alpha: 10, otherLimit: 10 },
  dupWeights: [1, 0.6, 0.3, 0],
  diffDupWeights: [1, 0.6, 0, 0],
  metaBonus: 10,
  maxDifficulty: 20,
  monthlyPoint: 5,
  stages: {},
};

let state = {
  settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
  players: {},
  rollLog: {},
  pullLog: {},
};

let mode = "local"; // "local" | "firebase"
let db = null;

// -------------------------------------------------------------------------
// Storage layer
// -------------------------------------------------------------------------
const LOCAL_KEY = "gachaLuckState";

function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.settings = Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {});
      state.settings.baseScores = Object.assign({}, DEFAULT_SETTINGS.baseScores, (parsed.settings || {}).baseScores || {});
      state.players = parsed.players || {};
      state.rollLog = parsed.rollLog || {};
      state.pullLog = parsed.pullLog || {};
    }
  } catch (e) {
    console.warn("โหลด localStorage ไม่สำเร็จ", e);
  }
  render();
}

function saveLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

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
  db.ref("settings").on("value", (snap) => {
    const val = snap.val();
    if (!val) {
      db.ref("settings").set(DEFAULT_SETTINGS);
      return;
    }
    state.settings = Object.assign({}, DEFAULT_SETTINGS, val);
    state.settings.baseScores = Object.assign({}, DEFAULT_SETTINGS.baseScores, val.baseScores || {});
    state.settings.stages = val.stages || {};
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
  el.className = "conn-status conn-" + (kind === "online" ? "online" : kind === "error" ? "bad" : "local");
  el.textContent = "โหมด: " + text;
  document.getElementById("footerMode").textContent =
    mode === "firebase" ? "เชื่อมต่อ Firebase อยู่" : "เก็บข้อมูลใน localStorage เครื่องนี้เท่านั้น";
}

function persistSettings() {
  if (mode === "firebase") {
    db.ref("settings").set(state.settings);
  } else {
    saveLocal();
    render();
  }
}

function addPlayer(name) {
  const id = uid();
  if (mode === "firebase") {
    db.ref("players/" + id).set({ name });
  } else {
    state.players[id] = { name };
    saveLocal();
    render();
  }
}

function removePlayer(id) {
  if (mode === "firebase") {
    db.ref("players/" + id).remove();
  } else {
    delete state.players[id];
    saveLocal();
    render();
  }
}

function addRollEntry(entry) {
  entry.ts = Date.now();
  if (mode === "firebase") {
    db.ref("rollLog").push(entry);
  } else {
    state.rollLog[uid()] = entry;
    saveLocal();
    render();
  }
}

function addPullEntry(entry) {
  entry.ts = Date.now();
  if (mode === "firebase") {
    db.ref("pullLog").push(entry);
  } else {
    state.pullLog[uid()] = entry;
    saveLocal();
    render();
  }
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
  return stage.weight * s.maxDifficulty + (stage.monthly ? s.monthlyPoint : 0);
}

function pullScore(pull, s) {
  const base = s.baseScores[pull.category] || 0;
  const meta = pull.meta ? s.metaBonus : 0;
  const dupW = s.dupWeights[Math.min(pull.dupTier, 3)] ?? 0;
  let score = (base + meta) * dupW;

  if (pull.stageId && s.stages && s.stages[pull.stageId]) {
    const stage = s.stages[pull.stageId];
    const diffDupW = s.diffDupWeights[Math.min(pull.dupTier, 3)] ?? 0;
    score += stagePointsOf(stage, s) * diffDupW;
  }
  return score;
}

function computePlayerStats(playerName) {
  const s = state.settings;
  const rolls = Object.values(state.rollLog).filter((r) => r.player === playerName);
  const pulls = Object.values(state.pullLog).filter((p) => p.player === playerName);

  const totalRolls = rolls.reduce((a, r) => a + Number(r.rolls || 0), 0);
  const actualPoints = pulls.reduce((a, p) => a + pullScore(p, s), 0);
  const evHits = pulls.filter((p) => p.category === s.evCategory).length;

  const rate = Number(s.evRate) / 100;
  const evBase = s.baseScores[s.evCategory] || 0;
  const expectedPoints = totalRolls * rate * evBase;
  const expectedHits = totalRolls * rate;
  const hitDeviation = evHits - expectedHits;
  const variance = totalRolls * rate * (1 - rate);
  const sd = Math.sqrt(variance);
  const z = variance > 0 ? hitDeviation / sd : 0;

  return {
    player: playerName,
    totalRolls,
    evHits,
    expectedHits,
    actualPoints,
    expectedPoints,
    deviation: actualPoints - expectedPoints,
    z,
  };
}

// -------------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------------
function fmt(n, d = 2) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtDate(ts) {
  return new Date(ts).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}

function playerNames() {
  return Object.values(state.players).map((p) => p.name);
}

function render() {
  renderPlayerSelects();
  renderCategorySelects();
  renderStageSelect();
  renderPlayerChips();
  renderSettingsForm();
  renderStageTable();
  renderRollLogTable();
  renderPullLogTable();
  renderDashboard();
}

function renderPlayerSelects() {
  const names = playerNames();
  ["rollPlayerSelect", "pullPlayerSelect"].forEach((id) => {
    const sel = document.getElementById(id);
    const prev = sel.value;
    sel.innerHTML = names.length
      ? names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("")
      : `<option value="">— เพิ่มผู้เล่นในแท็บตั้งค่าก่อน —</option>`;
    if (names.includes(prev)) sel.value = prev;
  });
}

function renderCategorySelects() {
  ["pullCategory", "setEvCategory"].forEach((id) => {
    const sel = document.getElementById(id);
    const prev = sel.value || state.settings.evCategory;
    sel.innerHTML = CATEGORIES.map((c) => `<option value="${c.key}">${c.label}</option>`).join("");
    sel.value = prev;
  });
}

function renderStageSelect() {
  const sel = document.getElementById("pullStage");
  const prev = sel.value;
  const stages = state.settings.stages || {};
  const opts = Object.entries(stages)
    .map(([id, st]) => `<option value="${id}">${esc(st.name)} (${st.monthly ? "Monthly" : "ปกติ"})</option>`)
    .join("");
  sel.innerHTML = `<option value="">— ไม่มี / ยังลงไม่ได้ —</option>` + opts;
  sel.value = prev;
}

function renderPlayerChips() {
  const ul = document.getElementById("playerList");
  const entries = Object.entries(state.players);
  ul.innerHTML = entries.length
    ? entries.map(([id, p]) => `<li>${esc(p.name)} <button data-remove-player="${id}" title="ลบผู้เล่น">×</button></li>`).join("")
    : `<li class="hint small">ยังไม่มีผู้เล่น</li>`;
}

function renderSettingsForm() {
  const s = state.settings;
  document.getElementById("setEvRate").value = s.evRate;
  document.getElementById("setEvCategory").value = s.evCategory;
  document.getElementById("setMetaBonus").value = s.metaBonus;
  document.getElementById("setMaxDifficulty").value = s.maxDifficulty;
  document.getElementById("setMonthlyPoint").value = s.monthlyPoint;

  const baseRows = document.getElementById("baseScoreRows");
  baseRows.innerHTML = CATEGORIES.map(
    (c) => `<div class="kv-row"><span>${c.label}</span><input type="number" data-base="${c.key}" value="${s.baseScores[c.key]}"></div>`
  ).join("");

  const dupRows = document.getElementById("dupWeightRows");
  dupRows.innerHTML = [0, 1, 2, 3].map(
    (i) => `<div class="kv-row"><span>ดุ๊ปที่ ${i}${i === 3 ? "+" : ""}</span><input type="number" step="0.05" data-dup="${i}" value="${s.dupWeights[i]}"></div>`
  ).join("");

  const diffDupRows = document.getElementById("diffDupWeightRows");
  diffDupRows.innerHTML = [0, 1, 2, 3].map(
    (i) => `<div class="kv-row"><span>ดุ๊ปที่ ${i}${i === 3 ? "+" : ""}</span><input type="number" step="0.05" data-diffdup="${i}" value="${s.diffDupWeights[i]}"></div>`
  ).join("");
}

function renderStageTable() {
  const tbody = document.getElementById("stageBody");
  const stages = state.settings.stages || {};
  const entries = Object.entries(stages);
  tbody.innerHTML = entries.length
    ? entries
        .map(([id, st]) => {
          const pts = stagePointsOf(st, state.settings);
          return `<tr>
            <td class="name">${esc(st.name)}</td>
            <td>${fmt(st.weight, 2)}</td>
            <td>${st.monthly ? "✔" : "—"}</td>
            <td>${fmt(pts, 1)}</td>
            <td><button class="icon-btn" data-remove-stage="${id}" title="ลบด่าน">×</button></td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="5" class="empty-hint">ยังไม่มีด่าน — เพิ่มด้านบน</td></tr>`;
}

function renderRollLogTable() {
  const tbody = document.getElementById("rollLogBody");
  const rows = Object.values(state.rollLog).sort((a, b) => b.ts - a.ts).slice(0, 100);
  tbody.innerHTML = rows.length
    ? rows.map((r) => `<tr><td>${fmtDate(r.ts)}</td><td class="name">${esc(r.player)}</td><td>${r.rolls}</td></tr>`).join("")
    : `<tr><td colspan="3" class="empty-hint">ยังไม่มีข้อมูล</td></tr>`;
}

function renderPullLogTable() {
  const tbody = document.getElementById("pullLogBody");
  const s = state.settings;
  const rows = Object.values(state.pullLog).sort((a, b) => b.ts - a.ts).slice(0, 100);
  tbody.innerHTML = rows.length
    ? rows
        .map((p) => {
          const catLabel = CATEGORIES.find((c) => c.key === p.category)?.label || p.category;
          const stageLabel = p.stageId && s.stages && s.stages[p.stageId] ? s.stages[p.stageId].name : "—";
          return `<tr>
            <td>${fmtDate(p.ts)}</td>
            <td class="name">${esc(p.player)}</td>
            <td>${esc(catLabel)}</td>
            <td>${p.dupTier}${p.dupTier >= 3 ? "+" : ""}</td>
            <td>${p.meta ? "✔" : "—"}</td>
            <td>${esc(stageLabel)}</td>
            <td>${fmt(pullScore(p, s), 2)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="7" class="empty-hint">ยังไม่มีข้อมูล</td></tr>`;
}

function renderDashboard() {
  const names = playerNames();
  const tbody = document.getElementById("dashboardBody");
  const emptyHint = document.getElementById("dashboardEmpty");

  const stats = names.map(computePlayerStats).filter((st) => st.totalRolls > 0);

  if (!stats.length) {
    tbody.innerHTML = "";
    emptyHint.hidden = false;
    return;
  }
  emptyHint.hidden = true;

  const sortedByZ = [...stats].sort((a, b) => a.z - b.z);
  const rankOf = new Map(sortedByZ.map((st, i) => [st.player, i + 1]));

  tbody.innerHTML = stats
    .map((st) => {
      const rank = rankOf.get(st.player);
      const zClass = st.z <= -2 ? "z-bad" : st.z >= 2 ? "z-good" : "";
      const rankClass = rank === 1 ? "rank-1" : "";
      return `<tr>
        <td class="name">${esc(st.player)}</td>
        <td>${st.totalRolls}</td>
        <td>${st.evHits}</td>
        <td>${fmt(st.expectedHits, 1)}</td>
        <td>${fmt(st.actualPoints, 1)}</td>
        <td>${fmt(st.expectedPoints, 1)}</td>
        <td>${fmt(st.deviation, 1)}</td>
        <td class="${zClass}">${fmt(st.z, 2)}</td>
        <td class="${rankClass}">${rank}</td>
      </tr>`;
    })
    .join("");
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// -------------------------------------------------------------------------
// Event wiring
// -------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // tabs
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });

  document.getElementById("rollForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const player = document.getElementById("rollPlayerSelect").value;
    const rolls = Number(document.getElementById("rollCount").value);
    if (!player || !rolls || rolls <= 0) return;
    addRollEntry({ player, rolls });
    e.target.reset();
    document.getElementById("rollCount").value = 10;
  });

  document.getElementById("pullForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const player = document.getElementById("pullPlayerSelect").value;
    if (!player) return;
    addPullEntry({
      player,
      category: document.getElementById("pullCategory").value,
      dupTier: Number(document.getElementById("pullDup").value),
      meta: document.getElementById("pullMeta").checked,
      stageId: document.getElementById("pullStage").value || null,
    });
    document.getElementById("pullMeta").checked = false;
    document.getElementById("pullStage").value = "";
  });

  document.getElementById("playerForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("newPlayerName");
    const name = input.value.trim();
    if (!name) return;
    if (playerNames().includes(name)) {
      alert("มีชื่อนี้อยู่แล้ว");
      return;
    }
    addPlayer(name);
    input.value = "";
  });

  document.getElementById("playerList").addEventListener("click", (e) => {
    const id = e.target.dataset.removePlayer;
    if (id && confirm("ลบผู้เล่นนี้? (ประวัติ log เดิมจะยังอยู่แต่จะไม่โผล่ในดรอปดาวน์)")) removePlayer(id);
  });

  document.getElementById("stageForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("stageName").value.trim();
    const weight = Number(document.getElementById("stageWeight").value);
    const monthly = document.getElementById("stageMonthly").checked;
    if (!name || weight < 0 || weight > 1) return;
    addStage({ name, weight, monthly });
    e.target.reset();
  });

  document.getElementById("stageBody").addEventListener("click", (e) => {
    const id = e.target.dataset.removeStage;
    if (id && confirm("ลบด่านนี้?")) removeStage(id);
  });

  // settings live-edit
  const bindSetting = (id, path, isNumber = true) => {
    document.getElementById(id).addEventListener("change", (e) => {
      const v = isNumber ? Number(e.target.value) : e.target.value;
      path(v);
      persistSettings();
    });
  };
  bindSetting("setEvRate", (v) => (state.settings.evRate = v));
  bindSetting("setEvCategory", (v) => (state.settings.evCategory = v), false);
  bindSetting("setMetaBonus", (v) => (state.settings.metaBonus = v));
  bindSetting("setMaxDifficulty", (v) => (state.settings.maxDifficulty = v));
  bindSetting("setMonthlyPoint", (v) => (state.settings.monthlyPoint = v));

  document.getElementById("baseScoreRows").addEventListener("change", (e) => {
    const key = e.target.dataset.base;
    if (!key) return;
    state.settings.baseScores[key] = Number(e.target.value);
    persistSettings();
  });
  document.getElementById("dupWeightRows").addEventListener("change", (e) => {
    const i = e.target.dataset.dup;
    if (i === undefined) return;
    state.settings.dupWeights[Number(i)] = Number(e.target.value);
    persistSettings();
  });
  document.getElementById("diffDupWeightRows").addEventListener("change", (e) => {
    const i = e.target.dataset.diffdup;
    if (i === undefined) return;
    state.settings.diffDupWeights[Number(i)] = Number(e.target.value);
    persistSettings();
  });

  initStore();
});
