import React, { useEffect, useState } from "react";
import { Modal, View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { X, Sparkle, Warning, CheckCircle, MapPin } from "phosphor-react-native";
import { colors, radius, spacing } from "./theme";
import { api } from "./api";
import { environmentLabels, hazardTypeLabels, timeAgo, formatDuration } from "./labels";
import { UserLoc } from "./useUserLocation";

type Props = { open: boolean; onClose: () => void; userLoc: UserLoc | null };

export function DigestModal({ open, onClose, userLoc }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const qs = userLoc ? `?lat=${userLoc.lat}&lng=${userLoc.lng}` : "";
    api(`/digest${qs}`)
      .then(setData)
      .catch(() => setData({ new_walks: [], hazards: [], confirmations: [] }))
      .finally(() => setLoading(false));
  }, [open, userLoc?.lat, userLoc?.lng]);

  const openWalk = (id: string) => { onClose(); router.push(`/walk/${id}`); };

  return (
    <Modal transparent visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconCircle}><Sparkle size={18} color={colors.brandPrimary} weight="fill" /></View>
              <View>
                <Text style={styles.title}>This week on Doggo</Text>
                <Text style={styles.sub}>{userLoc ? "Nearby community activity" : "Community activity"}</Text>
              </View>
            </View>
            <Pressable testID="close-digest" onPress={onClose} hitSlop={8}><X size={22} color={colors.onSurface} /></Pressable>
          </View>

          {loading ? (
            <View style={{ paddingVertical: spacing.xxl, alignItems: "center" }}><ActivityIndicator color={colors.brandPrimary} /></View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingBottom: spacing.md, gap: spacing.md }}>
              <SectionLabel text={`New walks (${data?.new_walks?.length ?? 0})`} />
              {data?.new_walks?.length ? data.new_walks.map((w: any) => (
                <Pressable key={w.id} testID={`digest-walk-${w.id}`} style={styles.row} onPress={() => openWalk(w.id)}>
                  <View style={styles.rowIcon}><MapPin size={18} color={colors.brandPrimary} weight="fill" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{w.title}</Text>
                    <Text style={styles.rowSub}>{environmentLabels[w.environment]} · {formatDuration(w.duration_min)} · {w.distance_km}km{w.distance_from_you_km !== undefined ? ` · ${w.distance_from_you_km}km away` : ""}</Text>
                  </View>
                  <Text style={styles.timeText}>{timeAgo(w.created_at)}</Text>
                </Pressable>
              )) : <Text style={styles.empty}>No new walks this week{userLoc ? " nearby" : ""}.</Text>}

              <SectionLabel text={`Fresh hazard reports (${data?.hazards?.length ?? 0})`} />
              {data?.hazards?.length ? data.hazards.map((h: any) => (
                <Pressable key={h.id} testID={`digest-hazard-${h.id}`} style={styles.row} onPress={() => openWalk(h.walk_id)}>
                  <View style={[styles.rowIcon, { backgroundColor: "#FEE2E2" }]}><Warning size={18} color={colors.error} weight="fill" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{hazardTypeLabels[h.type] || h.type}{h.status === "resolved" ? " · resolved" : ""}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>{h.walk_title}{h.distance_from_you_km !== undefined ? ` · ${h.distance_from_you_km}km away` : ""}</Text>
                  </View>
                  <Text style={styles.timeText}>{timeAgo(h.last_confirmed_at)}</Text>
                </Pressable>
              )) : <Text style={styles.empty}>No hazard updates this week{userLoc ? " nearby" : ""}.</Text>}

              <SectionLabel text={`Community confirmations (${data?.confirmations?.length ?? 0})`} />
              {data?.confirmations?.length ? data.confirmations.map((c: any) => (
                <Pressable key={c.walk_id} testID={`digest-confirm-${c.walk_id}`} style={styles.row} onPress={() => openWalk(c.walk_id)}>
                  <View style={[styles.rowIcon, { backgroundColor: "#DCFCE7" }]}><CheckCircle size={18} color={colors.success} weight="fill" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{c.walk_title}</Text>
                    <Text style={styles.rowSub}>{c.count} confirmation{c.count > 1 ? "s" : ""} · {environmentLabels[c.environment]}{c.distance_from_you_km !== undefined ? ` · ${c.distance_from_you_km}km away` : ""}</Text>
                  </View>
                  <Text style={styles.timeText}>{timeAgo(c.last)}</Text>
                </Pressable>
              )) : <Text style={styles.empty}>No confirmations this week{userLoc ? " nearby" : ""}.</Text>}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text}</Text>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.md, maxHeight: "88%" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "700", color: colors.onSurface },
  sub: { fontSize: 12, color: colors.muted },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  rowIcon: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  rowSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  timeText: { fontSize: 11, color: colors.muted },
  empty: { color: colors.muted, fontSize: 13, fontStyle: "italic", paddingVertical: spacing.sm },
});
