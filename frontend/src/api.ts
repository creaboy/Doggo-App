import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const API_URL = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

const TOKEN_KEY = "doggo_token";

let inMemoryToken: string | null = null;

export async function getToken(): Promise<string | null> {
  if (inMemoryToken) return inMemoryToken;
  try {
    if (Platform.OS === "web") {
      const t = typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;
      inMemoryToken = t;
      return t;
    }
    const t = await SecureStore.getItemAsync(TOKEN_KEY);
    inMemoryToken = t;
    return t;
  } catch {
    return null;
  }
}

export async function setToken(t: string | null) {
  inMemoryToken = t;
  try {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") {
        if (t) window.localStorage.setItem(TOKEN_KEY, t);
        else window.localStorage.removeItem(TOKEN_KEY);
      }
      return;
    }
    if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {}
}

export async function api(path: string, opts: RequestInit = {}) {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as any),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { ...opts, headers });
  if (res.status === 401) {
    await setToken(null);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
  return data;
}
