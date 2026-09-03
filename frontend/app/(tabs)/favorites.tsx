import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Heart, Warning } from "phosphor-react-native";
import { api } from "../../src/api";
import { useAuth } from "../../src/AuthContext";
import { useFavorites } from "../../src/FavoritesContext";
import { colors, radius, spacing } from "../../src/theme";
import { WalkCard } from "./explore";

export default function FavoritesScreen() {
  const { user } = useAuth();
  const { favorites, refresh } = useFavorites();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [walks, setWalks] = useState<any[]>([]);
  const [hazards, setHazards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      const [w, hz] = await Promise.all([api("/me/favorites"), api("/me/favorites/hazards")]);
      setWalks(w);
      setHazards(hz);
    } catch {} finally { setLoading(false); }
  }, [user]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); refresh(); }, [load, refresh]));

  if (!user) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Heart size={40} color={colors.muted} />
        <Text style={styles.title}>Save walks you love</Text>
        <Text style={styles.muted}>Sign in to keep your favorites in one place and get nearby hazard alerts.</Text>
        <Pressable testID="go-to-login" style={styles.primaryBtn} onPress={() => router.replace("/auth/login")}>
          <Text style={styles.primaryBtnText}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.headerTitle}>Favorites</Text>
        <Text style={styles.headerSub}>{walks.length} saved · {hazards.length} active hazards to watch</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : walks.length === 0 ? (
        <View style={styles.center}>
          <Heart size={40} color={colors.muted} />
          <Text style={styles.title}>No favorites yet</Text>
          <Text style={styles.muted}>Tap the heart on any walk to save it here.</Text>
          <Pressable testID="go-explore" style={styles.primaryBtn} onPress={() => router.push("/(tabs)/explore")}>
            <Text style={styles.primaryBtnText}>Explore walks</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={walks}
          keyExtractor={(w) => w.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl }}
          ListHeaderComponent={hazards.length > 0 ? (
            <View style={styles.alertBox} testID="hazards-summary">
              <View style={styles.alertIconBox}><Warning size={18} color={colors.error} weight="fill" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.alertTitle}>{hazards.length} active hazard{hazards.length > 1 ? "s" : ""} on your saved walks</Text>
                <Text style={styles.alertSub}>You'll be alerted when you get within 300m of any of them.</Text>
              </View>
            </View>
          ) : null}
          renderItem={({ item }) => <WalkCard walk={item} onPress={() => router.push(`/walk/${item.id}`)} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 },
  headerTitle: { fontSize: 22, fontWeight: "700", color: colors.onSurface },
  headerSub: { fontSize: 13, color: colors.muted },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md, backgroundColor: colors.surface },
  title: { fontSize: 18, fontWeight: "700", color: colors.onSurface, textAlign: "center" },
  muted: { color: colors.muted, textAlign: "center", fontSize: 14, maxWidth: 280 },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, marginTop: spacing.sm },
  primaryBtnText: { color: colors.onBrand, fontWeight: "700" },
  alertBox: { flexDirection: "row", gap: spacing.md, alignItems: "center", backgroundColor: "#FEF2F2", borderColor: "#FCA5A5", borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  alertIconBox: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  alertTitle: { fontSize: 14, fontWeight: "700", color: "#7F1D1D" },
  alertSub: { fontSize: 12, color: "#991B1B", marginTop: 2 },
});
