import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "./api";
import { useAuth } from "./AuthContext";

type Ctx = {
  favorites: Set<string>;
  toggle: (walkId: string) => Promise<void>;
  isFavorite: (walkId: string) => boolean;
  refresh: () => Promise<void>;
  loading: boolean;
};

const C = createContext<Ctx | null>(null);

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setFavorites(new Set());
      return;
    }
    setLoading(true);
    try {
      const list = await api("/me/favorites");
      setFavorites(new Set(list.map((w: any) => w.id)));
    } catch {
      setFavorites(new Set());
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = async (walkId: string) => {
    if (!user) return;
    const isFav = favorites.has(walkId);
    // optimistic
    const next = new Set(favorites);
    if (isFav) next.delete(walkId);
    else next.add(walkId);
    setFavorites(next);
    try {
      await api(`/walks/${walkId}/favorite`, { method: isFav ? "DELETE" : "POST" });
    } catch {
      // revert
      setFavorites(favorites);
    }
  };

  return (
    <C.Provider value={{ favorites, toggle, isFavorite: (id) => favorites.has(id), refresh, loading }}>
      {children}
    </C.Provider>
  );
}

export function useFavorites() {
  const v = useContext(C);
  if (!v) throw new Error("useFavorites outside provider");
  return v;
}
