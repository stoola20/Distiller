-- items 表：spec 欄位 ＋ pipeline-decisions.md 第 5 節的三個新欄位
-- 在 Supabase SQL Editor 執行

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('ig', 'yt', 'fb', 'web')),
  source_url text not null,
  canonical_url text not null,
  source_author text,
  source_handle text,
  raw_content text,
  extracted_text text,          -- OCR 原文或 YT 逐字稿留底，供重新處理與全文檢索
  processed_summary text,
  processed_detail text,
  original_language text,
  category text not null default '其他',
  tags text[] not null default '{}',
  auto_tags text[] not null default '{}',  -- LLM 原始輸出留底，使用者編輯不動這欄
  collection_method text not null check (collection_method in ('share_extension', 'yt_auto', 'openclaw_auto')),
  status text not null default 'processed' check (status in ('processed', 'pending', 'processing_failed')),
  is_read boolean not null default false,
  is_included_in_newsletter boolean not null default false,
  notion_page_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 去重的地基：同一 canonical URL 只允許一筆
create unique index if not exists items_canonical_url_idx on items (canonical_url);

-- Feed 與探索頁的查詢路徑
create index if not exists items_created_at_idx on items (created_at desc);
create index if not exists items_category_idx on items (category);

-- 只有 Worker 用 service_role key 存取，仍開 RLS 擋 anon key 誤用
alter table items enable row level security;
