import { ChevronLeft, Ellipsis, Flag, MapPinned, MessageCircle, Send, ShieldBan, Siren, UserX } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errorMessage, invalidate, setCached, useApi } from "../api/client";
import { Avatar, Button, Empty, Input, LinkButton, Menu, Modal, Spinner, Verified } from "../components/ui";
import { onLive, useAuth } from "../context/AuthContext";
import { useToast } from "../context/ui";
import { activeLabel, ago, fmtDayLong, fmtTime } from "../lib/format";
import type { Message, Thread } from "../types";
import { ReportModal } from "./ListingDetail";

type ThreadData = { matchId: string; active: boolean; user: Thread["user"]; items: Message[] };

export default function Messages() {
  const { matchId } = useParams();
  const { me } = useAuth();
  const threads = useApi<{ items: Thread[] }>(me ? "/messages/threads" : null, { staleMs: 10_000 });
  useEffect(() => {
    const offs = [onLive("message", () => void threads.reload()), onLive("match", () => void threads.reload()), onLive("unmatch", () => void threads.reload())];
    return () => offs.forEach((o) => o());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!me) return null;

  return (
    <div className={`inbox ${matchId ? "has-thread" : ""}`}>
      <aside className="inbox-list">
        <div className="row between" style={{ padding: "10px 10px 14px" }}>
          <h1 className="h-1">Messages</h1>
        </div>
        {threads.loading ? (
          <div className="row" style={{ justifyContent: "center", padding: 24 }}>
            <Spinner />
          </div>
        ) : (threads.data?.items.length ?? 0) === 0 ? (
          <div style={{ padding: "8px 10px" }}>
            <p className="small muted">When you and another member like each other, your conversation appears here.</p>
            <LinkButton to="/connect" size="sm" className="mt-12">
              Go to Connect
            </LinkButton>
          </div>
        ) : (
          threads.data!.items.map((t) => (
            <Link key={t.matchId} to={`/messages/${t.matchId}`} className={`thread-row ${t.matchId === matchId ? "active" : ""}`}>
              <span className={t.user.online ? "presence" : ""}>
                <Avatar name={t.user.name} src={t.user.photoUrl} size={48} />
              </span>
              <span className="grow stack g-4">
                <span className="row between g-8">
                  <span className="strong row g-4">
                    {t.user.name} {t.user.verified && <Verified />}
                  </span>
                  <span className="tiny muted nowrap">{ago(t.last?.createdAt ?? t.createdAt)}</span>
                </span>
                <span className="row between g-8">
                  <span className={`small ${t.unread ? "" : "muted"}`} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.last ? `${t.last.senderId === me.id ? "You: " : ""}${t.last.content}` : "New match. Say hello."}
                  </span>
                  {t.unread > 0 && <span className="unread-pill">{t.unread}</span>}
                </span>
              </span>
            </Link>
          ))
        )}
      </aside>
      <section className="chat-pane" style={{ minHeight: 0 }}>
        {matchId ? (
          <Chat key={matchId} matchId={matchId} onActivity={() => void threads.reload()} />
        ) : (
          <div className="row" style={{ height: "100%", justifyContent: "center" }}>
            <Empty icon={<MessageCircle />} title="Choose a conversation" />
          </div>
        )}
      </section>
    </div>
  );
}

function Chat({ matchId, onActivity }: { matchId: string; onActivity: () => void }) {
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const key = `/messages/${matchId}`;
  const { data, loading, error } = useApi<ThreadData>(key, { staleMs: 0 });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [report, setReport] = useState(false);
  const [checkin, setCheckin] = useState(false);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.items.length]);

  useEffect(() => {
    const offMsg = onLive("message", (e: { matchId: string; message: Message }) => {
      if (e.matchId !== matchId) return;
      setCached<ThreadData>(key, (d) => (d && !d.items.some((m) => m.id === e.message.id) ? { ...d, items: [...d.items, e.message] } : d));
      void api.post(`/messages/${matchId}/read`).catch(() => {});
    });
    const offRead = onLive("read", (e: { matchId: string; ids: string[] }) => {
      if (e.matchId !== matchId) return;
      setCached<ThreadData>(key, (d) => d && { ...d, items: d.items.map((m) => (e.ids.includes(m.id) ? { ...m, isRead: true } : m)) });
    });
    return () => {
      offMsg();
      offRead();
    };
  }, [matchId, key]);

  useLayoutEffect(() => {
    body.current?.scrollTo({ top: body.current.scrollHeight, behavior: data && data.items.length > 0 ? "smooth" : "auto" });
  }, [data?.items.length]);

  const send = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const r = await api.post<{ message: Message }>(`/messages/${matchId}`, { content });
      setCached<ThreadData>(key, (d) => d && { ...d, items: [...d.items, r.data.message] });
      setText("");
      onActivity();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSending(false);
    }
  };

  const unmatch = async () => {
    if (!confirm(`Unmatch ${data?.user.name}? The conversation ends for both of you.`)) return;
    await api.delete(`/connect/matches/${matchId}`);
    void invalidate("/messages", "/connect");
    nav("/messages");
  };
  const block = async () => {
    if (!data || !confirm(`Block ${data.user.name}? You won't see each other in Connect.`)) return;
    await api.post(`/safety/block/${data.user.id}`);
    toast(`${data.user.name} is blocked`, "ok");
    void invalidate("/messages", "/connect");
    nav("/messages");
  };
  const sos = async () => {
    if (!confirm("Send an SOS? Your trusted contact gets a text with your location, and the Konnect safety team is alerted.")) return;
    const send = async (pos?: GeolocationPosition) => {
      try {
        const r = await api.post<{ notifiedContact: boolean; safetyPhone: string | null }>("/safety/sos", { withUserId: data?.user.id, lat: pos?.coords.latitude, lng: pos?.coords.longitude });
        toast(r.data.notifiedContact ? "SOS sent to your trusted contact and the safety team" : "SOS sent to the safety team. Add a trusted contact in Account › Safety.", "ok");
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    };
    if ("geolocation" in navigator) navigator.geolocation.getCurrentPosition((p) => void send(p), () => void send(), { timeout: 6000 });
    else await send();
  };

  if (loading)
    return (
      <div className="row" style={{ height: "100%", justifyContent: "center" }}>
        <Spinner />
      </div>
    );
  if (error || !data) return <Empty title="Conversation not found" action={<LinkButton to="/messages">Back</LinkButton>} />;

  let lastDay = "";
  return (
    <div className="chat">
      <div className="chat-head">
        <Link to="/messages" className="icon-btn hide-desktop" aria-label="Back">
          <ChevronLeft />
        </Link>
        <Link to={`/connect/${data.user.id}`} className="row g-12 grow" style={{ minWidth: 0 }}>
          <span className={data.user.online ? "presence" : ""}>
            <Avatar name={data.user.name} src={data.user.photoUrl} size={40} />
          </span>
          <span className="stack">
            <span className="strong row g-4">
              {data.user.name} {data.user.verified && <Verified />}
            </span>
            <span className="tiny muted">{data.user.online ? "Online" : activeLabel(data.user.lastSeen)}</span>
          </span>
        </Link>
        <button className="icon-btn" onClick={() => setCheckin(true)} title="Share a meetup with your trusted contact" aria-label="Share meetup">
          <MapPinned />
        </button>
        <Menu
          trigger={(_, t) => (
            <button className="icon-btn" onClick={t} aria-label="More">
              <Ellipsis />
            </button>
          )}
        >
          {(close) => (
            <>
              <button
                onClick={() => {
                  close();
                  setCheckin(true);
                }}
              >
                <MapPinned /> Share a meetup
              </button>
              <button
                onClick={() => {
                  close();
                  void sos();
                }}
              >
                <Siren /> SOS
              </button>
              <hr />
              <button
                onClick={() => {
                  close();
                  setReport(true);
                }}
              >
                <Flag /> Report
              </button>
              <button
                onClick={() => {
                  close();
                  void unmatch();
                }}
              >
                <UserX /> Unmatch
              </button>
              <button
                className="danger"
                onClick={() => {
                  close();
                  void block();
                }}
              >
                <ShieldBan /> Block
              </button>
            </>
          )}
        </Menu>
      </div>
      <div className="chat-body" ref={body}>
        {data.items.length === 0 && (
          <div className="empty">
            <Avatar name={data.user.name} src={data.user.photoUrl} size={72} />
            <div className="h-2">You and {data.user.name} like each other</div>
            <p>Say hello. Meet somewhere public the first time, and use “Share a meetup” to let someone you trust know where you'll be.</p>
          </div>
        )}
        {data.items.map((m, k) => {
          const day = new Date(new Date(m.createdAt).getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
          const showDay = day !== lastDay;
          lastDay = day;
          const mine = m.senderId === me?.id;
          const next = data.items[k + 1];
          const showMeta = !next || next.senderId !== m.senderId || new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() > 5 * 60_000;
          return (
            <div key={m.id} className="stack">
              {showDay && <div className="chat-day">{fmtDayLong(day)}</div>}
              <div className={`bubble ${mine ? "me" : "them"}`}>{m.content}</div>
              {showMeta && (
                <div className={`bubble-meta ${mine ? "me" : ""}`}>
                  {fmtTime(m.createdAt)}
                  {mine && k === data.items.length - 1 ? (m.isRead ? " · Read" : " · Sent") : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {data.active ? (
        <div className="chat-compose">
          <textarea
            value={text}
            rows={1}
            placeholder={`Message ${data.user.name}`}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className="send" onClick={send} disabled={!text.trim() || sending} aria-label="Send">
            {sending ? <span className="spinner" /> : <Send />}
          </button>
        </div>
      ) : (
        <div className="chat-compose">
          <p className="small muted">This conversation has ended.</p>
        </div>
      )}
      <ReportModal open={report} onClose={() => setReport(false)} target={{ targetUserId: data.user.id }} />
      <CheckinModal open={checkin} onClose={() => setCheckin(false)} withUserId={data.user.id} name={data.user.name} />
    </div>
  );
}

function CheckinModal({ open, onClose, withUserId, name }: { open: boolean; onClose: () => void; withUserId: string; name: string }) {
  const { me } = useAuth();
  const toast = useToast();
  const [place, setPlace] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const share = async () => {
    setBusy(true);
    try {
      const meetAt = new Date(`${when}:00+03:00`).toISOString();
      const r = await api.post<{ notifiedContact: boolean }>("/safety/checkin", { withUserId, place, meetAt });
      toast(r.data.notifiedContact ? `Sent to ${me?.trustedContact?.name}` : "Saved. Text delivery isn't switched on yet, so your contact wasn't messaged.", "ok");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Share a meetup">
      {!me?.trustedContact ? (
        <div className="stack g-16">
          <p className="soft">Add a trusted contact first. They'll get a text with where you're meeting {name} and when.</p>
          <LinkButton to="/account/safety" variant="ink">
            Add a trusted contact
          </LinkButton>
        </div>
      ) : (
        <div className="stack g-16">
          <p className="soft">
            {me.trustedContact.name} will get a text with where and when you're meeting {name}.
          </p>
          <Input label="Where" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Café, restaurant or venue" />
          <Input label="When" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <Button variant="primary" block loading={busy} disabled={place.trim().length < 2 || !when} onClick={share}>
            Send to {me.trustedContact.name}
          </Button>
        </div>
      )}
    </Modal>
  );
}
