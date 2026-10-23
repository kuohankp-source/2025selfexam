/**
 * ============================================================================
 * 郭志雄物理 - 物理概念與公式自測系統 (Frontend Core Engine - app.js)
 * ----------------------------------------------------------------------------
 * 架構規範：
 *   [MODULE 1.0] 全域環境配置與狀態容器 (Global Configurations & State)
 *   [MODULE 2.0] 通訊協定與雲端同步引擎 (Communication & Cloud Sync Engine)
 *   [MODULE 3.0] 核心導航與視圖切換中樞 (Navigation & View Orchestrator)
 *   [MODULE 4.0] 講義三層樹狀分類引擎 (Hierarchical Taxonomy Engine)
 *   [MODULE 5.0] 肯定句觀念推導卡片渲染引擎 (Study Cards & Formula Engine)
 *   [MODULE 6.0] 隨機抽題、4選1動態組裝與倒數測驗引擎 (Timed Quiz Engine)
 *   [MODULE 7.0] 錯題動態消除、歷史快照區間篩選與錯題特訓引擎 (Mistake & History Engine)
 *
 * 鐵則：嚴禁在前端寫死任何假題庫或假觀念資料，100% 由雲端 Google Sheets 驅動。
 * ============================================================================
 */

/* ============================================================================
 * [MODULE 1.0] 全域環境配置與狀態容器 (Global Configurations & State)
 * ============================================================================ */

// [1.1] API 端點常數 GAS_ENDPOINT_URL
// v3.2.3 起改放在 config.js（index.html 會先載入它），更新 app.js 時不必再修改網址

// [1.2] 全域資料容器
let currentUser = null;
let sessionToken = null; // 登入後由後端發放的 token，之後每次請求都會附上

// 通訊方式：true = POST(text/plain，無網址長度限制、密碼不會出現在網址)；false = 舊版 GET
const API_USE_POST = true;
let conceptBank = [];
let questionBank = [];
let quizHistory = [];
let unresolvedMistakeMap = new Map();

// [1.3] 測驗執行狀態容器
let quizQuestions = [];
let currentQuizIndex = 0;
let quizTimer = null;
let questionStartTime = 0;
let timeLeft = 20;
let quizAnswersRecord = [];
let isAnswered = false;
let currentQuizMode = "standard"; // "standard" 或 "retry"
let currentFourChoices = [];
let currentQuizUnitTitle = "";
let currentHistoryFilter = "6m";

/* ============================================================================
 * [MODULE 2.0] 通訊協定與雲端同步引擎 (Communication & Cloud Sync Engine)
 * ============================================================================ */

/**
 * [2.1] URL-Encoded 純 GET 通訊包裝器 (callGasApi)
 * 全面回歸純 GET 通訊協定，徹底杜絕跨網域 POST 觸發 Google Apps Script HTTP 302 重導向
 * 所導致的 CORS 阻斷與「400 Bad Request / 無效的請求」問題。
 */
async function callGasApi(action, dataObj = {}) {
  if (typeof GAS_ENDPOINT_URL === "undefined" || !GAS_ENDPOINT_URL) {
    throw new Error("找不到後端網址設定（config.js），請聯絡老師");
  }
  const payload = { action, ...dataObj };
  if (sessionToken && action !== "login") {
    payload.token = sessionToken;
  }

  let response;
  if (API_USE_POST) {
    // text/plain 屬於「簡單請求」，不會觸發 CORS 預檢；後端 doPost 已支援
    response = await fetch(GAS_ENDPOINT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow"
    });
  } else {
    const url = `${GAS_ENDPOINT_URL}?payload=${encodeURIComponent(JSON.stringify(payload))}`;
    response = await fetch(url, { method: "GET", mode: "cors" });
  }

  const res = await response.json();

  // 登入逾時（token 過期）或後端要求重新登入
  if (res && res.code === "AUTH_REQUIRED" && action !== "login") {
    sessionToken = null;
    alert("登入已逾時，請重新登入。");
    handleLogout();
  }
  return res;
}

/**
 * [2.1.1] 通用 LaTeX 語法健檢與自動修復器 (sanitizeAndRepairLatex)
 * 解決未閉合 $、未閉合 \text{}、損壞的 $$ 前綴、管道符號切斷與殘缺字符問題
 */
function sanitizeAndRepairLatex(rawStr) {
  if (rawStr === null || rawStr === undefined) return "";
  let s = String(rawStr).trim();
  if (!s) return "";

  // 1. 去除首尾的孤立管道符號與多餘反斜線
  s = s.replace(/^[\|\\]+|[\|\\]+$/g, "").trim();

  // 2. 清理試算表歷史遺留的文字干擾片段（例如 "$刻 $", "$為 $"）
  s = s.replace(/\$刻\s*\$/g, "").replace(/\$為\s*\$/g, "");

  // 3. 修復 "$$...$"（開頭為雙錢號、結尾為單錢號；(?!\$) 避免誤傷正常的 $$...$$ 顯示式公式）
  s = s.replace(/\$\$([^$]+)\$(?!\$)/g, (m, body) => "$" + body + "$");

  // 4. 修復常見單位殘缺（例如 "$0\text{$" -> "$0\text{ m}$", "$24\text{$" -> "$24\text{ m}$"）
  s = s.replace(/(\d+)\s*\\text\{\s*(\$)?$/g, "$1\\text{ m}$2");
  s = s.replace(/\\text\{\s*m\s*(\$)?$/gi, "\\text{ m}$1");

  // 5. 修復 \text{ 內未閉合花括號即接 $ 的情況
  s = s.replace(/\\text\{([^}]+)\$/g, "\\text{$1}$");

  // 6. 花括號配對檢查：若開括號 { 多於 閉括號 }，在末尾（若有 $ 則在 $ 前）補齊 }
  const openBraces = (s.match(/\{/g) || []).length;
  const closeBraces = (s.match(/\}/g) || []).length;
  if (openBraces > closeBraces) {
    const diff = openBraces - closeBraces;
    if (s.endsWith("$")) {
      s = s.slice(0, -1) + "}".repeat(diff) + "$";
    } else {
      s = s + "}".repeat(diff);
    }
  }

  // 7. $ 配對檢查（排除 \$）：若為奇數個 $，在末尾補上 $
  const cleanForCount = s.replace(/\\\$/g, "");
  const dollarCount = (cleanForCount.match(/\$/g) || []).length;
  if (dollarCount % 2 === 1) {
    s = s + "$";
  }

  return s.trim();
}

/**
 * [2.1.2] 雲端歷史題庫選項專屬修補表 (避免歷史試算表因 | 分隔符號或儲存格損壞造成之殘缺字串)
 */
const QUESTION_DISTRACTOR_PATCHES = {
  "q_kin_01_03_a": [
    "$+5\\text{ m}$",
    "$+1\\text{ m}$",
    "$-1\\text{ m}$",
    "$0\\text{ m}$"
  ],
  "q_kin_01_03_b": [
    "$10\\text{ m}$",
    "$5\\text{ m}$",
    "$-5\\text{ m}$",
    "$8\\text{ m}$"
  ],
  "q_kin_01_04_a": [
    "純量和，且大小為 $11\\text{ m}$",
    "向量差，且大小為 $11\\text{ m}$",
    "純量和，且大小為 $5\\text{ m}$",
    "乘積，且大小為 $24\\text{ m}$"
  ],
  "q_kin_01_05_a": [
    "$5\\text{ m}$（為各段位移之向量和）",
    "$-5\\text{ m}$",
    "$0\\text{ m}$",
    "$24\\text{ m}$"
  ],
  "q_kin_02_01_b": [
    "「第 4 秒末」代表時刻 $t = 4\\text{ s}$",
    "「第 4 秒內」代表時距由 $t = 3\\text{ s}$ 至 $t = 4\\text{ s}$（歷時 $1\\text{ s}$）",
    "「前 4 秒」代表時距由 $t = 0\\text{ s}$ 至 $t = 4\\text{ s}$（歷時 $4\\text{ s}$）",
    "「第 4 秒」通常指時刻 $t = 4\\text{ s}$"
  ],
  "q_kin_02_02_a": [
    "$t_1$ 該時刻點之切線斜率",
    "$t_2$ 該時刻點之切線斜率",
    "$v$-$t$ 曲線與時間軸所圍成的面積",
    "該時段內各點切線斜率的算術平均值"
  ],
  "q_kin_02_03_a": [
    "瞬時加速度必定為 0",
    "在該時段內的總路程為 0",
    "該質點恰好通過坐標原點 $x = 0$",
    "質點正在作等速度運動"
  ],
  "q_kin_02_04_a": [
    "$\\vec{v}_a = \\frac{\\Delta S}{\\Delta t}$（純量）；$\\bar{v} = \\frac{\\Delta\\vec{x}}{\\Delta t}$（向量）",
    "兩者皆為純量，公式均為 $\\frac{\\Delta S}{\\Delta t}$",
    "兩者皆為向量，公式均為 $\\frac{\\Delta\\vec{x}}{\\Delta t}$",
    "$\\vec{v}$ 為瞬時量；$\\bar{v}$ 為時距平均量"
  ],
  "q_kin_02_05_a": [
    "$\\bar{v} = 3\\text{ m/s}$，$\\Vert{}\\vec{v}_a\\Vert{} = 7\\text{ m/s}$",
    "$\\bar{v} = 5\\text{ m/s}$，$\\Vert{}\\vec{v}_a\\Vert{} = 5\\text{ m/s}$",
    "$\\bar{v} = 8\\text{ m/s}$，$\\Vert{}\\vec{v}_a\\Vert{} = 3\\text{ m/s}$",
    "$\\bar{v} = 7\\text{ m/s}$，$\\Vert{}\\vec{v}_a\\Vert{} = 7\\text{ m/s}$"
  ],
  "q_kin_02_06_a": [
    "只有在等速度運動時，$v = \\Vert{}\\vec{v}\\Vert{}$ 才會成立",
    "瞬時速率恆大於瞬時速度之量值（$v > \\Vert{}\\vec{v}\\Vert{}$）",
    "瞬時速率可能為負值，瞬時速度量值恆為正值",
    "兩者完全無關，無法進行比較"
  ]
};

/**
 * 雲端觀念資料正規化器：確保 8 欄結構與舊版欄位偏移皆能精準對應，並通過 LaTeX 修復器
 */
function normalizeConceptItem(raw) {
  if (!raw) return null;

  let cid = "";
  let mainCat = "未分類講義";
  let subCat = "未分類觀念";
  let title = "";
  let contentType = "text";
  let definition = "";
  let premise = "";
  let explanation = "";

  // 標準 8 欄結構
  if (raw.main_category !== undefined && raw.sub_category !== undefined) {
    cid = String(raw.concept_id || "").trim();
    mainCat = String(raw.main_category || "未分類講義").trim();
    subCat = String(raw.sub_category || "未分類觀念").trim();
    title = String(raw.title || "").trim();
    contentType = String(raw.content_type || "text").trim();
    definition = String(raw.definition || "").trim();
    premise = String(raw.premise || "").trim();
    explanation = String(raw.explanation || "").trim();
  } else if (raw.unit !== undefined && raw.definition === "text") {
    // 相容雲端試算表 8 欄但舊版 GAS 以 7 欄讀取之偏移映射
    cid = String(raw.concept_id || "").trim();
    mainCat = String(raw.unit || "未分類講義").trim();
    subCat = String(raw.title || "未分類觀念").trim();
    title = String(raw.content_type || "").trim();
    contentType = "text";
    definition = String(raw.premise || "").trim();
    premise = String(raw.explanation || "").trim();
    explanation = "";
  } else {
    cid = String(raw.concept_id || "").trim();
    mainCat = String(raw.main_category || raw.unit || "未分類講義").trim();
    subCat = String(raw.sub_category || raw.title || "未分類觀念").trim();
    title = String(raw.title || "").trim();
    contentType = String(raw.content_type || "text").trim();
    definition = String(raw.definition || "").trim();
    premise = String(raw.premise || "").trim();
    explanation = String(raw.explanation || "").trim();
  }

  return {
    concept_id: cid,
    main_category: mainCat,
    sub_category: subCat,
    title: sanitizeAndRepairLatex(title),
    content_type: contentType,
    definition: sanitizeAndRepairLatex(definition),
    premise: sanitizeAndRepairLatex(premise),
    explanation: sanitizeAndRepairLatex(explanation)
  };
}

/**
 * 雲端題庫資料正規化器：確保 11 欄結構與舊版欄位偏移皆能精準對應，並杜絕殘缺選項與損壞 LaTeX
 */
function normalizeQuestionItem(raw, conceptLookupMap) {
  if (!raw) return null;

  let qid = "";
  let cid = "";
  let mainCat = "未分類講義";
  let subCat = "未分類觀念";
  let promptText = "";
  let correctText = "";
  let rawDistractors = "";
  let expText = "";

  // 標準 11 欄轉換後結構
  if (raw.main_category !== undefined && raw.sub_category !== undefined && raw.question !== undefined) {
    qid = String(raw.id || "").trim();
    cid = String(raw.concept_id || "").trim();
    mainCat = String(raw.main_category || "未分類講義").trim();
    subCat = String(raw.sub_category || "未分類觀念").trim();
    promptText = String(raw.question || "").trim();
    correctText = String(raw.correctAnswer || "").trim();
    rawDistractors = Array.isArray(raw.distractors) ? raw.distractors.join("|") : String(raw.distractors || "");
    expText = String(raw.explanation || "").trim();
  } else if (raw.unit !== undefined && raw.correct_val === "text") {
    // 相容雲端試算表 11 欄但舊版 GAS 以 10 欄讀取之偏移映射
    qid = String(raw.id || "").trim();
    cid = String(raw.concept_id || "").trim();
    const linkedConcept = conceptLookupMap ? conceptLookupMap.get(cid) : null;
    mainCat = String(raw.unit || "未分類講義").trim();
    subCat = String(raw.prompt || "未分類觀念").trim();
    promptText = String(raw.correct_type || "").trim();
    correctText = String(raw.distractor_type || "").trim();
    rawDistractors = String(raw.explanation || "").trim();
    expText = linkedConcept
      ? `${linkedConcept.definition}${linkedConcept.premise ? " ｜ " + linkedConcept.premise : ""}`
      : "";
  } else {
    qid = String(raw.id || "").trim();
    cid = String(raw.concept_id || "").trim();
    mainCat = String(raw.main_category || raw.unit || "未分類講義").trim();
    subCat = String(raw.sub_category || "未分類觀念").trim();
    promptText = String(raw.question || raw.prompt || "").trim();
    correctText = String(raw.correctAnswer || raw.correct_val || "").trim();
    rawDistractors = Array.isArray(raw.distractors) ? raw.distractors.join("|") : String(raw.distractors || "");
    expText = String(raw.explanation || "").trim();
  }

  // 1. 題幹與正解進行 LaTeX 修復
  const sanitizedPrompt = sanitizeAndRepairLatex(promptText);
  const sanitizedCorrect = sanitizeAndRepairLatex(correctText);

  // 2. 檢測雲端回傳之干擾項是否包含損壞特徵 (如 "$24\text{$", "$$", 孤立標點)
  let distractorsArr = [];
  const hasCorruptedDistractors =
    rawDistractors.includes("$$") ||
    rawDistractors.includes("\\text{$") ||
    /\|\s*[\$\\]\s*\|/.test(rawDistractors) ||
    rawDistractors.includes("$刻 $") ||
    rawDistractors.includes("$為 $");

  if (hasCorruptedDistractors && QUESTION_DISTRACTOR_PATCHES[qid]) {
    // 優先使用物理校正修補選項
    distractorsArr = QUESTION_DISTRACTOR_PATCHES[qid].map(sanitizeAndRepairLatex);
  } else {
    // 依 | 拆分並嚴格防呆清洗
    distractorsArr = rawDistractors
      .split("|")
      .map(s => s.trim())
      .filter(s => {
        // 排除長度過短或純標點碎片
        if (!s || s.length <= 1) return false;
        if (/^[\$\\\|#\s]+$/.test(s)) return false;
        return true;
      })
      .map(sanitizeAndRepairLatex);

    // 若拆分後過少且修補字典有對應，使用修補字典
    if (distractorsArr.length < 3 && QUESTION_DISTRACTOR_PATCHES[qid]) {
      distractorsArr = QUESTION_DISTRACTOR_PATCHES[qid].map(sanitizeAndRepairLatex);
    }
  }

  return {
    id: qid,
    concept_id: cid,
    main_category: mainCat,
    sub_category: subCat,
    question: sanitizedPrompt,
    correctAnswer: sanitizedCorrect,
    distractors: distractorsArr,
    explanation: sanitizeAndRepairLatex(expText)
  };
}

/**
 * [2.1.3] 快照資料水合器 (hydrateSnapshot)
 * 相容舊版完整快照與最新輕量化 compact 快照 ({ qId, concept_id, sub, pick, correct, ok, t })
 * 當前端讀取歷史快照時，若快照只有 qId，自動從本地 questionBank 補上完整的題幹 prompt 與詳解 explanation，
 * 確保「歷史快照展開」與「錯題特訓」畫面顯示依然豐富完整！
 */
function hydrateSnapshot(snap) {
  if (!snap) return null;
  const qId = String(snap.questionId || snap.qId || "").trim();
  const qRef = questionBank.find(q => q.id === qId);

  const conceptId = snap.concept_id || snap.cid || (qRef ? qRef.concept_id : "");
  const subCategory = snap.sub_category || snap.sub || snap.unit || (qRef ? qRef.sub_category : "物理觀念");
  const promptText = snap.prompt || snap.question || (qRef ? qRef.question : "");
  const userPickText = snap.userPick !== undefined ? snap.userPick : (snap.pick !== undefined ? snap.pick : "未作答");
  const correctPickText = snap.correctPick !== undefined ? snap.correctPick : (snap.correct !== undefined ? snap.correct : (qRef ? qRef.correctAnswer : ""));
  const isOk = snap.isCorrect !== undefined ? Boolean(snap.isCorrect) : (snap.ok !== undefined ? Boolean(snap.ok) : false);
  const timeSpentVal = String(snap.timeSpent || snap.t || "0.0");
  const expText = snap.explanation || (qRef ? qRef.explanation : "");

  return {
    questionId: qId,
    qId: qId,
    concept_id: conceptId,
    cid: conceptId,
    sub_category: subCategory,
    sub: subCategory,
    unit: subCategory,
    prompt: promptText,
    question: promptText,
    userPick: userPickText,
    pick: userPickText,
    correctPick: correctPickText,
    correct: correctPickText,
    isCorrect: isOk,
    ok: isOk,
    timeSpent: timeSpentVal,
    t: timeSpentVal,
    explanation: expText,
    optionsSnapshot: snap.optionsSnapshot || []
  };
}

/**
 * 雲端歷史紀錄正規化器 (自動透過 hydrateSnapshot 補齊快照細節)
 */
function normalizeHistoryItem(raw) {
  if (!raw) return null;
  let rawSnapshots = [];
  if (Array.isArray(raw.snapshots)) {
    rawSnapshots = raw.snapshots;
  } else if (typeof raw.snapshots_json === "string" && raw.snapshots_json.trim()) {
    try {
      rawSnapshots = JSON.parse(raw.snapshots_json);
    } catch (err) {
      rawSnapshots = [];
    }
  }

  // 透過 hydrateSnapshot 自動水合補齊題幹、正解、解析
  const snapshots = rawSnapshots.map(hydrateSnapshot).filter(Boolean);

  const correctCount = Number(raw.correct_count !== undefined ? raw.correct_count : raw.correctCount || 0);
  const totalCount = Number(raw.total_count !== undefined ? raw.total_count : raw.totalCount || snapshots.length || 0);

  return {
    session_id: String(raw.session_id || raw.sessionId || `sess_${Date.now()}`),
    username: String(raw.username || (currentUser ? currentUser.username : "")),
    unit_title: String(raw.unit_title || raw.unitTitle || "綜合測驗"),
    score: String(raw.score || `${correctCount} / ${totalCount}`),
    correct_count: correctCount,
    total_count: totalCount,
    snapshots: snapshots,
    timestamp: String(raw.timestamp || new Date().toISOString())
  };
}

/* ============================================================================
 * [MODULE 2.5] 按需載入引擎 (On-demand Loader)
 * 登入時只取得「目錄」；勾選範圍後才向雲端要觀念卡與題目，已載入的資料會留在記憶體重複使用。
 * ============================================================================ */
const UNIT_SEP = "\u0001";
let catalog = [];                       // [{ main, conceptCount, questionCount, subs:[{sub, conceptCount, questionCount}] }]
let loadedUnitKeys = new Set();         // 已載入的「講義 + 觀念子分類」
let requestedQuestionIds = new Set();   // 已向雲端要過的題號（避免重複請求）
let requestedConceptIds = new Set();    // 已向雲端要過的觀念編號
let studyShownKeys = new Set();         // 觀念複習目前顯示的範圍
let unitLoadQueue = Promise.resolve();

function unitKey(main, sub) {
  return `${main}${UNIT_SEP}${sub}`;
}

function splitUnitKey(key) {
  const idx = key.indexOf(UNIT_SEP);
  return { main: key.slice(0, idx), sub: key.slice(idx + 1) };
}

function itemUnitKey(item) {
  return unitKey(item.main_category, item.sub_category);
}

/** 將雲端回傳的觀念卡與題目併入本地暫存（以編號去重） */
function mergeLoadedItems(rawConcepts, rawQuestions) {
  const conceptMap = new Map(conceptBank.map(c => [c.concept_id, c]));
  (Array.isArray(rawConcepts) ? rawConcepts : [])
    .map(normalizeConceptItem)
    .filter(c => c && c.concept_id)
    .forEach(c => conceptMap.set(c.concept_id, c));
  conceptBank = Array.from(conceptMap.values());

  const questionMap = new Map(questionBank.map(q => [q.id, q]));
  (Array.isArray(rawQuestions) ? rawQuestions : [])
    .map(q => normalizeQuestionItem(q, conceptMap))
    .filter(q => q && q.id && q.question)
    .forEach(q => questionMap.set(q.id, q));
  questionBank = Array.from(questionMap.values());
}

async function loadUnitsNow(keys) {
  const missing = Array.from(new Set(keys)).filter(k => !loadedUnitKeys.has(k));
  if (missing.length === 0) return;
  // v3.1：後端每次只接受一本講義，依講義分批請求
  const byMain = new Map();
  missing.forEach(k => {
    const { main } = splitUnitKey(k);
    if (!byMain.has(main)) byMain.set(main, []);
    byMain.get(main).push(k);
  });
  for (const [, groupKeys] of byMain) {
    const res = await callGasApi("getUnitData", { units: groupKeys.map(splitUnitKey) });
    if (!res || !res.success) {
      throw new Error((res && res.message) || "無法載入所選範圍的資料");
    }
    mergeLoadedItems(res.concepts, res.questions);
    groupKeys.forEach(k => loadedUnitKeys.add(k));
  }
}

/** 確保指定範圍已載入；多個請求會依序排隊，避免同一範圍重複下載 */
function ensureUnitsLoaded(keys) {
  const run = unitLoadQueue.then(() => loadUnitsNow(keys));
  unitLoadQueue = run.catch(() => {});
  return run;
}

/** 依題號／觀念編號補齊資料（錯題、歷史快照、觀念對照彈窗使用） */
async function ensureItemsLoaded(questionIds, conceptIds) {
  const haveQ = new Set(questionBank.map(q => q.id));
  const haveC = new Set(conceptBank.map(c => c.concept_id));
  const needQ = Array.from(new Set((questionIds || []).map(String)))
    .filter(id => id && !haveQ.has(id) && !requestedQuestionIds.has(id));
  const needC = Array.from(new Set((conceptIds || []).map(String)))
    .filter(id => id && !haveC.has(id) && !requestedConceptIds.has(id));
  if (needQ.length === 0 && needC.length === 0) return;
  needQ.forEach(id => requestedQuestionIds.add(id));
  needC.forEach(id => requestedConceptIds.add(id));

  const Q_CHUNK = 200;
  const C_CHUNK = 10;
  const rounds = Math.max(Math.ceil(needQ.length / Q_CHUNK), Math.ceil(needC.length / C_CHUNK));
  for (let r = 0; r < rounds; r++) {
    const res = await callGasApi("getItemsByIds", {
      questionIds: needQ.slice(r * Q_CHUNK, (r + 1) * Q_CHUNK),
      conceptIds: needC.slice(r * C_CHUNK, (r + 1) * C_CHUNK)
    });
    if (res && res.success) {
      mergeLoadedItems(res.concepts, res.questions);
    }
  }
}

function catalogTotals() {
  return catalog.reduce(
    (acc, m) => ({ concepts: acc.concepts + (m.conceptCount || 0), questions: acc.questions + (m.questionCount || 0) }),
    { concepts: 0, questions: 0 }
  );
}

function findCatalogSub(key) {
  const { main, sub } = splitUnitKey(key);
  const m = catalog.find(x => x.main === main);
  return m ? m.subs.find(s => s.sub === sub) : null;
}

function loadingBoxHtml(text) {
  return `<div class="empty-state-box">⏳ ${escapeHtml(text)}</div>`;
}

/**
 * [2.2] 處理登入與兩階段雲端初始資料載入
 */
function handleLoginKeydown(e) {
  if (e && e.key === "Enter") {
    e.preventDefault();
    handleLogin();
  }
}

async function handleLogin() {
  const usernameInput = document.getElementById("login-username");
  const passwordInput = document.getElementById("login-password");
  const statusEl = document.getElementById("login-status");
  const loginBtn = document.getElementById("login-btn");

  const username = usernameInput ? usernameInput.value.trim() : "";
  const password = passwordInput ? passwordInput.value.trim() : "";

  if (!username || !password) {
    statusEl.textContent = "⚠️ 請輸入完整的學生帳號與登入密碼！";
    statusEl.className = "login-status error";
    return;
  }

  try {
    loginBtn.disabled = true;
    statusEl.textContent = "🔄 正在向雲端驗證帳號身分並取得講義目錄...";
    statusEl.className = "login-status loading";

    // 第一階段：呼叫 login 驗證帳密
    const loginRes = await callGasApi("login", { username, password });
    if (!loginRes || !loginRes.success) {
      statusEl.textContent = `❌ 登入失敗：${(loginRes && loginRes.message) || "帳號或密碼不正確"}`;
      statusEl.className = "login-status error";
      loginBtn.disabled = false;
      return;
    }

    sessionToken = loginRes.token || null;
    if (!sessionToken) {
      statusEl.textContent = "❌ 後端尚未更新為安全版（未收到登入憑證 token），請先重新部署 Code.gs。";
      statusEl.className = "login-status error";
      loginBtn.disabled = false;
      return;
    }

    // 判斷管理者權限（試算表 E 欄核取方塊）
    // 管理者權限完全以後端回傳為準
    const isAdmin = Boolean(
      loginRes.user && (
        loginRes.user.isAdmin === true ||
        String(loginRes.user.isAdmin).toUpperCase() === "TRUE"
      )
    );

    currentUser = {
      ...(loginRes.user || { username, name: username }),
      isAdmin: isAdmin
    };

    // 第二階段：立刻呼叫 getInitialData 取得觀念庫、題庫與歷史紀錄
    statusEl.textContent = "☁️ 驗證成功！正在整理講義目錄與作答紀錄...";
    // v3.1：登入回應已包含初始資料；若後端是舊版才另外請求
    const initRes = Array.isArray(loginRes.catalog) ? loginRes : await callGasApi("getInitialData", { username: currentUser.username });

    if (!initRes || !initRes.success) {
      statusEl.textContent = `❌ 資料同步失敗：${(initRes && initRes.message) || "無法取得雲端題庫"}`;
      statusEl.className = "login-status error";
      loginBtn.disabled = false;
      return;
    }

    // 只取得目錄、本人歷史，以及未訂正錯題的題目內容（其餘資料於勾選範圍後才載入）
    catalog = Array.isArray(initRes.catalog) ? initRes.catalog : [];
    const initItems = initRes.items || {};
    mergeLoadedItems(initItems.concepts, initItems.questions);
    (Array.isArray(initItems.questions) ? initItems.questions : []).forEach(q => {
      if (q && q.id) requestedQuestionIds.add(String(q.id));
    });

    // 正規化歷史紀錄
    const rawHistory = Array.isArray(initRes.history)
      ? initRes.history
      : Array.isArray(initRes.historySessions)
      ? initRes.historySessions
      : [];
    quizHistory = rawHistory.map(normalizeHistoryItem).filter(Boolean);

    // 更新頂部學生姓名與雲端同步狀態徽章
    const userDisplayEl = document.getElementById("user-display-name");
    const syncBadgeEl = document.getElementById("sync-status-badge");
    const adminTabBtn = document.getElementById("tab-btn-admin");

    if (userDisplayEl) {
      userDisplayEl.textContent = currentUser.isAdmin
        ? `👑 管理者：${currentUser.name || currentUser.username}`
        : `👤 學生：${currentUser.name || currentUser.username}`;
    }
    if (syncBadgeEl) {
      syncBadgeEl.textContent = "🟢 雲端同步";
    }

    // 根據管理權限顯示或隱藏「🛠️ 題庫總覽」分頁按鈕
    if (adminTabBtn) {
      if (currentUser.isAdmin) {
        adminTabBtn.classList.remove("hidden");
      } else {
        adminTabBtn.classList.add("hidden");
      }
    }
    const adminLogTabBtn = document.getElementById("tab-btn-admin-log");
    if (adminLogTabBtn) adminLogTabBtn.classList.toggle("hidden", !currentUser.isAdmin);
    applyTopBanner(loginRes.banner, currentUser.isAdmin);
    const accountsTabBtn = document.getElementById("tab-btn-admin-accounts");
    if (accountsTabBtn) accountsTabBtn.classList.toggle("hidden", !currentUser.isAdmin);

    // 隱藏 #login-view，顯示 #main-app
    document.getElementById("login-view").classList.add("hidden");
    document.getElementById("main-app").classList.remove("hidden");
    statusEl.textContent = "";

    // 觸發錯題動態解析、三層分類選單初始化
    recalculateUnresolvedMistakes();
    initTaxonomyFilters();
    renderMistakeReviewCards();
    initRetryQuizUI();
    renderHistoryCards("6m");

    // 管理者登入後直接進入「🛠️ 題庫總覽與單元檢視面板」；一般學生進入「📐 觀念複習」
    if (currentUser.isAdmin) {
      initAdminTaxonomyFilters();
      switchTab("view-admin-bank");
    } else {
      switchTab("view-study");
    }
  } catch (err) {
    console.error("雲端通訊異常：", err);
    statusEl.textContent = `❌ 網路或雲端連線異常：${err.message || "請稍後再試"}`;
    statusEl.className = "login-status error";
  } finally {
    if (loginBtn) loginBtn.disabled = false;
  }
}

/**
 * [2.3] 登出系統：清空記憶體狀態並切回 #login-view
 */
function handleLogout() {
  if (quizTimer) {
    clearInterval(quizTimer);
    quizTimer = null;
  }

  currentUser = null;
  sessionToken = null;
  conceptBank = [];
  questionBank = [];
  quizHistory = [];
  catalog = [];
  loadedUnitKeys = new Set();
  requestedQuestionIds = new Set();
  requestedConceptIds = new Set();
  studyShownKeys = new Set();
  unresolvedMistakeMap.clear();
  quizQuestions = [];
  quizAnswersRecord = [];

  const pwdInput = document.getElementById("login-password");
  if (pwdInput) pwdInput.value = "";
  const statusEl = document.getElementById("login-status");
  if (statusEl) {
    statusEl.textContent = "已安全登出雲端系統。";
    statusEl.className = "login-status";
  }

  const adminTabBtn = document.getElementById("tab-btn-admin");
  if (adminTabBtn) adminTabBtn.classList.add("hidden");
  const adminLogTabBtn = document.getElementById("tab-btn-admin-log");
  if (adminLogTabBtn) adminLogTabBtn.classList.add("hidden");
  adminLogData = null;
  adminLogInitialized = false;
  applyTopBanner("", false);
  const accountsTabBtn = document.getElementById("tab-btn-admin-accounts");
  if (accountsTabBtn) accountsTabBtn.classList.add("hidden");
  accountsData = null;
  accountsInitialized = false;

  document.getElementById("main-app").classList.add("hidden");
  document.getElementById("login-view").classList.remove("hidden");
  closeConceptModal();
}

/* ============================================================================
 * [MODULE 3.0] 核心導航與視圖切換中樞 (Navigation & View Orchestrator)
 * ============================================================================ */

// [3.1] 頂部永久品牌橫幅 (#global-top-banner) 已常駐掛載於 DOM 最頂端

/**
 * [3.2] 切換 7 大主要功能視圖與 1 個測驗進行中視圖
 * @param {string} tabKey - 目標視圖 ID
 */
function switchTab(tabKey) {
  // 若正在測驗倒數中且切換離開測驗視圖，清除計時器
  if (tabKey !== "view-active-quiz" && quizTimer) {
    clearInterval(quizTimer);
    quizTimer = null;
  }

  const allViews = [
    "view-guide",
    "view-study",
    "view-review",
    "view-quiz",
    "view-active-quiz",
    "view-history",
    "view-retry",
    "view-admin-bank",
    "view-admin-log",
    "view-admin-accounts"
  ];

  allViews.forEach(viewId => {
    const el = document.getElementById(viewId);
    if (el) {
      if (viewId === tabKey) {
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    }
  });

  // 更新導航按鈕 active 狀態
  const tabBtnMap = {
    "view-guide": "tab-btn-guide",
    "view-study": "tab-btn-study",
    "view-review": "tab-btn-review",
    "view-quiz": "tab-btn-quiz",
    "view-active-quiz": "tab-btn-quiz",
    "view-history": "tab-btn-history",
    "view-retry": "tab-btn-retry",
    "view-admin-bank": "tab-btn-admin",
    "view-admin-log": "tab-btn-admin-log",
    "view-admin-accounts": "tab-btn-admin-accounts"
  };

  const activeBtnId = tabBtnMap[tabKey];
  document.querySelectorAll(".nav-tab-btn").forEach(btn => {
    if (btn.id === activeBtnId) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // 進入各視圖時確保畫面即時同步渲染
  if (tabKey === "view-study") {
    renderStudyCards();
  } else if (tabKey === "view-review") {
    renderMistakeReviewCards();
  } else if (tabKey === "view-history") {
    renderHistoryCards(currentHistoryFilter);
  } else if (tabKey === "view-retry") {
    initRetryQuizUI();
  } else if (tabKey === "view-admin-bank") {
    renderAdminQuestionList();
  } else if (tabKey === "view-admin-log") {
    initAdminLogView();
  } else if (tabKey === "view-admin-accounts") {
    initAccountsView();
  }
}

/**
 * [3.3] 跨視圖「對照核心觀念 (concept_id)」居中模態彈窗 (openConceptModal)
 * 根據 concept_id 從 conceptBank 查找對應觀念卡片；若無 concept_id 則退回以 sub_category 匹配顯示。
 */
async function openConceptModal(conceptId, fallbackSubCategory = "") {
  const modalBackdrop = document.getElementById("concept-modal-backdrop");
  const modalBody = document.getElementById("concept-modal-body");
  if (!modalBackdrop || !modalBody) return;

  modalBackdrop.classList.remove("hidden");

  if (conceptId && !conceptBank.some(c => c.concept_id === conceptId)) {
    modalBody.innerHTML = loadingBoxHtml("正在載入對應的觀念卡...");
    try {
      await ensureItemsLoaded([], [conceptId]);
    } catch (err) {
      console.warn("觀念卡載入失敗：", err);
    }
  }

  let matchedConcepts = [];
  if (conceptId) {
    const exact = conceptBank.find(c => c.concept_id === conceptId);
    if (exact) matchedConcepts.push(exact);
  }
  if (matchedConcepts.length === 0 && fallbackSubCategory) {
    matchedConcepts = conceptBank.filter(c => c.sub_category === fallbackSubCategory);
  }

  if (matchedConcepts.length === 0) {
    modalBody.innerHTML = `<div class="empty-state-box">找不到對應的核心觀念資料（ID: ${escapeHtml(conceptId || "無")}）。</div>`;
  } else {
    modalBody.innerHTML = matchedConcepts.map(c => buildConceptCardHtml(c)).join("");
    triggerKaTeXRender(modalBody);
  }
}

function closeConceptModal() {
  const modalBackdrop = document.getElementById("concept-modal-backdrop");
  if (modalBackdrop) {
    modalBackdrop.classList.add("hidden");
  }
}

function handleModalBackdropClick(event) {
  if (event.target && event.target.id === "concept-modal-backdrop") {
    closeConceptModal();
  }
}

/* ============================================================================
 * [MODULE 4.0] 講義三層樹狀分類引擎 (Hierarchical Taxonomy Engine)
 * ============================================================================ */

/**
 * 初始化「觀念複習」與「快速測驗」的第一層講義勾選清單（依目錄產生，不載入任何題目）
 */
function initTaxonomyFilters() {
  renderMainCheckboxes("study");
  renderMainCheckboxes("quiz");
  populateSubCategoryCheckboxes("study");
  populateSubCategoryCheckboxes("quiz");
}

function renderMainCheckboxes(mode) {
  const grid = document.getElementById(`${mode}-main-grid`);
  if (!grid) return;
  if (catalog.length === 0) {
    grid.innerHTML = `<div class="empty-state-box">目前沒有開放的講義，請洽詢老師。</div>`;
    return;
  }
  grid.innerHTML = catalog
    .map(m => {
      const countText = mode === "quiz" ? `${m.questionCount} 題` : `${m.conceptCount} 張觀念卡`;
      return `
        <label class="sub-check-item">
          <input
            type="checkbox"
            class="${mode}-main-checkbox"
            value="${escapeHtml(m.main)}"
            onchange="handleMainCategoryChange('${mode}')"
          />
          <span>${escapeHtml(m.main)}（${countText}）</span>
        </label>
      `;
    })
    .join("");
}

function getCheckedMains(mode) {
  return Array.from(document.querySelectorAll(`.${mode}-main-checkbox:checked`)).map(cb => cb.value);
}

/**
 * 第二層：依已勾選的講義列出其觀念子分類（資料來自目錄）
 * 已顯示過的子分類保留原本的勾選狀態；新出現的子分類預設為勾選
 */
function populateSubCategoryCheckboxes(mode) {
  const subGrid = document.getElementById(`${mode}-sub-grid`);
  if (!subGrid) return;

  const previouslyShown = new Set(
    Array.from(document.querySelectorAll(`.${mode}-sub-checkbox`)).map(cb => cb.value)
  );
  const previouslyChecked = getCheckedSubCategories(mode);
  const selectedMains = getCheckedMains(mode);

  if (selectedMains.length === 0) {
    subGrid.innerHTML = `<div class="empty-state-box">請先在第一層勾選至少一本講義，這裡就會出現該講義的觀念子分類。</div>`;
  } else {
    subGrid.innerHTML = catalog
      .filter(m => selectedMains.includes(m.main))
      .map(m => {
        const items = m.subs
          .map(s => {
            const key = unitKey(m.main, s.sub);
            const checked = previouslyShown.has(key) ? previouslyChecked.has(key) : true;
            const countText = mode === "quiz" ? `${s.questionCount} 題` : `${s.conceptCount} 張`;
            return `
              <label class="sub-check-item">
                <input
                  type="checkbox"
                  class="${mode}-sub-checkbox"
                  value="${escapeHtml(key)}"
                  ${checked ? "checked" : ""}
                  onchange="${mode === "study" ? "updateStudyPendingHint()" : "updateQuizAvailableCount()"}"
                />
                <span>${escapeHtml(s.sub)}（${countText}）</span>
              </label>
            `;
          })
          .join("");
        return `
          <div style="grid-column: 1 / -1; font-weight: 700; margin-top: 6px;">📘 ${escapeHtml(m.main)}</div>
          ${items}
        `;
      })
      .join("");
  }

  if (mode === "study") {
    updateStudyPendingHint();
  } else {
    updateQuizAvailableCount();
  }
}

function handleMainCategoryChange(mode) {
  populateSubCategoryCheckboxes(mode);
}

// 保留舊名稱，避免舊版 HTML 呼叫時出錯
function handleStudyMainCategoryChange() {
  populateSubCategoryCheckboxes("study");
}

function handleQuizMainCategoryChange() {
  populateSubCategoryCheckboxes("quiz");
}

/**
 * 「全選子分類」與「全部取消」快捷按鈕
 */
function toggleAllSubCategories(mode, checkedState) {
  document.querySelectorAll(`.${mode}-sub-checkbox`).forEach(cb => {
    cb.checked = checkedState;
  });
  if (mode === "study") {
    updateStudyPendingHint();
  } else {
    updateQuizAvailableCount();
  }
}

/**
 * 取得指定模式下已勾選的子分類（以「講義 + 子分類」為單位）
 */
function getCheckedSubCategories(mode) {
  const checkboxes = document.querySelectorAll(`.${mode}-sub-checkbox:checked`);
  return new Set(Array.from(checkboxes).map(cb => cb.value));
}

/**
 * 「⚡ 快速測驗」可用題數：直接由目錄計算，不需要先載入題目
 */
function updateQuizAvailableCount() {
  const checkedKeys = getCheckedSubCategories("quiz");
  let total = 0;
  checkedKeys.forEach(key => {
    const s = findCatalogSub(key);
    if (s) total += s.questionCount || 0;
  });
  const badgeEl = document.getElementById("quiz-available-count");
  if (badgeEl) {
    badgeEl.textContent = `可用題庫：${total} 題`;
  }
}

/**
 * 「📐 觀念複習」勾選狀態提示：勾選改變後，需按「載入觀念卡」才會更新卡片
 */
function updateStudyPendingHint() {
  const statusEl = document.getElementById("study-load-status");
  if (!statusEl) return;
  const checkedKeys = getCheckedSubCategories("study");
  let total = 0;
  checkedKeys.forEach(key => {
    const s = findCatalogSub(key);
    if (s) total += s.conceptCount || 0;
  });
  const same =
    checkedKeys.size === studyShownKeys.size &&
    Array.from(checkedKeys).every(k => studyShownKeys.has(k));
  if (checkedKeys.size === 0) {
    statusEl.textContent = "尚未勾選任何觀念子分類。";
  } else if (same) {
    statusEl.textContent = `目前顯示的就是勾選範圍（${total} 張觀念卡）。`;
  } else {
    statusEl.textContent = `已勾選 ${checkedKeys.size} 個觀念子分類（共 ${total} 張觀念卡），請按「📥 載入觀念卡」。`;
  }
}

/**
 * 「📥 載入觀念卡」：向雲端取得勾選範圍的觀念卡後顯示
 */
async function loadStudyCards() {
  const checkedKeys = Array.from(getCheckedSubCategories("study"));
  if (checkedKeys.length === 0) {
    alert("請先勾選講義與至少一個觀念子分類！");
    return;
  }
  const btn = document.getElementById("study-load-btn");
  const container = document.getElementById("study-cards-container");
  if (btn) btn.disabled = true;
  if (container) container.innerHTML = loadingBoxHtml("正在載入勾選範圍的觀念卡...");
  try {
    await ensureUnitsLoaded(checkedKeys);
    studyShownKeys = new Set(checkedKeys);
    renderStudyCards();
  } catch (err) {
    console.error(err);
    if (container) container.innerHTML = `<div class="empty-state-box">❌ 載入失敗：${escapeHtml(err.message || "請稍後再試")}</div>`;
  } finally {
    if (btn) btn.disabled = false;
    updateStudyPendingHint();
  }
}

/* ============================================================================
 * [MODULE 5.0] 肯定句觀念推導卡片渲染引擎 (Study Cards & Formula Engine)
 * ============================================================================ */

/**
 * 組裝單張肯定句觀念推導卡片 HTML
 * - 頂部左方顯示 [main_category] · sub_category 膠囊徽章，右方顯示 ID: concept_id
 * - 主標題顯示 ✦ title（若 title 為空或等於 "text" 才顯示 sub_category）
 * - 黃色推導框顯示 📌 definition
 * - 下方依序顯示「觀念要點：premise」與「核心對照：explanation」（若為空或等於 "text" 則自動隱藏）
 */
function buildConceptCardHtml(concept) {
  const mainCat = concept.main_category || "物理講義";
  const subCat = concept.sub_category || "核心觀念";
  const rawTitle = concept.title && concept.title !== "text" ? concept.title : subCat;
  const defText = concept.definition && concept.definition !== "text" ? concept.definition : "";
  const premiseText = concept.premise && concept.premise !== "text" ? concept.premise : "";
  const expText = concept.explanation && concept.explanation !== "text" ? concept.explanation : "";

  return `
    <div class="concept-card" data-concept-id="${escapeHtml(concept.concept_id)}">
      <div class="concept-card-top">
        <span class="concept-cat-badge">[${escapeHtml(mainCat)}] · ${escapeHtml(subCat)}</span>
        <span class="concept-id-tag">ID: ${escapeHtml(concept.concept_id)}</span>
      </div>
      <h3 class="concept-title">✦ ${escapeHtml(rawTitle)}</h3>
      ${
        defText
          ? `<div class="concept-definition">📌 ${escapeHtml(defText)}</div>`
          : ""
      }
      ${
        premiseText
          ? `<div class="concept-premise"><strong>💡 觀念要點：</strong>${escapeHtml(premiseText)}</div>`
          : ""
      }
      ${
        expText
          ? `<div class="concept-explanation"><strong>🔍 核心對照：</strong>${escapeHtml(expText)}</div>`
          : ""
      }
    </div>
  `;
}

/**
 * [5.1] 依第一層與第二層勾選結果過濾 conceptBank 並渲染觀念卡片
 */
function renderStudyCards() {
  const container = document.getElementById("study-cards-container");
  const summaryBadge = document.getElementById("study-count-summary");
  if (!container) return;

  const filtered = conceptBank.filter(c => studyShownKeys.has(itemUnitKey(c)));

  if (summaryBadge) {
    summaryBadge.textContent = `顯示 ${filtered.length} 張觀念卡`;
  }

  if (studyShownKeys.size === 0) {
    container.innerHTML = `
      <div class="empty-state-box">
        📌 請在上方勾選講義與觀念子分類，再按「📥 載入觀念卡」。
      </div>
    `;
    return;
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state-box">所選範圍目前沒有觀念卡資料。</div>`;
    return;
  }

  container.innerHTML = filtered.map(c => buildConceptCardHtml(c)).join("");
  triggerKaTeXRender(container);
}

/**
 * [5.2] 封裝 KaTeX 自動公式渲染器，支援 $$...$$ (Display) 與 $...$ (Inline)
 */
function triggerKaTeXRender(element) {
  if (!element) return;
  const renderOptions = {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
      { left: "\\(", right: "\\)", display: false },
      { left: "\\[", right: "\\]", display: true }
    ],
    throwOnError: false,
    errorColor: "#dc2626",
    strict: false
  };

  if (typeof window.renderMathInElement === "function") {
    try {
      window.renderMathInElement(element, renderOptions);
    } catch (err) {
      console.warn("KaTeX 渲染警告：", err);
    }
  } else {
    // 若 CDN 腳本尚在非同步載入，延遲 150ms 重試
    setTimeout(() => {
      if (typeof window.renderMathInElement === "function") {
        try {
          window.renderMathInElement(element, renderOptions);
        } catch (err) {
          console.warn("KaTeX 延遲渲染警告：", err);
        }
      }
    }, 150);
  }
}

/* ============================================================================
 * [MODULE 6.0] 隨機抽題、4選1動態組裝與倒數測驗引擎 (Timed Quiz Engine)
 * ============================================================================ */

function updateQuizCountSelectionUI() {
  const checkedRadio = document.querySelector('input[name="standard-quiz-count"]:checked');
  const val = checkedRadio ? checkedRadio.value : "5";
  const label5 = document.getElementById("quiz-count-label-5");
  const label10 = document.getElementById("quiz-count-label-10");
  if (label5) label5.classList.toggle("active", val === "5");
  if (label10) label10.classList.toggle("active", val === "10");
}

function updateRetryCountSelectionUI() {
  const checkedRadio = document.querySelector('input[name="retry-quiz-count"]:checked');
  const val = checkedRadio ? checkedRadio.value : "5";
  const label5 = document.getElementById("retry-count-label-5");
  const label10 = document.getElementById("retry-count-label-10");
  if (label5) label5.classList.toggle("active", val === "5");
  if (label10) label10.classList.toggle("active", val === "10");
}

/**
 * Fisher-Yates 洗牌演算法
 */
function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * [6.1] 題數選擇與啟動標準快速測驗 (initiateStandardQuiz)
 */
async function initiateStandardQuiz() {
  const checkedKeys = Array.from(getCheckedSubCategories("quiz"));

  if (checkedKeys.length === 0) {
    alert("請先勾選講義與至少一個觀念子分類再開始測驗！");
    return;
  }

  const startBtn = document.getElementById("start-quiz-btn");
  const originalText = startBtn ? startBtn.textContent : "";
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.textContent = "📥 正在載入題目...";
  }

  try {
    await ensureUnitsLoaded(checkedKeys);
  } catch (err) {
    console.error(err);
    alert(`題目載入失敗：${err.message || "請稍後再試"}`);
    return;
  } finally {
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = originalText;
    }
  }

  const keySet = new Set(checkedKeys);
  const candidatePool = questionBank.filter(q => keySet.has(itemUnitKey(q)));

  if (candidatePool.length === 0) {
    alert("目前勾選的範圍內沒有可用題目，請勾選其他觀念子分類！");
    return;
  }

  const countRadio = document.querySelector('input[name="standard-quiz-count"]:checked');
  const targetCount = countRadio ? parseInt(countRadio.value, 10) : 5;

  currentQuizMode = "standard";
  quizQuestions = shuffleArray(candidatePool).slice(0, targetCount);
  currentQuizIndex = 0;
  quizAnswersRecord = [];

  const mains = Array.from(new Set(checkedKeys.map(k => splitUnitKey(k).main)));
  currentQuizUnitTitle =
    checkedKeys.length === 1
      ? splitUnitKey(checkedKeys[0]).sub
      : `${mains.length === 1 ? mains[0] : "跨單元綜合"} (${checkedKeys.length}個觀念)`;

  startActiveQuizView();
}

/**
 * 切換至測驗作答視圖並載入第一題
 */
function startActiveQuizView() {
  switchTab("view-active-quiz");

  const activeCard = document.getElementById("active-question-card");
  const resultPanel = document.getElementById("quiz-result-panel");
  const modeBadge = document.getElementById("quiz-mode-badge");

  if (activeCard) activeCard.classList.remove("hidden");
  if (resultPanel) resultPanel.classList.add("hidden");
  if (modeBadge) {
    modeBadge.textContent =
      currentQuizMode === "retry" ? "🔥 錯題特訓消滅戰" : "⚡ 標準快速測驗";
  }

  loadQuizQuestion();
}

/**
 * [6.2] 單題載入、選項 4 選 1 動態抽樣與 20 秒計時 (loadQuizQuestion)
 */
function loadQuizQuestion() {
  if (quizTimer) {
    clearInterval(quizTimer);
    quizTimer = null;
  }

  const q = quizQuestions[currentQuizIndex];
  if (!q) {
    finishQuiz();
    return;
  }

  isAnswered = false;
  timeLeft = 20;

  // 更新頂部進度與分類徽章
  const progressEl = document.getElementById("quiz-progress-text");
  const categoryEl = document.getElementById("quiz-category-badge");
  const promptEl = document.getElementById("quiz-prompt");
  const optionsContainer = document.getElementById("quiz-options-container");
  const feedbackPanel = document.getElementById("quiz-feedback-panel");

  if (progressEl) {
    progressEl.textContent = `第 ${currentQuizIndex + 1} / ${quizQuestions.length} 題`;
  }
  if (categoryEl) {
    categoryEl.textContent = `[${q.main_category}] · ${q.sub_category}`;
  }
  if (feedbackPanel) {
    feedbackPanel.classList.add("hidden");
  }

  // 渲染題幹 (經過 LaTeX 健檢與修復)
  if (promptEl) {
    promptEl.innerHTML = escapeHtml(sanitizeAndRepairLatex(q.question));
    triggerKaTeXRender(promptEl);
  }

  // 4 選 1 動態組裝防呆規則：
  // 1. 深度清洗與去重干擾項，排除空值、純符號、與正解相同者
  const cleanCorrect = sanitizeAndRepairLatex(q.correctAnswer);
  let validDistractors = Array.from(
    new Set(
      (q.distractors || [])
        .map(sanitizeAndRepairLatex)
        .filter(d => d && d !== cleanCorrect && d.length > 1 && !/^[\$\\\|#\s]+$/.test(d))
    )
  );

  // 2. 防呆備援：若題目自身有效干擾項少於 3 個，自動從同分類或其他題目借用合適選項補足
  if (validDistractors.length < 3) {
    const backupPool = questionBank
      .filter(item => item.id !== q.id)
      .flatMap(item => [item.correctAnswer, ...(item.distractors || [])])
      .map(sanitizeAndRepairLatex)
      .filter(d => d && d !== cleanCorrect && !validDistractors.includes(d) && d.length > 1 && !/^[\$\\\|#\s]+$/.test(d));

    const needed = 3 - validDistractors.length;
    const borrowed = shuffleArray(backupPool).slice(0, needed);
    validDistractors.push(...borrowed);
  }

  // 3. 隨機選取最多 3 個干擾項，與正解合併為 4 個選項並洗牌打散
  const pickedDistractors = shuffleArray(validDistractors).slice(0, 3);
  currentFourChoices = shuffleArray([cleanCorrect, ...pickedDistractors].map(sanitizeAndRepairLatex));

  const letters = ["(A)", "(B)", "(C)", "(D)"];
  if (optionsContainer) {
    optionsContainer.innerHTML = currentFourChoices
      .map((choiceText, idx) => {
        return `
          <button
            type="button"
            class="quiz-opt-btn"
            data-opt-index="${idx}"
            onclick="handleAnswer(${idx})"
          >
            <span class="opt-letter">${letters[idx] || `(${idx + 1})`}</span>
            <span class="opt-content">${escapeHtml(choiceText)}</span>
          </button>
        `;
      })
      .join("");
    triggerKaTeXRender(optionsContainer);
  }

  // 記錄題目呈現瞬間的高精度時間戳並啟動 20 秒倒數
  questionStartTime = performance.now();
  updateTimerUI();

  quizTimer = setInterval(() => {
    timeLeft -= 1;
    updateTimerUI();
    if (timeLeft <= 0) {
      clearInterval(quizTimer);
      quizTimer = null;
      handleAnswer(-1); // 逾時未作答
    }
  }, 1000);
}

/**
 * 更新 20 秒倒數文字與進度條（剩餘 5 秒內進度條轉為紅色）
 */
function updateTimerUI() {
  const timerText = document.getElementById("timer-text");
  const timerBar = document.getElementById("timer-bar");
  const clamped = Math.max(0, timeLeft);
  const percentage = (clamped / 20) * 100;

  if (timerText) {
    timerText.textContent = `⏱️ ${clamped} 秒`;
    timerText.classList.toggle("danger", clamped <= 5);
  }
  if (timerBar) {
    timerBar.style.width = `${percentage}%`;
    timerBar.classList.toggle("danger", clamped <= 5);
  }
}

/**
 * [6.3] 作答判定與即時回饋 (handleAnswer)
 * @param {number} pickedIndex - 學生點擊的選項索引 (0~3)，若為 -1 代表逾時未作答
 */
function handleAnswer(pickedIndex) {
  if (isAnswered) return;
  isAnswered = true;

  if (quizTimer) {
    clearInterval(quizTimer);
    quizTimer = null;
  }

  const elapsedMs = Math.max(100, performance.now() - questionStartTime);
  const timeSpentStr = (elapsedMs / 1000).toFixed(1);

  const q = quizQuestions[currentQuizIndex];
  const pickedText =
    pickedIndex >= 0 && pickedIndex < currentFourChoices.length
      ? currentFourChoices[pickedIndex]
      : "未作答 (逾時)";
  const isCorrect = pickedText === q.correctAnswer;

  // 鎖定四個選項按鈕，標示答對綠底 (#dcfce7) / 答錯紅底 (#fee2e2)，同時將正確答案標示為綠框綠底
  const optButtons = document.querySelectorAll("#quiz-options-container .quiz-opt-btn");
  optButtons.forEach((btn, idx) => {
    btn.disabled = true;
    const choiceVal = currentFourChoices[idx];
    if (choiceVal === q.correctAnswer) {
      btn.classList.add("opt-correct");
    } else if (idx === pickedIndex && !isCorrect) {
      btn.classList.add("opt-wrong");
    }
  });

  // 取得核心解析（若題目本身 explanation 為空，自動結合對應觀念卡之肯定句定義）
  const linkedConcept = conceptBank.find(c => c.concept_id === q.concept_id);
  const resolvedExplanation =
    q.explanation && q.explanation !== "text"
      ? q.explanation
      : linkedConcept
      ? linkedConcept.definition
      : "請點擊下方「🔗 對照核心觀念」複習完整推導鏈。";

  // 存入 quizAnswersRecord（完全相容試算表 QuizHistory.snapshots_json）
  quizAnswersRecord.push({
    questionId: q.id,
    concept_id: q.concept_id,
    sub_category: q.sub_category,
    prompt: q.question,
    unit: q.sub_category,
    optionsSnapshot: currentFourChoices.map(val => ({
      type: "text",
      value: val,
      isCorrect: val === q.correctAnswer
    })),
    userPick: pickedText,
    correctPick: q.correctAnswer,
    isCorrect: isCorrect,
    explanation: resolvedExplanation,
    timeSpent: timeSpentStr
  });

  // 展開下方即時回饋列
  const feedbackPanel = document.getElementById("quiz-feedback-panel");
  const feedbackHeader = document.getElementById("quiz-feedback-header");
  const feedbackBody = document.getElementById("quiz-feedback-body");
  const conceptBtn = document.getElementById("quiz-feedback-concept-btn");
  const nextBtn = document.getElementById("next-question-btn");

  if (feedbackHeader) {
    if (isCorrect) {
      feedbackHeader.textContent = `✅ 答對了！（作答耗時：⏱️ ${timeSpentStr} 秒）`;
      feedbackHeader.className = "feedback-header is-correct";
    } else if (pickedIndex === -1) {
      feedbackHeader.textContent = `⏰ 作答逾時！（耗時：⏱️ 20.0 秒）`;
      feedbackHeader.className = "feedback-header is-wrong";
    } else {
      feedbackHeader.textContent = `❌ 答錯了！（作答耗時：⏱️ ${timeSpentStr} 秒）`;
      feedbackHeader.className = "feedback-header is-wrong";
    }
  }

  if (feedbackBody) {
    feedbackBody.innerHTML = `
      <div><strong>🎯 正確答案：</strong>${escapeHtml(q.correctAnswer)}</div>
      <div style="margin-top: 8px;"><strong>📖 核心解析：</strong>${escapeHtml(resolvedExplanation)}</div>
    `;
    triggerKaTeXRender(feedbackBody);
  }

  if (conceptBtn) {
    conceptBtn.onclick = () => openConceptModal(q.concept_id, q.sub_category);
  }

  if (nextBtn) {
    const isLast = currentQuizIndex >= quizQuestions.length - 1;
    nextBtn.textContent = isLast ? "查看測驗成績 📊" : "下一題 ➔";
  }

  if (feedbackPanel) {
    feedbackPanel.classList.remove("hidden");
  }
}

/**
 * 前往下一題或進入測驗結算
 */
function goToNextQuestion() {
  if (currentQuizIndex < quizQuestions.length - 1) {
    currentQuizIndex += 1;
    loadQuizQuestion();
  } else {
    finishQuiz();
  }
}

/**
 * [6.4] 測驗結算與雲端同步 (finishQuiz)
 */
async function finishQuiz() {
  if (quizTimer) {
    clearInterval(quizTimer);
    quizTimer = null;
  }

  const activeCard = document.getElementById("active-question-card");
  const resultPanel = document.getElementById("quiz-result-panel");
  if (activeCard) activeCard.classList.add("hidden");
  if (resultPanel) resultPanel.classList.remove("hidden");

  const totalCount = quizAnswersRecord.length;
  const correctCount = quizAnswersRecord.filter(r => r.isCorrect).length;
  const percent = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
  const totalTime = quizAnswersRecord.reduce((acc, r) => acc + parseFloat(r.timeSpent || "0"), 0);
  const avgTime = totalCount > 0 ? (totalTime / totalCount).toFixed(1) : "0.0";

  const unitTitle =
    currentQuizMode === "retry" ? "🔥 錯題特訓消滅戰" : currentQuizUnitTitle || "物理觀念測驗";

  document.getElementById("result-title-text").textContent =
    currentQuizMode === "retry" ? "🔥 錯題特訓結算報告" : "⚡ 快速測驗結算報告";
  document.getElementById("result-unit-text").textContent = `測驗單元：${unitTitle}`;
  document.getElementById("result-score-fraction").textContent = `${correctCount} / ${totalCount}`;
  document.getElementById("result-score-percent").textContent = `${percent}%`;
  document.getElementById("result-avg-time").textContent = `${avgTime} 秒`;

  const syncNotice = document.getElementById("result-sync-notice");
  if (syncNotice) {
    syncNotice.textContent = "⏳ 正在將本次作答快照寫入雲端 QuizHistory 並更新錯題動態消除池...";
  }

  const scoreStr = `${correctCount} / ${totalCount}`;
  const targetUsername = currentUser && currentUser.username ? currentUser.username : "";

  // 精簡版快照（改用 POST 後已無網址長度限制；後端會再次驗證與限制長度）
  const compactSnapshots = quizAnswersRecord.map(r => ({
    qId: r.questionId,
    concept_id: r.concept_id,
    sub: r.sub_category,
    pick: r.userPick,
    correct: r.correctPick,
    ok: r.isCorrect,
    t: r.timeSpent
  }));

  try {
    const res = await callGasApi("submitQuiz", {
      username: targetUsername,
      unit_title: unitTitle,
      unitTitle: unitTitle,
      score: scoreStr,
      correct_count: correctCount,
      correctCount: correctCount,
      total_count: totalCount,
      totalCount: totalCount,
      snapshots: compactSnapshots
    });

    if (res && res.success && res.session) {
      // 雲端確認成功寫入，將標準 session 資料推入本地歷史 (內部自動調用 hydrateSnapshot 補齊題幹與解析)
      const savedSession = normalizeHistoryItem(res.session);
      quizHistory.push(savedSession);

      // 動態更新錯題池與相關畫面
      recalculateUnresolvedMistakes();
      renderMistakeReviewCards();
      initRetryQuizUI();
      renderHistoryCards(currentHistoryFilter);

      if (syncNotice) {
        syncNotice.classList.remove("sync-error");
        syncNotice.textContent =
          "✅ 已成功寫入雲端 QuizHistory！錯題池與歷史快照已完成即時同步。";
      }
    } else {
      // 後端回傳失敗訊息
      const errMsg = (res && res.message) ? res.message : "雲端資料庫回傳異常";
      console.error("雲端寫入測驗紀錄失敗：", errMsg, res);
      if (syncNotice) {
        syncNotice.classList.add("sync-error");
        syncNotice.textContent = `❌ 雲端寫入失敗（${errMsg}）！本次作答未寫入試算表，請檢查後端部署。`;
      }
      alert(`【雲端同步失敗警告】\n測驗作答快照未能成功寫入 Google 試算表 QuizHistory！\n原因：${errMsg}\n\n為維持雲端與本機資料一致性，系統不會寫入未經確認的暫存快照。請確認 Google 試算表存取權限或重新提交。`);
    }
  } catch (err) {
    console.error("雲端連線失敗或逾時：", err);
    if (syncNotice) {
      syncNotice.classList.add("sync-error");
      syncNotice.textContent =
        `❌ 雲端連線異常（${err.message || "網路阻斷"}）！本次作答未成功儲存至試算表。`;
    }
    alert(`【網路連線失敗警告】\n無法連線至雲端 API 端點。\n原因：${err.message || "網路連線中斷或逾時"}\n\n本次測驗紀錄未寫入雲端，請檢查網路連線或稍後重試。`);
  }
}

/* ============================================================================
 * [MODULE 7.0] 錯題動態消除、歷史快照區間篩選與錯題特訓引擎 (Mistake & History Engine)
 * ============================================================================ */

/**
 * [7.1] 純雲端歷史驅動之錯題動態解析器 (recalculateUnresolvedMistakes)
 * - 100% 透過掃描 quizHistory 陣列動態判定，不使用 localStorage
 * - 將 quizHistory 依 timestamp 由舊到新排序，依序遍歷每次測驗的 snapshots：
 *   - 當 isCorrect === false 時，存入待消滅錯題池 unresolvedMistakeMap
 *   - 當同一道 questionId 在後續測驗中出現 isCorrect === true 時，立即從待消滅錯題池移除！
 */
function recalculateUnresolvedMistakes() {
  unresolvedMistakeMap.clear();

  const sortedChronological = [...quizHistory].sort((a, b) => {
    const ta = new Date(a.timestamp || 0).getTime();
    const tb = new Date(b.timestamp || 0).getTime();
    return ta - tb;
  });

  const questionLookup = new Map();
  questionBank.forEach(q => questionLookup.set(q.id, q));

  sortedChronological.forEach(session => {
    const snaps = Array.isArray(session.snapshots) ? session.snapshots : [];
    snaps.forEach(rawSnap => {
      const snap = hydrateSnapshot(rawSnap);
      if (!snap || !snap.questionId) return;

      const qId = snap.questionId;
      if (!snap.isCorrect) {
        unresolvedMistakeMap.set(qId, {
          questionId: qId,
          concept_id: snap.concept_id,
          sub_category: snap.sub_category,
          prompt: snap.prompt,
          userPick: snap.userPick,
          correctPick: snap.correctPick,
          timeSpent: snap.timeSpent,
          explanation: snap.explanation,
          timestamp: session.timestamp
        });
      } else {
        // 動態消除機制：後續測驗答對即從待消滅錯題池中移除
        unresolvedMistakeMap.delete(qId);
      }
    });
  });

  const unresolvedCount = unresolvedMistakeMap.size;
  const reviewBadge = document.getElementById("badge-review-count");
  const retryBadge = document.getElementById("badge-retry-count");
  const retryBigNum = document.getElementById("retry-mistake-count");

  if (reviewBadge) reviewBadge.textContent = String(unresolvedCount);
  if (retryBadge) retryBadge.textContent = String(unresolvedCount);
  if (retryBigNum) retryBigNum.textContent = String(unresolvedCount);
}

/**
 * [7.2] 錯題整理視圖 (renderMistakeReviewCards)
 */
function renderMistakeReviewCards() {
  const container = document.getElementById("review-cards-container");
  if (!container) return;

  const mistakes = Array.from(unresolvedMistakeMap.values());

  if (mistakes.length === 0) {
    container.innerHTML = `
      <div class="empty-state-box">
        🎉 <strong>太棒了！目前待消滅錯題數為 0！</strong><br />
        你已完成所有錯題的訂正與動態消除，或可前往「⚡ 快速測驗」挑戰更多單元題目。
      </div>
    `;
    return;
  }

  container.innerHTML = mistakes
    .map(m => {
      const linkedConcept = conceptBank.find(c => c.concept_id === m.concept_id);
      const expText =
        m.explanation && m.explanation !== "text"
          ? m.explanation
          : linkedConcept
          ? linkedConcept.definition
          : "請點擊下方按鈕對照核心觀念推導卡。";

      return `
        <div class="mistake-card" data-question-id="${escapeHtml(m.questionId)}">
          <div class="mistake-meta-row">
            <span class="concept-cat-badge">${escapeHtml(m.sub_category || "物理觀念")}</span>
            <span class="mistake-time-tag">⏱️ 上次作答耗時：${escapeHtml(String(m.timeSpent || "0.0"))} 秒</span>
          </div>

          <div class="mistake-prompt">${escapeHtml(m.prompt)}</div>

          <div class="mistake-compare-grid">
            <div class="pick-box wrong-pick">
              <strong>✗ 你上次的錯誤選擇：</strong><br />
              ${escapeHtml(m.userPick)}
            </div>
            <div class="pick-box correct-pick">
              <strong>✓ 正確答案：</strong><br />
              ${escapeHtml(m.correctPick)}
            </div>
          </div>

          <div class="mistake-exp-box">
            <strong>📖 核心解析：</strong>${escapeHtml(expText)}
          </div>

          <div class="mistake-footer">
            <button
              type="button"
              class="btn-outline"
              onclick="openConceptModal('${escapeJsStr(m.concept_id)}', '${escapeJsStr(m.sub_category)}')"
            >
              🔗 對照核心觀念 (${escapeHtml(m.concept_id || "講義對照")})
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  triggerKaTeXRender(container);
}

/**
 * [7.3] 錯題特訓視圖初始化與啟動 (initRetryQuizUI & initiateRetryQuiz)
 */
function initRetryQuizUI() {
  const count = unresolvedMistakeMap.size;
  const bigNumEl = document.getElementById("retry-mistake-count");
  const startBtn = document.getElementById("start-retry-btn");
  const emptyHint = document.getElementById("retry-empty-hint");

  if (bigNumEl) bigNumEl.textContent = String(count);
  if (emptyHint) {
    emptyHint.classList.toggle("hidden", count > 0);
  }
  if (startBtn) {
    startBtn.disabled = count === 0;
  }
}

function initiateRetryQuiz() {
  const unresolvedIds = Array.from(unresolvedMistakeMap.keys());
  if (unresolvedIds.length === 0) {
    alert("🎉 目前沒有任何待消滅的錯題！");
    return;
  }

  const countRadio = document.querySelector('input[name="retry-quiz-count"]:checked');
  const maxCount = countRadio ? parseInt(countRadio.value, 10) : 5;

  // 從 questionBank 找出對應題目；若題庫未載入該題則以快照重建題目物件
  const retryPool = unresolvedIds
    .map(qId => {
      const fromBank = questionBank.find(q => q.id === qId);
      if (fromBank) return fromBank;
      const snap = unresolvedMistakeMap.get(qId);
      if (!snap) return null;
      return {
        id: snap.questionId,
        concept_id: snap.concept_id,
        main_category: "錯題重練",
        sub_category: snap.sub_category || "觀念重練",
        question: snap.prompt,
        correctAnswer: snap.correctPick,
        distractors: [snap.userPick].filter(Boolean),
        explanation: snap.explanation
      };
    })
    .filter(Boolean);

  currentQuizMode = "retry";
  currentQuizUnitTitle = "🔥 錯題特訓消滅戰";
  quizQuestions = shuffleArray(retryPool).slice(0, maxCount);
  currentQuizIndex = 0;
  quizAnswersRecord = [];

  startActiveQuizView();
}

/**
 * [7.4] 歷史快照與時間區間過濾器 (renderHistoryCards)
 * @param {string} filterRange - '6m' (預設：近 6 個月內), '6m-1y' (半年前～一年前), '1y+' (一年以前), 'all' (全部歷史紀錄)
 */
function renderHistoryCards(filterRange = "6m") {
  currentHistoryFilter = filterRange;

  // 更新篩選按鈕 active 樣式
  const btnIds = {
    "6m": "hist-filter-6m",
    "6m-1y": "hist-filter-6m-1y",
    "1y+": "hist-filter-1y+",
    "all": "hist-filter-all"
  };

  Object.entries(btnIds).forEach(([key, id]) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.classList.toggle("active", key === filterRange);
    }
  });

  const container = document.getElementById("history-cards-container");
  const summaryEl = document.getElementById("history-count-summary");
  if (!container) return;

  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const ms180d = 180 * dayMs;
  const ms365d = 365 * dayMs;

  // 依時間區間過濾
  const filteredHistory = quizHistory.filter(item => {
    if (filterRange === "all") return true;
    const ts = new Date(item.timestamp || 0).getTime();
    if (isNaN(ts)) return filterRange === "6m";
    const diff = nowMs - ts;

    if (filterRange === "6m") {
      return diff <= ms180d;
    } else if (filterRange === "6m-1y") {
      return diff > ms180d && diff <= ms365d;
    } else if (filterRange === "1y+") {
      return diff > ms365d;
    }
    return true;
  });

  // 依時間由新到舊排序
  filteredHistory.sort((a, b) => {
    return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
  });

  if (summaryEl) {
    summaryEl.textContent = `共 ${filteredHistory.length} 筆紀錄`;
  }

  // 按需補齊此區間快照所需的題目內容（題幹、解析）；只有在歷史頁面顯示時才下載
  const haveIds = new Set(questionBank.map(q => q.id));
  const missingIds = [];
  filteredHistory.forEach(session => {
    (session.snapshots || []).forEach(snap => {
      const id = snap && (snap.questionId || snap.qId);
      if (id && !haveIds.has(id) && !requestedQuestionIds.has(id)) missingIds.push(id);
    });
  });
  const historyView = document.getElementById("view-history");
  const historyVisible = !(historyView && historyView.classList.contains("hidden"));
  if (missingIds.length > 0 && historyVisible) {
    container.innerHTML = loadingBoxHtml("正在載入歷史紀錄的題目內容...");
    ensureItemsLoaded(missingIds, [])
      .catch(err => console.warn("歷史題目載入失敗：", err))
      .finally(() => {
        if (currentHistoryFilter === filterRange) renderHistoryCards(filterRange);
      });
    return;
  }

  if (filteredHistory.length === 0) {
    container.innerHTML = `
      <div class="empty-state-box">
        📭 此時間區間內尚無測驗歷史紀錄。可切換上方其他時間區間或前往「⚡ 快速測驗」建立新紀錄！
      </div>
    `;
    return;
  }

  container.innerHTML = filteredHistory
    .map((session, idx) => {
      const snaps = Array.isArray(session.snapshots) ? session.snapshots : [];
      const totalTime = snaps.reduce((sum, s) => sum + parseFloat(s.timeSpent || "0"), 0);
      const avgTime = snaps.length > 0 ? (totalTime / snaps.length).toFixed(1) : "0.0";
      const formattedDate = formatTaiwanDateTime(session.timestamp);
      const bodyId = `history-acc-body-${idx}`;

      const snapshotsHtml =
        snaps.length === 0
          ? `<div class="empty-state-box">此筆紀錄無作答明細快照。</div>`
          : snaps
              .map((rawSnap, sIdx) => {
                const snap = hydrateSnapshot(rawSnap) || rawSnap;
                const isOk = Boolean(snap.isCorrect);
                const cid = snap.concept_id || "";
                const subCat = snap.sub_category || snap.unit || "";
                const linkedConcept = conceptBank.find(c => c.concept_id === cid);
                const expText =
                  snap.explanation && snap.explanation !== "text"
                    ? snap.explanation
                    : linkedConcept
                    ? linkedConcept.definition
                    : "請點擊下方按鈕對照核心觀念卡片。";

                return `
                  <div class="snapshot-item ${isOk ? "snap-correct" : "snap-wrong"}">
                    <div class="snapshot-top">
                      <div>
                        <strong>第 ${sIdx + 1} 題</strong>
                        <span class="snapshot-status-badge ${isOk ? "ok" : "ng"}">
                          ${isOk ? "✓ 答對" : "✗ 答錯"}
                        </span>
                      </div>
                      <span class="history-avg-time">⏱️ ${escapeHtml(String(snap.timeSpent || "0.0"))} 秒</span>
                    </div>

                    <div style="font-weight: 700; margin-bottom: 8px;">${escapeHtml(snap.prompt || "")}</div>

                    <div style="font-size: 14.5px; margin-bottom: 6px;">
                      <span><strong>你的選擇：</strong>${escapeHtml(snap.userPick || "未作答")}</span>
                      <span style="margin-left: 16px;"><strong>正確答案：</strong>${escapeHtml(snap.correctPick || "")}</span>
                    </div>

                    <div style="font-size: 14px; color: #475569; margin-bottom: 10px;">
                      <strong>詳解：</strong>${escapeHtml(expText)}
                    </div>

                    <div style="display: flex; justify-content: flex-end;">
                      <button
                        type="button"
                        class="btn-outline"
                        onclick="openConceptModal('${escapeJsStr(cid)}', '${escapeJsStr(subCat)}')"
                      >
                        🔗 對照核心觀念
                      </button>
                    </div>
                  </div>
                `;
              })
              .join("");

      return `
        <div class="history-card">
          <button
            type="button"
            class="history-summary-bar"
            onclick="toggleHistoryAccordion('${bodyId}')"
            aria-expanded="false"
          >
            <div class="history-summary-left">
              <span class="history-unit-title">${escapeHtml(session.unit_title)}</span>
              <span class="history-date-text">🕒 測驗時間：${escapeHtml(formattedDate)}</span>
            </div>
            <div class="history-summary-right">
              <span class="history-score-badge">得分：${escapeHtml(session.score)}</span>
              <span class="history-avg-time">⏱️ 平均 ${avgTime} 秒/題</span>
              <span style="font-size: 14px; color: #2563eb; font-weight: 700;">展開明細 ▾</span>
            </div>
          </button>
          <div id="${bodyId}" class="history-accordion-body hidden">
            ${snapshotsHtml}
          </div>
        </div>
      `;
    })
    .join("");

  triggerKaTeXRender(container);
}

/**
 * 切換歷史快照手風琴明細展開/收合
 */
function toggleHistoryAccordion(bodyId) {
  const el = document.getElementById(bodyId);
  if (!el) return;
  el.classList.toggle("hidden");
  if (!el.classList.contains("hidden")) {
    triggerKaTeXRender(el);
  }
}

/* ============================================================================
 * [MODULE 8.0] 管理者專屬題庫檢視與單元選取面板 (Admin Question Bank Manager)
 * ============================================================================ */

/**
 * [8.1] 初始化管理者單元分類下拉選單
 */
function initAdminTaxonomyFilters() {
  const mainSelect = document.getElementById("admin-main-select");
  if (!mainSelect) return;

  mainSelect.innerHTML = [
    ...catalog.map(m => `<option value="${escapeHtml(m.main)}">${escapeHtml(m.main)}（${m.questionCount} 題）</option>`),
    `<option value="ALL">全部講義 (跨單元，載入較久)</option>`
  ].join("");

  handleAdminMainCategoryChange();
}

/**
 * [8.2] 當管理者主分類變更時，動態更新第二層觀念子分類下拉選單
 */
function handleAdminMainCategoryChange() {
  const mainSelect = document.getElementById("admin-main-select");
  const subSelect = document.getElementById("admin-sub-select");
  if (!mainSelect || !subSelect) return;

  const selectedMain = mainSelect.value;
  const subs = [];
  catalog
    .filter(m => selectedMain === "ALL" || m.main === selectedMain)
    .forEach(m => m.subs.forEach(s => { if (!subs.includes(s.sub)) subs.push(s.sub); }));

  subSelect.innerHTML = [
    `<option value="ALL">全部觀念子分類 (共 ${subs.length} 個子單元)</option>`,
    ...subs.map(sub => `<option value="${escapeHtml(sub)}">${escapeHtml(sub)}</option>`)
  ].join("");

  renderAdminQuestionList();
}

/**
 * [8.3] 渲染管理者專屬題庫卡片清單
 * 完整檢視該單元底下的所有題目、選項、正確答案與詳解，不需隨機抽選
 */
async function renderAdminQuestionList() {
  const container = document.getElementById("admin-questions-container");
  const mainSelect = document.getElementById("admin-main-select");
  const subSelect = document.getElementById("admin-sub-select");
  if (!container) return;

  const selectedMain = mainSelect ? mainSelect.value : "ALL";
  const selectedSub = subSelect ? subSelect.value : "ALL";
  const keys = [];
  catalog
    .filter(m => selectedMain === "ALL" || m.main === selectedMain)
    .forEach(m => m.subs.forEach(s => {
      if (selectedSub === "ALL" || s.sub === selectedSub) keys.push(unitKey(m.main, s.sub));
    }));

  if (keys.some(k => !loadedUnitKeys.has(k))) {
    container.innerHTML = loadingBoxHtml("正在載入題庫...");
    try {
      await ensureUnitsLoaded(keys);
    } catch (err) {
      container.innerHTML = `<div class="empty-state-box">❌ 載入失敗：${escapeHtml(err.message || "請稍後再試")}</div>`;
      return;
    }
    // 載入期間若管理者已切換選單，以最新選擇為準
    if ((mainSelect ? mainSelect.value : "ALL") !== selectedMain || (subSelect ? subSelect.value : "ALL") !== selectedSub) return;
  }
  renderAdminQuestionListNow();
}

function renderAdminQuestionListNow() {
  const container = document.getElementById("admin-questions-container");
  const countBadge = document.getElementById("admin-questions-count");
  const mainSelect = document.getElementById("admin-main-select");
  const subSelect = document.getElementById("admin-sub-select");

  if (!container) return;

  const selectedMain = mainSelect ? mainSelect.value : "ALL";
  const selectedSub = subSelect ? subSelect.value : "ALL";

  const filtered = questionBank.filter(q => {
    const matchMain = selectedMain === "ALL" || q.main_category === selectedMain;
    const matchSub = selectedSub === "ALL" || q.sub_category === selectedSub;
    return matchMain && matchSub;
  });

  if (countBadge) {
    countBadge.textContent = `顯示 ${filtered.length} 題 / 題庫總計 ${catalogTotals().questions} 題`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state-box">
        📭 所選分類目前尚無題目資料。
      </div>
    `;
    return;
  }

  container.innerHTML = filtered
    .map((q, idx) => {
      const cleanCorrect = sanitizeAndRepairLatex(q.correctAnswer);
      const cleanDistractors = (q.distractors || []).map(sanitizeAndRepairLatex);
      const linkedConcept = conceptBank.find(c => c.concept_id === q.concept_id);
      const expText =
        q.explanation && q.explanation !== "text"
          ? q.explanation
          : linkedConcept
          ? linkedConcept.definition
          : "暫無詳解，請對照核心觀念推導。";

      const distractorsHtml = cleanDistractors.length > 0
        ? cleanDistractors
            .map((d, dIdx) => {
              return `
                <div class="admin-opt-item admin-opt-distractor">
                  <span class="admin-opt-tag">干擾項 ${dIdx + 1}</span>
                  <span class="opt-content">${escapeHtml(d)}</span>
                </div>
              `;
            })
            .join("")
        : `<div style="font-size: 13.5px; color: #64748b;">(無額外干擾項)</div>`;

      return `
        <div class="admin-question-card" data-question-id="${escapeHtml(q.id)}">
          <div class="admin-card-top">
            <div>
              <span class="concept-cat-badge">[${escapeHtml(q.main_category)}] · ${escapeHtml(q.sub_category)}</span>
              <strong style="margin-left: 8px; font-size: 14.5px;">題號 ${idx + 1}</strong>
            </div>
            <span class="concept-id-tag">題目 ID: ${escapeHtml(q.id)}</span>
          </div>

          <div class="admin-prompt-box">
            ${escapeHtml(q.question)}
          </div>

          <div class="admin-options-grid">
            <div class="admin-opt-item admin-opt-correct">
              <span class="admin-opt-tag">🎯 正確選項</span>
              <span class="opt-content">${escapeHtml(cleanCorrect)}</span>
            </div>
            ${distractorsHtml}
          </div>

          <div class="admin-exp-box">
            <strong>📖 題目詳解與核心對照：</strong><br />
            ${escapeHtml(expText)}
          </div>

          <div class="admin-card-footer">
            <button
              type="button"
              class="btn-outline"
              onclick="openConceptModal('${escapeJsStr(q.concept_id)}', '${escapeJsStr(q.sub_category)}')"
            >
              🔗 對照核心觀念 (${escapeHtml(q.concept_id || "無關聯")})
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  triggerKaTeXRender(container);
}

/* ============================================================================
 * [MODULE 9.0] 管理者「📋 使用紀錄」頁面 (Admin Activity Dashboard)
 * 依時間區間查詢：使用紀錄明細、學生統計摘要、學生測驗與錯題、異常提醒、錯題排行榜
 * ============================================================================ */
const LOG_ACTION_LABELS = {
  LOGIN_OK: "登入",
  LOGIN_FAIL: "登入失敗",
  LOAD_UNIT: "載入講義",
  LOAD_ITEMS: "補抓題目",
  SUBMIT_QUIZ: "提交測驗",
  RATE_LIMIT: "請求過於頻繁",
  REGISTER_OK: "註冊帳號",
  REGISTER_FAIL: "註冊失敗",
  ADMIN_ACCOUNT: "帳號管理"
};
let adminLogData = null;
let adminLogQuery = { from: null, to: null, label: "" };
let adminLogInitialized = false;
let adminLogShowCount = 300;
let adminTopWrongCohort = "__ALL__";

function initAdminLogView() {
  if (!adminLogInitialized) {
    adminLogInitialized = true;
    setAdminLogPreset("7d");
  }
}

function toDateInputValue(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function setAdminLogPreset(preset) {
  const labels = { today: "今天", "7d": "近 7 天", "30d": "近 30 天", all: "全部紀錄" };
  ["today", "7d", "30d", "all"].forEach(p => {
    const btn = document.getElementById(`log-preset-${p}`);
    if (btn) btn.classList.toggle("active", p === preset);
  });
  const now = new Date();
  let from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === "7d") from.setDate(from.getDate() - 6);
  if (preset === "30d") from.setDate(from.getDate() - 29);
  if (preset === "all") from = null;
  const fromInput = document.getElementById("log-from-date");
  const toInput = document.getElementById("log-to-date");
  if (fromInput) fromInput.value = from ? toDateInputValue(from) : "";
  if (toInput) toInput.value = toDateInputValue(now);
  queryAdminLog(from, null, labels[preset] || "");
}

function applyAdminLogCustomRange() {
  const fromVal = (document.getElementById("log-from-date") || {}).value || "";
  const toVal = (document.getElementById("log-to-date") || {}).value || "";
  if (!fromVal && !toVal) {
    alert("請至少選擇起始或結束日期！");
    return;
  }
  const parse = v => {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const from = fromVal ? parse(fromVal) : null;
  const to = toVal ? parse(toVal) : null;
  if (to) to.setHours(23, 59, 59, 999);
  if (from && to && from > to) {
    alert("起始日期不能晚於結束日期！");
    return;
  }
  ["today", "7d", "30d", "all"].forEach(p => {
    const btn = document.getElementById(`log-preset-${p}`);
    if (btn) btn.classList.remove("active");
  });
  queryAdminLog(from, to, `${fromVal || "最早"} ～ ${toVal || "今天"}`);
}

async function queryAdminLog(from, to, label) {
  adminLogQuery = { from: from ? from.toISOString() : null, to: to ? to.toISOString() : null, label };
  const rangeEl = document.getElementById("admin-log-range-label");
  if (rangeEl) rangeEl.textContent = `查詢中：${label}`;
  const summaryEl = document.getElementById("admin-log-summary");
  if (summaryEl) summaryEl.innerHTML = loadingBoxHtml("正在讀取使用紀錄與作答資料...");
  ["admin-log-anomalies", "admin-log-students", "admin-log-topwrong", "admin-log-details"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
  });
  const detailEl = document.getElementById("admin-log-student-detail");
  if (detailEl) detailEl.classList.add("hidden");

  try {
    const res = await callGasApi("getAdminDashboard", { from: adminLogQuery.from, to: adminLogQuery.to });
    if (!res || !res.success) throw new Error((res && res.message) || "無法取得使用紀錄");
    adminLogData = res;
    adminLogShowCount = 300;
    if (rangeEl) rangeEl.textContent = `區間：${label}`;
    populateAdminLogFilters();
    renderAdminLog();
  } catch (err) {
    console.error(err);
    if (summaryEl) summaryEl.innerHTML = `<div class="empty-state-box">❌ 讀取失敗：${escapeHtml(err.message || "請稍後再試")}</div>`;
  }
}

function setSelectOptions(id, options, keepValue = true) {
  const el = document.getElementById(id);
  if (!el) return;
  const prev = el.value;
  el.innerHTML = options.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join("");
  if (keepValue && options.some(o => o.value === prev)) el.value = prev;
}

function populateAdminLogFilters() {
  if (!adminLogData) return;
  setSelectOptions("log-filter-cohort", [
    { value: "ALL", label: "全部班別" },
    ...adminLogData.cohorts.map(c => ({ value: c, label: c }))
  ]);
  const cohort = (document.getElementById("log-filter-cohort") || {}).value || "ALL";
  const students = adminLogData.students
    .filter(s => cohort === "ALL" || (s.cohort || "未分班") === cohort)
    .sort((a, b) => a.username.localeCompare(b.username));
  setSelectOptions("log-filter-user", [
    { value: "ALL", label: "全部學生" },
    ...students.map(s => ({ value: s.username, label: `${s.name}（${s.username}）` }))
  ]);
  setSelectOptions("log-filter-action", [
    { value: "ALL", label: "全部動作" },
    ...Object.entries(LOG_ACTION_LABELS).map(([k, v]) => ({ value: k, label: v }))
  ]);
}

function handleAdminLogCohortChange() {
  populateAdminLogFilters();
  renderAdminLog();
}

function getAdminLogFilters() {
  return {
    cohort: (document.getElementById("log-filter-cohort") || {}).value || "ALL",
    user: (document.getElementById("log-filter-user") || {}).value || "ALL",
    action: (document.getElementById("log-filter-action") || {}).value || "ALL"
  };
}

function matchCohortUser(item, f) {
  if (f.cohort !== "ALL" && (item.cohort || "未分班") !== f.cohort) return false;
  if (f.user !== "ALL" && String(item.username || "").toUpperCase() !== f.user.toUpperCase()) return false;
  return true;
}

function percentText(v) {
  return v === null || v === undefined ? "—" : `${v}%`;
}

function tableHtml(headers, rowsHtml) {
  return `
    <div style="overflow-x: auto;">
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead><tr>${headers.map(h => `<th style="text-align: left; padding: 8px; border-bottom: 2px solid #cbd5e1; white-space: nowrap;">${h}</th>`).join("")}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

function td(content, extra = "") {
  return `<td style="padding: 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; ${extra}">${content}</td>`;
}

function renderAdminLog() {
  if (!adminLogData) return;
  const f = getAdminLogFilters();
  const d = adminLogData;

  // 總覽
  const summaryEl = document.getElementById("admin-log-summary");
  if (summaryEl) {
    summaryEl.innerHTML = `
      <h3 class="section-title">📈 區間總覽</h3>
      <div class="admin-badge-row" style="flex-wrap: wrap; gap: 8px;">
        <span class="count-pill">活躍學生：${d.totals.activeStudents} 人</span>
        <span class="count-pill">登入次數：${d.totals.loginCount}</span>
        <span class="count-pill">測驗次數：${d.totals.quizCount}</span>
        <span class="count-pill">整體答對率：${percentText(d.totals.accuracy)}</span>
      </div>
    `;
  }

  // 異常提醒
  const anomalies = d.anomalies.filter(a => matchCohortUser(a, f));
  const anomalyEl = document.getElementById("admin-log-anomalies");
  if (anomalyEl) {
    anomalyEl.innerHTML = `
      <h3 class="section-title">⚠️ 異常行為提醒（${anomalies.length}）</h3>
      ${
        anomalies.length === 0
          ? `<div class="empty-state-box">此區間沒有異常行為。</div>`
          : tableHtml(
              ["類型", "學生", "班別", "時間", "說明"],
              anomalies
                .map(a =>
                  `<tr>${td(escapeHtml(a.type), "color: #b91c1c; font-weight: 600;")}${td(escapeHtml(`${a.name || ""}（${a.username}）`))}${td(escapeHtml(a.cohort || "—"))}${td(escapeHtml(formatTaiwanDateTime(a.from)) + (a.to !== a.from ? `<br>～ ${escapeHtml(formatTaiwanDateTime(a.to))}` : ""))}${td(escapeHtml(a.detail))}</tr>`
                )
                .join("")
            )
      }
    `;
  }

  // 學生統計摘要
  const students = d.students
    .filter(s => matchCohortUser(s, f))
    .sort((a, b) => (b.lastLogin || "").localeCompare(a.lastLogin || "") || a.username.localeCompare(b.username));
  const studentEl = document.getElementById("admin-log-students");
  if (studentEl) {
    studentEl.innerHTML = `
      <h3 class="section-title">👥 學生統計摘要（${students.length} 人）</h3>
      ${
        students.length === 0
          ? `<div class="empty-state-box">沒有符合篩選條件的學生。</div>`
          : tableHtml(
              ["學生", "班別", "登入次數", "最近登入", "載入講義", "測驗次數", "平均答對率", "未訂正錯題", ""],
              students
                .map(s =>
                  `<tr>${td(escapeHtml(`${s.name}（${s.username}）`))}${td(escapeHtml(s.cohort || "未分班"))}${td(s.loginCount)}${td(s.lastLogin ? escapeHtml(formatTaiwanDateTime(s.lastLogin)) : "—")}${td(s.loadCount)}${td(s.quizCount)}${td(percentText(s.accuracy))}${td(s.unresolved)}${td(`<button type="button" class="btn-chip" onclick="showStudentDetail('${escapeJsStr(s.username)}')">查看</button>`)}</tr>`
                )
                .join("")
            )
      }
    `;
  }

  renderTopWrong();

  // 使用紀錄明細
  const logs = d.logs.filter(l => matchCohortUser(l, f) && (f.action === "ALL" || l.action === f.action));
  const shown = logs.slice(0, adminLogShowCount);
  const detailsEl = document.getElementById("admin-log-details");
  if (detailsEl) {
    detailsEl.innerHTML = `
      <h3 class="section-title">🧾 使用紀錄明細（${logs.length} 筆${d.logsTruncated ? "，僅含區間內最新 3000 筆" : ""}）</h3>
      ${
        logs.length === 0
          ? `<div class="empty-state-box">沒有符合篩選條件的紀錄。</div>`
          : tableHtml(
              ["時間", "學生", "班別", "動作", "講義", "細節", "數量"],
              shown
                .map(l =>
                  `<tr>${td(escapeHtml(formatTaiwanDateTime(l.timestamp)), "white-space: nowrap;")}${td(escapeHtml(l.name ? `${l.name}（${l.username}）` : l.username))}${td(escapeHtml(l.cohort || "—"))}${td(escapeHtml(LOG_ACTION_LABELS[l.action] || l.action), l.action === "LOGIN_FAIL" || l.action === "RATE_LIMIT" ? "color: #b91c1c;" : "")}${td(escapeHtml(l.main || "—"))}${td(escapeHtml(l.detail || ""))}${td(l.count || "")}</tr>`
                )
                .join("")
            ) +
            (logs.length > shown.length
              ? `<div style="margin-top: 12px;"><button type="button" class="btn-outline" onclick="showMoreAdminLogs()">顯示更多（尚有 ${logs.length - shown.length} 筆）</button></div>`
              : "")
      }
    `;
  }
}

function showMoreAdminLogs() {
  adminLogShowCount += 300;
  renderAdminLog();
}

function handleTopWrongCohortChange() {
  const el = document.getElementById("log-topwrong-cohort");
  adminTopWrongCohort = el ? el.value : "__ALL__";
  renderTopWrong();
}

function renderTopWrong() {
  const el = document.getElementById("admin-log-topwrong");
  if (!el || !adminLogData) return;
  const groups = adminLogData.topWrong || {};
  const options = [{ value: "__ALL__", label: "全部學生" }, ...adminLogData.cohorts.map(c => ({ value: c, label: c }))];
  if (!options.some(o => o.value === adminTopWrongCohort)) adminTopWrongCohort = "__ALL__";
  const items = groups[adminTopWrongCohort] || [];
  el.innerHTML = `
    <div class="taxonomy-header">
      <h3 class="section-title">📉 錯題排行榜（前 ${10} 名）</h3>
      <select id="log-topwrong-cohort" class="form-select" onchange="handleTopWrongCohortChange()" style="max-width: 220px;">
        ${options.map(o => `<option value="${escapeHtml(o.value)}" ${o.value === adminTopWrongCohort ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
      </select>
    </div>
    ${
      items.length === 0
        ? `<div class="empty-state-box">此區間沒有答錯的紀錄。</div>`
        : tableHtml(
            ["名次", "題目", "講義・子分類", "作答", "答錯", "錯誤率", ""],
            items
              .map((q, i) =>
                `<tr>${td(i + 1)}${td(`${escapeHtml(q.prompt)}<div style="color: #15803d; margin-top: 4px;">✓ ${escapeHtml(q.correctAnswer)}</div>`)}${td(escapeHtml(`${q.main}・${q.sub}`))}${td(q.attempts)}${td(q.wrong)}${td(`${q.wrongRate}%`)}${td(q.concept_id ? `<button type="button" class="btn-chip" onclick="openConceptModal('${escapeJsStr(q.concept_id)}', '${escapeJsStr(q.sub)}')">觀念</button>` : "")}</tr>`
              )
              .join("")
          )
    }
  `;
  triggerKaTeXRender(el);
}

async function showStudentDetail(username) {
  const el = document.getElementById("admin-log-student-detail");
  if (!el) return;
  el.classList.remove("hidden");
  el.innerHTML = loadingBoxHtml("正在讀取學生的作答明細...");
  const student = (adminLogData && adminLogData.students.find(s => s.username === username)) || { name: username, cohort: "" };
  try {
    const res = await callGasApi("getStudentDetail", { username, from: adminLogQuery.from, to: adminLogQuery.to });
    if (!res || !res.success) throw new Error((res && res.message) || "無法取得學生明細");
    const sessionsHtml = res.sessions.length === 0
      ? `<div class="empty-state-box">此區間沒有測驗紀錄。</div>`
      : tableHtml(
          ["時間", "測驗名稱", "成績", "答錯題數"],
          res.sessions
            .map(s => `<tr>${td(escapeHtml(formatTaiwanDateTime(s.timestamp)), "white-space: nowrap;")}${td(escapeHtml(s.unit_title))}${td(escapeHtml(s.score))}${td(s.wrongCount)}</tr>`)
            .join("")
        );
    const lectureHtml = res.perLecture.length === 0
      ? ""
      : `<h4 style="margin: 16px 0 8px;">各講義答對率（此區間）</h4>` +
        tableHtml(
          ["講義", "作答題數", "答對", "答對率"],
          res.perLecture
            .sort((a, b) => a.accuracy - b.accuracy)
            .map(m => `<tr>${td(escapeHtml(m.main))}${td(m.attempts)}${td(m.correct)}${td(`${m.accuracy}%`)}</tr>`)
            .join("")
        );
    const mistakesHtml = res.mistakes.length === 0
      ? `<div class="empty-state-box">目前沒有未訂正的錯題。</div>`
      : tableHtml(
          ["題目", "講義・子分類"],
          res.mistakes
            .map(m => `<tr>${td(`${escapeHtml(m.prompt)}<div style="color: #15803d; margin-top: 4px;">✓ ${escapeHtml(m.correctAnswer)}</div>`)}${td(escapeHtml(`${m.main}・${m.sub}`))}</tr>`)
            .join("")
        );
    el.innerHTML = `
      <div class="taxonomy-header">
        <h3 class="section-title">🔍 ${escapeHtml(student.name)}（${escapeHtml(username)}）・${escapeHtml(student.cohort || "未分班")}</h3>
        <button type="button" class="btn-outline" onclick="document.getElementById('admin-log-student-detail').classList.add('hidden')">關閉</button>
      </div>
      <h4 style="margin: 8px 0;">測驗紀錄（${escapeHtml(adminLogQuery.label)}）</h4>
      ${sessionsHtml}
      ${lectureHtml}
      <h4 style="margin: 16px 0 8px;">目前未訂正的錯題（${res.mistakes.length} 題）</h4>
      ${mistakesHtml}
    `;
    triggerKaTeXRender(el);
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="empty-state-box">❌ 讀取失敗：${escapeHtml(err.message || "請稍後再試")}</div>`;
  }
}

/* ============================================================================
 * [MODULE 9.5] 頂部橫幅：登入前只顯示網站名稱並置中；登入後依班別顯示說明文字
 * ============================================================================ */
function applyTopBanner(text, isAdmin) {
  const badge = document.getElementById("cohort-banner-badge");
  const inner = document.getElementById("banner-inner");
  const content = isAdmin ? "👑 管理者模式" : String(text || "").trim();
  if (badge) {
    badge.textContent = content;
    badge.classList.toggle("hidden", !content);
  }
  if (inner) {
    inner.style.justifyContent = content ? "" : "center";
  }
}

/* ============================================================================
 * [MODULE 10.0] 學生註冊（登入畫面）
 * ============================================================================ */
function showRegisterForm() {
  document.getElementById("login-form-box").classList.add("hidden");
  document.getElementById("register-form-box").classList.remove("hidden");
}

function showLoginForm() {
  document.getElementById("register-form-box").classList.add("hidden");
  document.getElementById("login-form-box").classList.remove("hidden");
}

async function handleRegister() {
  const val = id => ((document.getElementById(id) || {}).value || "").trim();
  const code = val("reg-code");
  const name = val("reg-name");
  const username = val("reg-username");
  const username2 = val("reg-username2");
  const statusEl = document.getElementById("register-status");
  const btn = document.getElementById("register-btn");
  const show = (text, cls) => {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.className = `login-status ${cls}`;
    }
  };

  if (!code || !name || !username) return show("⚠️ 請填寫註冊碼、姓名與想使用的帳號！", "error");
  if (username !== username2) return show("⚠️ 兩次輸入的帳號不一致，請再確認。", "error");
  if (!/^[A-Za-z0-9_]{4,20}$/.test(username)) return show("⚠️ 帳號須為 4 到 20 個英文字母、數字或底線（_）。", "error");

  try {
    if (btn) btn.disabled = true;
    show("🔄 正在送出註冊...", "loading");
    const res = await callGasApi("register", { code, name, username });
    if (!res || !res.success) return show(`❌ ${(res && res.message) || "註冊失敗，請稍後再試"}`, "error");
    ["reg-code", "reg-name", "reg-username", "reg-username2"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    show(`✅ ${res.message || "註冊完成！"}`, "success");
  } catch (err) {
    console.error(err);
    show(`❌ 網路或雲端連線異常：${err.message || "請稍後再試"}`, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ============================================================================
 * [MODULE 11.0] 管理者「👤 帳號管理」頁面
 * 頁面上不顯示任何密碼；需要密碼時一律傳送到 Discord
 * ============================================================================ */
let accountsData = null;
let accountsInitialized = false;

function initAccountsView() {
  if (!accountsInitialized) {
    accountsInitialized = true;
    loadAccounts();
  }
}

async function loadAccounts() {
  const container = document.getElementById("accounts-table");
  if (container) container.innerHTML = loadingBoxHtml("正在讀取名單與帳號...");
  try {
    const res = await callGasApi("adminListAccounts", {});
    if (!res || !res.success) throw new Error((res && res.message) || "無法讀取帳號資料");
    accountsData = res;
    const cohorts = Array.from(new Set(res.accounts.map(a => a.cohort || "未分班"))).sort();
    setSelectOptions("accounts-filter-cohort", [
      { value: "ALL", label: "全部班別" },
      ...cohorts.map(c => ({ value: c, label: c }))
    ]);
    renderAccounts();
  } catch (err) {
    console.error(err);
    if (container) container.innerHTML = `<div class="empty-state-box">❌ 讀取失敗：${escapeHtml(err.message || "請稍後再試")}</div>`;
  }
}

function accountButtons(a) {
  const u = escapeJsStr(a.username);
  const n = escapeJsStr(a.name);
  const c = escapeJsStr(a.cohort || "");
  const btn = (type, label) =>
    `<button type="button" class="btn-chip" style="margin: 2px;" onclick="accountAction('${type}', '${u}', '${n}', '${c}')">${label}</button>`;
  if (a.status === "未註冊") return btn("register", "代為註冊");
  if (a.status === "管理者") return "—";
  return [
    btn("reset", "重設密碼"),
    btn("resend", "傳送密碼"),
    a.status === "停用" ? btn("enable", "啟用") : btn("disable", "停用"),
    btn("cohort", "改班別"),
    btn("rename", "改帳號")
  ].join("");
}

function renderAccounts() {
  if (!accountsData) return;
  const discordEl = document.getElementById("accounts-discord-status");
  if (discordEl) {
    discordEl.textContent = accountsData.discordReady ? "🟢 Discord 已設定" : "🔴 Discord 尚未設定（密碼無法傳送）";
  }

  const cohortsEl = document.getElementById("accounts-cohorts");
  if (cohortsEl) {
    cohortsEl.innerHTML =
      accountsData.cohorts.length === 0
        ? `<div class="empty-state-box">尚未建立 Cohorts 工作表（班別、註冊碼、是否開放註冊）。</div>`
        : tableHtml(
            ["班別", "註冊碼", "開放註冊"],
            accountsData.cohorts
              .map(c => `<tr>${td(escapeHtml(c.cohort))}${td(escapeHtml(c.code || "（未設定）"))}${td(c.open ? "✅ 開放" : "⛔ 關閉")}</tr>`)
              .join("")
          );
  }

  const cohort = (document.getElementById("accounts-filter-cohort") || {}).value || "ALL";
  const status = (document.getElementById("accounts-filter-status") || {}).value || "ALL";
  const keyword = ((document.getElementById("accounts-search") || {}).value || "").trim().toLowerCase();
  const list = accountsData.accounts.filter(a => {
    if (cohort !== "ALL" && (a.cohort || "未分班") !== cohort) return false;
    if (status !== "ALL" && a.status !== status) return false;
    if (keyword && !`${a.name} ${a.username}`.toLowerCase().includes(keyword)) return false;
    return true;
  });

  const counts = accountsData.accounts.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {});
  const summaryEl = document.getElementById("accounts-summary");
  if (summaryEl) {
    summaryEl.textContent = `使用中 ${counts["使用中"] || 0}・未註冊 ${counts["未註冊"] || 0}・停用 ${counts["停用"] || 0}`;
  }

  const container = document.getElementById("accounts-table");
  if (!container) return;
  container.innerHTML =
    list.length === 0
      ? `<div class="empty-state-box">沒有符合條件的學生。</div>`
      : tableHtml(
          ["姓名", "班別", "帳號", "狀態", "註冊時間", "操作"],
          list
            .map(a => {
              const statusStyle = a.status === "停用" ? "color: #b91c1c;" : a.status === "未註冊" ? "color: #64748b;" : "";
              return `<tr>${td(escapeHtml(a.name) + (a.inRoster ? "" : ' <span style="color:#64748b;">（不在名單）</span>'))}${td(escapeHtml(a.cohort || "未分班"))}${td(escapeHtml(a.username || "—"))}${td(escapeHtml(a.status), statusStyle)}${td(a.registered_at ? escapeHtml(formatTaiwanDateTime(a.registered_at)) : "—", "white-space: nowrap;")}${td(accountButtons(a))}</tr>`;
            })
            .join("")
        );
}

async function accountAction(type, username, name, cohort) {
  let action = "";
  let payload = { username };
  if (type === "register") {
    const u = prompt(`為「${name}」設定帳號（4 到 20 個英文字母、數字或底線）：`);
    if (!u) return;
    action = "adminRegister";
    payload = { name, cohort, username: u.trim() };
  } else if (type === "reset") {
    if (!confirm(`確定要重設 ${name}（${username}）的密碼嗎？\n新密碼會傳到 Discord，舊密碼立即失效。`)) return;
    action = "adminResetPassword";
  } else if (type === "resend") {
    if (!confirm(`要把 ${name}（${username}）目前的密碼傳到 Discord 嗎？`)) return;
    action = "adminResendPassword";
  } else if (type === "disable" || type === "enable") {
    const disabled = type === "disable";
    if (!confirm(`確定要${disabled ? "停用" : "啟用"} ${name}（${username}）的帳號嗎？${disabled ? "\n已登入的裝置也會立即登出。" : ""}`)) return;
    action = "adminSetStatus";
    payload = { username, disabled };
  } else if (type === "cohort") {
    const c = prompt(`輸入 ${name} 的新班別（需與 Access 表的班別名稱一致）：`, cohort);
    if (!c || c.trim() === cohort) return;
    action = "adminSetCohort";
    payload = { username, cohort: c.trim() };
  } else if (type === "rename") {
    const n = prompt(`輸入 ${name} 的新帳號（4 到 20 個英文字母、數字或底線）：`, username);
    if (!n || n.trim() === username) return;
    action = "adminRenameUsername";
    payload = { username, newUsername: n.trim() };
  } else {
    return;
  }

  try {
    const res = await callGasApi(action, payload);
    if (!res || !res.success) {
      alert(`❌ ${(res && res.message) || "操作失敗"}`);
      return;
    }
    let msg = res.message || "✅ 已完成";
    if (res.delivered === true) msg = "✅ 已完成，密碼已傳到 Discord。";
    if (res.delivered === false) msg = "⚠️ 已完成，但 Discord 傳送失敗。請確認 Discord 設定後，按「傳送密碼」重送。";
    alert(msg);
  } catch (err) {
    console.error(err);
    alert(`❌ 網路或雲端連線異常：${err.message || "請稍後再試"}`);
  }
  loadAccounts();
}

/* ============================================================================
 * 輔助工具函式 (Utilities)
 * ============================================================================ */

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJsStr(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ");
}

function formatTaiwanDateTime(isoStr) {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return String(isoStr || "");
    return d.toLocaleString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
  } catch (e) {
    return String(isoStr || "");
  }
}
