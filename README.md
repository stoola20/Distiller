# Distiller

個人社群知識收集系統：從 IG、FB、YouTube 收集內容，經 Claude API 處理（OCR、翻譯、摘要、自動標籤），透過 iOS App、電子報、Notion 三個出口呈現。

命名由來：蒸餾——大量社群貼文 → LLM 處理 → 濃縮成精煉的知識摘要。

## 文件地圖

| 文件 | 內容 |
|------|------|
| `distiller-project-spec.md` | 完整規格（架構、schema、畫面、Sprint 總覽） |
| `docs/design/pipeline-decisions.md` | 設計定案：標籤 taxonomy、去重、電子報邏輯、模型選擇（**與 spec 衝突時以此為準**） |
| `docs/design/llm-prompts.md` | LLM prompt 全文（P1–P4）＋評估與迭代規則 |
| `docs/plans/sprint-implementation-plan.md` | Sprint 1–4 里程碑實作計畫（含 TCA 從 RxSwift 橋接教學） |
| `.claude/CLAUDE.md` | 給 Claude Code session 的專案指引 |

## 目前進度（2026-07-03）

**Sprint 1 — 打通核心管道**（進行中）

- [x] M1.2 型別與 Supabase client 骨架（`src/types.ts`）
- [x] M1.3 URL 正規化與來源判斷（`src/utils/`，含測試）
- [x] M1.4 Taxonomy 封閉清單與 prompt 組裝（`src/prompts/`，含測試）
- [x] M1.5 Claude API service：防禦性解析、重試、標籤降級（`src/services/claude.ts`，含測試）
- [x] Migration SQL（`cloudflare/migrations/001_items.sql`）
- [x] 測試基礎：vitest 37 案全綠（`npm test`）、型別檢查（`npm run typecheck`）

## 待辦事項

**Sprint 1 剩餘**

- [ ] M1.1 開通帳號：Cloudflare Workers、Supabase、Anthropic Console；設 wrangler secrets（`SUPABASE_URL`、`SUPABASE_KEY`、`ANTHROPIC_API_KEY`）與 vars（`CLAUDE_MODEL=claude-sonnet-5`）；在 Supabase 執行 migration —— **需要 Jesse 操作**
- [ ] M1.2 補完 `src/utils/supabase.ts`（client 工廠）
- [ ] M1.6 三種內容處理器（圖片 base64 多模態／YouTube 逐字稿／網頁 Jina Reader）
- [ ] M1.7 API endpoints（POST 去重冪等、GET 篩選分頁、PATCH）＋ API key auth
- [ ] M1.8 部署正式環境、真實內容測 5–10 則、開始累積 `cloudflare/eval/cases/`

**之後的 Sprint**（細節見 `docs/plans/sprint-implementation-plan.md`）

- [ ] Sprint 2 — iOS App + Share Extension（SwiftUI + TCA，先讀 M2.0 橋接教學）
- [ ] Sprint 3 — 電子報（日報純程式／週報 LLM）+ YouTube 頻道自動監控
- [ ] Sprint 4 — OpenClaw IG/FB 自動巡邏（前置：Mac Mini）
- [ ] Sprint 5 — Notion 同步
- [ ] Prompt 迭代：評估集累積 10–20 案後照 `llm-prompts.md` 的迭代規則跑（觸發條件見實作計畫最後一節）

## 開發

```bash
cd cloudflare
npm install
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run dev        # wrangler dev
```
