// LLM 處理後的結構化內容（六欄位，定義見 docs/design/llm-prompts.md）
export interface ProcessedContent {
  extracted_text: string;
  original_language: string;
  summary: string;
  detail: string;
  category: string;
  tags: string[];
}

// API 回應統一包裝
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export type SourceType = "ig" | "yt" | "fb" | "web";

// items 表的一筆資料（欄位見 spec ＋ pipeline-decisions.md 第 5 節）
export interface Item {
  id: string;
  source_type: SourceType;
  source_url: string;
  canonical_url: string;
  source_author: string | null;
  source_handle: string | null;
  raw_content: string | null;
  extracted_text: string | null;
  processed_summary: string | null;
  processed_detail: string | null;
  original_language: string | null;
  category: string;
  tags: string[];
  auto_tags: string[];
  collection_method: "share_extension" | "yt_auto" | "openclaw_auto";
  status: "processed" | "pending" | "processing_failed";
  is_read: boolean;
  is_included_in_newsletter: boolean;
  notion_page_id: string | null;
  created_at: string;
  updated_at: string;
}
