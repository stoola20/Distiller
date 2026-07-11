# Sprint 實作計畫（iOS-first，教學型）

> 2026-07-03 初稿，**2026-07-11 大改為 iOS-first**（架構翻轉見 `docs/design/pipeline-decisions.md` 第 0 節）。
> 兩個讀者：
> 1. **Jesse**——SwiftUI 與 TCA 是他刻意學習的新技術（熟 UIKit + RxSwift），所以 TCA 的每個概念都從 RxSwift 思維橋接，先懂再寫。
> 2. **未來執行實作的 Claude session**——每個里程碑都有明確檔案位置、做法要點、驗收標準。照順序做，一個里程碑一個 commit，驗收過了才進下一個。
>
> 設計決策（架構、taxonomy、去重、供應商）在 `docs/design/pipeline-decisions.md`，prompt 在 `docs/design/llm-prompts.md`。**實作時以那兩份為準，不要即興發明。**

---

## 貫穿原則

- 一個里程碑一個 commit，commit message 繁體中文
- **不寫死任何 API key**：使用者的 key 存 Keychain，dev 期開發者自己的 key 也走 Keychain，絕不進程式碼或 commit
- 處理邏輯（parse / taxonomy / canonical-url）配 Swift Testing 單元測試；TCA feature 配 `TestStore` 測試
- 卡住超過 30 分鐘的問題，記錄現象後先跳過或問 Jesse，不要在一個里程碑裡挖洞
- **移植來源**：`cloudflare/src`（dormant）有對應的 TS 實作與 37 個測試，當 Swift 移植的藍本與行為對照

---

## Sprint 0 — TCA 概念橋接（寫程式前先讀，約半天）

你熟 RxSwift + MVVM，TCA 的每個概念都有對應物，差別在「哪裡可以自由、哪裡被限制」：

| RxSwift + MVVM 的做法 | TCA 的對應物 | 關鍵差異 |
|---|---|---|
| ViewModel 裡的 `BehaviorRelay` 們 | `State` struct | 狀態集中成一個 value type，不再散落在多個 relay。因為是 struct，每次變化都是新值，可以直接 assert 相等——這是 TCA 測試好寫的根源 |
| Input：`PublishRelay`、按鈕 tap 綁定 | `Action` enum | 所有事件（使用者操作、API 回來、timer）都是同一個 enum 的 case，進同一個入口。RxSwift 裡每個 input 一條 stream，TCA 裡是一條 stream 的不同 case |
| ViewModel 的 transform／訂閱邏輯 | `Reducer` 的 `body` | 唯一可以改 state 的地方。RxSwift 你可以在任何 subscribe 裡改 relay，TCA 強制所有變化走 `(state, action) -> effect`，資料流向單一 |
| `flatMapLatest` 打 API 再 `bind` 回 relay | `Effect`（`.run { send in ... }`） | 副作用不直接改 state，而是做完後 `send` 一個新 action 回系統（如 `.processed(.success(...))`），由 reducer 接手改 state。可以想成 flatMap 的結果必須繞回 input 端 |
| `DisposeBag` | 不需要 | Store 管生命週期；要取消的 effect 用 `.cancellable(id:)` |
| 建構子注入 `APIService` | `@Dependency(\.contentProcessor)` | 依賴是全域註冊、reducer 內宣告取用；測試時用 `withDependencies` 整組替換 |
| Driver 綁 UI | SwiftUI view 直接觀察 store | `store.state` 讀、`store.send(action)` 寫，沒有綁定樣板 |
| 子 ViewModel 組合 | `Scope`／child reducer | 父 feature 的 state／action 各切一塊給子 feature，組合是型別安全的 |

先讀官方 tutorial 前兩章（Essentials）對照上表。**測試思維的轉變最重要**：`TestStore` 強制你窮舉每個 action 之後的 state 變化，漏 assert 直接測試失敗——RxSwift 測試是抽查，TCA 測試是全查。

- **驗收**：能向自己解釋「為什麼 Effect 要 send action 回去而不是直接改 state」（答案：讓所有狀態變化都經過 reducer 單一入口，時間旅行除錯與測試才可能）

---

# Sprint 1 — 打通核心管道（iOS-first）

**目標**：在 App 用 `PhotosPicker` 批次上傳圖檔 → 一次 multimodal 呼叫 → 六欄位存進 SwiftData → Feed 看到中文摘要。**零外部依賴（不需 Worker、不需 Supabase），模擬器/實機端對端可測。** 這條路先通，因為它最能獨立驗證整條處理管線。

### M1.1 專案骨架

- Xcode 專案：主 App target ＋（Sprint 2 才加）Share Extension target，目錄照 `.claude/CLAUDE.md` 結構
- SPM 加 `swift-composable-architecture`（含 `swift-dependencies`）
- **開啟 CloudKit**：Signing & Capabilities 加 iCloud → CloudKit，建一個 container；App Group（`group.com.stoola20.distiller`）為 Share Extension 預留
- **驗收**：App build 過、跑得起來，模擬器登入 iCloud 帳號

### M1.2 SwiftData 模型（CloudKit 相容）

- `Models/Item.swift`：`@Model`，欄位見 `pipeline-decisions.md` 第 5 節（category、tags、auto_tags、canonicalURL、sourceType、extractedText、status、bookTitle/bookAuthor、is_read、時間戳）
- **CloudKit 限制**：所有屬性有預設值或 optional、關聯 optional、**不用 `@Attribute(.unique)`**
- `ModelContainer` 設定 CloudKit 私有庫同步
- **驗收**：能建立、查詢、刪除 Item；重啟 App 資料還在；（有第二台裝置的話）跨裝置同步出現

### M1.3 移植處理核心（parse / taxonomy / canonical-url）

- `Processing/Taxonomy.swift`：封閉清單常數（唯一真源）＋ category/tags 驗證
- `Processing/CanonicalURL.swift`：URL 正規化，行為對齊 `cloudflare/src/utils/canonical-url.ts`
- `Processing/ContentParsing.swift`：剝 code fence → 解析六欄位 → 型別驗證 → taxonomy 降級「其他」（弱模型防線）
- **Swift Testing 重寫原 37 案**：`youtu.be`、`/shorts/`、IG reel、`utm_*`/`fbclid`、大小寫 host、圍欄剝除、欄位驗證、降級路徑
- **驗收**：測試全綠，行為對齊原 TS

### M1.4 ContentProcessor 協定與 ClaudeAPIProcessor

- `Processing/ContentProcessor.swift`：**TCA DependencyClient pattern**——struct 裡放 closure `process: (CaptureInput) async throws -> ProcessedContent`；`liveValue` 打真 API、`testValue`/`previewValue` 回假資料
- `Processing/Prompts.swift`：P1–P5 組裝（全文以 `llm-prompts.md` 為準，共用區塊抽常數）
- `Processing/ClaudeAPIProcessor.swift`：`URLSession` 打 `api.anthropic.com`，多圖 base64 進 multimodal message，用 P1；解析失敗重試 1 次；再失敗標 `processingFailed`
- key 從 Keychain 讀（dev 期先手動塞你自己的 key）
- **驗收**：mock 測試涵蓋圍欄剝除、欄位驗證、降級；`previewValue` 能餵假 ProcessedContent

### M1.5 Capture feature（批次上傳圖檔）

- `Features/Capture/`：`PhotosPicker` 多選 → 顯示待處理圖 → 送 `ContentProcessor` → 存 SwiftData
- 這是第一個完整 TCA feature，寫慢一點：`State`（selectedImages、isProcessing）、`Action`（imagesPicked、process、processed(Result)）、Reducer 回 `.run` effect 打 processor
- 存 SwiftData 一樣走 dependency client（`@Dependency(\.itemDatabase)`），不要在 effect 裡直接摸 `ModelContext`——`@Model` 與 TCA 的邊界原則見 M1.6 的坑註記
- 為它寫 `TestStore` 測試（成功、失敗降級）——第一次體驗 TCA「全查」
- **驗收**：模擬器選幾張黑底白字圖文 → 幾秒後 SwiftData 多一筆完整六欄位 item；測試綠

### M1.6 Feed feature（最小可視）

- `Features/Feed/`：卡片列表讀 SwiftData（來源 icon、作者/書名、一句話摘要、標籤 chips、時間），未讀藍點
- **坑：`@Model` 是 reference type，不要直接放進 TCA `State`**——State 靠 Equatable value semantics 運作，reference 相等 ≠ 內容相等，`TestStore` 的全查會形同虛設，物件也可能在 reducer 外被偷改（對照 RxSwift：等於把 mutable model 塞進 `BehaviorRelay` 還期望 `distinctUntilChanged` 有用）。做法：SwiftData 存取包成 dependency client（`@Dependency(\.itemDatabase)`，fetch/insert/update 都走它），fetch 結果投影成 plain struct（如 `ItemRowData: Equatable, Identifiable`）進 State；寫回時用 id 找回 `@Model` 再改。後續 Detail（M2.2）沿用同一模式
- 頂部 category 篩選 chips（從 `Taxonomy.swift` 來）
- **驗收**：M1.5 上傳的內容出現在 Feed，中文摘要正確；重啟仍在

### M1.7 評估集起點

- 用真實內容測 5–10 則，**每次真實測試的輸入存進 `eval/cases/`**（結構見 `llm-prompts.md`）——prompt 迭代的資產，現在就開始累積
- **驗收**：端對端通；eval cases 至少 5 案（含書籍拍照）

---

# Sprint 2 — 完整收集與日常可用

**目標**：日常真的用得起來——多種來源都能收、Feed/詳細/探索/設定齊備、實機日用。

### M2.1 其餘收集路徑
- Share Extension（收 **URL**）：**只收件、不處理**——URL 寫進 App Group 收件匣、item 標 `pending` 即返回（extension 生命週期秒級，等不了 LLM；決策見 `pipeline-decisions.md` 第 0 節）
- 主 App 進前景時掃 `pending` 佇列：抓內容（YT 逐字稿、Jina Reader 正文、OG 標籤）→ 對應 P2/P3 → 更新為 `processed`
- **YT 逐字稿是整條收集裡最脆弱的一環，難度別低估**：沒有官方 API，等於用 Swift 自打 YouTube 私有的 innertube 端點（無成熟 Swift 套件，請求形狀參考 `youtubei.js`），隨時可能被改壞。fallback 順序寫死：逐字稿 → 抓不到改用標題＋描述（oEmbed/OG）進 P2 並在 detail 註記「無逐字稿」→ 連標題都抓不到就留 `pending` 待重試。**不變式：任何一步失敗都不可讓這筆收集整筆丟失**
- 書籍拍照走 P5（沿用 M1.5 的批次上傳，另存 bookTitle/bookAuthor）；圖片壓到 2048px 長邊再進 multimodal
- 去重：插入前 fetch 查 `canonicalURL`；另做 App 進前景時的跨裝置 reconciliation（兩台裝置各插一筆同 URL 的 race，合併規則見 `pipeline-decisions.md` 第 2 節）

### M2.2 Detail / Explore / Settings
- Detail：完整摘要（markdown）、原文連結、標籤顯示與編輯；進入時標 is_read
- Explore：category grid（含數量）→ 點入該分類列表
- Settings：**BYO-key 設定 UI**（選供應商 + 填 key 存 Keychain）、版本資訊；電子報/監控留空區塊

### M2.3 收尾
- 實機安裝、真實使用一週；把發現的 LLM 輸出問題記進 `eval/cases/`
- **驗收**：Jesse 日常真的在用

---

# Sprint 3+ — 延後與進階（順序視需要）

- **零 server 的推送補償**：電子報延後拿掉了「知識送到面前」的推力，先用本地手段補——每日/每週本地通知（「本週收了 N 則、最舊 3 則未讀」）＋ Widget 顯示最近摘要。零 server、成本一天內，先做這個再考慮電子報回歸
- **多供應商 processor**：OpenAI / Gemini（分發 BYO-key 前置）
- **Apple Intelligence 端上 processor**：純隱私/離線場景
- **Mac agent（Mac Mini 到位）**：登入抓 IG/FB 零截圖 + 小共享信箱 + Push 通知（見 `pipeline-decisions.md` 第 0、Future 節）
- **延後功能回歸（需引入 server）**：電子報、YouTube 自動監控、Notion 同步——此時才做 server 端 items 同步
- **免費 Claude Pro（`claude -p`）省成本路徑**：Mac Mini 常駐後值得做

---

## 里程碑之外：何時回頭迭代 prompt

出現以下任一，開一個 session 照 `llm-prompt-iteration` skill 跑完整迭代（評估集在 `eval/`）：

- 標籤明顯選錯累積 5 例以上
- summary 常態性超過 40 字或抓錯重點
- JSON 解析失敗率 > 2%（看 M1.4 的降級 log）
- 換供應商後輸出品質變化——用同一個評估集比對再決定
