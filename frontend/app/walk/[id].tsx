import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, Modal, Share } from "react-native";
import Svg, { Path } from "react-native-svg";
import { annotationPath, filledHazardIcons } from "../../src/maps/markerIcons";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretLeft, Star, Clock, TrendUp, Heart, ShareNetwork } from "phosphor-react-native";
import { colors, radius, spacing } from "../../src/theme";
import { DoggoMap, SegmentInput } from "../../src/DoggoMap";
import { api } from "../../src/api";
import { regionFor } from "../../src/routeDraft";
import { estimateWalkMinutes, mergeWalkNotes } from "../../src/walkDetails";
import { featureOptions, interestOptions, dangerOptions } from '../../src/create/routeMetadata';
import { useAuth } from "../../src/AuthContext";
import { useFavorites } from "../../src/FavoritesContext";
import { WalkFeedback } from "../../src/WalkFeedback";
import { environmentLabels, difficultyLabels, freedomLabels, formatDuration, timeAgo, poiTypeLabels, hazardTypeLabels, walkColor } from "../../src/labels";

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
  const [toast, setToast] = useState<string | null>(null);
  const [requestedVariant, setVariantName] = useState('A');
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const load = useCallback(async () => {
    try {
      const d = await api(`/walks/${id}`);
      setData(d);
      setErr("");
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;
  if (err || !data) return <View style={styles.center}><Text style={styles.err}>{err || "Balade introuvable"}</Text>
    <Pressable style={styles.outlineBtn} onPress={() => router.back()}><Text style={styles.outlineBtnText}>Retour</Text></Pressable></View>;

  const { walk, comments } = data;
  const variant = walk.variants?.find((v: any) => v.name === requestedVariant);
  const variantName = variant?.name ?? 'A';
  const hidden = walk.moderation_status === 'hidden';
  const verification = data.verification?.[variantName];
  const route = variant || walk;
  const pois = mergeWalkNotes<any>(data.pois || [], (variant?.pois || []).map((p: any, i: number) => ({ ...p, id: `variant-poi-${i}` })));
  const hazards = mergeWalkNotes<any>(data.hazards || [], (variant?.hazards || []).map((h: any, index: number) => ({ ...h, index })));
  const duration = route.duration_min ?? estimateWalkMinutes(route.distance_km, walk.environment, walk.difficulty);

  const segments: SegmentInput[] = route.segments.map((s: any) => ({
    freedom: s.freedom,
    offPath: !!s.off_path,
    coordinates: s.coordinates.map((c: number[]) => ({ latitude: c[0], longitude: c[1] })),
  }));

  const region = regionFor({ start: segments[0]?.coordinates[0] || null,
    legs: segments.map(s => ({ ...s, source: "gps" as const })) });

  const markers = [
    { id: "start", coordinate: { latitude: walk.start_lat, longitude: walk.start_lng }, color: walkColor(walk), icon: { kind: "walk" as const }, label: "Départ de la balade" },
    ...pois.map((p: any) => ({ id: p.id, coordinate: { latitude: p.lat, longitude: p.lng }, color: colors.brandSecondary, icon: { kind: "poi" as const, type: p.type }, label: poiTypeLabels[p.type] })),
    ...hazards.map((h: any, i: number) => ({ id: h.id || `variant-hazard-${i}`, coordinate: { latitude: h.lat, longitude: h.lng }, color: h.status === "resolved" ? colors.muted : colors.error, icon: { kind: "hazard" as const, type: h.type }, label: hazardTypeLabels[h.type] })),
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

  const respondToHazard = async (hz: any, action: 'confirm' | 'resolve') => {
    if (!user) { router.push("/auth/login"); return; }
    const url = hz.id ? `/hazards/${hz.id}` : `/walks/${walk.id}/variants/${variantName}/hazards/${hz.index}`;
    try { await api(`${url}/${action}`, { method: "POST" }); await load(); }
    catch { showToast('Réponse non envoyée.'); }
  };

  const shareWalk = async () => {
    const base = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");
    const url = `${base}/walk/${walk.id}`;
    const message = `Check out this dog walk on Doggo — ${walk.title} (${walk.distance_km}km · ${formatDuration(walk.duration_min)})\n${url}`;
    try {
      if (Platform.OS === "web") {
        // Try native share first, fallback to clipboard
        // @ts-ignore
        if (typeof navigator !== "undefined" && navigator.share) {
          // @ts-ignore
          await navigator.share({ title: walk.title, text: message, url });
          return;
        }
        await Clipboard.setStringAsync(url);
        showToast("Link copied to clipboard");
      } else {
        await Share.share({ message, url, title: walk.title });
      }
    } catch {}
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}>
        <View style={[styles.headerBar, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable testID="back-btn" style={styles.backBtn} onPress={() => router.back()}>
            <CaretLeft size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>{walk.title}</Text>
          <View style={styles.headerRight}>
            <Pressable testID="share-btn" style={styles.backBtn} onPress={shareWalk}>
              <ShareNetwork size={20} color={colors.onSurface} />
            </Pressable>
            {user ? (
              <Pressable testID="fav-detail" style={styles.backBtn} onPress={() => toggle(walk.id)}>
                <Heart size={22} color={isFavorite(walk.id) ? colors.error : colors.onSurface} weight={isFavorite(walk.id) ? "fill" : "regular"} />
              </Pressable>
            ) : null}
          </View>
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
          {hidden && <Text style={styles.err}>Balade masquée par la modération.</Text>}
          {walk.moderation_status === 'correction_requested' && <Text style={styles.err}>La modération a demandé une correction à l’auteur.</Text>}
          {!!walk.moderation_note && (data.can_edit || user?.can_moderate) && <Text style={styles.desc}>{walk.moderation_note}</Text>}
          {data.can_edit && <Pressable accessibilityRole="link" style={styles.outlineBtn}
            onPress={() => router.push({ pathname: '/edit-walk/[id]', params: { id: walk.id } })}>
            <Text style={styles.outlineBtnText}>Modifier la balade</Text>
          </Pressable>}
          {!!data.has_visible_dog && !!walk.created_by && <Pressable accessibilityRole="link" style={styles.outlineBtn} testID="walk-owner-dog"
            onPress={() => router.push({ pathname: '/member-dog/[id]', params: { id: walk.created_by } })}>
            <Text style={styles.outlineBtnText}>Voir le chien de {walk.creator_name || 'l’auteur'}</Text>
          </Pressable>}

          <View style={styles.statsGrid}>
            <StatBox icon={<Clock size={18} color={colors.brandPrimary} />} label={route.duration_min ? "Durée" : "Durée estimée"} value={formatDuration(duration)} />
            <StatBox icon={<TrendUp size={18} color={colors.brandPrimary} />} label="Distance" value={`${route.distance_km} km`} />
            <StatBox icon={<View style={[styles.stripe, { backgroundColor: walkColor(walk) }]} />} label={freedomLabels[walk.dog_freedom]} value={`${route.off_leash_pct}% free`} />
          </View>
        </View>

        {!!walk.variants?.length && <View style={[styles.section, { gap: 8 }]}><Text style={styles.hazardTitle}>Choisir une boucle</Text><View style={styles.metaRow}>
          {[{ name: 'A', distance_km: walk.distance_km }, ...walk.variants].map((v: any) => <Pressable key={v.name} testID={`view-variant-${v.name}`} style={[styles.outlineBtn, variantName === v.name && { backgroundColor: colors.surfaceTertiary }]}
            onPress={() => { setVariantName(v.name); setSelectedSegment(null); }}><Text style={styles.outlineBtnText}>{v.name} · {v.distance_km} km</Text></Pressable>)}
        </View></View>}
        {!hidden && <View style={[styles.section, { paddingTop: spacing.md }]}>
          <Pressable testID="start-walk-navigation" accessibilityRole="button" style={styles.sheetBtnPrimary}
            onPress={() => router.push({ pathname: '/navigate/[id]', params: { id: walk.id, variant: variantName } })}>
            <Text style={styles.sheetBtnPrimaryText}>Démarrer la balade{walk.variants?.length ? ` · ${variantName}` : ''}</Text>
          </Pressable>
        </View>}
        <View style={styles.mapWrap}>
          <DoggoMap testID="walk-detail-map" initialRegion={region} segments={segments} markers={markers} fitToRoute fitRevision={variantName.charCodeAt(0)}
            onSegmentPress={index => setSelectedSegment(index)} selectedSegmentIndex={selectedSegment ?? undefined} style={{ flex: 1 }} />
        </View>

        <LegendRow />
        {selectedSegment !== null && <View style={[styles.section, { gap: 8 }]} testID="segment-details">
          <Text style={styles.hazardTitle}>Segment {selectedSegment + 1}</Text>
          <Text style={styles.desc}>{[
            ...(route.segments[selectedSegment]?.features || []).map((key: string) => featureOptions[key]),
            ...(route.segments[selectedSegment]?.interests || []).map((key: string) => interestOptions[key]),
            ...(route.segments[selectedSegment]?.dangers || []).map((key: string) => dangerOptions[key]),
          ].join(' · ') || 'Aucun détail supplémentaire.'}</Text>
          {!!route.segments[selectedSegment]?.notes && <Text style={styles.desc}>{route.segments[selectedSegment].notes}</Text>}
        </View>}

        <View style={styles.section}>
          <View style={styles.confirmCard} testID="confirm-card">
            <View style={{ flex: 1 }}>
              <Text style={styles.confirmTitle}>Fiabilité du parcours · {variantName}</Text>
              <Text style={styles.confirmSub}>{verification?.last_confirmed_at
                ? `Dernière confirmation le ${new Date(verification.last_confirmed_at).toLocaleDateString('fr-FR')}`
                : 'Aucune confirmation pour cette version'}</Text>
              <Text style={styles.confirmSub}>{verification?.people_30d ?? 0} marcheur{verification?.people_30d > 1 ? 's' : ''} sur les 30 derniers jours</Text>
              {data.reported_variants?.includes(variantName) && <Text style={styles.err}>Un problème a été signalé sur ce parcours.</Text>}
            </View>
            {!hidden && <Pressable testID="open-confirm" style={styles.outlineBtn} onPress={() => user ? setConfirmOpen(true) : router.push("/auth/login")}>
              <Text style={styles.outlineBtnText}>{data.can_edit ? 'Signaler' : 'Donner un retour'}</Text>
            </Pressable>}
          </View>
        </View>

        <SectionHeader title="Noter la balade" />
        <View style={styles.ratingBar}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} testID={`rate-${n}`} onPress={() => rate(n)}>
              <Star size={30} color={colors.warning} weight={n <= Math.round(walk.rating_avg || 0) ? "fill" : "regular"} />
            </Pressable>
          ))}
        </View>

        <SectionHeader title={`Hazards (${hazards.length})`} action={{ label: "+ Add", onPress: () => user ? setHazardOpen(true) : router.push("/auth/login"), testID: "add-hazard" }} />
        <View style={styles.list}>
          {hazards.length === 0 ? <Text style={styles.emptyText}>No hazards reported.</Text> : hazards.map((h: any, i: number) => (
            <View key={h.id || i} style={styles.hazardRow} testID={`hazard-${h.id || i}`}>
              <View style={[styles.iconBox, { backgroundColor: h.status === "resolved" ? colors.surfaceTertiary : "#FEE2E2" }]}>
                <AnnotationIcon kind="hazard" type={h.type} color={h.status === "resolved" ? colors.muted : colors.error} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.hazardTitle}>{hazardTypeLabels[h.type]}{h.status === "resolved" ? " · resolved" : ""}</Text>
                {!!h.description && <Text style={styles.hazardDesc}>{h.description}</Text>}
                {!!h.last_confirmed_at && <Text style={styles.metaSmall}>Confirmed {timeAgo(h.last_confirmed_at)} · {h.confirmations || 0} confirmations</Text>}
              </View>
              {h.status !== "resolved" && (
                <View style={{ gap: 4 }}>
                  <Pressable testID={`confirm-hazard-${h.id || i}`} onPress={() => respondToHazard(h, 'confirm')} style={styles.tinyBtn}><Text style={styles.tinyBtnText}>Still there</Text></Pressable>
                  <Pressable testID={`resolve-hazard-${h.id || i}`} onPress={() => respondToHazard(h, 'resolve')} style={[styles.tinyBtn, { backgroundColor: colors.surfaceTertiary }]}><Text style={styles.tinyBtnText}>Gone</Text></Pressable>
                </View>
              )}
            </View>
          ))}
        </View>

        <SectionHeader title={`Points of interest (${pois.length})`} />
        <View style={styles.list}>
          {pois.length === 0 ? <Text style={styles.emptyText}>No POIs yet.</Text> : pois.map((p: any) => (
            <View key={p.id} style={styles.poiRow} testID={`poi-${p.id}`}>
              <View style={styles.iconBox}><AnnotationIcon kind="poi" type={p.type} color={colors.brandSecondary} /></View>
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

      {confirmOpen && !hidden && <WalkFeedback walkId={walk.id} variant={variantName} revision={route.route_revision ?? 'initial'} canConfirm={!data.can_edit}
        onClose={() => setConfirmOpen(false)} onDone={accurate => {
          setConfirmOpen(false); showToast(accurate ? 'Parcours confirmé.' : 'Signalement transmis.'); void load();
        }} />}
      <AddHazardModal open={hazardOpen} onClose={() => setHazardOpen(false)} walkId={walk.id} centerLat={walk.start_lat} centerLng={walk.start_lng} onDone={load} />
      {toast && (
        <View pointerEvents="none" style={[styles.toast, { bottom: insets.bottom + spacing.xl }]} testID="share-toast">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function AnnotationIcon({ kind, type, color }: { kind: 'poi' | 'hazard'; type: string; color: string }) {
  const filled = kind === 'hazard' && filledHazardIcons.includes(type);
  return <Svg width={20} height={20} viewBox="0 0 24 24">
    <Path d={annotationPath(kind, type)} fill={filled ? color : 'none'} fillRule="evenodd"
      stroke={filled ? 'none' : color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
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
  headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 },
  headerRight: { flexDirection: "row", gap: 4 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700", color: colors.onSurface },
  toast: { position: "absolute", left: spacing.lg, right: spacing.lg, backgroundColor: colors.surfaceInverse, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: spacing.md, alignItems: "center" },
  toastText: { color: colors.onSurfaceInverse, fontSize: 13, fontWeight: "600" },
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
  sheetCancel: { alignItems: "center", paddingVertical: spacing.sm, marginTop: spacing.sm },
  sheetCancelText: { color: colors.muted, fontWeight: "600" },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  chipTextActive: { color: colors.onBrand },
  textArea: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, minHeight: 80, color: colors.onSurface, backgroundColor: colors.surface },
});
