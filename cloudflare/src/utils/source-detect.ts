import type { SourceType } from "../types";

// URL → 來源類型判斷
export function detectSource(raw: string): SourceType {
  let host: string;
  try {
    host = new URL(raw.trim()).hostname.toLowerCase();
  } catch {
    return "web";
  }
  if (host === "youtu.be" || host.endsWith("youtube.com")) return "yt";
  if (host.endsWith("instagram.com")) return "ig";
  if (host.endsWith("facebook.com") || host === "fb.watch" || host === "fb.com")
    return "fb";
  return "web";
}
