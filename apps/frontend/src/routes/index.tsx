import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { roomCodeSchema } from "@talk/shared";
import { api, errorMessage } from "../api";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate();
  const [roomCode, setRoomCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  async function createRoom() {
    setCreating(true);
    setError("");
    try {
      const room = await api.rooms.create({});
      await navigate({ to: "/rooms/$code", params: { code: room.code } });
    } catch (cause) {
      setError(errorMessage(cause, "建立房間失敗，請稍後再試。"));
    } finally {
      setCreating(false);
    }
  }

  async function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const parsed = roomCodeSchema.safeParse(roomCode);
    if (!parsed.success) {
      setError("請輸入正確的 10 碼房號。");
      return;
    }

    setJoining(true);
    try {
      const room = await api.rooms.get({ code: parsed.data });
      if (!room) {
        setError("找不到這個房間。請確認房號，或建立一個新房間。");
        return;
      }
      await navigate({ to: "/rooms/$code", params: { code: room.code } });
    } catch (cause) {
      setError(errorMessage(cause, "暫時無法加入房間，請稍後再試。"));
    } finally {
      setJoining(false);
    }
  }

  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="主要導覽">
        <a className="brand" href="/" aria-label="TalkRoom 首頁">
          <span className="brand-mark">T</span>
          <span>TalkRoom</span>
        </a>
        <span className="nav-note">私人房號 · 即時對話</span>
      </nav>

      <section className="hero-grid">
        <div className="hero-copy">
          <p className="eyebrow"><span /> 不必註冊，點一下就能聊</p>
          <h1>房間不用想，<br /><em>我們替你產生。</em></h1>
          <p className="hero-lead">
            建立按鈕會自動產生不重複的 10 碼房號。把房號或邀請連結分享給朋友，就能立即加入同一個聊天室。
          </p>
          <div className="trust-row" aria-label="產品特點">
            <span>安全亂碼</span><i />
            <span>即時同步</span><i />
            <span>不用帳號</span>
          </div>
        </div>

        <div className="entry-card">
          <div className="entry-card-head">
            <span className="status-dot" />
            <span>準備開始</span>
          </div>

          <button className="create-room-button" type="button" onClick={createRoom} disabled={creating || joining}>
            <span className="button-icon">＋</span>
            <span>
              <strong>{creating ? "正在建立…" : "建立新房間"}</strong>
              <small>自動產生唯一亂碼房號</small>
            </span>
            <span className="arrow">→</span>
          </button>

          <div className="or-divider"><span>或加入知道的房間</span></div>

          <form className="join-form" onSubmit={joinRoom}>
            <label htmlFor="room-code">輸入房號</label>
            <div className="join-control">
              <input
                id="room-code"
                value={roomCode}
                onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/\s/g, "").slice(0, 10))}
                placeholder="例如：7KMD2QX9WA"
                autoComplete="off"
                spellCheck={false}
                aria-describedby={error ? "entry-error" : undefined}
              />
              <button type="submit" disabled={creating || joining}>{joining ? "確認中…" : "加入"}</button>
            </div>
          </form>

          {error ? <p className="form-error" id="entry-error" role="alert">{error}</p> : null}
          <p className="privacy-note">只有知道房號的人才能進入房間</p>
        </div>
      </section>

      <footer className="landing-footer">
        <span>TalkRoom</span>
        <span>Built for quiet conversations.</span>
      </footer>
    </main>
  );
}
