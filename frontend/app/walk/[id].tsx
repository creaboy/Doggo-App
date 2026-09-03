import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, Modal } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretLeft, Star, Clock, TrendUp, MapPin, Warning, CheckCircle, Drop, Car, Trash, Eye, Heart } from "phosphor-react-native";
import { colors, radius, spacing } from "../../src/theme";
import { DoggoMap, SegmentInput } from "../../src/DoggoMap";
import { api } from "../../src/api";
import { useAuth } from "../../src/AuthContext";
import { useFavorites } from "../../src/FavoritesContext";
import { environmentLabels, difficultyLabels, freedomLabels, formatDuration, timeAgo, poiTypeLabels, hazardTypeLabels, walkFreedomColor } from "../../src/labels";

export default function WalkDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { isFavorite, toggle } = useFavorites();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [commentText, setCommentText] = useState("");
  const [posting, setPosting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [hazardOpen, setHazardOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api(`/walks/${id}`);
      setData(d);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;
  if (err || !data) return <View style={styles.center}><Text style={styles.err}>{err || "Not found"}</Text></View>;

  const { walk, pois, hazards, comments, confirmations_30d } = data;

  const segments: SegmentInput[] = walk.segments.map((s: any) => ({
    freedom: s.freedom,
    coordinates: s.coordinates.map((c: number[]) => ({ latitude: c[0], longitude: c[1] })),
  }));

  const allLats = segments.flatMap((s) => s.coordinates.map((c) => c.latitude));
  const allLngs = segments.flatMap((s) => s.coordinates.map((c) => c.longitude));
  const region = {
    latitude: (Math.min(...allLats) + Math.max(...allLats)) / 2,
    longitude: (Math.min(...allLngs) + Math.max(...allLngs)) / 2,
    latitudeDelta: Math.max(0.005, (Math.max(...allLats) - Math.min(...allLats)) * 1.6),
    longitudeDelta: Math.max(0.005, (Math.max(...allLngs) - Math.min(...allLngs)) * 1.6),
  };

  const markers = [
    ...pois.map((p: any) => ({ id: p.id, coordinate: { latitude: p.lat, longitude: p.lng }, color: colors.brandSecondary, label: poiTypeLabels[p.type] })),
    ...hazards.map((h: any) => ({ id: h.id, coordinate: { latitude: h.lat, longitude: h.lng }, color: colors.error, label: hazardTypeLabels[h.type] })),
  ];

  const rate = async (stars: number) => {
    if (!user) { router.push("/auth/login"); return; }
    try {
      await api(`/walks/${walk.id}/rate`, { method: "POST", body: JSON.stringify({ stars }) });
      load();
    } catch {}
  };

  const postComment = async () => {
    if (!user) { router.push("/auth/login"); return; }
    if (!commentText.trim()) return;
    setPosting(true);
    try {
      await api(`/walks/${walk.id}/comments`, { method: "POST", body: JSON.stringify({ text: commentText.trim() }) });
      setCommentText("");
      load();
    } catch {} finally { setPosting(false); }
  };

  const confirmAccurate = async () => {
    if (!user) { router.push("/auth/login"); return; }
    try { await api(`/walks/${walk.id}/confirm`, { method: "POST", body: JSON.stringify({ accurate: true }) }); }
    catch {} finally { setConfirmOpen(false); load(); }
  };
  const reportChange = async (change_type: string) => {
    if (!user) { router.push("/auth/login"); return; }
    try { await api(`/walks/${walk.id}/confirm`, { method: "POST", body: JSON.stringify({ accurate: false, change_type }) }); }
    catch {} finally { setConfirmOpen(false); load(); }
  };

  const confirmHazard = async (hz: any) => {
    if (!user) { router.push("/auth/login"); return; }
    try { await api(`/hazards/${hz.id}/confirm`, { method: "POST" }); } catch {}
    load();
  };
  const resolveHazard = async (hz: any) => {
    if (!user) { router.push("/auth/login"); return; }
    try { await api(`/hazards/${hz.id}/resolve`, { method: "POST" }); } catch {}
    load();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}>
        <View style={[styles.headerBar, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable testID="back-btn" style={styles.backBtn} onPress={() => router.back()}>
            <CaretLeft size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>{walk.title}</Text>
          {user ? (
            <Pressable testID="fav-detail" style={styles.backBtn} onPress={() => toggle(walk.id)}>
              <Heart size={22} color={isFavorite(walk.id) ? colors.error : colors.onSurface} weight={isFavorite(walk.id) ? "fill" : "regular"} />
            </Pressable>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>

        <View style={styles.topCard}>
          <Text style={styles.walkTitle} testID="walk-detail-title">{walk.title}</Text>
          <View style={styles.metaRow}>
            <View style={styles.rating}><Star size={16} color={colors.warning} weight="fill" /><Text style={styles.ratingText}>{walk.rating_avg ? walk.rating_avg.toFixed(1) : "—"}</Text><Text style={styles.ratingCount}>({walk.rating_count})</Text></View>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.metaText}>{environmentLabels[walk.environment]}</Text>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.metaText}>{difficultyLabels[walk.difficulty]}</Text>
          </View>
          {!!walk.description && <Text style={styles.desc}>{walk.description}</Text>}

          <View style={styles.statsGrid}>
            <StatBox icon={<Clock size={18} color={colors.brandPrimary} />} label="Duration" value={formatDuration(walk.duration_min)} />
            <StatBox icon={<TrendUp size={18} color={colors.brandPrimary} />} label="Distance" value={`${walk.distance_km} km`} />
            <StatBox icon={<View style={[styles.stripe, { backgroundColor: walkFreedomColor[walk.dog_freedom] }]} />} label={freedomLabels[walk.dog_freedom]} value={`${walk.off_leash_pct}% free`} />
          </View>
        </View>

        <View style={styles.mapWrap}>
          <DoggoMap testID="walk-detail-map" initialRegion={region} segments={segments} markers={markers} style={{ flex: 1 }} />
        </View>

        <LegendRow />

        <View style={styles.section}>
          <View style={styles.confirmCard} testID="confirm-card">
            <View style={{ flex: 1 }}>
              <Text style={styles.confirmTitle}>Last verified {timeAgo(walk.last_verified_at)}</Text>
              <Text style={styles.confirmSub}>{confirmations_30d} community confirmations in the last 30 days</Text>
            </View>
            <Pressable testID="open-confirm" style={styles.outlineBtn} onPress={() => setConfirmOpen(true)}>
              <Text style={styles.outlineBtnText}>Confirm</Text>
            </Pressable>
          </View>
        </View>

        <SectionHeader title="Rate this walk" />
        <View style={styles.ratingBar}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} testID={`rate-${n}`} onPress={() => rate(n)}>
              <Star size={30} color={colors.warning} weight={n <= Math.round(walk.rating_avg || 0) ? "fill" : "regular"} />
            </Pressable>
          ))}
        </View>

        <SectionHeader title={`Hazards (${hazards.length})`} action={{ label: "+ Add", onPress: () => user ? setHazardOpen(true) : router.push("/auth/login"), testID: "add-hazard" }} />
        <View style={styles.list}>
          {hazards.length === 0 ? <Text style={styles.emptyText}>No hazards reported.</Text> : hazards.map((h: any) => (
            <View key={h.id} style={styles.hazardRow} testID={`hazard-${h.id}`}>
              <View style={[styles.iconBox, { backgroundColor: h.status === "resolved" ? colors.surfaceTertiary : "#FEE2E2" }]}>
                <Warning size={18} color={h.status === "resolved" ? colors.muted : colors.error} weight="fill" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.hazardTitle}>{hazardTypeLabels[h.type]}{h.status === "resolved" ? " · resolved" : ""}</Text>
                {!!h.description && <Text style={styles.hazardDesc}>{h.description}</Text>}
                <Text style={styles.metaSmall}>Confirmed {timeAgo(h.last_confirmed_at)} · {h.confirmations} confirmations</Text>
              </View>
              {h.status === "active" && (
                <View style={{ gap: 4 }}>
                  <Pressable testID={`confirm-hazard-${h.id}`} onPress={() => confirmHazard(h)} style={styles.tinyBtn}><Text style={styles.tinyBtnText}>Still there</Text></Pressable>
                  <Pressable testID={`resolve-hazard-${h.id}`} onPress={() => resolveHazard(h)} style={[styles.tinyBtn, { backgroundColor: colors.surfaceTertiary }]}><Text style={styles.tinyBtnText}>Gone</Text></Pressable>
                </View>
              )}
            </View>
          ))}
        </View>

        <SectionHeader title={`Points of interest (${pois.length})`} />
        <View style={styles.list}>
          {pois.length === 0 ? <Text style={styles.emptyText}>No POIs yet.</Text> : pois.map((p: any) => (
            <View key={p.id} style={styles.poiRow} testID={`poi-${p.id}`}>
              <View style={styles.iconBox}>{poiIcon(p.type)}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.hazardTitle}>{poiTypeLabels[p.type]}</Text>
                {!!p.description && <Text style={styles.hazardDesc}>{p.description}</Text>}
              </View>
            </View>
          ))}
        </View>

        <SectionHeader title={`Comments (${comments.length})`} />
        <View style={styles.list}>
          <View style={styles.commentInputRow}>
            <TextInput
              testID="comment-input"
              value={commentText}
              onChangeText={setCommentText}
              style={styles.commentInput}
              placeholder={user ? "Share what you saw…" : "Sign in to comment"}
              placeholderTextColor={colors.muted}
              editable={!!user}
              multiline
            />
            <Pressable testID="post-comment" style={styles.postBtn} onPress={postComment} disabled={posting || !user}>
              <Text style={styles.postBtnText}>Post</Text>
            </Pressable>
          </View>
          {comments.map((c: any) => (
            <View key={c.id} style={styles.commentRow} testID={`comment-${c.id}`}>
              <Text style={styles.commentAuthor}>{c.username} <Text style={styles.metaSmall}>· {timeAgo(c.created_at)}</Text></Text>
              <Text style={styles.commentText}>{c.text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <ConfirmModal open={confirmOpen} onClose={() => setConfirmOpen(false)} onAccurate={confirmAccurate} onChange={reportChange} />
      <AddHazardModal open={hazardOpen} onClose={() => setHazardOpen(false)} walkId={walk.id} centerLat={walk.start_lat} centerLng={walk.start_lng} onDone={load} />
    </KeyboardAvoidingView>
  );
}

function poiIcon(type: string) {
  const props = { size: 18, color: colors.brandPrimary, weight: "fill" as const };
  if (type === "water") return <Drop {...props} />;
  if (type === "swimming") return <Drop {...props} />;
  if (type === "parking") return <Car {...props} />;
  if (type === "viewpoint") return <Eye {...props} />;
  if (type === "trash") return <Trash {...props} />;
  return <MapPin {...props} />;
}

function LegendRow() {
  return (
    <View style={styles.legendRow}>
      <LegendItem color={colors.success} label="Off-leash" />
      <LegendItem color={colors.warning} label="Caution" />
      <LegendItem color={colors.error} label="Leash" />
    </View>
  );
}
function LegendItem({ color, label }: any) {
  return <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: color }]} /><Text style={styles.legendText}>{label}</Text></View>;
}
function StatBox({ icon, label, value }: any) {
  return (
    <View style={styles.statBox}>
      <View style={styles.statIcon}>{icon}</View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
function SectionHeader({ title, action }: any) {
  return (
    <View style={styles.sectionHeaderRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && <Pressable testID={action.testID} onPress={action.onPress}><Text style={styles.actionText}>{action.label}</Text></Pressable>}
    </View>
  );
}

function ConfirmModal({ open, onClose, onAccurate, onChange }: any) {
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Text style={styles.sheetTitle}>Is this walk information still accurate?</Text>
          <Pressable testID="confirm-accurate" style={styles.sheetBtnPrimary} onPress={onAccurate}>
            <CheckCircle size={20} color="#fff" weight="fill" /><Text style={styles.sheetBtnPrimaryText}>Yes, everything looks correct</Text>
          </Pressable>
          <Text style={styles.sheetSectionLabel}>Something changed:</Text>
          {[
            ["new_hazard", "New hazard"],
            ["path_inaccessible", "Path inaccessible"],
            ["rules_changed", "Rules changed"],
            ["hazard_disappeared", "Hazard disappeared"],
            ["new_poi", "New useful point"],
            ["other", "Other"],
          ].map(([key, label]) => (
            <Pressable key={key} testID={`change-${key}`} style={styles.sheetBtnGhost} onPress={() => onChange(key)}>
              <Text style={styles.sheetBtnGhostText}>{label}</Text>
            </Pressable>
          ))}
          <Pressable style={styles.sheetCancel} onPress={onClose}><Text style={styles.sheetCancelText}>Cancel</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

function AddHazardModal({ open, onClose, walkId, centerLat, centerLng, onDone }: any) {
  const insets = useSafeAreaInsets();
  const [type, setType] = useState("cars");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/walks/${walkId}/hazards`, {
        method: "POST",
        body: JSON.stringify({ type, description, lat: centerLat, lng: centerLng }),
      });
      onClose(); setDescription(""); onDone();
    } catch {} finally { setBusy(false); }
  };
  return (
    <Modal transparent visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Text style={styles.sheetTitle}>Report a hazard</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: 4 }}>
            {Object.entries(hazardTypeLabels).map(([k, v]) => (
              <Pressable key={k} testID={`hz-type-${k}`} onPress={() => setType(k)} style={[styles.chip, type === k && styles.chipActive]}>
                <Text style={[styles.chipText, type === k && styles.chipTextActive]}>{v}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <TextInput testID="hz-description" value={description} onChangeText={setDescription}
            style={styles.textArea} placeholder="Describe the hazard (optional)" placeholderTextColor={colors.muted} multiline />
          <Pressable testID="submit-hazard" style={styles.sheetBtnPrimary} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sheetBtnPrimaryText}>Report hazard</Text>}
          </Pressable>
          <Pressable style={styles.sheetCancel} onPress={onClose}><Text style={styles.sheetCancelText}>Cancel</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, backgroundColor: colors.surface },
  err: { color: colors.error },
  headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700", color: colors.onSurface },
  topCard: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.sm },
  walkTitle: { fontSize: 24, fontWeight: "700", color: colors.onSurface },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  rating: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingText: { fontWeight: "700", color: colors.onSurface },
  ratingCount: { color: colors.muted, fontSize: 12 },
  dot: { color: colors.muted },
  metaText: { color: colors.muted, fontSize: 13 },
  desc: { color: colors.onSurface, fontSize: 14, lineHeight: 20 },
  statsGrid: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  statBox: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  statIcon: { marginBottom: 4 },
  statValue: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 2, textAlign: "center" },
  stripe: { width: 22, height: 4, borderRadius: 2 },
  mapWrap: { height: 320, marginTop: spacing.lg, marginHorizontal: spacing.md, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  legendRow: { flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  section: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  confirmCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  confirmTitle: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  confirmSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  outlineBtn: { borderWidth: 1, borderColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 },
  outlineBtnText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 12 },
  ratingBar: { flexDirection: "row", justifyContent: "center", gap: spacing.md, marginTop: spacing.sm, paddingHorizontal: spacing.lg },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  actionText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 13 },
  list: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  emptyText: { color: colors.muted, fontSize: 13, paddingVertical: spacing.sm },
  hazardRow: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  poiRow: { flexDirection: "row", gap: spacing.md, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  iconBox: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  hazardTitle: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  hazardDesc: { fontSize: 13, color: colors.onSurface, marginTop: 2 },
  metaSmall: { fontSize: 11, color: colors.muted, marginTop: 4 },
  tinyBtn: { backgroundColor: colors.brandTertiary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  tinyBtnText: { fontSize: 11, fontWeight: "600", color: colors.onBrandTertiary },
  commentInputRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" },
  commentInput: { flex: 1, minHeight: 44, maxHeight: 100, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.onSurface, backgroundColor: colors.surfaceSecondary },
  postBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.md },
  postBtnText: { color: colors.onBrand, fontWeight: "700" },
  commentRow: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  commentAuthor: { fontWeight: "700", color: colors.onSurface, fontSize: 13 },
  commentText: { color: colors.onSurface, marginTop: 4, fontSize: 14 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, maxHeight: "85%" },
  sheetTitle: { fontSize: 16, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.sm },
  sheetBtnPrimary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14 },
  sheetBtnPrimaryText: { color: colors.onBrand, fontWeight: "700" },
  sheetSectionLabel: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", marginTop: spacing.sm },
  sheetBtnGhost: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, paddingVertical: 12, alignItems: "center" },
  sheetBtnGhostText: { color: colors.onSurface, fontWeight: "600" },
  sheetCancel: { alignItems: "center", paddingVertical: spacing.sm, marginTop: spacing.sm },
  sheetCancelText: { color: colors.muted, fontWeight: "600" },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  chipTextActive: { color: colors.onBrand },
  textArea: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, minHeight: 80, color: colors.onSurface, backgroundColor: colors.surface },
});
