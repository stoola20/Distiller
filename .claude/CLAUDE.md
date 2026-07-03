# CLAUDE.md — Distiller

## 專案簡介

Distiller 是個人社群知識收集系統。從 IG、FB、YouTube 收集內容，經 Claude API 處理（OCR、翻譯、摘要、自動標籤），透過 iOS App、電子報、Notion 三個出口呈現。

完整規格見 `distiller-project-spec.md`。

## 關鍵文件（實作前必讀，與 spec 衝突時以這些為準）

- `docs/design/pipeline-decisions.md` — 標籤 taxonomy（封閉清單）、去重、電子報邏輯、模型選擇的定案與取捨
- `docs/design/llm-prompts.md` — 五個 LLM prompt 的設計版全文＋評估與迭代規則
- `docs/plans/sprint-implementation-plan.md` — Sprint 1–4 里程碑計畫（含 TCA 從 RxSwift 橋接的教學段），照里程碑順序執行、逐項驗收

## 技術棧

- **iOS App**：SwiftUI + TCA (The Composable Architecture)，最低支援 iOS 17
- **後端**：Cloudflare Workers (TypeScript)
- **資料庫**：Supabase (PostgreSQL)
- **LLM**：Claude API (Anthropic)
- **寄信**：Resend
- **YouTube 監控**：YouTube Data API v3
- **IG/FB 自動巡邏**：OpenClaw agent（Mac Mini，Sprint 4）
- **筆記同步**：Notion API

## 專案結構

```
distiller/
├── CLAUDE.md
├── distiller-project-spec.md
├── cloudflare/                    # Cloudflare Workers
│   ├── wrangler.toml
│   ├── package.json
│   └── src/
│       ├── index.ts            # Router + endpoints
│       ├── handlers/
│       │   ├── items.ts        # CRUD for items
│       │   └── process.ts      # 內容處理引擎
│       ├── services/
│       │   ├── claude.ts       # Claude API 呼叫
│       │   ├── youtube.ts      # YT 逐字稿擷取
│       │   ├── scraper.ts      # 網頁內容萃取
│       │   ├── newsletter.ts   # 電子報生成 + Resend
│       │   └── notion.ts       # Notion 同步
│       ├── utils/
│       │   ├── source-detect.ts # URL 來源類型判斷
│       │   └── supabase.ts     # Supabase client
│       └── types.ts
├── ios/                        # Xcode 專案
│   └── Distiller/
│       ├── Distiller.xcodeproj
│       ├── Distiller/          # 主 App target
│       │   ├── App/
│       │   ├── Features/
│       │   │   ├── Feed/       # TCA Feature: 動態時間軸
│       │   │   ├── Detail/     # TCA Feature: 內容詳細頁
│       │   │   ├── Explore/    # TCA Feature: 標籤探索
│       │   │   └── Settings/   # TCA Feature: 設定
│       │   ├── Models/
│       │   ├── Services/
│       │   │   └── APIClient.swift
│       │   └── SharedUI/       # 共用 UI 元件（卡片、標籤 chip 等）
│       └── DistillerShareExtension/  # Share Extension target
└── openclaw/                   # Sprint 4，Mac Mini 上的巡邏 skill
    ├── ig-patrol.md
    └── fb-patrol.md
```

## 開發階段

目前在 **Sprint 1 — 打通核心管道**。

Sprint 1 的目標：送一個 URL 或圖片進去 → 拿到結構化摘要，用 curl 能端對端測試。

## 編碼規範

### 通用
- 註解和 commit message 使用繁體中文
- 變數、函式、型別名稱使用英文
- 不要在程式碼中寫死 API key，一律用環境變數或 secrets

### TypeScript（Cloudflare Workers）
- 使用 TypeScript strict mode
- 用 `wrangler` CLI 開發和部署
- API 回傳格式統一：`{ success: boolean, data?: T, error?: string }`
- Supabase 連線使用 `@supabase/supabase-js`
- 環境變數透過 `wrangler secret` 管理：`SUPABASE_URL`、`SUPABASE_KEY`、`ANTHROPIC_API_KEY`

### Swift（iOS App）
- 使用 SwiftUI + TCA (The Composable Architecture)
- 遵循 TCA 的 Reducer / Action / State / Effect 架構
- 最低部署目標：iOS 17
- 使用 Swift Package Manager 管理依賴
- 主要依賴：`swift-composable-architecture`、`swift-dependencies`
- API Client 使用 TCA 的 DependencyClient pattern
- 網路層使用 async/await + URLSession
- Share Extension 與主 App 共用 App Group 來傳遞資料

## API Endpoints

```
POST   /api/items          接收 URL 或圖片，觸發處理
GET    /api/items           取得列表（支援 ?tag=、?source_type=、?is_read= 篩選）
GET    /api/items/:id       取得單一 item 詳情
PATCH  /api/items/:id       更新標籤、已讀狀態等
```

## Supabase Schema

核心表為 `items`，欄位見 `distiller-project-spec.md` 的資料庫 Schema 章節，
另加三個欄位（`category`、`canonical_url` 唯一索引、`extracted_text`），
定義與理由見 `docs/design/pipeline-decisions.md` 第 5 節。

## Claude API 使用方式

處理內容時呼叫 Claude API（模型 `claude-sonnet-5`，ID 放環境變數），一個 prompt 同時完成多個任務。
**Prompt 全文、輸出 JSON 格式（六欄位）、封閉標籤清單、邊界案例處理，一律以 `docs/design/llm-prompts.md` 為準，不要即興改寫。**
修改 prompt 前先讀該文件的「評估與迭代」一節。

## 測試

- 後端：用 curl / Postman 測試各 endpoint
- iOS：Xcode Preview + 模擬器測試，最終安裝到實機
- Share Extension：需在實機測試（模擬器不支援跨 App 分享）
