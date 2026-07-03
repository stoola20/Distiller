import { describe, expect, it } from "vitest";
import {
  normalizeTaxonomy,
  parseProcessedContent,
  processContent,
} from "../src/services/claude";
import type { ProcessedContent } from "../src/types";

const validContent: ProcessedContent = {
  extracted_text: "some text",
  original_language: "en",
  summary: "一句話摘要",
  detail: "## 重點\n\n- 內容",
  category: "健康長壽",
  tags: ["營養"],
};

describe("parseProcessedContent", () => {
  it("解析乾淨的 JSON", () => {
    expect(parseProcessedContent(JSON.stringify(validContent))).toEqual(
      validContent,
    );
  });

  it("剝除 markdown 圍欄後解析", () => {
    const fenced = "```json\n" + JSON.stringify(validContent) + "\n```";
    expect(parseProcessedContent(fenced)).toEqual(validContent);
  });

  it("欄位缺漏回 null", () => {
    const { summary: _dropped, ...missing } = validContent;
    expect(parseProcessedContent(JSON.stringify(missing))).toBeNull();
  });

  it("tags 型別錯誤回 null", () => {
    expect(
      parseProcessedContent(
        JSON.stringify({ ...validContent, tags: "not-array" }),
      ),
    ).toBeNull();
  });

  it("非 JSON 文字回 null", () => {
    expect(parseProcessedContent("好的，以下是摘要：...")).toBeNull();
  });
});

describe("normalizeTaxonomy", () => {
  it("合法的 category 與 tags 原樣通過", () => {
    const result = normalizeTaxonomy(validContent);
    expect(result.degraded).toBe(false);
    expect(result.content).toEqual(validContent);
  });

  it("清單外的 category 降級為「其他」", () => {
    const result = normalizeTaxonomy({
      ...validContent,
      category: "養生",
      tags: ["健康"],
    });
    expect(result.degraded).toBe(true);
    expect(result.content.category).toBe("其他");
    expect(result.content.tags).toEqual([]);
  });

  it("tags 不屬於所選 category 時降級", () => {
    const result = normalizeTaxonomy({
      ...validContent,
      category: "健康長壽",
      tags: ["台股"],
    });
    expect(result.degraded).toBe(true);
    expect(result.content.category).toBe("其他");
  });

  it("「其他」搭配空 tags 是合法組合", () => {
    const result = normalizeTaxonomy({
      ...validContent,
      category: "其他",
      tags: [],
    });
    expect(result.degraded).toBe(false);
  });
});

// 模擬 Anthropic API 回應的 fetcher
function mockFetcher(responses: string[]): typeof fetch {
  let call = 0;
  return (async () => {
    const text = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return new Response(JSON.stringify({ content: [{ type: "text", text }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const config = (fetcher: typeof fetch) => ({
  apiKey: "test-key",
  model: "claude-sonnet-5",
  fetcher,
});

describe("processContent", () => {
  it("第一次就成功", async () => {
    const result = await processContent(
      config(mockFetcher([JSON.stringify(validContent)])),
      "system",
      [{ type: "text", text: "input" }],
    );
    expect(result.content.summary).toBe("一句話摘要");
  });

  it("第一次壞掉、重試成功", async () => {
    const result = await processContent(
      config(mockFetcher(["亂七八糟的輸出", JSON.stringify(validContent)])),
      "system",
      [{ type: "text", text: "input" }],
    );
    expect(result.degraded).toBe(false);
  });

  it("重試後仍失敗會 throw", async () => {
    await expect(
      processContent(config(mockFetcher(["壞的", "還是壞的"])), "system", [
        { type: "text", text: "input" },
      ]),
    ).rejects.toThrow("無法解析");
  });
});
