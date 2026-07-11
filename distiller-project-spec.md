# Distiller — 個人社群知識收集系統

## 專案概述

Distiller 是一套個人 iOS App，把手動收集的社群媒體與書籍內容（Instagram、Facebook、Threads、YouTube、書籍拍照），經 LLM 處理、翻譯、摘要，呈現成可瀏覽的知識庫。

命名由來：Distillery（蒸餾廠）— 蒸餾是把大量原料經過加熱、冷凝，濃縮成少量高純度的東西。對應到專案的流程：大量社群貼文 → LLM 處理 → 濃縮成精煉的知識摘要。也有威士忌蒸餾的浪漫感，暗示「時間會讓知識更有價值」。

> **架構定案（2026-07-11）**：本專案已從 server-centric 翻轉為 **phone-centric**。App 直接呼叫 LLM API 處理、SwiftData + CloudKit 本地儲存，不需後端。完整取捨見 `docs/design/pipeline-decisions.md` 第 0 節（凌駕本 spec）。

---

## 系統架構

```
收集層（手動優先）
├── 1. Share Extension（收 URL）
│     YT / 網頁 / Threads / 公開 FB → App 端抓內容（逐字稿 / Jina Reader / OG）
└── 2. 批次上傳圖檔（PhotosPicker 多選）
      書籍拍照 / IG 圖文貼文截圖 → 一次 multimodal 呼叫

處理層（App 內，無後端）
└── ContentProcessor 協定（TCA DependencyClient）
    ├── ClaudeAPIProcessor（現做）— URLSession 直接打 api.anthropic.com
    ├── OpenAI / Gemini（未來 BYO-key）
    └── Apple Intelligence（未來端上）
    ├── 圖片/書頁 → 多模態 OCR + 翻譯 + 摘要 + 標籤（P1/P5）
    ├── YouTube → 逐字稿 + 摘要 + 翻譯 + 標籤（P2）
    └── 一般網頁 → 正文萃取 + 摘要 + 標籤（P3）

儲存層
└── SwiftData + CloudKit（私有庫同步跨裝置 + 自動備份）

呈現層
└── iOS App（SwiftUI + TCA）：Feed 快速預覽 + 標籤瀏覽 + 詳細頁

延後（回歸時才引入 server）
└── 電子報、YouTube 自動監控、OpenClaw IG/FB 巡邏（Mac Mini）、Notion 同步
```

---

## 技術棧

| 元件 | 技術選擇 | 用途 |
|------|---------|------|
| iOS App | SwiftUI + TCA (The Composable Architecture) | 主要使用介面與處理邏輯 |
| 儲存 | SwiftData + CloudKit | 本地結構化儲存 + 跨裝置同步 + 備份 |
| LLM | 多供應商（預設 Claude API），App 內 URLSession 直接呼叫 | OCR、翻譯、摘要、自動標籤 |
| API key | 使用者自帶（BYO-key），存 Keychain | 不落任何 server |
| 內容抓取 | App 端（YT 逐字稿、Jina Reader 網頁正文、OG 標籤） | 把分享的 URL 變成內容 |
| （延後）電子報 | Resend | 日報 / 週報 |
| （延後）YouTube 監控 | YouTube Data API v3 | 自動抓指定頻道 |
| （延後）IG/FB 巡邏 | OpenClaw + Mac Mini | 登入身份抓登入牆內容，零截圖 |
| （延後）筆記同步 | Notion API | 每則同步為 Notion page |

---

## 資料模型（SwiftData `@Model`）

`Item`（CloudKit 私有庫同步）主要欄位：

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | UUID | 主鍵 |
| sourceType | String | ig / yt / fb / web / **threads** / **book** |
| sourceURL | String? | 原始連結（圖片上傳可為 nil） |
| canonicalURL | String? | 正規化後，本地去重用（**不設 unique**，CloudKit 限制） |
| sourceAuthor / sourceHandle | String? | 作者 / handle |
| bookTitle / bookAuthor | String? | 書籍（P5 抽出，可能為空） |
| extractedText | String? | OCR 原文 / 逐字稿 / 書頁文字留底 |
| processedSummary | String? | 一句話中文摘要 |
| processedDetail | String? | 完整翻譯 + 整理（markdown） |
| originalLanguage | String? | 原始語言 |
| category | String | 封閉清單分類，預設「其他」 |
| tags / autoTags | [String] | 標籤 / LLM 原始標籤留底 |
| status | String | processed / pending / processingFailed |
| isRead | Bool | 已讀 |
| createdAt / updatedAt | Date | 時間戳 |

> 欄位定義與理由見 `docs/design/pipeline-decisions.md` 第 5 節。原 Postgres schema 保留在 `cloudflare/migrations/001_items.sql`（dormant，僅供欄位對照）。

---

## iOS App 畫面結構

### Tab 1 — 動態（Feed）
- 卡片式時間軸：來源 icon、作者/書名、一句話摘要、標籤 chips、收集時間；未讀藍點
- 頂部篩選 chips（從封閉 taxonomy 的 8 個 category 來，不寫死第二份）
- 點擊卡片 → 詳細頁：完整翻譯 + 摘要，底部「開啟原文」

### Tab 2 — 探索
- category grid（各分類內容數量）→ 點入該分類列表
- 底部「近期收藏」快速列表

### Tab 3 — 設定
- **BYO-key**：選 LLM 供應商 + 填自己的 API key（存 Keychain）
- 版本資訊；電子報 / 監控帳號為延後功能，留空區塊

### 收集入口
- **Share Extension**：在任何 App 按分享 → Distiller → 收 URL（YT/網頁/Threads/公開 FB）或單張圖片 → 非同步處理
- **App 內批次上傳**：Capture 分頁用 PhotosPicker 一次多選圖檔（書頁、圖文截圖）→ 一次 multimodal 呼叫

---

## LLM Prompt 設計方向

一個 prompt 同時完成：文字辨識 → 翻譯 → 結構化摘要 → 自動標籤分類。五個 prompt：

- **P1 圖片貼文**（多模態）：如 Bryan Johnson 的黑底白字圖文
- **P2 YouTube**：逐字稿 → 重點摘要 + 翻譯 + 標籤
- **P3 一般網頁**：萃取正文 → 摘要（實際占比低）
- **P4 週報歸納**（延後，隨電子報回歸）
- **P5 書籍拍照**（多模態、多頁）：另抽 book_title / book_author

**全文、輸出六欄位 JSON、封閉標籤清單、邊界案例，一律以 `docs/design/llm-prompts.md` 為準。**

---

## 需開通的帳號 / 服務

| 服務 | 用途 | 現況 |
|------|------|------|
| Anthropic Console | Claude API（dev 用開發者自己的 key） | **現在需要** |
| Apple Developer | App、Share Extension、CloudKit、Push | **現在需要**（已有帳號） |
| iCloud | CloudKit 同步 | **現在需要** |
| Resend | 電子報 | 延後 |
| YouTube Data API v3 | 頻道監控 | 延後 |
| Notion API | 筆記同步 | 延後 |
| 新 IG/FB 帳號 + Mac Mini | OpenClaw 巡邏 | 延後（Sprint 3+） |

分發時改為每個使用者自填 key，開發者不需為使用者的用量付費。

---

## Sprint 開發計畫

詳見 `docs/plans/sprint-implementation-plan.md`（iOS-first）。摘要：

- **Sprint 0**：TCA 概念橋接（從 RxSwift 思維）
- **Sprint 1**：打通「批次上傳圖檔 → ClaudeAPIProcessor → SwiftData → Feed」，零外部依賴端對端可測
- **Sprint 2**：其餘收集路徑（Share Extension URL、YT/網頁/書籍）、Detail/Explore/Settings（含 BYO-key）、去重、實機日用
- **Sprint 3+**：多供應商、Apple Intelligence 端上、Mac agent（IG/FB 零截圖）、延後功能回歸（電子報/監控/Notion，此時引入 server）

---

## 資安注意事項

- 使用者的 API key 只存裝置 Keychain，**不經過任何 server**，不寫進程式碼或 commit
- （延後）OpenClaw 使用專用 IG/FB 帳號與 isolated profile，跑在與個人環境隔離的 Mac Mini
- SwiftData 資料在裝置與使用者的 CloudKit 私有庫，不對外
