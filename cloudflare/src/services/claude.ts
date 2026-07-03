// Claude API 呼叫與防禦性解析
// 解析失敗重試 1 次；標籤不在封閉清單就降級為「其他」——弱模型防線的最後一層
// fetch 可注入，測試不打真 API

import type { ProcessedContent } from "../types";
import {
  FALLBACK_CATEGORY,
  isValidCategory,
  isValidTags,
} from "../prompts/taxonomy";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

export interface ClaudeConfig {
  apiKey: string;
  model: string;
  fetcher?: typeof fetch;
}

// 使用者訊息的內容區塊（文字或 base64 圖片）
export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

export interface ProcessResult {
  content: ProcessedContent;
  // degraded = true 表示 taxonomy 驗證失敗被降級，要記 log 供每月檢視
  degraded: boolean;
}

// 剝除模型可能加上的 markdown 圍欄後解析 JSON；欄位缺漏或型別錯誤回 null
export function parseProcessedContent(text: string): ProcessedContent | null {
  let body = text.trim();
  const fenceMatch = body.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) body = fenceMatch[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const obj = parsed as Record<string, unknown>;
  const stringFields = [
    "extracted_text",
    "original_language",
    "summary",
    "detail",
    "category",
  ] as const;
  for (const field of stringFields) {
    if (typeof obj[field] !== "string") return null;
  }
  if (!Array.isArray(obj.tags) || !obj.tags.every((t) => typeof t === "string"))
    return null;

  return {
    extracted_text: obj.extracted_text as string,
    original_language: obj.original_language as string,
    summary: obj.summary as string,
    detail: obj.detail as string,
    category: obj.category as string,
    tags: obj.tags as string[],
  };
}

// category／tags 不在封閉清單 → 整則降為「其他」＋空 tags
export function normalizeTaxonomy(content: ProcessedContent): ProcessResult {
  if (
    isValidCategory(content.category) &&
    isValidTags(content.category, content.tags)
  ) {
    return { content, degraded: false };
  }
  return {
    content: { ...content, category: FALLBACK_CATEGORY, tags: [] },
    degraded: true,
  };
}

async function callClaude(
  config: ClaudeConfig,
  systemPrompt: string,
  userContent: ContentBlock[],
): Promise<string> {
  const fetcher = config.fetcher ?? fetch;
  const res = await fetcher(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  return data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

// 主入口：呼叫 → 解析 → 失敗重試 1 次 → taxonomy 驗證與降級
// 兩次都解析失敗會 throw，由呼叫端把 item 落庫為 processing_failed
export async function processContent(
  config: ClaudeConfig,
  systemPrompt: string,
  userContent: ContentBlock[],
): Promise<ProcessResult> {
  const firstText = await callClaude(config, systemPrompt, userContent);
  let parsed = parseProcessedContent(firstText);

  if (!parsed) {
    const retryContent: ContentBlock[] = [
      ...userContent,
      {
        type: "text",
        text: "（你上一次的輸出無法解析為合法 JSON。請重新輸出：只輸出一個 JSON 物件，包含 extracted_text、original_language、summary、detail、category、tags 六個欄位，不加任何其他文字。）",
      },
    ];
    const retryText = await callClaude(config, systemPrompt, retryContent);
    parsed = parseProcessedContent(retryText);
  }

  if (!parsed) {
    throw new Error("LLM 輸出經重試後仍無法解析為合法 JSON");
  }
  return normalizeTaxonomy(parsed);
}
