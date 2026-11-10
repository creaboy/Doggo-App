import React, { createContext, useContext, useEffect, useState } from "react";
import { api, setToken, getToken } from "./api";

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
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me: User | null = await getToken() ? await api("/auth/me") : null;
        if (active) setUser(me);
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const authenticate = async (path: string, credentials: object) => {
    const data = await api(path, { method: "POST", body: JSON.stringify(credentials) });
    await setToken(data.session_token);
    setUser(data.user);
  };

  const logout = async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    await setToken(null);
    setUser(null);
  };

  return (
    <Ctx.Provider value={{ user, loading, logout,
      loginEmail: (email, password) => authenticate("/auth/login", { email, password }),
      registerEmail: (email, password, username) => authenticate("/auth/register", { email, password, username }),
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside provider");
  return v;
}
