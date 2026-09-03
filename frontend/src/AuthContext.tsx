import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { api, setToken, getToken } from "./api";

WebBrowser.maybeCompleteAuthSession();

export type User = {
  user_id: string;
  email: string;
  username: string;
  picture?: string | null;
};

type AuthCtx = {
  user: User | null;
  loading: boolean;
  loginEmail: (email: string, password: string) => Promise<void>;
  registerEmail: (email: string, password: string, username: string) => Promise<void>;
  loginGoogle: () => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

const processedSessionIds = new Set<string>();

async function exchangeSessionId(sessionId: string) {
  if (processedSessionIds.has(sessionId)) return null;
  processedSessionIds.add(sessionId);
  const data = await api("/auth/session", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId }),
  });
  await setToken(data.session_token);
  return data.user as User;
}

function extractSessionIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    try {
      const t = await getToken();
      if (!t) {
        setUser(null);
        return;
      }
      const me = await api("/auth/me");
      setUser(me);
    } catch {
      setUser(null);
    }
  }, []);

  // Web: parse URL for session_id on mount
  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === "web" && typeof window !== "undefined") {
          const full = window.location.href;
          const sid = extractSessionIdFromUrl(full);
          if (sid) {
            const u = await exchangeSessionId(sid);
            if (u) {
              setUser(u);
              try {
                const url = new URL(window.location.href);
                url.hash = "";
                url.searchParams.delete("session_id");
                window.history.replaceState(window.history.state, "", url.toString());
              } catch {}
              setLoading(false);
              return;
            }
          }
        } else {
          // mobile: check cold-start deep link
          const initial = await Linking.getInitialURL();
          const sid = extractSessionIdFromUrl(initial);
          if (sid) {
            const u = await exchangeSessionId(sid);
            if (u) {
              setUser(u);
              setLoading(false);
              return;
            }
          }
        }
        await refreshMe();
      } finally {
        setLoading(false);
      }
    })();

    if (Platform.OS !== "web") {
      const sub = Linking.addEventListener("url", async ({ url }) => {
        const sid = extractSessionIdFromUrl(url);
        if (sid) {
          try {
            const u = await exchangeSessionId(sid);
            if (u) setUser(u);
          } catch {}
        }
      });
      return () => sub.remove();
    }
  }, [refreshMe]);

  const loginEmail = async (email: string, password: string) => {
    const data = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    await setToken(data.session_token);
    setUser(data.user);
  };

  const registerEmail = async (email: string, password: string, username: string) => {
    const data = await api("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, username }),
    });
    await setToken(data.session_token);
    setUser(data.user);
  };

  const loginGoogle = async () => {
    if (Platform.OS === "web") {
      const redirect = window.location.origin + "/";
      const url = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
      window.location.href = url;
      return;
    }
    const redirect = Linking.createURL("");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
    let capturedUrl: string | null = null;
    const sub = Linking.addEventListener("url", ({ url }) => { capturedUrl = url; });
    try {
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirect);
      let sid = result.type === "success" && (result as any).url
        ? extractSessionIdFromUrl((result as any).url)
        : null;
      if (!sid) sid = extractSessionIdFromUrl(capturedUrl);
      if (!sid) {
        const initial = await Linking.getInitialURL();
        sid = extractSessionIdFromUrl(initial);
      }
      if (!sid) throw new Error("Google sign-in was cancelled");
      const u = await exchangeSessionId(sid);
      if (u) setUser(u);
    } finally {
      sub.remove();
    }
  };

  const logout = async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    await setToken(null);
    setUser(null);
  };

  return (
    <Ctx.Provider value={{ user, loading, loginEmail, registerEmail, loginGoogle, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside provider");
  return v;
}
