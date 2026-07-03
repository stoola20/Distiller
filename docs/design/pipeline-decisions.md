# 內容處理管線 — 設計決策

> 2026-07-03 定稿。這份文件釘死 spec 裡的模糊地帶：標籤系統、去重、電子報邏輯、模型選擇。
> 每項決策都附「為什麼」，未來要改的時候先讀完取捨再動手。

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

清單的唯一真源（single source of truth）放在 `cloudflare/src/prompts/taxonomy.ts`，
prompt 組裝時從這裡帶入。App 端的篩選 chips 也從 API 取得，不要在 iOS 寫死第二份。

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

## 2. 去重：canonical URL 唯一索引

### 決策

新增 `canonical_url` 欄位＋唯一索引。`POST /api/items` 收到 URL 先正規化，
撞到既有 item 就直接回傳該 item（HTTP 200 加 `"duplicate": true`），不重複處理、不重複扣 API 費用。

正規化規則（實作在 `cloudflare/src/utils/canonical-url.ts`）：

1. host 轉小寫、移除尾端 `/`
2. 移除追蹤參數：`utm_*`、`fbclid`、`igsh`、`igshid`、`si`、`feature`、`ref`
3. 平台特例：
   - YouTube：抽出 video ID，一律轉成 `https://www.youtube.com/watch?v=<ID>`（涵蓋 `youtu.be`、`/shorts/`、`/live/`）
   - Instagram：貼文一律轉成 `https://www.instagram.com/p/<shortcode>/`（涵蓋 `/reel/`）
4. 其餘參數保留（有些網站用 query 區分文章）

```sql
canonical_url text not null,
-- 唯一索引
create unique index items_canonical_url_idx on items (canonical_url);
```

### 為什麼

- 三條輸入管道（手動分享、YT 排程、OpenClaw 巡邏）**一定**會撞到同一則內容，去重不做，電子報和 Feed 都會重複。
- URL 層去重涵蓋 95% 的情況且零成本。內容層去重（同一篇文章出現在不同網址）需要 hash 或 embedding 比對，複雜度高、收益低，**列為 future，v1 不做**。
- 回傳既有 item 而不是回 409 錯誤：Share Extension 的使用情境是「按了就走」，冪等回傳讓重複分享無感，不需要在 iOS 端處理錯誤 UI。

---

## 3. 電子報邏輯

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

## 4. 模型選擇

| 用途 | 模型 | 為什麼 |
|------|------|--------|
| 內容處理（OCR＋翻譯＋摘要＋標籤） | `claude-sonnet-5` | 需要多模態＋穩定 JSON。Haiku 的 OCR 和翻譯品質不夠，Opus 對這種模板化任務是浪費 |
| 週報歸納 | `claude-sonnet-5` | 跨內容歸納需要一定推理力，每週只跑一次，成本可忽略 |
| 日報 | 不用 LLM | 見上節 |

模型 ID 放環境變數（`wrangler secret` 或 vars），不寫死在程式裡，方便日後升級。

成本粗估：每則內容約 2k–5k input tokens（圖片另計）＋1k output，Sonnet 價位下每則約 US$0.02–0.05。
一天 10 則、一年 3,650 則 ≈ US$100–180／年。量到十倍時再評估把網頁類降到 Haiku。

---

## 5. Schema 變更彙總（相對於 spec）

```sql
alter table items add column category text not null default '其他';
alter table items add column canonical_url text not null;
alter table items add column extracted_text text;  -- OCR 原文或 YT 逐字稿留底
alter table items add column status text not null default 'processed';
  -- processed｜pending（IG/FB 連結等 OpenClaw 補內容）｜processing_failed（LLM 重試後仍失敗）
create unique index items_canonical_url_idx on items (canonical_url);
```

完整建表 SQL 在 `cloudflare/migrations/001_items.sql`。

`extracted_text` 的理由：圖片的 OCR 原文和 YT 逐字稿如果不留底，未來 prompt 改版想重新處理就得重抓（IG 圖可能已失效、YT 逐字稿要重打 API）。文字儲存很便宜，這是保險。

---

## Future（記下來，v1 不做）

- 內容層去重（同文異址）：hash 或 embedding 比對
- `noteworthy` 品質評分欄位：Sprint 4 OpenClaw 自動巡邏上線後，雜訊量會變大，屆時在處理 prompt 加一個「值不值得留」的判斷，低分內容不進日報。現在只有手動分享，分享本身就是品質篩選，不需要
- Haiku 降級路徑（純文字網頁類）
