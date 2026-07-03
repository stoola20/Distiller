import { describe, expect, it } from "vitest";
import { canonicalUrl } from "../src/utils/canonical-url";

describe("canonicalUrl", () => {
  it("youtu.be 短網址收斂成 watch 形式", () => {
    expect(canonicalUrl("https://youtu.be/dQw4w9WgXcQ?si=abc123")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  it("YouTube shorts 收斂成 watch 形式", () => {
    expect(canonicalUrl("https://www.youtube.com/shorts/abc123XYZ_-")).toBe(
      "https://www.youtube.com/watch?v=abc123XYZ_-",
    );
  });

  it("YouTube watch 網址清掉多餘參數", () => {
    expect(
      canonicalUrl(
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&feature=share",
      ),
    ).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("IG reel 收斂成 /p/ 形式", () => {
    expect(
      canonicalUrl("https://www.instagram.com/reel/C8xYz12AbCd/?igsh=xyz"),
    ).toBe("https://www.instagram.com/p/C8xYz12AbCd/");
  });

  it("IG 貼文帶 igshid 收斂後一致", () => {
    expect(
      canonicalUrl(
        "https://instagram.com/p/C8xYz12AbCd/?igshid=MzRlODBiNWFlZA==",
      ),
    ).toBe("https://www.instagram.com/p/C8xYz12AbCd/");
  });

  it("一般網址清除 utm 與 fbclid，保留其他參數", () => {
    expect(
      canonicalUrl(
        "https://example.com/article?id=42&utm_source=ig&utm_medium=social&fbclid=xyz",
      ),
    ).toBe("https://example.com/article?id=42");
  });

  it("host 大小寫混雜轉小寫、去尾端斜線", () => {
    expect(canonicalUrl("https://Example.COM/Article/")).toBe(
      "https://example.com/Article",
    );
  });

  it("根目錄網址去掉自動補的尾斜線", () => {
    expect(canonicalUrl("https://example.com")).toBe("https://example.com");
  });

  it("移除 hash fragment", () => {
    expect(canonicalUrl("https://example.com/post#section-2")).toBe(
      "https://example.com/post",
    );
  });

  it("同一支 YT 影片的三種網址收斂成同一個 canonical", () => {
    const a = canonicalUrl("https://youtu.be/dQw4w9WgXcQ");
    const b = canonicalUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10");
    const c = canonicalUrl("https://m.youtube.com/shorts/dQw4w9WgXcQ");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("解析不了的字串原樣回傳", () => {
    expect(canonicalUrl("not a url")).toBe("not a url");
  });
});
