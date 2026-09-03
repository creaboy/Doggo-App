import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { SignOut, Star, PathIcon } from "phosphor-react-native";
import { useAuth } from "../../src/AuthContext";
import { colors, radius, spacing } from "../../src/theme";
import { api } from "../../src/api";
import { formatDuration, environmentLabels, difficultyLabels, timeAgo } from "../../src/labels";

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [walks, setWalks] = useState<any[]>([]);
  const [activity, setActivity] = useState<{ comments: any[]; ratings: any[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    (async () => {
      try {
        const [w, a] = await Promise.all([api("/me/walks"), api("/me/activity")]);
        setWalks(w); setActivity(a);
      } catch {} finally { setLoading(false); }
    })();
  }, [user]);

  if (!user) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.title}>You're browsing as guest</Text>
        <Pressable testID="go-to-login" style={styles.primaryBtn} onPress={() => router.replace("/auth/login")}>
          <Text style={styles.primaryBtnText}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  const initial = (user.username || user.email || "?")[0].toUpperCase();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl }}>
      <View style={styles.headerCard}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} testID="profile-username">{user.username}</Text>
          <Text style={styles.email}>{user.email}</Text>
        </View>
        <Pressable testID="logout-btn" onPress={logout} style={styles.iconBtn}>
          <SignOut size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        <StatBox label="Walks created" value={walks.length} />
        <StatBox label="Ratings given" value={activity?.ratings.length ?? 0} />
        <StatBox label="Comments" value={activity?.comments.length ?? 0} />
      </View>

      <Text style={styles.section}>My walks</Text>
      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.lg }} />
      ) : walks.length === 0 ? (
        <View style={styles.empty}>
          <PathIcon size={32} color={colors.muted} />
          <Text style={styles.emptyText}>You haven't published any walks yet</Text>
          <Pressable testID="go-create" style={styles.primaryBtn} onPress={() => router.push("/(tabs)/create")}>
            <Text style={styles.primaryBtnText}>Create your first walk</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ paddingHorizontal: spacing.md, gap: spacing.md }}>
          {walks.map((w) => (
            <Pressable key={w.id} testID={`my-walk-${w.id}`} style={styles.walkRow} onPress={() => router.push(`/walk/${w.id}`)}>
              <View>
                <Text style={styles.walkTitle}>{w.title}</Text>
                <Text style={styles.walkSub}>{environmentLabels[w.environment]} · {formatDuration(w.duration_min)} · {w.distance_km} km</Text>
              </View>
              <View style={styles.ratingRow}><Star size={14} color={colors.warning} weight="fill" /><Text style={styles.ratingText}>{w.rating_avg || "—"}</Text></View>
            </Pressable>
          ))}
        </View>
      )}

      {activity?.comments.length ? (
        <>
          <Text style={styles.section}>Recent comments</Text>
          <View style={{ paddingHorizontal: spacing.md, gap: spacing.md }}>
            {activity.comments.slice(0, 5).map((c) => (
              <View key={c.id} style={styles.commentRow}>
                <Text style={styles.commentText}>"{c.text}"</Text>
                <Text style={styles.walkSub}>{timeAgo(c.created_at)}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

function StatBox({ label, value }: any) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, backgroundColor: colors.surface },
  title: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  headerCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, marginHorizontal: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.onBrand, fontSize: 22, fontWeight: "700" },
  name: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  email: { fontSize: 13, color: colors.muted },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", gap: spacing.sm, marginHorizontal: spacing.md, marginTop: spacing.md },
  statBox: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  statValue: { fontSize: 22, fontWeight: "700", color: colors.brandPrimary },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  section: { fontSize: 15, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.sm, paddingHorizontal: spacing.md },
  empty: { alignItems: "center", padding: spacing.xl, gap: spacing.md },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: "center" },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  primaryBtnText: { color: colors.onBrand, fontWeight: "700", fontSize: 14 },
  walkRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  walkTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  walkSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingText: { fontSize: 13, fontWeight: "600" },
  commentRow: { backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  commentText: { color: colors.onSurface, fontSize: 14 },
});
