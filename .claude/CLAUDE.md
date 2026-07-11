# CLAUDE.md — Distiller

## 專案簡介

Distiller 是個人社群知識收集系統。手動收集 Instagram、Facebook、Threads、YouTube、書籍等內容，經 LLM 處理（OCR、翻譯、摘要、自動標籤），呈現在 iOS App。

> **架構已於 2026-07-11 從 server-centric 翻轉為 phone-centric。** 原 spec 以「後端自動化為主」（Cloudflare Worker + Supabase + 電子報 + 自動監控）設計，但實際使用是「手動收集為主」，故改為 **App 直接呼叫 LLM API 處理 + SwiftData 本地儲存**。定案與完整取捨見 `docs/design/pipeline-decisions.md`。`cloudflare/` 目錄保留為 TS 移植參考，目前 **dormant，不再主動開發**。

完整規格見 `distiller-project-spec.md`。

## 關鍵文件（實作前必讀，與 spec 衝突時以這些為準）

- `docs/design/pipeline-decisions.md` — 標籤 taxonomy（封閉清單）、去重、模型/供應商選擇、**phone-centric 架構與收集方式**的定案與取捨
- `docs/design/llm-prompts.md` — 五個 LLM prompt（P1–P5）的設計版全文＋評估與迭代規則
- `docs/plans/sprint-implementation-plan.md` — iOS-first 里程碑計畫（含 TCA 從 RxSwift 橋接的教學段），照里程碑順序執行、逐項驗收

## 技術棧

- **iOS App**：SwiftUI + TCA (The Composable Architecture)，最低支援 iOS 17
- **儲存**：SwiftData + CloudKit（私有庫同步跨使用者裝置 + 自動備份）
- **LLM**：多供應商。App 內用 `URLSession` **直接呼叫 provider API**，透過 `ContentProcessor` 協定切換 Claude / OpenAI / Gemini /（未來）Apple Intelligence 端上模型
- **API key**：使用者自帶（BYO-key），存 Keychain，**不落任何 server**
- **內容抓取**：App 端抓取（YT 逐字稿、網頁正文用 Jina Reader、OG 標籤），登入牆的 IG/FB 走批次上傳圖檔或（未來）Mac agent
- **延後**（回歸時才引入 server）：電子報（Resend）、YouTube 監控、OpenClaw IG/FB 巡邏（Mac Mini）、Notion 同步

## 專案結構

```
distiller/
├── CLAUDE.md
├── distiller-project-spec.md
├── ios/                          # Xcode 專案（主要開發目標）
│   └── Distiller/
│       ├── Distiller.xcodeproj
│       ├── Distiller/            # 主 App target
│       │   ├── App/
│       │   ├── Features/         # TCA Features
│       │   │   ├── Feed/         #   動態時間軸
│       │   │   ├── Detail/       #   內容詳細頁
│       │   │   ├── Explore/      #   標籤探索
│       │   │   ├── Capture/      #   批次上傳圖檔 / 收件
│       │   │   └── Settings/     #   設定（含 BYO-key）
│       │   ├── Models/           # SwiftData @Model（Item）
│       │   ├── Processing/       # ContentProcessor 協定與各供應商實作
│       │   │   ├── ContentProcessor.swift
│       │   │   ├── ClaudeAPIProcessor.swift
│       │   │   ├── Prompts.swift        # P1–P5（真源仍是 llm-prompts.md）
│       │   │   ├── Taxonomy.swift       # 封閉清單
│       │   │   └── CanonicalURL.swift   # URL 正規化（去重用）
│       │   └── SharedUI/
│       └── DistillerShareExtension/     # Share Extension target（收 URL / 圖片）
├── cloudflare/                   # DORMANT — Swift 移植的參考，不再主動開發
└── openclaw/                     # 延後：Mac agent 抓 IG/FB（Sprint 4）
```

## 開發階段

目前在 **Sprint 1（iOS-first 重定義）— 打通核心管道**。

Sprint 1 的目標：在 App 用 `PhotosPicker` 批次上傳圖檔（書頁或圖文貼文截圖）→ `ClaudeAPIProcessor` 一次 multimodal 呼叫 → 六欄位結果存進 SwiftData → Feed 看到中文摘要。零外部依賴，模擬器/實機可端對端測。

## 編碼規範

### 通用
- 註解和 commit message 使用繁體中文
- 變數、函式、型別名稱使用英文
- 不要在程式碼中寫死 API key；使用者的 key 存 Keychain，dev 期自己的 key 也走 Keychain，不寫進程式碼或 commit

### Swift（iOS App，主要）
- 使用 SwiftUI + TCA (The Composable Architecture)，遵循 Reducer / Action / State / Effect
- 最低部署目標：iOS 17；用 Swift Package Manager 管理依賴
- 主要依賴：`swift-composable-architecture`、`swift-dependencies`
- `ContentProcessor` 用 TCA 的 **DependencyClient pattern**（struct of closures，`liveValue` 打真 API、`testValue`/`previewValue` 回假資料）
- 網路層用 async/await + URLSession，直接呼叫 provider API（native app 無 CORS 限制）
- **SwiftData + CloudKit 限制**：開同步時所有屬性要有預設值或 optional、關聯要 optional、**不能用 `@Attribute(.unique)`**。故去重改用「插入前先 fetch 查 `canonical_url`」的本地查詢
- Share Extension 與主 App 共用 App Group

### TypeScript（`cloudflare/`，dormant）
- 保留為 Swift 移植的參考藍本（prompts、taxonomy、parse/重試/降級、canonical-url、source-detect），**不再主動開發**

## 內容處理

App 內處理內容，一個 prompt 同時完成多任務（OCR + 翻譯 + 摘要 + 自動標籤）：

- 收集方式：① Share Extension 收 URL（YT/網頁/Threads/公開 FB → App 端抓內容）② 批次上傳圖檔（書籍、圖文截圖 → 一次 multimodal 呼叫）
- `ContentProcessor.process(_:)` 回傳結構化的六欄位 `ProcessedContent`
- **Prompt 全文（P1–P5）、輸出 JSON 格式（六欄位）、封閉標籤清單、邊界案例，一律以 `docs/design/llm-prompts.md` 為準，不要即興改寫。** 修改 prompt 前先讀該文件的「評估與迭代」一節
- 解析：剝除意外 code fence 後 `JSON.parse` → 欄位驗證 → taxonomy 不合就降級「其他」（弱模型防線）
- 儲存：SwiftData `Item` @Model；`canonical_url` 本地去重

## 測試

- 內容處理邏輯（parse/taxonomy/canonical-url）：Swift Testing 單元測試，對齊原 TS 的行為
- iOS：Xcode Preview + 模擬器；`ContentProcessor` 用 mock 實作測 Reducer
- Share Extension：需在實機測試（模擬器不支援跨 App 分享）
- 真實 LLM 輸出：累積進評估集（見 `llm-prompts.md`），不憑感覺改 prompt
