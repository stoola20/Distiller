# Cloudflare Worker Hello World — Design Spec

Date: 2026-03-18

## 目標

建立最簡 Cloudflare Worker，部署後能用 curl 打到 `https://<worker>.workers.dev/` 拿到 JSON 回應，確認帳號與部署流程通暢。這是 Sprint 1 的第一步，驗證環境後再接 Supabase 與 Claude API。

## 技術選擇

- **Runtime**：Cloudflare Workers（TypeScript）
- **框架**：Hono（輕量 router，與 CLAUDE.md 技術棧一致）
- **套件管理**：npm
- **CLI**：wrangler

## 專案結構

```
cloudflare/
├── wrangler.toml       # Worker 設定（name、compatibility_date）
├── package.json
├── tsconfig.json
└── src/
    └── index.ts        # 單一入口，一個 GET / 路由
```

## API 設計

```
GET /
→ 200 { "success": true, "message": "Distiller API is alive" }
```

## 驗收條件

1. `wrangler` CLI 安裝成功
2. `wrangler login` 授權 Cloudflare 帳號成功
3. `wrangler deploy` 成功，拿到 `*.workers.dev` URL
4. `curl https://<worker>.workers.dev/` 回傳 `{"success":true,"message":"Distiller API is alive"}`

## 不在此範圍內

- Supabase 連線
- Claude API 呼叫
- 任何業務邏輯 endpoint
- 環境變數設定
