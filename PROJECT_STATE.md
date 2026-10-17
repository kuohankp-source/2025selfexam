# 郭志雄物理 - 物理概念與公式自測系統 (`PROJECT_STATE.md`)

> **專案長期記憶庫與架構基準線**  
> **班別對象**：🎓 2025年入學 科學班／數理資優班專屬  
> **維護承諾**：📌 此網頁將至少維護至 **2029 年 8 月**（陪伴至高三分科測驗結束）

---

## 1. 專案檔案結構清單 (File Manifest)

| 檔案名稱 | 角色與職責說明 |
| :--- | :--- |
| `index.html` | 純淨語意化 HTML5 骨架與視圖容器（載入 KaTeX v0.16.8 CDN、`style.css`、`app.js`） |
| `style.css` | 完整響應式樣式表（嚴格落實清爽白底、皇家藍漸層橫幅、暖黃色肯定句推導框與字級規範） |
| `app.js` | 前端核心商業邏輯（嚴格採用 `[MODULE 1.0]` 至 `[MODULE 7.0]` 階層式工程樹狀編號，100% 雲端驅動） |
| `Code.gs` | 後端 Google Apps Script 程式碼備份檔（支援 `GET ?payload=` 與 `POST` 雙通道抗 CORS 路由） |
| `PROJECT_STATE.md` | 系統架構樹編號、Google Sheets 資料表結構、DOM ID 對照表與維護基準線 |

---

## 2. 系統工程架構樹編號 (`app.js` Architecture Tree)

- **`[MODULE 1.0]` 全域環境配置與狀態容器 (Global Configurations & State)**
  - `[1.1]` API 端點常數 `GAS_ENDPOINT_URL`
  - `[1.2]` 全域資料容器：`currentUser`, `conceptBank`, `questionBank`, `quizHistory`, `unresolvedMistakeMap`
  - `[1.3]` 測驗執行狀態容器：`quizQuestions`, `currentQuizIndex`, `quizTimer`, `questionStartTime`, `timeLeft`, `quizAnswersRecord`, `isAnswered`, `currentQuizMode`
- **`[MODULE 2.0]` 通訊協定與雲端同步引擎 (Communication & Cloud Sync Engine)**
  - `[2.1]` `callGasApi(action, dataObj)`：純 GET URL-Encoded 通訊包裝器（徹底杜絕跨網域 POST 觸發 Google Apps Script HTTP 302 重導向所導致的 CORS 阻斷與無效的請求問題）
  - `[2.1.3]` `hydrateSnapshot(snap)`：快照資料水合器（相容輕量化 compactSnapshots，自動關聯本地題庫補齊題幹 prompt 與解析 explanation）
  - `[2.2]` `handleLogin()` 與 `handleLoginKeydown(e)`：支援 `Enter` 鍵登入與兩階段載入（`login` ➔ `getInitialData`）
  - `[2.3]` `handleLogout()`：清空記憶體狀態並切回 `#login-view`
  - `[2.4]` 反虛假同步原則：`finishQuiz()` 嚴格檢查雲端寫入回傳狀態，僅在確認成功寫入 Google 試算表 `QuizHistory` 時才將資料推入 `quizHistory`，失敗時給予明確報警與阻斷，杜絕本地假同步與登出歸零瑕疵
- **`[MODULE 3.0]` 核心導航與視圖切換中樞 (Navigation & View Orchestrator)**
  - `[3.1]` 頂部永久品牌橫幅（`#global-top-banner`，登入前後常駐）
  - `[3.2]` `switchTab(tabKey)`：管理 6 大主要功能視圖與 1 個測驗作答進行中視圖
  - `[3.3]` `openConceptModal(conceptId, fallbackSubCategory)`：跨視圖「🔗 對照核心觀念」居中模態彈窗
- **`[MODULE 4.0]` 講義三層樹狀分類引擎 (Hierarchical Taxonomy Engine)**
  - 第一層（主分類下拉選單 `#study-main-select` / `#quiz-main-select`）：萃取 `main_category`
  - 第二層（核取方塊清單 `#study-sub-grid` / `#quiz-sub-grid`）：嚴格只萃取 `sub_category`，提供「全選子分類」與「全部取消」
  - 第三層（具體內容）：渲染對應 `title` 觀念推導卡或抽取對應測驗題目
- **`[MODULE 5.0]` 肯定句觀念推導卡片渲染引擎 (Study Cards & Formula Engine)**
  - `[5.1]` `renderStudyCards()` & `buildConceptCardHtml()`：渲染觀念卡片並自動隱藏空白或 `"text"` 佔位欄位
  - `[5.2]` `triggerKaTeXRender(element)`：封裝 `window.renderMathInElement` 支援 `$$...$$` 與 `$...$` 公式渲染
- **`[MODULE 6.0]` 隨機抽題、4選1動態組裝與倒數測驗引擎 (Timed Quiz Engine)**
  - `[6.1]` `initiateStandardQuiz()`：支援 5 題 / 10 題切換與隨機洗牌抽題
  - `[6.2]` `loadQuizQuestion()`：1 正解 + 最多 3 干擾項動態組裝洗牌為 (A)(B)(C)(D)，啟動 20 秒倒數與 `performance.now()` 耗時紀錄
  - `[6.3]` `handleAnswer(pickedIndex)`：鎖定選項、標示紅綠底色、展開解析與「🔗 對照核心觀念」按鈕、記錄作答快照
  - `[6.4]` `finishQuiz()`：計算成績、呼叫 `submitQuiz` 寫入雲端並立即觸發 `recalculateUnresolvedMistakes()`
- **`[MODULE 7.0]` 錯題動態消除、歷史快照區間篩選與錯題特訓引擎 (Mistake & History Engine)**
  - `[7.1]` `recalculateUnresolvedMistakes()`：純雲端歷史驅動（依時間由舊到新掃描，答錯入池、後續答對即動態消除）
  - `[7.2]` `renderMistakeReviewCards()`：渲染待消滅錯題卡片與「🔗 對照核心觀念」按鈕
  - `[7.3]` `initRetryQuizUI()` & `initiateRetryQuiz()`：從未消滅錯題池抽題進行「🔥 錯題特訓消滅戰」
  - `[7.4]` `renderHistoryCards(filterRange)`：提供「近 6 個月內」、「半年前 ～ 一年前」、「一年以前」、「全部歷史紀錄」4 段篩選與手風琴明細展開
- **`[MODULE 8.0]` 管理者專屬題庫檢視與單元選取面板 (Admin Question Bank Manager)**
  - `[8.1]` `initAdminTaxonomyFilters()`：初始化講義主分類與子分類選單
  - `[8.2]` `handleAdminMainCategoryChange()`：連動切換子分類與重繪
  - `[8.3]` `renderAdminQuestionList()`：直接完整檢視單元底下的所有題目、選項、正解與詳解，不需隨機抽選，支援即時切換回實測模式

---

## 3. 雲端資料庫結構 (Google Sheets Database Schema)

### 3.1 `Users` 工作表 (5 欄)
| 欄位順序 | 欄位名稱 | 說明與範例 |
| :---: | :--- | :--- |
| 1 (A) | `username` | 學生/教師登入帳號（如：`KUO`） |
| 2 (B) | `password` | 登入密碼（如：`3333`） |
| 3 (C) | `name` | 顯示姓名（如：`郭老師`） |
| 4 (D) | `role` / 備註 | 備註或角色名稱 |
| 5 (E) | `isAdmin` | **管理者權限核取方塊（TRUE / FALSE）**，勾選者登入後直接進入題庫檢視面板 |

### 3.2 `Concepts` 工作表 (8 欄)
| 欄位順序 | 欄位名稱 | 說明與範例 |
| :---: | :--- | :--- |
| 1 (A) | `concept_id` | 觀念唯一識別碼（如：`c_kin_01_01`） |
| 2 (B) | `main_category` | 第一層講義主分類（如：`運動學講義`） |
| 3 (C) | `sub_category` | 第二層觀念子分類（如：`觀念一：位置、位移、路程`） |
| 4 (D) | `title` | 第三層具體定理或推導標題（如：`位置向量的幾何與代數定義`） |
| 5 (E) | `content_type` | 內容型態標記（預設為 `"text"`，前端嚴禁將其當作標題顯示） |
| 6 (F) | `definition` | 暖黃色推導框核心肯定句推導與公式（支援 LaTeX） |
| 7 (G) | `premise` | 觀念要點補充說明 |
| 8 (H) | `explanation` | 核心對照與易錯比較 |

### 3.3 `QuestionBank` 工作表 (11 欄)
| 欄位順序 | 欄位名稱 | 說明與範例 |
| :---: | :--- | :--- |
| 1 (A) | `id` | 題目唯一識別碼（如：`q_kin_01_01_a`） |
| 2 (B) | `is_active` | 是否啟用（`TRUE` / `FALSE`） |
| 3 (C) | `concept_id` | 關聯之核心觀念 ID（對應 `Concepts.concept_id`） |
| 4 (D) | `main_category` | 第一層講義主分類（如：`運動學講義`） |
| 5 (E) | `sub_category` | 第二層觀念子分類（如：`觀念一：位置、位移、路程`） |
| 6 (F) | `question` | 題目題幹（支援 LaTeX） |
| 7 (G) | `correct_type` | 正解型態（`"text"`） |
| 8 (H) | `correctAnswer` | 正確選項文字 |
| 9 (I) | `distractor_type` | 干擾項型態（`"text"`） |
| 10 (J) | `distractors` | 以 `\|` 分隔之最多 6 個干擾選項字串 |
| 11 (K) | `explanation` | 題目詳解與核心觀念解析 |

### 3.4 `QuizHistory` 工作表 (8 欄)
| 欄位順序 | 欄位名稱 | 說明與範例 |
| :---: | :--- | :--- |
| 1 (A) | `session_id` | 測驗場次唯一識別碼 |
| 2 (B) | `username` | 作答學生帳號 |
| 3 (C) | `unit_title` | 測驗單元名稱或 `"🔥 錯題特訓消滅戰"` |
| 4 (D) | `score` | 得分字串（如：`"4 / 5"`） |
| 5 (E) | `correct_count` | 答對題數（數值） |
| 6 (F) | `total_count` | 總題數（數值） |
| 7 (G) | `snapshots_json` | 每題作答完整快照 JSON 字串 |
| 8 (H) | `timestamp` | ISO 8601 測驗完成時間戳記 |

---

## 4. DOM ID 與核心視覺元件對照表 (DOM Registry)

| 區塊分類 | DOM ID / Selector | 用途說明 |
| :--- | :--- | :--- |
| **頂部品牌橫幅** | `#global-top-banner` | 登入前後常駐之深邃皇家藍漸層橫幅 |
| **登入視圖** | `#login-view`, `#login-username`, `#login-password`, `#login-btn`, `#login-status` | 帳號密碼驗證與兩階段雲端資料載入狀態顯示 |
| **主應用與狀態列** | `#main-app`, `#user-display-name`, `#sync-status-badge`, `#logout-btn` | 顯示學生姓名、雲端同步觀念數/題數與登出控制 |
| **導航分頁按鈕** | `#tab-btn-guide`, `#tab-btn-study`, `#tab-btn-review`, `#tab-btn-quiz`, `#tab-btn-history`, `#tab-btn-retry` | 6 大主要功能視圖切換與待消滅錯題數徽章 (`#badge-review-count`, `#badge-retry-count`) |
| **觀念複習視圖** | `#view-study`, `#study-main-select`, `#study-sub-grid`, `#study-cards-container` | 三層樹狀分類過濾與 `.concept-card` 肯定句推導卡渲染 |
| **錯題整理視圖** | `#view-review`, `#review-cards-container` | 待消滅錯題卡片列表與核心觀念對照觸發 |
| **快速測驗設定** | `#view-quiz`, `#quiz-main-select`, `#quiz-sub-grid`, `#start-quiz-btn` | 測驗分類篩選、5題/10題單選切換與測驗啟動 |
| **測驗作答視圖** | `#view-active-quiz`, `#timer-text`, `#timer-bar`, `#quiz-prompt`, `#quiz-options-container`, `#quiz-feedback-panel`, `#quiz-result-panel` | 20 秒倒數、`.quiz-opt-btn` 4選1動態按鈕、即時詳解回饋與結算面板 |
| **歷史快照視圖** | `#view-history`, `#hist-filter-6m`, `#hist-filter-6m-1y`, `#hist-filter-1y+`, `#hist-filter-all`, `#history-cards-container` | 4 段時間區間篩選與手風琴作答快照展開 |
| **錯題特訓視圖** | `#view-retry`, `#retry-mistake-count`, `#start-retry-btn` | 顯示待消滅錯題總數並啟動錯題特訓消滅戰 |
| **核心觀念彈窗** | `#concept-modal-backdrop`, `#concept-modal`, `#concept-modal-body`, `#concept-modal-close` | 跨視圖顯示 `concept_id` 對應之完整觀念推導卡 |

---

## 5. 視覺與排版硬性基準線 (Typography & Color Baseline)

- **色系基調**：背景 `#f8fafc`、卡片 `#ffffff`、主調寶藍 `#2563eb`、肯定句推導框 `#fffbeb` 底 / `#fde68a` 邊框 / `#92400e` 字體。
- **頂部永久品牌橫幅**：`linear-gradient(135deg, #1e3a8a, #2563eb)`，主標題 `24px` 粗體，班別與 2029 年 8 月維護承諾徽章 `13.5px`。
- **觀念複習卡片 (`.concept-card`)**：分類徽章 `14px` 粗體（`#2563eb` 字 / `#eff6ff` 底）、條目大標題 `22px` 粗體 `#0f172a`、黃色肯定句推導框 `17px`（行高 `1.85`、內距 `20px 24px`、圓角 `14px`）、觀念要點 `15.5px`（行高 `1.75`、`#f8fafc` 底）、核心對照 `15px`（行高 `1.75`、`#475569` 字）。
- **測驗與選項排版**：題幹 `#quiz-prompt` `18.5px` 粗體（行高 `1.6`）、選項按鈕 `.quiz-opt-btn` `16px`（內距 `14px 18px`、圓角 `10px`、邊框 `1.5px solid #cbd5e1`）、答對綠底 `#dcfce7`、答錯紅底 `#fee2e2`。

---

## 6. 通訊架構與版本演進歷程 (Architecture Evolution & Changelog)

### 📌 [v2.3] 終極修復：回歸「輕量化 Payload」純 GET 通訊協定與快照水合引擎 (2026/10)
- **根本病因診斷**：
  Google Apps Script (GAS) 面對跨網域（GitHub Pages / 本地端）發送的 `POST` 請求時，固定執行 HTTP 302 重新導向至 `script.googleusercontent.com`。此行為在瀏覽器標準 CORS 限制下會引發阻斷並回傳「400 Bad Request / 無效的請求」，導致後端無法正常接收。
- **終極架構決策**：
  1. **通訊包裝器全面純 GET 化 (`callGasApi`)**：移除所有 POST 請求與預檢重試，統一透過 `GET ?payload=URL-Encoded-JSON` 通訊，100% 規避 302 重導向與跨網域阻斷。
  2. **交卷快照極致壓縮 (`compactSnapshots`)**：
     在 `finishQuiz` 交卷時，不再重複序列化題幹與詳解等大段文字，僅抽取 `{ qId, concept_id, sub, pick, correct, ok, t }` 極簡結構。5 題測驗僅約 350~600 字元，完整 URL-Encoded 網址遠低於 2048 字元上限，安全裕度高達 60% 以上。
  3. **前端自動資料水合機制 (`hydrateSnapshot`)**：
     當前端讀取雲端歷史快照時，自動從已載入之 `questionBank` 補齊題目題幹 `prompt` 與核心詳解 `explanation`，確保「歷史快照展開」、「錯題整理」與「錯題特訓」介面內容依然完整豐富。
  4. **嚴格防虛假同步驗證**：
     `finishQuiz` 嚴格校驗雲端成功回傳（`res && res.success && res.session`），寫入失敗時即時彈窗報警並在介面上顯示紅色警告標籤，絕不在本地偽造暫存紀錄，徹底根除「登出重登後錯題特訓歸零」的歷史缺陷。

