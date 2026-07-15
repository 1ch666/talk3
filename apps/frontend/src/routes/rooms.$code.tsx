import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  displayNameSchema,
  socketServerEventSchema,
  type ChatMessage,
} from "@talk/shared";
import { api, errorMessage } from "../api";

export const Route = createFileRoute("/rooms/$code")({ component: RoomPage });

function makeGuestName(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return `訪客-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function RoomPage() {
  const { code } = Route.useParams();
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [name, setName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [text, setText] = useState("");
  const [connection, setConnection] = useState<"connecting" | "online" | "offline">("connecting");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"code" | "link" | "">("");
  const socketRef = useRef<WebSocket | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("talkroom-display-name")?.trim();
    const nextName = displayNameSchema.safeParse(stored).success ? stored! : makeGuestName();
    setName(nextName);
    setNameDraft(nextName);
    localStorage.setItem("talkroom-display-name", nextName);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadRoom() {
      try {
        const room = await api.rooms.get({ code });
        if (cancelled) return;
        if (!room) {
          setStatus("missing");
          return;
        }
        const history = await api.rooms.listMessages({ roomCode: room.code, limit: 100 });
        if (!cancelled) {
          setMessages(history);
          setStatus("ready");
        }
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause, "讀取房間失敗。"));
      }
    }
    void loadRoom();
    return () => { cancelled = true; };
  }, [code]);

  useEffect(() => {
    if (status !== "ready" || !name) return;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      if (disposed) return;
      setConnection("connecting");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}/api/rooms/${code}/socket?name=${encodeURIComponent(name)}`;
      const socket = new WebSocket(url);
      socketRef.current = socket;
      socket.onopen = () => setConnection("online");
      socket.onmessage = (event) => {
        let payload: unknown;
        try {
          payload = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const parsed = socketServerEventSchema.safeParse(payload);
        if (!parsed.success) return;
        if (parsed.data.type === "error") {
          setError(parsed.data.message);
          return;
        }
        const message = parsed.data.message;
        setMessages((current) => current.some((item) => item.id === message.id)
          ? current
          : [...current, message]);
      };
      socket.onerror = () => setConnection("offline");
      socket.onclose = () => {
        if (disposed) return;
        setConnection("offline");
        reconnectTimer = setTimeout(connect, 1_500);
      };
    }

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close(1000, "page changed");
      socketRef.current = null;
    };
  }, [code, name, status]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !name) return;
    setText("");
    setError("");
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "message", text: trimmed }));
      return;
    }
    try {
      const message = await api.rooms.sendMessage({ roomCode: code, senderName: name, text: trimmed });
      setMessages((current) => [...current, message]);
    } catch (cause) {
      setText(trimmed);
      setError(errorMessage(cause, "訊息傳送失敗。"));
    }
  }

  function applyName() {
    const parsed = displayNameSchema.safeParse(nameDraft);
    if (!parsed.success) {
      setError("暱稱需為 1 到 24 個字。");
      return;
    }
    setName(parsed.data);
    localStorage.setItem("talkroom-display-name", parsed.data);
    setError("");
  }

  async function copy(value: string, kind: "code" | "link") {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    setTimeout(() => setCopied(""), 1_500);
  }

  if (status === "loading") return <main className="state-page"><div className="loader" /><p>正在打開房間…</p></main>;
  if (status === "missing") {
    return (
      <main className="state-page">
        <p className="eyebrow"><span /> 房間不存在</p>
        <h1>這組房號找不到房間</h1>
        <p>請回首頁確認房號，或建立一個新的聊天室。</p>
        <Link className="home-link" to="/">返回首頁</Link>
      </main>
    );
  }

  return (
    <main className="chat-shell">
      <aside className="chat-sidebar">
        <Link className="brand brand-light" to="/"><span className="brand-mark">T</span><span>TalkRoom</span></Link>
        <div className="room-label">目前房間</div>
        <div className="room-code-display">{code}</div>
        <div className="share-actions">
          <button type="button" onClick={() => copy(code, "code")}>{copied === "code" ? "已複製" : "複製房號"}</button>
          <button type="button" onClick={() => copy(window.location.href, "link")}>{copied === "link" ? "已複製" : "複製邀請連結"}</button>
        </div>
        <div className="name-editor">
          <label htmlFor="display-name">你的暱稱</label>
          <div><input id="display-name" value={nameDraft} maxLength={24} onChange={(event) => setNameDraft(event.target.value)} /><button type="button" onClick={applyName}>套用</button></div>
        </div>
        <div className="sidebar-spacer" />
        <div className={`connection-pill ${connection}`}><span />{connection === "online" ? "即時連線中" : connection === "connecting" ? "正在連線" : "重新連線中"}</div>
        <Link className="leave-link" to="/">← 離開房間</Link>
      </aside>

      <section className="chat-main">
        <header className="chat-header">
          <div><p>房間 {code}</p><h1>大家的對話</h1></div>
          <span className="mobile-code">{code}</span>
        </header>
        <div className="message-thread" ref={threadRef} aria-live="polite">
          {messages.length === 0 ? (
            <div className="empty-thread"><span>✦</span><h2>房間已準備好</h2><p>傳送第一則訊息，或把邀請連結分享給朋友。</p></div>
          ) : messages.map((message) => {
            const mine = message.senderName === name;
            return (
              <article className={`message-row ${mine ? "mine" : "other"}`} key={message.id}>
                <div className="message-author">{mine ? "你" : message.senderName}</div>
                <div className="message-bubble">{message.text}</div>
                <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</time>
              </article>
            );
          })}
        </div>
        {error ? <div className="chat-error" role="alert">{error}<button type="button" onClick={() => setError("")}>×</button></div> : null}
        <form className="message-composer" onSubmit={sendMessage}>
          <input value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} placeholder="輸入訊息…" aria-label="訊息" />
          <button type="submit" disabled={!text.trim()} aria-label="傳送訊息">→</button>
        </form>
      </section>
    </main>
  );
}
