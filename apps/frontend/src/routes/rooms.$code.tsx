import { createFileRoute, Link } from "@tanstack/react-router";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  displayNameSchema,
  messageSchema,
  socketServerEventSchema,
  type ChatMessage,
} from "@talk/shared";
import { api, errorMessage } from "../api";

export const Route = createFileRoute("/rooms/$code")({ component: RoomPage });

type RoomIdentity = { id: string; key: string };
type SelectedImage = { file: File; previewUrl: string };

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

function roomIdentity(code: string): RoomIdentity {
  const storageKey = `talkroom-owner-${code}`;
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Partial<RoomIdentity> | null;
    if (stored?.id && stored.key?.match(/^[a-f0-9]{64}$/i)) return { id: stored.id, key: stored.key };
  } catch { /* create a fresh identity */ }
  const identity = { id: crypto.randomUUID(), key: randomHex(32) };
  localStorage.setItem(storageKey, JSON.stringify(identity));
  return identity;
}

function makeGuestName(): string {
  return `訪客-${randomHex(2).toUpperCase()}`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function prepareImage(file: File): Promise<File> {
  if (!IMAGE_MIME_TYPES.includes(file.type as (typeof IMAGE_MIME_TYPES)[number])) throw new Error("只支援 JPEG、PNG、WebP 圖片");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("圖片不可超過 5MB");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("瀏覽器無法處理圖片");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error("圖片處理失敗")),
      file.type,
      file.type === "image/png" ? undefined : 0.85,
    ));
    if (blob.size > MAX_IMAGE_BYTES) throw new Error("處理後的圖片仍超過 5MB");
    return new File([blob], file.name, { type: file.type, lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

function RoomPage() {
  const { code } = Route.useParams();
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [identity, setIdentity] = useState<RoomIdentity | null>(null);
  const [name, setName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [text, setText] = useState("");
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<ChatMessage | null>(null);
  const [highlightedId, setHighlightedId] = useState("");
  const [connection, setConnection] = useState<"connecting" | "online" | "offline">("connecting");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"code" | "link" | "">("");
  const socketRef = useRef<WebSocket | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("talkroom-display-name")?.trim();
    const nextName = displayNameSchema.safeParse(stored).success ? stored! : makeGuestName();
    setName(nextName);
    setNameDraft(nextName);
    setIdentity(roomIdentity(code));
    localStorage.setItem("talkroom-display-name", nextName);
  }, [code]);

  useEffect(() => () => { if (selectedImage) URL.revokeObjectURL(selectedImage.previewUrl); }, [selectedImage]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const room = await api.rooms.get({ code });
        if (cancelled) return;
        if (!room) return setStatus("missing");
        const history = await api.rooms.listMessages({ roomCode: room.code, limit: 100 });
        if (!cancelled) { setMessages(history); setStatus("ready"); }
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause, "無法讀取聊天室"));
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  useEffect(() => {
    if (status !== "ready" || !name) return;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectDelay = 1_000;
    function connect() {
      if (disposed) return;
      setConnection("connecting");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/rooms/${code}/socket?name=${encodeURIComponent(name)}`);
      socketRef.current = socket;
      socket.onopen = () => { reconnectDelay = 1_000; setConnection("online"); };
      socket.onmessage = (event) => {
        let payload: unknown;
        try { payload = JSON.parse(String(event.data)); } catch { return; }
        const parsed = socketServerEventSchema.safeParse(payload);
        if (!parsed.success) return;
        if (parsed.data.type === "error") return setError(parsed.data.message);
        const incoming = parsed.data.message;
        setMessages((current) => {
          const next = current.some((item) => item.id === incoming.id)
            ? current.map((item) => item.id === incoming.id ? incoming : item)
            : [...current, incoming];
          if (parsed.data.type !== "message_updated") return next;
          return next.map((item) => item.replyTo?.id === incoming.id
            ? { ...item, replyTo: { ...item.replyTo, text: "", hasImage: false, recalled: true } }
            : item);
        });
      };
      socket.onerror = () => setConnection("offline");
      socket.onclose = () => {
        if (disposed) return;
        setConnection("offline");
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
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

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }); }, [messages.length]);

  useEffect(() => {
    if (!actionMessage) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setActionMessage(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [actionMessage]);

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const processed = await prepareImage(file);
      setSelectedImage({ file: processed, previewUrl: URL.createObjectURL(processed) });
    } catch (cause) {
      setError(errorMessage(cause, "圖片處理失敗"));
    } finally { setBusy(false); }
  }

  function clearSelectedImage() {
    if (selectedImage) URL.revokeObjectURL(selectedImage.previewUrl);
    setSelectedImage(null);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if ((!trimmed && !selectedImage) || !name || !identity || busy) return;
    setBusy(true);
    setError("");
    try {
      if (selectedImage) {
        const form = new FormData();
        form.set("file", selectedImage.file);
        form.set("senderName", name);
        form.set("senderId", identity.id);
        form.set("senderKey", identity.key);
        form.set("text", trimmed);
        if (replyingTo) form.set("replyToMessageId", replyingTo.id);
        const response = await fetch(`/api/rooms/${code}/images`, { method: "POST", body: form }).catch(() => {
          throw new Error("暫時無法上傳");
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message = payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "暫時無法上傳";
          throw new Error(message);
        }
        const message = messageSchema.parse(payload);
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
        clearSelectedImage();
      } else {
        const input = {
          roomCode: code,
          senderName: name,
          senderId: identity.id,
          senderKey: identity.key,
          text: trimmed,
          replyToMessageId: replyingTo?.id ?? null,
        };
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "message", ...input }));
        } else {
          const message = await api.rooms.sendMessage(input);
          setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
        }
      }
      setText("");
      setReplyingTo(null);
    } catch (cause) {
      setError(errorMessage(cause, "訊息傳送失敗"));
    } finally { setBusy(false); }
  }

  async function recallMessage(message: ChatMessage) {
    if (!identity || message.senderId !== identity.id || message.recalledAt) return;
    setActionMessage(null);
    setError("");
    const input = { roomCode: code, messageId: message.id, senderId: identity.id, senderKey: identity.key };
    try {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "recall", ...input }));
      else {
        const updated = await api.rooms.recallMessage(input);
        setMessages((current) => current.map((item) => item.id === updated.id ? updated : item));
      }
    } catch (cause) { setError(errorMessage(cause, "訊息收回失敗")); }
  }

  function beginPress(event: ReactPointerEvent, message: ChatMessage) {
    if (message.recalledAt) return;
    pressStartRef.current = { x: event.clientX, y: event.clientY };
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => { setActionMessage(message); pressTimerRef.current = null; }, 500);
  }

  function movePress(event: ReactPointerEvent) {
    const start = pressStartRef.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancelPress();
  }

  function cancelPress() {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = null;
    pressStartRef.current = null;
  }

  function scrollToMessage(messageId: string) {
    document.getElementById(`message-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(messageId);
    setTimeout(() => setHighlightedId(""), 1_500);
  }

  function applyName() {
    const parsed = displayNameSchema.safeParse(nameDraft);
    if (!parsed.success) return setError("暱稱需要 1 到 24 個字");
    setName(parsed.data);
    localStorage.setItem("talkroom-display-name", parsed.data);
    setError("");
  }

  async function copy(value: string, kind: "code" | "link") {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    setTimeout(() => setCopied(""), 1_500);
  }

  if (status === "loading") return <main className="state-page"><div className="loader" /><p>正在開啟聊天室…</p></main>;
  if (status === "missing") return <main className="state-page"><h1>找不到這個聊天室</h1><p>房間可能已關閉，請建立新的聊天室。</p><Link className="home-link" to="/">回到首頁</Link></main>;

  return (
    <main className="chat-shell">
      <aside className="chat-sidebar">
        <Link className="brand brand-light" to="/"><span className="brand-mark">T</span><span>TalkRoom</span></Link>
        <div className="room-label">聊天室房號</div><div className="room-code-display">{code}</div>
        <div className="share-actions">
          <button type="button" onClick={() => copy(code, "code")}>{copied === "code" ? "已複製" : "複製房號"}</button>
          <button type="button" onClick={() => copy(window.location.href, "link")}>{copied === "link" ? "已複製" : "複製邀請連結"}</button>
        </div>
        <div className="name-editor"><label htmlFor="display-name">你的暱稱</label><div><input id="display-name" value={nameDraft} maxLength={24} onChange={(event) => setNameDraft(event.target.value)} /><button type="button" onClick={applyName}>套用</button></div></div>
        <div className="sidebar-spacer" />
        <div className={`connection-pill ${connection}`}><span />{connection === "online" ? "即時連線中" : connection === "connecting" ? "正在連線" : "連線中斷"}</div>
        <Link className="leave-link" to="/">離開聊天室</Link>
      </aside>

      <section className="chat-main">
        <header className="chat-header"><div><p>房間 {code}</p><h1>即時聊天室</h1></div><span className="mobile-code">{code}</span></header>
        <div className="message-thread" ref={threadRef} aria-live="polite">
          {messages.length === 0 ? <div className="empty-thread"><span>✦</span><h2>聊天室還沒有訊息</h2><p>傳送第一則文字或圖片，開始聊天吧。</p></div> : messages.map((message) => {
            const mine = Boolean(identity && message.senderId === identity.id);
            return (
              <article
                id={`message-${message.id}`}
                className={`message-row ${mine ? "mine" : "other"} ${highlightedId === message.id ? "highlighted" : ""}`}
                key={message.id}
                onPointerDown={(event) => beginPress(event, message)}
                onPointerMove={movePress}
                onPointerUp={cancelPress}
                onPointerCancel={cancelPress}
                onContextMenu={(event) => { event.preventDefault(); if (!message.recalledAt) setActionMessage(message); }}
              >
                <div className="message-author">{mine ? "你" : message.senderName}</div>
                {message.recalledAt ? <div className="message-bubble recalled">此訊息已收回</div> : (
                  <div className="message-bubble">
                    {message.replyTo ? <button type="button" className="reply-quote" onClick={() => scrollToMessage(message.replyTo!.id)}><strong>{message.replyTo.senderName}</strong><span>{message.replyTo.recalled ? "原訊息已收回" : message.replyTo.text || (message.replyTo.hasImage ? "圖片" : "訊息")}</span></button> : null}
                    {message.image ? <a className="message-image-link" href={message.image.url} target="_blank" rel="noreferrer"><img className="message-image" src={message.image.url} alt={`${message.senderName} 傳送的圖片`} loading="lazy" /></a> : null}
                    {message.text ? <div className="message-text">{message.text}</div> : null}
                  </div>
                )}
                {!message.recalledAt ? <button className="message-more" type="button" aria-label="訊息操作" onClick={() => setActionMessage(message)}>⋯</button> : null}
                <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</time>
              </article>
            );
          })}
        </div>
        {error ? <div className="chat-error" role="alert">{error}<button type="button" onClick={() => setError("")}>×</button></div> : null}
        <form className="message-composer" onSubmit={sendMessage}>
          {replyingTo ? <div className="composer-reply"><div><strong>回覆 {replyingTo.senderName}</strong><span>{replyingTo.text || (replyingTo.image ? "圖片" : "訊息")}</span></div><button type="button" onClick={() => setReplyingTo(null)} aria-label="取消回覆">×</button></div> : null}
          {selectedImage ? <div className="image-preview"><img src={selectedImage.previewUrl} alt="待傳送圖片預覽" /><div><strong>{selectedImage.file.name}</strong><span>{formatBytes(selectedImage.file.size)}</span></div><button type="button" onClick={clearSelectedImage} aria-label="移除圖片">×</button></div> : null}
          <div className="composer-controls">
            <input ref={fileInputRef} className="file-input" type="file" accept={IMAGE_MIME_TYPES.join(",")} onChange={chooseImage} />
            <button className="image-picker" type="button" onClick={() => fileInputRef.current?.click()} disabled={busy} aria-label="選擇圖片">＋</button>
            <input value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} placeholder={selectedImage ? "加入圖片說明…" : "輸入訊息…"} aria-label="訊息" />
            <button className="send-button" type="submit" disabled={busy || (!text.trim() && !selectedImage)} aria-label="傳送">{busy ? "…" : "➜"}</button>
          </div>
        </form>
      </section>

      {actionMessage ? <div className="action-sheet-backdrop" onClick={() => setActionMessage(null)}><div className="action-sheet" role="dialog" aria-modal="true" aria-label="訊息操作" onClick={(event) => event.stopPropagation()}><div className="action-sheet-handle" /><button type="button" onClick={() => { setReplyingTo(actionMessage); setActionMessage(null); }}>回覆這則訊息</button>{identity && actionMessage.senderId === identity.id ? <button className="danger" type="button" onClick={() => void recallMessage(actionMessage)}>收回訊息</button> : null}<button type="button" onClick={() => setActionMessage(null)}>取消</button></div></div> : null}
    </main>
  );
}
