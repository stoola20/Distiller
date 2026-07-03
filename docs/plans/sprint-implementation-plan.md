# Sprint 1–4 實作計畫（教學型）

> 2026-07-03 定稿。這份計畫有兩個讀者：
> 1. **Jesse**——SwiftUI 與 TCA 是他刻意學習的新技術（熟 UIKit + RxSwift），所以 Sprint 2 的每個概念都從 RxSwift 思維橋接過去，先懂再寫。
> 2. **未來執行實作的 Claude session（任何模型）**——每個里程碑都有明確的檔案位置、做法要點、驗收標準。照順序做，一個里程碑一個 commit，驗收過了才進下一個。
>
> 設計決策（taxonomy、去重、電子報邏輯、模型選擇）都在 `docs/design/pipeline-decisions.md`，prompt 在 `docs/design/llm-prompts.md`。**實作時以那兩份為準，不要即興發明。**

---

## 貫穿原則

- 一個里程碑一個 commit，commit message 繁體中文
- secrets 一律走 `wrangler secret` 或環境變數，任何 key 出現在程式碼或 commit 裡就是事故
- 後端每個 util 函式配 vitest 單元測試；API 層用 curl 驗收
- 卡住超過 30 分鐘的問題，記錄現象後先跳過或問 Jesse，不要在一個里程碑裡挖洞

---

# Sprint 1 — 打通核心管道

**目標**：`curl POST` 一個 URL 或圖片進去 → Supabase 裡出現一筆結構化的 item。全程不需要 iOS。

### M1.1 基礎設施

- 開通／確認帳號：Cloudflare Workers、Supabase、Anthropic Console
- Supabase 建 `items` 表：spec 的欄位＋`pipeline-decisions.md` 第 5 節的三個新欄位（`category`、`canonical_url` 含唯一索引、`extracted_text`），SQL 存 `cloudflare/migrations/001_items.sql`
- 設定 secrets：`SUPABASE_URL`、`SUPABASE_KEY`（用 service_role key，Worker 是唯一後端）、`ANTHROPIC_API_KEY`；模型 ID `CLAUDE_MODEL=claude-sonnet-5` 放 wrangler vars
- **驗收**：`wrangler dev` 起得來；Supabase dashboard 看得到空表

### M1.2 型別與 Supabase client

- `src/types.ts`：`Item`、`ProcessedContent`（LLM 輸出的六欄位）、API 回應包 `{ success, data?, error? }`
- `src/utils/supabase.ts`：包一層 client 工廠，從 env 讀設定
- **驗收**：`tsc --noEmit` 過

### M1.3 URL 正規化與來源判斷

- `src/utils/canonical-url.ts`：實作 `pipeline-decisions.md` 第 2 節的正規化規則（追蹤參數清除、YouTube 統一成 `watch?v=`、IG 統一成 `/p/<shortcode>/`）
- `src/utils/source-detect.ts`：URL → `ig | yt | fb | web`
- vitest 測試涵蓋：`youtu.be` 短網址、`/shorts/`、IG reel、帶 `utm_*` 與 `fbclid` 的網址、大小寫混雜的 host
- **驗收**：測試全綠。這兩個函式是去重的地基，測試寫足再往下

### M1.4 Taxonomy 與 prompt 模組

- `src/prompts/taxonomy.ts`：封閉清單常數（唯一真源），export 給 prompt 組裝和 API 驗證用
- `src/prompts/index.ts`：把 `llm-prompts.md` 的共用區塊 A／B／C 和 P1／P2／P3 組裝成函式（`buildImagePrompt()` 等），內容照文件抄，不要改寫
- **驗收**：組裝出的 prompt 字串包含完整封閉清單與 JSON 範例

### M1.5 Claude API service

- `src/services/claude.ts`：
  - 呼叫 Messages API，模型從 env 讀
  - 回應解析：先剝除可能出現的 ``` 圍欄再 `JSON.parse`
  - 解析失敗或欄位缺漏 → 重試 1 次（重試訊息附上「上次輸出無法解析」）；再失敗 → item 以 `processing_failed` 狀態落庫，不要讓整個請求 500
  - 驗證 `category`／`tags` 在封閉清單內，不在就整則降為 `其他`＋空 tags 並記 log（這是弱模型防線的最後一層）
- **驗收**：mock 測試涵蓋圍欄剝除、欄位驗證、降級路徑

### M1.6 三種內容處理器

- `src/handlers/process.ts` 統一入口，依 source type 分流：
  - **圖片**（Share Extension 會直接傳圖）：圖片以 base64 進 multimodal message，用 P1
  - **YouTube**：`src/services/youtube.ts` 抓逐字稿（建議用 `youtubei.js`；抓不到逐字稿就 fallback 存標題＋描述並註記），逐字稿存 `extracted_text`，用 P2
  - **一般網頁**：`src/services/scraper.ts`，v1 直接用 Jina Reader（`https://r.jina.ai/<url>`）取 markdown 正文——零萃取程式碼、品質夠好；取捨是多一個外部依賴，之後量大或不穩再自建萃取。正文存 `extracted_text`，用 P3
  - **IG／FB 連結**（非圖片直傳）：v1 不做網頁抓取（登入牆），存 URL＋標記 `pending`，Sprint 4 由 OpenClaw 補內容
- **驗收**：三種輸入各自跑通，Supabase 出現完整六欄位的 item

### M1.7 API endpoints

- `src/handlers/items.ts` ＋ router：
  - `POST /api/items`：先算 `canonical_url` 查重，撞到回既有 item ＋ `duplicate: true`；沒撞到 → 處理 → 落庫
  - `GET /api/items`（`?tag=`、`?category=`、`?source_type=`、`?is_read=` 篩選、cursor 分頁）
  - `GET /api/items/:id`、`PATCH /api/items/:id`（tags、is_read）
  - 簡單 API key auth：自訂 header 比對一個 `wrangler secret`（App 和 Share Extension 用同一把）
- **驗收**：curl 全流程——POST 一個 YT 連結 → GET 列表看到它 → PATCH 改標籤 → 重 POST 同連結拿到 `duplicate: true`

### M1.8 部署與評估集起點

- `wrangler deploy` 上正式環境，用真實內容測 5–10 則
- **每一次真實測試的輸入都存進 `cloudflare/eval/cases/`**（結構見 `llm-prompts.md` 評估一節）——這是之後 prompt 迭代的資產，Sprint 1 就開始累積
- **驗收**：正式環境端對端通；eval cases 至少 5 案

---

# Sprint 2 — iOS App + Share Extension

**目標**：日常真的用得起來——在 IG 按分享存內容、在 App 看 Feed。

### M2.0 TCA 概念橋接（寫程式前先讀，約半天）

你熟 RxSwift + MVVM，TCA 的每個概念都有對應物，差別在「哪裡可以自由、哪裡被限制」：

| RxSwift + MVVM 的做法 | TCA 的對應物 | 關鍵差異 |
|---|---|---|
| ViewModel 裡的 `BehaviorRelay` 們 | `State` struct | 狀態集中成一個 value type，不再散落在多個 relay。因為是 struct，每次變化都是新值，可以直接 assert 相等——這是 TCA 測試好寫的根源 |
| Input：`PublishRelay`、按鈕 tap 綁定 | `Action` enum | 所有事件（使用者操作、API 回來、timer）都是同一個 enum 的 case，進同一個入口。RxSwift 裡每個 input 一條 stream，TCA 裡是一條 stream 的不同 case |
| ViewModel 的 transform／訂閱邏輯 | `Reducer` 的 `body` | 唯一可以改 state 的地方。RxSwift 你可以在任何 subscribe 裡改 relay，TCA 強制所有變化走 `(state, action) -> effect`，資料流向單一 |
| `flatMapLatest` 打 API 再 `bind` 回 relay | `Effect`（`.run { send in ... }`） | 副作用不直接改 state，而是做完後 `send` 一個新 action 回系統（如 `.itemsResponse(.success(...))`），由 reducer 接手改 state。可以想成 flatMap 的結果必須繞回 input 端 |
| `DisposeBag` | 不需要 | Store 管生命週期；要取消的 effect 用 `.cancellable(id:)` |
| 建構子注入 `APIService` | `@Dependency(\.apiClient)` | 依賴是全域註冊、reducer 內宣告取用；測試時用 `withDependencies` 整組替換 |
| Driver 綁 UI | SwiftUI view 直接觀察 store | `store.state` 讀、`store.send(action)` 寫，沒有綁定樣板 |
| 子 ViewModel 組合 | `Scope`／child reducer | 父 feature 的 state／action 各切一塊給子 feature，組合是型別安全的 |

先讀官方 tutorial 的前兩章（Essentials：你的第一個 feature、加入副作用），對照上表。**測試思維的轉變最重要**：`TestStore` 會強制你窮舉每個 action 之後的 state 變化，漏 assert 會直接測試失敗——RxSwift 測試是抽查，TCA 測試是全查。

- **驗收**：能向自己解釋「為什麼 Effect 要 send action 回去而不是直接改 state」（答案：讓所有狀態變化都經過 reducer 這個單一入口，時間旅行除錯與測試才可能）

### M2.1 專案骨架

- Xcode 專案：主 App target ＋ Share Extension target，目錄照 `.claude/CLAUDE.md` 的結構
- SPM 加 `swift-composable-architecture`（含 `swift-dependencies`）
- App Group（`group.com.stoola20.distiller`）兩個 target 都開，API base URL 與 key 存 App Group 的 UserDefaults／Keychain
- **驗收**：兩個 target 都 build 過、跑得起來

### M2.2 Models 與 APIClient

- `Models/Item.swift`：對應後端 `Item`，`Codable`＋`Identifiable`＋`Equatable`（TCA state 需要 Equatable）
- `Services/APIClient.swift`：TCA 的 `DependencyClient` pattern——struct 裡放 closure 屬性（`fetchItems`、`fetchItem`、`updateItem`、`submitURL`），`liveValue` 用 async/await + URLSession 實作，`testValue`／`previewValue` 回假資料
- 這一步等於 RxSwift 裡「定義 protocol ＋ live／mock 兩個實作」，只是用 struct of closures 取代 protocol
- **驗收**：`previewValue` 能在 SwiftUI Preview 餵出假 Feed

### M2.3 Feed feature（第一個完整 TCA feature，寫慢一點）

- `Features/Feed/FeedFeature.swift`：
  - `State`：`items: IdentifiedArrayOf<Item>`、`selectedCategory: String?`、`isLoading`
  - `Action`：`onAppear`、`categorySelected(String?)`、`itemsResponse(Result<[Item], Error>)`、`itemTapped(Item.ID)`
  - Reducer：`onAppear` 回傳 `.run` effect 打 API → `itemsResponse` 更新 state
- `Features/Feed/FeedView.swift`：卡片列表＋頂部 category 篩選 chips（清單從 taxonomy 來，先硬編 8 個 category 字串，之後可改從 API 拿）
- 未讀藍點用 `item.isRead` 判斷
- **為這個 feature 寫 `TestStore` 測試**（載入成功、篩選切換）——第一次體驗 TCA 測試的「全查」
- **驗收**：模擬器看到真實後端資料的 Feed；測試綠

### M2.4 Detail feature 與導航

- `Features/Detail/`：完整摘要（markdown 渲染可先用 `Text`＋AttributedString）、原文連結按鈕、標籤顯示
- 導航用 TCA 的 tree-based navigation：Feed state 裡放 `@Presents var detail: DetailFeature.State?`，`itemTapped` 時填值。對照 UIKit：這等於「push 由 state 驅動」而不是 `navigationController.push`——state 有值就顯示，設 nil 就 pop
- 進入詳細頁時 PATCH `is_read = true`
- **驗收**：點卡片進詳細頁、返回後未讀點消失

### M2.5 Explore feature

- 標籤分類 grid（category 卡片＋內容數量）→ 點入該分類列表（重用 Feed 的列表元件）
- 數量統計 v1 直接 `GET /api/items?category=` 拿全量在客戶端算，量大再加後端統計 endpoint
- **驗收**：grid 顯示正確數量、點入列表正確篩選

### M2.6 Settings 基本框架

- v1 只放：API base URL ＋ API key 設定（存 Keychain）、版本資訊。電子報開關和監控帳號管理是 Sprint 3 的事，先留空區塊
- **驗收**：改 API 設定後 Feed 連得上

### M2.7 Share Extension

- 接收 URL 與圖片（`NSItemProvider`），顯示小 sheet：連結預覽＋「儲存」
- 送出走 background `URLSession`（extension 可能被系統快速回收，background session 保證送達）；圖片壓到 2048px 長邊再上傳
- 預填標籤功能 v1 **不做** LLM 預覽（extension 等 LLM 回應會超過 3 秒體驗目標），直接送後端非同步處理——spec 的「LLM 預填標籤可編輯」移到詳細頁編輯
- **驗收**：實機上從 IG／Safari 分享 → 幾秒後 App Feed 出現該內容

### M2.8 收尾

- 實機安裝、真實使用一週開始
- 把使用中發現的 LLM 輸出問題記進 `eval/cases/`
- **驗收**：Jesse 日常真的在用

---

# Sprint 3 — 電子報 + YouTube 自動監控

**目標**：不開 App 也能吸收——每天日報、每週日週報自動寄達。

### M3.1 電子報渲染

- `src/services/newsletter.ts`：
  - 日報：**純程式**——撈當天 items 按 category 分組套 HTML 模板（決策見 `pipeline-decisions.md` 第 3 節），當天沒 items 不寄
  - 週報：組 P4 輸入 → LLM 拿結構化 JSON → 程式渲染（themes／highlights／action items 三區塊）；少於 3 則 items 跳過 LLM 直接列清單
- HTML 模板用 inline style（email client 不吃 stylesheet），手機優先單欄
- **驗收**：本地用假資料渲染出兩種報，Gmail 手機版顯示正常

### M3.2 Resend 寄送與排程

- 開通 Resend、驗證網域
- `newsletters` 表落庫**先於**寄信（借 pubvet 的不變式：先存檔再寄，寄失敗可以重寄，存檔失敗就不寄）
- Cron Triggers（`wrangler.toml`）——**注意 cron 是 UTC**：
  - 日報 07:00 台北 = `0 23 * * *`（UTC 前一天 23:00）
  - 週報週日 09:00 台北 = `0 1 * * 0`（UTC 週日 01:00）
- 寄送冪等：寄之前查 `newsletters` 表今天是否已寄過同型別
- **驗收**：手動觸發 cron（`wrangler dev --test-scheduled`）收到信；連跑兩次只寄一封

### M3.3 YouTube 頻道監控

- 建 `monitored_accounts` 表（spec schema）＋管理 endpoints（`GET/POST/PATCH /api/accounts`）
- Cron 每日一次：對每個 active 的 YT 頻道用 Data API 撈 `last_checked_at` 之後的新影片 → 走既有 `POST /api/items` 內部流程（自動吃到去重）→ 更新 `last_checked_at`
- 配額註記：每頻道每天 1–2 單位查詢，10 個頻道遠低於 10,000 配額，不用省
- **驗收**：加一個常更新的頻道，隔天 Feed 自動出現新影片

### M3.4 App 設定頁補完

- 電子報開關（後端存偏好，cron 讀）、監控帳號管理（吃 M3.3 的 endpoints）
- **驗收**：從 App 新增 YT 頻道，隔日自動收到內容

### M3.5 週報 prompt 首次真實驗證

- 用第一個真實週的資料跑 P4，Jesse 人工評：主題是不是真的跨內容、有沒有硬湊
- 結果與修改記錄回 `llm-prompts.md` 底部
- **驗收**：第一份真實週報寄達且 Jesse 認可品質

---

# Sprint 4 — OpenClaw IG/FB 自動巡邏

**前置**：Mac Mini 到手。此 sprint 涉及自動化瀏覽第三方平台，細節等環境就緒再細化，先定骨架與原則。

### M4.1 環境與帳號

- Mac Mini：Node.js、OpenClaw、獨立 `openclaw` browser profile
- 專用 IG／FB 帳號（不用個人帳號），手動追蹤目標帳號、養帳號一至兩週再上自動化
- **驗收**：手動操作該 profile 能正常瀏覽目標帳號

### M4.2 IG 巡邏 skill

- `openclaw/ig-patrol.md`：開帳號頁 → snapshot → 比對 `monitored_accounts.last_checked_at` 判斷新貼文 → 逐則截圖＋擷取 caption → `POST /api/items`（圖片走 base64，吃 Sprint 1 的 P1 流程）→ 回填 `last_checked_at`
- 頻率保守：每天一次（06:30），單次巡邏帳號數上限 10，動作間隨機延遲——**寧可漏抓不要被封**
- **驗收**：連續 7 天穩定巡邏無封鎖警告

### M4.3 FB 巡邏 skill ＋ 錯誤處理

- FB 版比照 IG；另做：登入失效偵測（snapshot 出現登入牆 → 停止巡邏＋通知 Jesse，不要自動重試登入）、連續失敗 3 天發告警信
- **驗收**：模擬登出後系統正確告警而不是無聲失敗

### Sprint 5（Notion 同步）照 spec 執行，無新增決策；`items.pending`（M1.6 的 IG/FB 連結）由 M4.2 的巡邏補完內容。

---

## 里程碑之外：何時回頭迭代 prompt

出現以下任一情況，開一個 session 照 `llm-prompt-iteration` skill 跑完整迭代（評估集在 `cloudflare/eval/`）：

- 標籤明顯選錯累積 5 例以上
- summary 常態性超過 40 字或抓錯重點
- JSON 解析失敗率 > 2%（看 M1.5 的降級 log）
- Sprint 4 上線後雜訊變多——屆時實作 `pipeline-decisions.md` Future 一節的 `noteworthy` 品質欄位
