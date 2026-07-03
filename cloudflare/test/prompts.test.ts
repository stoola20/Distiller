import { describe, expect, it } from "vitest";
import {
  buildImagePrompt,
  buildWebPrompt,
  buildWeeklyPrompt,
  buildYoutubePrompt,
} from "../src/prompts";
import { CATEGORIES } from "../src/prompts/taxonomy";

describe("prompt 組裝", () => {
  const processingPrompts = [
    buildImagePrompt(),
    buildYoutubePrompt(),
    buildWebPrompt(),
  ];

  it("三個處理 prompt 都含完整封閉分類清單", () => {
    for (const prompt of processingPrompts) {
      for (const category of CATEGORIES) {
        expect(prompt).toContain(category);
      }
    }
  });

  it("三個處理 prompt 都含完整 JSON 輸出範例（六欄位）", () => {
    for (const prompt of processingPrompts) {
      for (const field of [
        "extracted_text",
        "original_language",
        "summary",
        "detail",
        "category",
        "tags",
      ]) {
        expect(prompt).toContain(`"${field}"`);
      }
    }
  });

  it("三個處理 prompt 都含 injection 防禦指示", () => {
    for (const prompt of processingPrompts) {
      expect(prompt).toContain("待處理的內容");
    }
  });

  it("週報 prompt 含四個輸出區塊與不硬湊指示", () => {
    const prompt = buildWeeklyPrompt();
    for (const field of [
      "themes",
      "highlights",
      "action_items",
      "observation",
    ]) {
      expect(prompt).toContain(field);
    }
    expect(prompt).toContain("至少 2 則");
  });
});
