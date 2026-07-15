# 2026-07-15 — good-techstack 聊天室重構

## Added

- TanStack Start + Rsbuild 響應式聊天室介面。
- 一鍵建立 10 碼隨機、不重複房號。
- 已知房號驗證與加入流程。
- Hono/oRPC contract-first 房間與訊息 API。
- D1/Drizzle 房間、訊息 schema 與 migration。
- Durable Objects WebSocket Hibernation 即時廣播。
- 房號產生、碰撞重試與 Zod 契約測試。
- GitHub Actions 安裝、測試、型別、lint、建置流程。

## Changed

- 從原本單頁 Vite/Firebase 範例遷移成 good-techstack monorepo 架構。
- 本機與 CI 套件工作流改用 npm workspaces，避免特定 Windows CPU/應用程式控制政策造成的 Bun 原生執行問題。

## Security

- 房號只由後端安全亂數產生，資料庫唯一主鍵阻止重複。
- 所有房號、暱稱與訊息皆由共享 Zod schema 驗證。
- 房間不存在時拒絕 WebSocket 與訊息寫入。
