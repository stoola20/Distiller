# 內容處理管線 — 設計決策

> 2026-07-03 定稿，**2026-07-11 大改（見第 0 節）**。這份文件釘死 spec 裡的模糊地帶。
> 每項決策都附「為什麼」，未來要改的時候先讀完取捨再動手。
> **第 0 節（架構定案）凌駕以下各節與原 spec；各節內若與第 0 節衝突，以第 0 節為準。**

---

## 0. 架構定案（2026-07-11：server-centric → phone-centric）

原設計是 server-centric（Cloudflare Worker + Supabase + 電子報 + 自動監控），為「後端自動化為主」而生。實際使用是「手動收集為主、圖片與長文為大宗」，故翻轉為 **phone-centric**。

**儲存：SwiftData + CloudKit（不用 Supabase）**
- App 是唯一消費者；CloudKit 私有庫同步使用者的裝置 + 自動備份；離線、免 server、貼 SwiftUI/TCA。
- 取捨：放掉「server 端能讀全部 items」的能力，所以電子報、自動監控因此延後。要回歸時才引入 server。

**處理：App 直接呼叫 provider API（無 Worker）**
- 手機碰不到睡著的個人電腦，且 Worker（serverless 函式、非常駐機器）不能開子行程跑 CLI；App 內用 URLSession 直接打 API 最簡單、隨時可用。
- `ContentProcessor` 協定（TCA DependencyClient pattern）切換供應商：Claude 現做，OpenAI/Gemini 為分發 BYO-key 預留，Apple Intelligence 端上為未來。
- **BYO-key**：使用者自帶 key，存 Keychain，直接從裝置打 provider，**不經過任何 server**（零金鑰責任）——這是「未來發給別人用」的乾淨前提。
- 取捨：付 API（手動量約 US$50–200/yr）。免費 Claude Pro（`claude -p` CLI）省成本路徑延後到 Mac Mini（常駐）到位——它需要手機↔電腦的常駐信箱，Mac Mini 之前不划算。

**收集：手動優先，兩條路**
- ① Share Extension 收 **URL**（社群 App 分享只給 URL，不給內容）：YT/網頁/Threads/公開 FB → App 端抓內容（逐字稿 / Jina Reader 正文 / OG 標籤）→ 處理。
  - **交棒機制：extension 只收件、不處理**——把 URL 寫進 App Group 共享容器的收件匣（item 標 `pending`）即返回；抓內容與 LLM 呼叫都在**主 App 進前景時**做。理由：extension 生命週期秒級、記憶體上限低，等不了 30 秒級的 multimodal 呼叫；background `URLSession` 跨 process 交付結果又太複雜。取捨：分享後要等下次開 App 才看得到處理結果——可接受，Feed 本來就是開 App 才看。
- ② 批次上傳圖檔（PhotosPicker 多選）：書籍拍照、IG 圖文貼文截圖 → 一次 multimodal 呼叫（P1/P5）。**書籍與圖文截圖是同一個功能。**
- 硬限制：**IG／私密 FB 有登入牆**，App 拿 URL 抓不到內容 → 只能走 ② 截圖，或（未來）Mac agent 用登入身份抓。② 省的是匯入，IG 輪播仍要手動截圖；零截圖只有 Mac agent。

**延後（回歸時才引入 server，用同一個縫加回去）**
- 電子報（第 3 節）、YouTube 自動監控、OpenClaw IG/FB 巡邏、Notion 同步。
- Mac agent（Mac Mini，登入抓 IG/FB）：分享 URL → 存 pending → agent 抓內容 → Push 通知匯入；睡眠時等下次開機。需要一個小共享信箱（server/queue）當中繼，因為 Mac 讀不到手機 CloudKit 私有庫。

**新增 source type**：`threads`、`book`（原本只有 `ig`/`yt`/`fb`/`web`）。

---

## 1. 標籤系統：兩層封閉式

### 決策

每則 item 有兩層分類：

- **category（分類）**：單選，從 8 個封閉選項中選一個。對應 App Feed 的篩選 chips 和電子報的分組。
- **tags（標籤）**：從封閉清單選 1–3 個，只能選 category 底下的標籤。

### 封閉清單（v1）

| category | tags |
|----------|------|
| 健康長壽 | 長壽科學、營養、睡眠、補劑、疾病預防 |
| 健身訓練 | 肌力訓練、有氧耐力、運動恢復、訓練計畫 |
| 投資理財 | 台股、ETF、總體經濟、資產配置、投資心法 |
| AI 與開發 | AI 應用、LLM、Agent、iOS 開發、軟體工程、開發工具 |
| 攝影創作 | 攝影技巧、器材、後製、作品欣賞 |
| 獸醫專業 | 犬貓臨床、獸醫新知、飼主衛教 |
| 思維成長 | 思維模型、生產力、職涯、人際溝通 |
| 其他 | （無子標籤，tags 允許空陣列） |

清單的唯一真源（single source of truth）放在 App 的 `Taxonomy.swift`（設計真源仍是本文件）。
prompt 組裝與 Feed 篩選 chips 都從這個常數帶入，不要寫死第二份。

### 為什麼

- **開放式標籤必然發散**。讓 LLM 自由發揮，一個月後會出現「健康」「養生」「健康知識」三個同義標籤，探索頁變垃圾場。封閉清單是弱模型防呆的第一原則。
- **兩層而不是一層**：App 的篩選 chips 需要少量穩定的大分類（8 個剛好一排半），但檢索需要更細的粒度。一層 30 個標籤當 chips 太多，一層 8 個當檢索又太粗。
- **種子來自 Jesse 的真實興趣**（長壽營養、台股、健身、AI/agent、攝影），不是憑空設計的通用分類。「獸醫專業」單獨成類是因為他是執業獸醫，臨床相關內容必然會進來，混進「健康長壽」會污染兩邊。
- **spec 原本的 chips（健康／投資／成長／科技）已被此清單取代**，spec 不回頭改，以本文件為準。

### 收斂機制（清單怎麼長大）

1. LLM 只能從封閉清單選。判斷不了就填「其他」。
2. 使用者在 App 手動改標籤時可以輸入任意文字（存進 `tags`，`auto_tags` 留 LLM 原始輸出）。
3. **每月檢視一次**：`category = 其他` 的 items 和使用者自創的標籤裡，出現 3 次以上的主題就提名進封閉清單，改 `taxonomy.ts` 一個檔案即可。
4. 已知取捨：長尾主題（一次性的冷門內容）會被壓進「其他」，這是刻意的——為了收斂犧牲長尾細分。

### Schema 變更

`items` 表新增：

```sql
category text not null default '其他'
```

---

## 2. 去重：canonical URL 本地查詢（2026-07-11 改）

### 決策

每則 item 存正規化後的 `canonical_url`。收到 URL 先正規化，**插入 SwiftData 前先 fetch 查有沒有同 `canonical_url` 的既有 item**；撞到就直接顯示既有 item、不重複處理、不重複扣 API 費用。

> 原設計用 Postgres `canonical_url` 唯一索引擋重。改 SwiftData + CloudKit 後**不能用 `@Attribute(.unique)`**（CloudKit 同步不支援），故改為插入前的本地 fetch 查詢。正規化規則不變，只是實作從 TS 移到 Swift `CanonicalURL.swift`。

**跨裝置 race 與 reconciliation**：插入前 fetch 只擋得住「本機」重複——iPhone 和 iPad 各自（離線或同步延遲間）分享同一則內容時，兩邊本地查詢都查不到，CloudKit 同步後 Feed 就會出現兩筆。單人情境發生率低但一定會遇到，補救便宜：**App 進前景時跑一次 reconciliation**——查全庫重複的 `canonicalURL`，保留 `createdAt` 較早的那筆，把較晚那筆使用者可能已改過的欄位（`tags`、`is_read`）合併過去再刪除。決策要點：
- 掛在「進前景」而不是監聽 CloudKit 同步事件：時機粗一點但實作簡單得多，重複多顯示幾分鐘無害。
- 「保留較早那筆」是為了讓兩台裝置各自 reconcile 時收斂到同一筆（deterministic），不能用「保留本機那筆」這種兩邊結論不同的規則。

正規化規則（Swift `CanonicalURL.swift`，行為對齊原 `cloudflare/src/utils/canonical-url.ts`）：

1. host 轉小寫、移除尾端 `/`
2. 移除追蹤參數：`utm_*`、`fbclid`、`igsh`、`igshid`、`si`、`feature`、`ref`
3. 平台特例：
   - YouTube：抽出 video ID，一律轉成 `https://www.youtube.com/watch?v=<ID>`（涵蓋 `youtu.be`、`/shorts/`、`/live/`）
   - Instagram：貼文一律轉成 `https://www.instagram.com/p/<shortcode>/`（涵蓋 `/reel/`）
4. 其餘參數保留（有些網站用 query 區分文章）

### 為什麼

- 手動分享同一則內容（不同時間、不同裝置、或未來加上 YT 監控）會撞到，去重不做 Feed 會重複。
- URL 層去重涵蓋 95% 的情況且近乎零成本。內容層去重（同一篇文章出現在不同網址）需要 hash 或 embedding 比對，複雜度高、收益低，**列為 future，v1 不做**。
- 撞到直接顯示既有 item（不報錯）：Share Extension 的使用情境是「按了就走」，無感冪等，不需要在 App 端處理錯誤 UI。
- 純圖片上傳（無 URL，如書頁、截圖）沒有 `canonical_url` 可比對，v1 不對圖片做去重（成本低、重複機率小）。

---

## 3. 電子報邏輯（**已延後**，見第 0 節）

> phone-centric 之後 server 讀不到 items，電子報整段延後。以下決策保留，回歸（引入 server 那份 items 同步）時直接沿用。

### 日報：不用 LLM

**日報是純程式邏輯**：撈當天的 items → 按 category 分組 → 套 HTML 模板渲染既有的 `processed_summary`。

為什麼：日報的內容（每則 1–2 句重點）在 item 處理時就已經生成了，再叫一次 LLM 只是重新措辭，多花錢、多一個不穩定環節。當天沒有 items 就不寄。

### 週報：LLM 歸納，輸出結構化 JSON

輸入：本週 items 的 `(id, summary, category, tags, source_author)`。
輸出 JSON（prompt 見 `llm-prompts.md` P4），由程式套模板渲染 HTML：

- `themes[]`：跨內容主題。**至少 2 則 items 支撐才成立一個主題**，每個主題附綜合觀察與 item ids
- `highlights[]`：不屬於任何主題但值得單獨一提的內容（最多 3 則）
- `action_items[]`：0–3 條，只在內容明確可行動時才寫，不硬湊
- `observation`：本週收集趨勢一句話

### 為什麼

- **LLM 輸出 JSON、程式渲染 HTML**，而不是讓 LLM 直接寫 HTML：弱模型寫 HTML 會漏標籤、樣式漂移，而且模板改版就要改 prompt。資料與呈現分離。
- 「主題需要 ≥2 則支撐」「不硬湊 action items」是防止 LLM 過度發揮——沒有趨勢的一週就老實說內容分散，硬歸納出來的主題是雜訊。
- 本週少於 3 則 items 時跳過歸納，直接列清單（程式判斷，不進 LLM）。

---

## 4. 模型／供應商選擇（2026-07-11 改為多供應商 BYO-key）

處理不綁單一供應商，走 `ContentProcessor` 協定，實作各自打不同 provider 的 API：

| 供應商 | 現況 | 為什麼 |
|------|------|--------|
| Claude（`claude-sonnet-5`） | **現做** | 需要多模態＋穩定 JSON；圖文 OCR/翻譯品質夠。dev 用開發者自己的 key |
| OpenAI / Gemini | 為分發 BYO-key 預留 | 未來發給別人用時，每個使用者選供應商、填自己的 key |
| Apple Intelligence（端上） | 未來 | 純隱私/離線場景；~3B 端上模型對外語 OCR＋翻譯偏弱，不當主力 |

- **不寫死模型**：供應商與模型 ID 存設定（App 內），方便切換升級。
- **key 走 BYO-key**：使用者自帶、存 Keychain、直接從裝置打 provider，不落 server（見第 0 節）。
- 週報歸納（若電子報回歸）沿用同一套供應商；每週一次，成本可忽略。日報不用 LLM。

成本粗估：每則約 2k–5k input tokens（圖片另計）＋1k output，Sonnet 價位下每則約 US$0.02–0.05。手動量一天 5–15 則 ≈ **US$50–200／年**。這也是「免費 Claude Pro CLI」省成本路徑延後（Mac Mini 到位再做）的原因——省的金額不大，不值得現在多養一套常駐信箱。

---

## 5. 資料模型（2026-07-11 改為 SwiftData `@Model`）

`Item` 存在 SwiftData（CloudKit 私有庫同步）。相對原 spec 表的重點欄位：

- `category`（預設「其他」）、`tags` / `auto_tags`
- `canonicalURL`（正規化後，本地去重用；**不設 unique 屬性**，見第 2 節）
- `sourceType`：`ig` / `yt` / `fb` / `web` / `threads` / `book`
- `extractedText`：OCR 原文、YT 逐字稿、書頁文字留底
- `status`：`processed`｜`pending`（待處理：Share Extension 剛收件、或 IG/FB 連結等 Mac agent 補內容）｜`processingFailed`（LLM 重試後仍失敗）
- 書籍（`book`）另存 `bookTitle` / `bookAuthor`（P5 抽出，可能為空）

**CloudKit 限制**：屬性要有預設值或 optional、關聯要 optional、不能用 `@Attribute(.unique)`。

`extractedText` 的理由：OCR 原文、逐字稿、書頁文字若不留底，未來 prompt 改版想重新處理就得重抓（IG 圖可能已失效、YT 逐字稿要重打 API、書本可能已還）。文字儲存很便宜，這是保險。

> 原 Postgres 建表 SQL 保留在 `cloudflare/migrations/001_items.sql`（dormant，僅供欄位對照）。

---

## Future（記下來，現在不做）

- 內容層去重（同文異址）：hash 或 embedding 比對
- **零 server 推送補償**：本地通知（未讀提醒）＋ Widget（最近摘要），補電子報延後失去的「推力」；比電子報回歸便宜得多，優先做
- **延後功能回歸**：電子報、YouTube 監控、Notion 同步——都需要一份 server 端的 items（App 啟用時同步上去，或走 CloudKit Web Services 讓 server 讀私有庫）
- **Mac agent（登入抓 IG/FB）**：Mac Mini 到位後做，含中繼的小共享信箱 + Push 通知（見第 0 節）
- **免費 Claude Pro（`claude -p` CLI）省成本路徑**：Mac Mini 常駐後值得做
- `noteworthy` 品質評分欄位：自動巡邏上線後雜訊變多，屆時在處理 prompt 加「值不值得留」判斷。現在只有手動收集，收集本身就是品質篩選，不需要
- 更弱/更省模型的降級路徑（純文字類）
