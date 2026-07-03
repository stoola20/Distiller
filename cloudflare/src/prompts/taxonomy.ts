// 分類與標籤的封閉清單——全系統唯一真源
// 修改前先讀 docs/design/pipeline-decisions.md 第 1 節（收斂機制與取捨）

export const TAXONOMY: Record<string, readonly string[]> = {
  健康長壽: ["長壽科學", "營養", "睡眠", "補劑", "疾病預防"],
  健身訓練: ["肌力訓練", "有氧耐力", "運動恢復", "訓練計畫"],
  投資理財: ["台股", "ETF", "總體經濟", "資產配置", "投資心法"],
  "AI 與開發": ["AI 應用", "LLM", "Agent", "iOS 開發", "軟體工程", "開發工具"],
  攝影創作: ["攝影技巧", "器材", "後製", "作品欣賞"],
  獸醫專業: ["犬貓臨床", "獸醫新知", "飼主衛教"],
  思維成長: ["思維模型", "生產力", "職涯", "人際溝通"],
  其他: [],
} as const;

export const FALLBACK_CATEGORY = "其他";

export const CATEGORIES = Object.keys(TAXONOMY);

export function isValidCategory(category: string): boolean {
  return category in TAXONOMY;
}

// tags 必須全部屬於該 category 底下；「其他」只允許空陣列
export function isValidTags(category: string, tags: string[]): boolean {
  if (!isValidCategory(category)) return false;
  if (category === FALLBACK_CATEGORY) return tags.length === 0;
  if (tags.length < 1 || tags.length > 3) return false;
  return tags.every((t) => TAXONOMY[category].includes(t));
}

// 渲染成 prompt 的共用區塊 B（格式見 docs/design/llm-prompts.md）
export function taxonomyPromptBlock(): string {
  const lines = CATEGORIES.map((c) =>
    c === FALLBACK_CATEGORY
      ? `- ${c}：（不選 tags，tags 填空陣列）`
      : `- ${c}：${TAXONOMY[c].join("、")}`,
  );
  return `分類與標籤只能從以下清單選擇，清單以外的詞一律不可使用：

${lines.join("\n")}

規則：
- category 選一個；tags 選 1 到 3 個，且必須屬於所選 category 底下
- 內容橫跨多個分類時，選最核心的那一個
- 無法歸類時，category 填「${FALLBACK_CATEGORY}」、tags 填 []`;
}
