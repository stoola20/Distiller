import { describe, expect, it } from "vitest";
import { detectSource } from "../src/utils/source-detect";

describe("detectSource", () => {
  it.each([
    ["https://youtu.be/abc", "yt"],
    ["https://www.youtube.com/watch?v=abc", "yt"],
    ["https://m.youtube.com/shorts/abc", "yt"],
    ["https://www.instagram.com/p/abc/", "ig"],
    ["https://instagram.com/reel/abc/", "ig"],
    ["https://www.facebook.com/somepost", "fb"],
    ["https://fb.watch/xyz/", "fb"],
    ["https://example.com/article", "web"],
    ["https://myyoutube.company.com/x", "web"],
    ["not a url", "web"],
  ])("%s → %s", (url, expected) => {
    expect(detectSource(url)).toBe(expected);
  });
});
