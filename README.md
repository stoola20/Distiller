# Distiller

個人社群知識收集系統：手動收集 Instagram、Facebook、Threads、YouTube、書籍內容，經 LLM 處理（OCR、翻譯、摘要、自動標籤），呈現在 iOS App。

命名由來：蒸餾——大量社群貼文 → LLM 處理 → 濃縮成精煉的知識摘要。

> **架構於 2026-07-11 從 server-centric 翻轉為 phone-centric**：App 直接呼叫 LLM API 處理、SwiftData + CloudKit 本地儲存，不需後端。取捨見 `docs/design/pipeline-decisions.md` 第 0 節。

## 文件地圖

| 文件 | 內容 |
|------|------|
| `distiller-project-spec.md` | 完整規格（架構、資料模型、畫面、Sprint 總覽） |
| `docs/design/pipeline-decisions.md` | 設計定案：**架構（第 0 節）**、taxonomy、去重、供應商選擇（**與 spec 衝突時以此為準**） |
| `docs/design/llm-prompts.md` | LLM prompt 全文（P1–P5）＋評估與迭代規則 |
| `docs/plans/sprint-implementation-plan.md` | iOS-first 里程碑實作計畫（含 TCA 從 RxSwift 橋接教學） |
| `.claude/CLAUDE.md` | 給 Claude Code session 的專案指引 |

## 目前進度（2026-07-11）

**架構重審完成，轉入 iOS-first。** 原 Cloudflare/Supabase 後端方案改為 App 內處理 + SwiftData 儲存。

- `cloudflare/` 的 TS 核心（taxonomy、prompts、canonical-url、防禦性解析、37 測試）**保留為 Swift 移植的藍本**，標記 dormant，不再主動開發。
- iOS 專案尚未建立（`ios/` 目前為空）。

## 待辦事項

**Sprint 1（iOS-first，見 `docs/plans/sprint-implementation-plan.md`）**

- [ ] M1.1 Xcode 骨架（SwiftUI + TCA）＋ 開啟 CloudKit / App Group
- [ ] M1.2 SwiftData `Item` @Model（CloudKit 相容）
- [ ] M1.3 移植處理核心到 Swift（taxonomy / canonical-url / 解析），Swift Testing 重寫 37 案
- [ ] M1.4 `ContentProcessor` 協定 + `ClaudeAPIProcessor`（BYO-key，Keychain）
- [ ] M1.5 Capture feature（`PhotosPicker` 批次上傳 → 處理 → 存 SwiftData）
- [ ] M1.6 Feed feature（讀 SwiftData、category 篩選）
- [ ] M1.7 評估集起點（`eval/cases/`，含書籍拍照）

**之後的 Sprint**

- [ ] Sprint 2 — 其餘收集路徑（Share Extension URL、YT/網頁/書籍）、Detail/Explore/Settings、去重、實機日用
- [ ] Sprint 3+ — 多供應商、Apple Intelligence 端上、Mac agent（IG/FB 零截圖）、延後功能回歸（電子報/監控/Notion）
- [ ] Prompt 迭代：評估集累積後照 `llm-prompts.md` 的迭代規則跑

## 開發

iOS 專案（Xcode）尚未建立，Sprint 1 M1.1 起建。

`cloudflare/`（dormant，移植參考）：

```bash
cd cloudflare
npm test           # vitest 37 案
npm run typecheck  # tsc --noEmit
```
