import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl, FlatList, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Star, Clock, TrendUp, X, SlidersHorizontal, List as ListIcon, MapTrifold, Heart, Sparkle, MagnifyingGlass } from "phosphor-react-native";
import { colors, radius, spacing } from "../../src/theme";
import { api } from "../../src/api";
import { DoggoMap, LatLng } from "../../src/DoggoMap";
import { environmentLabels, difficultyLabels, freedomLabels, formatDuration, timeAgo, walkFreedomColor } from "../../src/labels";
import { useFavorites } from "../../src/FavoritesContext";
import { useAuth } from "../../src/AuthContext";
import { useUserLocation, distanceKm } from "../../src/useUserLocation";
import { DigestModal } from "../../src/DigestModal";

type Walk = any;
type Viewport = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number; zoom: number };

const ENV_OPTIONS = ["all", "forest", "fields", "city", "beach", "mountain", "mixed"];
const DIFF_OPTIONS = ["all", "easy", "moderate", "sporty"];
const FREE_OPTIONS = ["all", "free", "partial", "leash"];
const SORT_OPTIONS: { key: "recommended" | "distance" | "rating"; label: string }[] = [
  { key: "recommended", label: "Recommandées" },
  { key: "distance", label: "Les plus proches" },
  { key: "rating", label: "Mieux notées" },
];

/** Une balade est-elle dans la zone actuellement visible ? */
function inViewport(w: Walk, vp: Viewport | null): boolean {
  if (!vp) return true;
  return Math.abs(w.start_lat - vp.latitude) <= vp.latitudeDelta / 2 &&
    Math.abs(w.start_lng - vp.longitude) <= vp.longitudeDelta / 2;
}

/** Regroupe les balades proches en clusters selon le niveau de zoom. */
function clusterWalks(list: Walk[], zoom: number) {
  const cell = (360 / (256 * Math.pow(2, Math.max(0, zoom || 12)))) * 56;
  const groups = new Map<string, Walk[]>();
  list.forEach((w) => {
    const k = Math.floor(w.start_lng / cell) + ":" + Math.floor(w.start_lat / cell);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(w);
  });
  const out: { count: number; coordinate: LatLng; walk: Walk | null }[] = [];
  groups.forEach((arr) => {
    if (arr.length === 1) {
      out.push({ count: 1, coordinate: { latitude: arr[0].start_lat, longitude: arr[0].start_lng }, walk: arr[0] });
    } else {
      const lat = arr.reduce((s, w) => s + w.start_lat, 0) / arr.length;
      const lng = arr.reduce((s, w) => s + w.start_lng, 0) / arr.length;
      out.push({ count: arr.length, coordinate: { latitude: lat, longitude: lng }, walk: null });
    }
  });
  return out;
}

export default function ExploreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [walks, setWalks] = useState<Walk[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [filterOpen, setFilterOpen] = useState(false);
  const [digestOpen, setDigestOpen] = useState(false);
  const [filters, setFilters] = useState({ environment: "all", difficulty: "all", dog_freedom: "all", min_rating: 0, max_duration: 0 });
  const [envFilter, setEnvFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<"recommended" | "distance" | "rating">("recommended");
  const [showWalks, setShowWalks] = useState(false);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [mapFocus, setMapFocus] = useState<{ id: number; coordinate: LatLng; zoom: number } | undefined>(undefined);
  const focusSeq = useRef(0);
  const { loc: userLoc, status: locStatus } = useUserLocation(sortKey === "distance");

  // Région initiale stable (calculée une seule fois) : la carte ne se recentre jamais toute seule.
  const initialRegion = useMemo(() => {
    if (userLoc) return { latitude: userLoc.lat, longitude: userLoc.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 };
    return { latitude: 48.85, longitude: 2.35, latitudeDelta: 0.12, longitudeDelta: 0.12 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setErr("");
    try {
      const qs = new URLSearchParams();
      if (filters.difficulty !== "all") qs.set("difficulty", filters.difficulty);
      if (filters.dog_freedom !== "all") qs.set("dog_freedom", filters.dog_freedom);
      if (filters.min_rating > 0) qs.set("min_rating", String(filters.min_rating));
      if (filters.max_duration > 0) qs.set("max_duration", String(filters.max_duration));
      const data = await api(`/walks?${qs.toString()}`);
      setWalks(data);
    } catch (e: any) {
      setErr(e.message || "Échec du chargement");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, [filters.difficulty, filters.dog_freedom, filters.min_rating, filters.max_duration]);

  // Balades affichées : seulement si l'utilisateur a cherché dans la zone OU a choisi un filtre,
  // et uniquement celles qui sont dans la zone visible. Aucun recentrage de la carte.
  const activeWalks = useMemo(() => {
    if (!showWalks && envFilter === "all") return [];
    return walks.filter((w) => (envFilter === "all" || w.environment === envFilter) && inViewport(w, viewport));
  }, [walks, envFilter, showWalks, viewport]);

  const displayWalks = useMemo(() => {
    let list = activeWalks.slice();
    if (sortKey === "distance" && userLoc) {
      list = list.map((w) => ({ ...w, _dist: distanceKm(userLoc, { lat: w.start_lat, lng: w.start_lng }) })).sort((a, b) => a._dist - b._dist);
    } else if (sortKey === "rating") {
      list = list.sort((a, b) => (b.rating_avg || 0) - (a.rating_avg || 0));
    } else {
      list = list.sort((a, b) => new Date(b.last_verified_at).getTime() - new Date(a.last_verified_at).getTime());
    }
    return list;
  }, [activeWalks, sortKey, userLoc]);

  const markers = useMemo(() => {
    const clusters = clusterWalks(activeWalks, viewport?.zoom || 12);
    return clusters.map((c, i) => c.count === 1
      ? { id: c.walk.id, coordinate: c.coordinate, color: walkFreedomColor[c.walk.dog_freedom], label: c.walk.title, onPress: () => router.push(`/walk/${c.walk.id}`) }
      : { id: `cluster-${i}`, coordinate: c.coordinate, count: c.count, onPress: () => { focusSeq.current += 1; setMapFocus({ id: focusSeq.current, coordinate: c.coordinate, zoom: Math.min(18, (viewport?.zoom || 12) + 2) }); } });
  }, [activeWalks, viewport, router]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      {/* En-tête collant */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerTop}>
          <Text style={styles.brand}>Doggo</Text>
          <View style={styles.headerActions}>
            <Pressable testID="open-digest" style={styles.iconBtn} onPress={() => setDigestOpen(true)}>
              <Sparkle size={20} color={colors.brandPrimary} weight="fill" />
            </Pressable>
            <Pressable testID="toggle-view-mode" style={styles.iconBtn} onPress={() => setViewMode(viewMode === "map" ? "list" : "map")}>
              {viewMode === "map" ? <ListIcon size={20} color={colors.onSurface} /> : <MapTrifold size={20} color={colors.onSurface} />}
            </Pressable>
            <Pressable testID="open-filters" style={styles.iconBtn} onPress={() => setFilterOpen(true)}>
              <SlidersHorizontal size={20} color={colors.onSurface} />
            </Pressable>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {ENV_OPTIONS.map((e) => (
            <Pressable key={e} testID={`env-chip-${e}`} onPress={() => setEnvFilter(e)}
              style={[styles.chip, envFilter === e && styles.chipActive]}>
              <Text style={[styles.chipText, envFilter === e && styles.chipTextActive]}>{e === "all" ? "Tous" : environmentLabels[e]}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {SORT_OPTIONS.map((s) => (
            <Pressable key={s.key} testID={`sort-${s.key}`} onPress={() => setSortKey(s.key)}
              style={[styles.chipSmall, sortKey === s.key && styles.chipSmallActive]}>
              <Text style={[styles.chipSmallText, sortKey === s.key && styles.chipSmallTextActive]}>{s.label}</Text>
            </Pressable>
          ))}
          {sortKey === "distance" && locStatus === "denied" && (
            <Text style={styles.locWarn}>Localisation refusée — activez-la pour trier par distance</Text>
          )}
          {sortKey === "distance" && locStatus === "requesting" && (
            <Text style={styles.locWarn}>Localisation en cours…</Text>
          )}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>
      ) : err ? (
        <View style={styles.center}>
          <Text style={styles.err}>{err}</Text>
          <Pressable style={styles.retryBtn} onPress={load}><Text style={styles.retryText}>Réessayer</Text></Pressable>
        </View>
      ) : viewMode === "map" ? (
        <View style={{ flex: 1 }}>
          <DoggoMap
            testID="explore-map"
            initialRegion={initialRegion}
            markers={markers}
            mapFocus={mapFocus}
            onRegionChange={setViewport}
            style={{ flex: 1 }}
          />
          {/* Bouton « Rechercher dans cette zone » */}
          <View pointerEvents="box-none" style={styles.searchAreaWrap}>
            <Pressable testID="search-area" style={styles.searchAreaBtn} onPress={() => setShowWalks(true)}>
              <MagnifyingGlass size={18} color={colors.onBrand} weight="bold" />
              <Text style={styles.searchAreaText}>{showWalks ? "Réactualiser la zone" : "Rechercher dans cette zone"}</Text>
            </Pressable>
          </View>
          {/* Carrousel horizontal des balades de la zone */}
          <View style={[styles.carouselWrap, { bottom: spacing.md }]} pointerEvents="box-none">
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={displayWalks}
              keyExtractor={(w, i) => w.id || String(i)}
              contentContainerStyle={{ paddingHorizontal: spacing.md, gap: spacing.md }}
              renderItem={({ item }) => <MiniCard walk={item} onPress={() => router.push(`/walk/${item.id}`)} />}
              ListEmptyComponent={
                <View style={styles.emptyMini}>
                  <Text style={styles.mutedText}>
                    {(!showWalks && envFilter === "all") ? "Appuyez sur « Rechercher dans cette zone » pour voir les balades" : "Aucune balade dans cette zone"}
                  </Text>
                </View>
              }
            />
          </View>
        </View>
      ) : (
        <FlatList
          data={displayWalks}
          keyExtractor={(w, i) => w.id || String(i)}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          renderItem={({ item }) => <WalkCard walk={item} onPress={() => router.push(`/walk/${item.id}`)} />}
          ListEmptyComponent={<View style={styles.center}><Text style={styles.mutedText}>{(!showWalks && envFilter === "all") ? "Recherchez des balades depuis l'onglet Carte" : "Aucune balade ne correspond à vos filtres"}</Text></View>}
        />
      )}

      <FilterModal open={filterOpen} onClose={() => setFilterOpen(false)} filters={filters} setFilters={setFilters} />
      <DigestModal open={digestOpen} onClose={() => setDigestOpen(false)} userLoc={userLoc} />
    </View>
  );
}

export function MiniCard({ walk, onPress }: { walk: any; onPress: () => void }) {
  const { user } = useAuth();
  const { isFavorite, toggle } = useFavorites();
  const fav = isFavorite(walk.id);
  return (
    <Pressable testID={`walk-mini-${walk.id}`} style={styles.miniCard} onPress={onPress}>
      <View style={[styles.miniStrip, { backgroundColor: walkFreedomColor[walk.dog_freedom] }]} />
      {user && (
        <Pressable testID={`fav-mini-${walk.id}`} hitSlop={8} style={styles.miniFav} onPress={() => toggle(walk.id)}>
          <Heart size={18} color={fav ? colors.error : colors.muted} weight={fav ? "fill" : "regular"} />
        </Pressable>
      )}
      <View style={{ padding: spacing.md, gap: 4 }}>
        <Text style={styles.miniTitle} numberOfLines={1}>{walk.title}</Text>
        <Text style={styles.miniSub} numberOfLines={1}>{environmentLabels[walk.environment]} · {difficultyLabels[walk.difficulty]}</Text>
        <View style={styles.miniStatsRow}>
          <View style={styles.miniStat}><Clock size={13} color={colors.muted} /><Text style={styles.miniStatText}>{formatDuration(walk.duration_min)}</Text></View>
          <View style={styles.miniStat}><TrendUp size={13} color={colors.muted} /><Text style={styles.miniStatText}>{walk.distance_km} km</Text></View>
          <View style={styles.miniStat}><Star size={13} color={colors.warning} weight="fill" /><Text style={styles.miniStatText}>{walk.rating_avg || "—"}</Text></View>
        </View>
      </View>
    </Pressable>
  );
}

export function WalkCard({ walk, onPress }: { walk: any; onPress: () => void }) {
  const { user } = useAuth();
  const { isFavorite, toggle } = useFavorites();
  const fav = isFavorite(walk.id);
  return (
    <Pressable testID={`walk-card-${walk.id}`} style={styles.card} onPress={onPress}>
      <View style={styles.cardRow}>
        <View style={[styles.cardStripe, { backgroundColor: walkFreedomColor[walk.dog_freedom] }]} />
        <View style={{ flex: 1, padding: spacing.md, gap: 6 }}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>{walk.title}</Text>
            {user && (
              <Pressable testID={`fav-card-${walk.id}`} hitSlop={8} onPress={() => toggle(walk.id)}>
                <Heart size={20} color={fav ? colors.error : colors.muted} weight={fav ? "fill" : "regular"} />
              </Pressable>
            )}
          </View>
          <Text style={styles.cardSub}>{environmentLabels[walk.environment]} · {difficultyLabels[walk.difficulty]} · {freedomLabels[walk.dog_freedom]}</Text>
          <View style={styles.statsRow}>
            <Stat icon={<Clock size={14} color={colors.muted} />} value={formatDuration(walk.duration_min)} />
            <Stat icon={<TrendUp size={14} color={colors.muted} />} value={`${walk.distance_km} km`} />
            <Stat icon={<Star size={14} color={colors.warning} weight="fill" />} value={walk.rating_avg ? walk.rating_avg.toFixed(1) : "—"} extra={walk.rating_count ? `(${walk.rating_count})` : ""} />
          </View>
          <Text style={styles.verified}>Vérifiée {timeAgo(walk.last_verified_at)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function Stat({ icon, value, extra }: any) {
  return (
    <View style={styles.stat}>
      {icon}
      <Text style={styles.statText}>{value}{extra ? ` ${extra}` : ""}</Text>
    </View>
  );
}

function FilterModal({ open, onClose, filters, setFilters }: any) {
  const insets = useSafeAreaInsets();
  const [local, setLocal] = useState(filters);
  useEffect(() => { setLocal(filters); }, [filters, open]);

  const apply = () => { setFilters(local); onClose(); };
  const clear = () => setLocal({ environment: "all", difficulty: "all", dog_freedom: "all", min_rating: 0, max_duration: 0 });

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Filtres</Text>
            <Pressable testID="close-filters" onPress={onClose}><X size={22} color={colors.onSurface} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.md, gap: spacing.lg }}>
            <FilterGroup label="Difficulté" options={DIFF_OPTIONS} value={local.difficulty} onChange={(v: string) => setLocal({ ...local, difficulty: v })} labels={{ all: "Toutes", ...difficultyLabels }} />
            <FilterGroup label="Liberté du chien" options={FREE_OPTIONS} value={local.dog_freedom} onChange={(v: string) => setLocal({ ...local, dog_freedom: v })} labels={{ all: "Toutes", ...freedomLabels }} />
            <FilterGroup label="Durée maximale" options={["0", "30", "60", "90", "120"]} value={String(local.max_duration)} onChange={(v: string) => setLocal({ ...local, max_duration: Number(v) })} labels={{ "0": "Toutes", "30": "≤ 30 min", "60": "≤ 1 h", "90": "≤ 1 h 30", "120": "≤ 2 h" }} />
            <FilterGroup label="Note minimale" options={["0", "3", "4", "4.5"]} value={String(local.min_rating)} onChange={(v: string) => setLocal({ ...local, min_rating: Number(v) })} labels={{ "0": "Toutes", "3": "3+", "4": "4+", "4.5": "4,5+" }} />
          </ScrollView>
          <View style={styles.sheetActions}>
            <Pressable testID="clear-filters" style={styles.secondaryBtn} onPress={clear}><Text style={styles.secondaryBtnText}>Réinitialiser</Text></Pressable>
            <Pressable testID="apply-filters" style={styles.primaryBtn} onPress={apply}><Text style={styles.primaryBtnText}>Appliquer</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function FilterGroup({ label, options, value, onChange, labels }: any) {
  return (
    <View>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {options.map((o: string) => (
          <Pressable key={o} testID={`filter-${label}-${o}`} onPress={() => onChange(o)} style={[styles.chip, value === o && styles.chipActive]}>
            <Text style={[styles.chipText, value === o && styles.chipTextActive]}>{labels[o] ?? o}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm, gap: spacing.sm },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg },
  brand: { fontSize: 22, fontWeight: "700", color: colors.onSurface },
  headerActions: { flexDirection: "row", gap: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  chipsRow: { paddingHorizontal: spacing.lg, gap: spacing.sm, height: 44, alignItems: "center" },
  chip: { height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", flexShrink: 0, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: colors.onBrand },
  chipSmall: { height: 28, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: "transparent", alignItems: "center", justifyContent: "center", flexShrink: 0, borderWidth: 1, borderColor: colors.border },
  chipSmallActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  chipSmallText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  chipSmallTextActive: { color: colors.brandPrimary },
  locWarn: { alignSelf: "center", color: colors.warning, fontSize: 11, fontWeight: "600", paddingHorizontal: spacing.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, gap: spacing.md },
  err: { color: colors.error, textAlign: "center" },
  mutedText: { color: colors.muted, fontSize: 14 },
  retryBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.md },
  retryText: { color: colors.onBrand, fontWeight: "600" },
  searchAreaWrap: { position: "absolute", top: spacing.md, left: 0, right: 0, alignItems: "center" },
  searchAreaBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.lg, paddingVertical: 11, borderRadius: radius.pill, ...shadow() },
  searchAreaText: { color: colors.onBrand, fontWeight: "700", fontSize: 14 },
  carouselWrap: { position: "absolute", left: 0, right: 0 },
  emptyMini: { padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  miniCard: { width: 240, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: colors.border, ...shadow() },
  miniFav: { position: "absolute", right: 8, top: 12, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", zIndex: 2, borderWidth: 1, borderColor: colors.border },
  miniStrip: { height: 4 },
  miniTitle: { fontSize: 15, fontWeight: "700", color: colors.onSurface, paddingRight: 28 },
  miniSub: { fontSize: 12, color: colors.muted },
  miniStatsRow: { flexDirection: "row", gap: spacing.md, marginTop: 4 },
  miniStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  miniStatText: { fontSize: 12, color: colors.onSurface, fontWeight: "500" },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  cardRow: { flexDirection: "row" },
  cardStripe: { width: 6 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.onSurface },
  cardSub: { fontSize: 13, color: colors.muted },
  statsRow: { flexDirection: "row", gap: spacing.md, marginTop: 4 },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
  statText: { fontSize: 13, color: colors.onSurface, fontWeight: "500" },
  verified: { fontSize: 11, color: colors.muted, marginTop: 4 },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.md, maxHeight: "85%" },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  groupLabel: { fontSize: 13, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  sheetActions: { flexDirection: "row", gap: spacing.sm },
  primaryBtn: { flex: 1, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: "center" },
  primaryBtnText: { color: colors.onBrand, fontWeight: "700" },
  secondaryBtn: { flex: 1, backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, paddingVertical: 14, alignItems: "center" },
  secondaryBtnText: { color: colors.onSurface, fontWeight: "600" },
});

function shadow() {
  return { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 };
}
