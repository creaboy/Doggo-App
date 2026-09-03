import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl, FlatList, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Star, MapPin, Clock, TrendUp, X, SlidersHorizontal, List as ListIcon, MapTrifold, Heart } from "phosphor-react-native";
import { colors, radius, spacing } from "../../src/theme";
import { api } from "../../src/api";
import { DoggoMap } from "../../src/DoggoMap";
import { environmentLabels, difficultyLabels, freedomLabels, formatDuration, timeAgo, walkFreedomColor } from "../../src/labels";
import { useFavorites } from "../../src/FavoritesContext";
import { useAuth } from "../../src/AuthContext";

type Walk = any;

const ENV_OPTIONS = ["all", "forest", "fields", "city", "beach", "mountain", "mixed"];
const DIFF_OPTIONS = ["all", "easy", "moderate", "sporty"];
const FREE_OPTIONS = ["all", "free", "partial", "leash"];

export default function ExploreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [walks, setWalks] = useState<Walk[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState({ environment: "all", difficulty: "all", dog_freedom: "all", min_rating: 0, max_duration: 0 });
  const [envFilter, setEnvFilter] = useState<string>("all");

  const load = async () => {
    setErr("");
    try {
      const qs = new URLSearchParams();
      const eff = { ...filters, environment: envFilter !== "all" ? envFilter : filters.environment };
      if (eff.environment !== "all") qs.set("environment", eff.environment);
      if (eff.difficulty !== "all") qs.set("difficulty", eff.difficulty);
      if (eff.dog_freedom !== "all") qs.set("dog_freedom", eff.dog_freedom);
      if (eff.min_rating > 0) qs.set("min_rating", String(eff.min_rating));
      if (eff.max_duration > 0) qs.set("max_duration", String(eff.max_duration));
      const data = await api(`/walks?${qs.toString()}`);
      setWalks(data);
    } catch (e: any) {
      setErr(e.message || "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, [filters, envFilter]);

  const region = useMemo(() => {
    if (walks.length === 0) return { latitude: 48.85, longitude: 2.35, latitudeDelta: 4, longitudeDelta: 4 };
    const lats = walks.map((w) => w.start_lat);
    const lngs = walks.map((w) => w.start_lng);
    const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const latD = Math.max(0.05, (Math.max(...lats) - Math.min(...lats)) * 1.5);
    const lngD = Math.max(0.05, (Math.max(...lngs) - Math.min(...lngs)) * 1.5);
    return { latitude: lat, longitude: lng, latitudeDelta: latD, longitudeDelta: lngD };
  }, [walks]);

  const markers = walks.map((w) => ({
    id: w.id,
    coordinate: { latitude: w.start_lat, longitude: w.start_lng },
    color: walkFreedomColor[w.dog_freedom],
    label: w.title,
    onPress: () => router.push(`/walk/${w.id}`),
  }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      {/* Sticky Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerTop}>
          <Text style={styles.brand}>Doggo</Text>
          <View style={styles.headerActions}>
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
              <Text style={[styles.chipText, envFilter === e && styles.chipTextActive]}>{e === "all" ? "All" : environmentLabels[e]}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>
      ) : err ? (
        <View style={styles.center}>
          <Text style={styles.err}>{err}</Text>
          <Pressable style={styles.retryBtn} onPress={load}><Text style={styles.retryText}>Retry</Text></Pressable>
        </View>
      ) : viewMode === "map" ? (
        <View style={{ flex: 1 }}>
          <DoggoMap
            testID="explore-map"
            initialRegion={region}
            markers={markers}
            style={{ flex: 1 }}
          />
          {/* Horizontal walk carousel */}
          <View style={[styles.carouselWrap, { bottom: spacing.md }]}>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={walks}
              keyExtractor={(w) => w.id}
              contentContainerStyle={{ paddingHorizontal: spacing.md, gap: spacing.md }}
              renderItem={({ item }) => <MiniCard walk={item} onPress={() => router.push(`/walk/${item.id}`)} />}
              ListEmptyComponent={<View style={styles.emptyMini}><Text style={styles.mutedText}>No walks match your filters</Text></View>}
            />
          </View>
        </View>
      ) : (
        <FlatList
          data={walks}
          keyExtractor={(w) => w.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          renderItem={({ item }) => <WalkCard walk={item} onPress={() => router.push(`/walk/${item.id}`)} />}
          ListEmptyComponent={<View style={styles.center}><Text style={styles.mutedText}>No walks match your filters</Text></View>}
        />
      )}

      <FilterModal open={filterOpen} onClose={() => setFilterOpen(false)} filters={filters} setFilters={setFilters} />
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
          <Text style={styles.verified}>Verified {timeAgo(walk.last_verified_at)}</Text>
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
            <Text style={styles.sheetTitle}>Filters</Text>
            <Pressable testID="close-filters" onPress={onClose}><X size={22} color={colors.onSurface} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.md, gap: spacing.lg }}>
            <FilterGroup label="Difficulty" options={DIFF_OPTIONS} value={local.difficulty} onChange={(v) => setLocal({ ...local, difficulty: v })} labels={{ all: "All", ...difficultyLabels }} />
            <FilterGroup label="Dog freedom" options={FREE_OPTIONS} value={local.dog_freedom} onChange={(v) => setLocal({ ...local, dog_freedom: v })} labels={{ all: "All", ...freedomLabels }} />
            <FilterGroup label="Max duration" options={["0", "30", "60", "90", "120"]} value={String(local.max_duration)} onChange={(v) => setLocal({ ...local, max_duration: Number(v) })} labels={{ "0": "Any", "30": "≤30min", "60": "≤1h", "90": "≤1h30", "120": "≤2h" }} />
            <FilterGroup label="Minimum rating" options={["0", "3", "4", "4.5"]} value={String(local.min_rating)} onChange={(v) => setLocal({ ...local, min_rating: Number(v) })} labels={{ "0": "Any", "3": "3+", "4": "4+", "4.5": "4.5+" }} />
          </ScrollView>
          <View style={styles.sheetActions}>
            <Pressable testID="clear-filters" style={styles.secondaryBtn} onPress={clear}><Text style={styles.secondaryBtnText}>Reset</Text></Pressable>
            <Pressable testID="apply-filters" style={styles.primaryBtn} onPress={apply}><Text style={styles.primaryBtnText}>Apply</Text></Pressable>
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, gap: spacing.md },
  err: { color: colors.error, textAlign: "center" },
  mutedText: { color: colors.muted, fontSize: 14 },
  retryBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.md },
  retryText: { color: colors.onBrand, fontWeight: "600" },
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
