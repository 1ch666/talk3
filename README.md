# TalkRoom

一個可直接建立私人聊天室、也可用已知房號加入的即時聊天網站。

## 功能

- 點擊「建立新房間」後，由後端自動產生 10 碼隨機房號。
- 房號使用不易混淆的 32 字元集合，並由 D1 主鍵唯一約束防止重複；碰撞時會自動重試。
- 可輸入已知房號，確認房間存在後直接加入。
- Durable Objects + WebSocket 即時同步訊息，D1 永久保存房間與歷史訊息。
- 手機與桌面皆可使用，可複製房號或完整邀請連結。

## 技術架構

- Frontend: React 19、TanStack Start/Router、Rsbuild
- API: Hono、oRPC contract-first、Zod
- Data: Cloudflare D1、Drizzle ORM
- Realtime: Cloudflare Durable Objects WebSocket Hibernation
- Tooling: npm workspaces、TypeScript、oxlint、Node test runner

## 本機安裝

需要 Node.js 22 以上版本。

```bash
npm install
npm run migrate -w @talk/backend -- --local
npm run dev
```

前端預設為 `http://localhost:3000`，後端由 Wrangler 啟動；前端會代理 `/rpc` 與 `/api` 到後端。

## 驗證

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Cloudflare 部署前設定

1. 建立 D1 database，將 `apps/backend/wrangler.toml` 的 `database_id` 換成實際 ID。
2. 套用 migration：`npm run migrate -w @talk/backend`。
3. 設定 `BETTER_AUTH_URL` 與 `BETTER_AUTH_SECRET`；正式 secret 請使用 Wrangler secret，不要提交到 Git。
4. 執行 `npm run deploy -w @talk/backend`，並依你的靜態網站平台部署前端產物。

## 房號設計

房號格式為 10 碼 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`。排除 `0/1/I/O` 可降低人工輸入錯誤。亂數在後端以 Web Crypto 產生，D1 的 `rooms.code` 主鍵是最終唯一性保證。
