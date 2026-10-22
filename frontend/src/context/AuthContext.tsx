import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, invalidate, onTokenChange, tokenStore } from "../api/client";
import type { Me } from "../types";

type SignupInput = { fullName: string; email: string; phone: string; password: string; dateOfBirth: string; gender: string; referralCode?: string };

type Auth = {
  me: Me | null;
  ready: boolean;
  login: (identifier: string, password: string) => Promise<Me>;
  signup: (input: SignupInput) => Promise<Me>;
  logout: () => void;
  refresh: () => Promise<void>;
  setMe: (m: Me) => void;
  adopt: (token: string, me: Me) => void;
};

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setMe(null);
      setReady(true);
      return;
    }
    try {
      const r = await api.get<{ user: Me }>("/users/me");
      setMe(r.data.user);
    } catch {
      setMe(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onTokenChange(() => {
      if (!tokenStore.get()) setMe(null);
    });
  }, [refresh]);

  const adopt = useCallback((token: string, user: Me) => {
    tokenStore.set(token);
    setMe(user);
  }, []);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const r = await api.post<{ token: string; user: Me }>("/auth/login", { identifier, password });
      adopt(r.data.token, r.data.user);
      return r.data.user;
    },
    [adopt],
  );

  const signup = useCallback(
    async (input: SignupInput) => {
      const r = await api.post<{ token: string; user: Me }>("/auth/signup", input);
      adopt(r.data.token, r.data.user);
      return r.data.user;
    },
    [adopt],
  );

  const logout = useCallback(() => {
    tokenStore.set(null);
    setMe(null);
    void invalidate("/");
  }, []);

  const value = useMemo(() => ({ me, ready, login, signup, logout, refresh, setMe, adopt }), [me, ready, login, signup, logout, refresh, adopt]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

// ——— Live events (server-sent) ———

type Handler = (data: any) => void;
const handlers = new Map<string, Set<Handler>>();
export function onLive(event: string, fn: Handler) {
  let s = handlers.get(event);
  if (!s) handlers.set(event, (s = new Set()));
  s.add(fn);
  return () => {
    s!.delete(fn);
  };
}
const dispatch = (event: string, data: unknown) => handlers.get(event)?.forEach((h) => h(data));

/** Keeps one event stream open while signed in, reconnecting with a fresh ticket after drops. */
export function LiveEvents() {
  const { me, refresh } = useAuth();
  const id = me?.id;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!id) return;
    let es: EventSource | null = null;
    let stopped = false;
    let delay = 2000;
    let timer: ReturnType<typeof setTimeout>;
    const open = async () => {
      try {
        const r = await api.post<{ ticket: string }>("/notifications/stream-ticket");
        if (stopped) return;
        es = new EventSource(`/api/notifications/stream?ticket=${encodeURIComponent(r.data.ticket)}`);
        es.onopen = () => (delay = 2000);
        for (const ev of ["notification", "message", "match", "payment", "read", "unmatch"]) {
          es.addEventListener(ev, (m) => {
            const data = JSON.parse((m as MessageEvent).data);
            dispatch(ev, data);
            if (ev === "notification" || ev === "message" || ev === "match") void refreshRef.current();
          });
        }
        es.onerror = () => {
          es?.close();
          if (!stopped) timer = setTimeout(open, (delay = Math.min(delay * 2, 30_000)));
        };
      } catch {
        if (!stopped) timer = setTimeout(open, (delay = Math.min(delay * 2, 30_000)));
      }
    };
    void open();
    return () => {
      stopped = true;
      clearTimeout(timer);
      es?.close();
    };
  }, [id]);
  return null;
}
