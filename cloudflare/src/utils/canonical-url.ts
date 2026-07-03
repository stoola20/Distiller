// URL 正規化——去重的地基，規則見 docs/design/pipeline-decisions.md 第 2 節

const TRACKING_PARAMS = new Set([
  "fbclid",
  "igsh",
  "igshid",
  "si",
  "feature",
  "ref",
]);

const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);
const IG_HOSTS = new Set(["instagram.com", "www.instagram.com"]);

function extractYoutubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1];
    return id || null;
  }
  if (!YT_HOSTS.has(host)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.pathname === "/watch") return url.searchParams.get("v");
  if (["shorts", "live", "embed"].includes(parts[0]) && parts[1])
    return parts[1];
  return null;
}

function extractInstagramShortcode(url: URL): string | null {
  if (!IG_HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (["p", "reel", "tv"].includes(parts[0]) && parts[1]) return parts[1];
  return null;
}

export function canonicalUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    // 解析不了就原樣回傳，讓上層決定要不要拒收
    return raw.trim();
  }

  // 平台特例優先：YouTube 與 Instagram 各自收斂成單一形式
  const ytId = extractYoutubeId(url);
  if (ytId) return `https://www.youtube.com/watch?v=${ytId}`;

  const igCode = extractInstagramShortcode(url);
  if (igCode) return `https://www.instagram.com/p/${igCode}/`;

  // 一般網址：host 小寫、清追蹤參數、去尾端斜線
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  const toDelete: string[] = [];
  url.searchParams.forEach((_, key) => {
    if (TRACKING_PARAMS.has(key) || key.startsWith("utm_")) toDelete.push(key);
  });
  for (const key of toDelete) url.searchParams.delete(key);

  let result = url.toString();
  if (url.pathname !== "/" && result.endsWith("/"))
    result = result.slice(0, -1);
  // path 是根目錄且沒有 query 時，去掉 URL() 自動補的尾斜線
  if (url.pathname === "/" && !url.search && result.endsWith("/"))
    result = result.slice(0, -1);
  return result;
}
