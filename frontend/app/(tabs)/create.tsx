import React, { useEffect, useState, useRef } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, ActivityIndicator, Alert, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { Play, Stop, ArrowClockwise, Check, MapTrifold, PathIcon, MagicWand } from "phosphor-react-native";
import { colors, radius, spacing } from "../../src/theme";
import { DoggoMap, LatLng, SegmentInput } from "../../src/DoggoMap";
import { api } from "../../src/api";
import { useAuth } from "../../src/AuthContext";
import { environmentLabels, difficultyLabels, freedomLabels } from "../../src/labels";

type Freedom = "free" | "caution" | "leash";

export default function CreateScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"draw" | "record">("draw");
  const [points, setPoints] = useState<LatLng[]>([]);
  const [freedom, setFreedom] = useState<Freedom>("free");
  const [recording, setRecording] = useState(false);
  const [recordingSub, setRecordingSub] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [environment, setEnvironment] = useState("forest");
  const [difficulty, setDifficulty] = useState("easy");
  const [dogFreedom, setDogFreedom] = useState("free");
  const [duration, setDuration] = useState("30");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [initialRegion, setInitialRegion] = useState<any>({ latitude: 48.85, longitude: 2.35, latitudeDelta: 0.05, longitudeDelta: 0.05 });

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({});
          setInitialRegion({ latitude: loc.coords.latitude, longitude: loc.coords.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 });
        }
      } catch {}
    })();
    return () => { if (recordingSub) recordingSub.remove(); };
  }, []);

  const onMapPress = (c: LatLng) => {
    if (mode === "draw") setPoints((p) => [...p, c]);
  };
  const undo = () => setPoints((p) => p.slice(0, -1));
  const clear = () => setPoints([]);

  const snapToPath = async () => {
    if (points.length < 2) { setErr("Add at least 2 points before snapping"); return; }
    setErr("");
    setSaving(true);
    try {
      const data = await api("/routing/snap", {
        method: "POST",
        body: JSON.stringify({
          points: points.map((p) => [p.latitude, p.longitude]),
          profile: "foot",
        }),
      });
      const snapped = data.coordinates.map((c: number[]) => ({ latitude: c[0], longitude: c[1] }));
      setPoints(snapped);
    } catch (e: any) {
      setErr("Could not snap to a path — try again or keep the direct line");
    } finally { setSaving(false); }
  };

  const startRecording = async () => {
    if (Platform.OS === "web") {
      setErr("Live recording works on device only. Use Draw mode on web.");
      return;
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") { setErr("Location permission required"); return; }
    setPoints([]); setRecording(true); setErr("");
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5, timeInterval: 2000 },
      (loc) => {
        setPoints((p) => [...p, { latitude: loc.coords.latitude, longitude: loc.coords.longitude }]);
      }
    );
    setRecordingSub(sub);
  };
  const stopRecording = () => {
    if (recordingSub) recordingSub.remove();
    setRecordingSub(null);
    setRecording(false);
  };

  const publish = async () => {
    setErr("");
    if (!user) { setErr("Please sign in to publish"); return; }
    if (!title.trim()) { setErr("Title is required"); return; }
    if (points.length < 2) { setErr("Add at least 2 route points"); return; }
    const dmin = parseInt(duration, 10);
    if (!dmin || dmin < 1) { setErr("Enter a valid duration"); return; }
    setSaving(true);
    try {
      const segment: SegmentInput = { coordinates: points, freedom };
      const walk = await api("/walks", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          difficulty, environment,
          dog_freedom: dogFreedom,
          duration_min: dmin,
          segments: [{ freedom, coordinates: points.map((p) => [p.latitude, p.longitude]) }],
          features: [],
          pois: [], hazards: [],
        }),
      });
      // reset
      setPoints([]); setTitle(""); setDescription(""); setDuration("30");
      router.push(`/walk/${walk.id}`);
    } catch (e: any) {
      setErr(e.message || "Failed to publish");
    } finally { setSaving(false); }
  };

  const segments: SegmentInput[] = points.length >= 2 ? [{ coordinates: points, freedom }] : [];
  const markers = points.length ? [
    { id: "start", coordinate: points[0], color: colors.brandPrimary, label: "Start" },
    ...(points.length > 1 ? [{ id: "end", coordinate: points[points.length - 1], color: colors.brandSecondary, label: "End" }] : []),
  ] : [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Create walk</Text>
        <View style={styles.modeRow}>
          <Pressable testID="mode-draw" onPress={() => { stopRecording(); setMode("draw"); }} style={[styles.modeBtn, mode === "draw" && styles.modeBtnActive]}>
            <PathIcon size={16} color={mode === "draw" ? colors.onBrand : colors.onSurface} />
            <Text style={[styles.modeText, mode === "draw" && styles.modeTextActive]}>Draw</Text>
          </Pressable>
          <Pressable testID="mode-record" onPress={() => setMode("record")} style={[styles.modeBtn, mode === "record" && styles.modeBtnActive]}>
            <MapTrifold size={16} color={mode === "record" ? colors.onBrand : colors.onSurface} />
            <Text style={[styles.modeText, mode === "record" && styles.modeTextActive]}>Record GPS</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
        <View style={styles.mapWrap}>
          <DoggoMap
            testID="create-map"
            initialRegion={initialRegion}
            segments={segments}
            markers={markers}
            onPress={onMapPress}
            showsUserLocation
            style={{ flex: 1 }}
          />
        </View>

        <View style={styles.section}>
          {mode === "draw" ? (
            <>
              <Text style={styles.hint}>Tap the map to add route points. {points.length} points added.</Text>
              <View style={styles.actionsRow}>
                <Pressable testID="undo-point" style={styles.smallBtn} onPress={undo}><ArrowClockwise size={16} color={colors.onSurface} /><Text style={styles.smallBtnText}>Undo</Text></Pressable>
                <Pressable testID="clear-points" style={styles.smallBtn} onPress={clear}><Text style={styles.smallBtnText}>Clear</Text></Pressable>
                <Pressable testID="snap-path" style={[styles.smallBtn, { backgroundColor: colors.brandTertiary }]} onPress={snapToPath} disabled={saving}>
                  <MagicWand size={16} color={colors.brandPrimary} weight="fill" />
                  <Text style={[styles.smallBtnText, { color: colors.brandPrimary }]}>Snap to path</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.hint}>{recording ? `Recording… ${points.length} points captured.` : "Start recording to capture your route as you walk."}</Text>
              <View style={styles.actionsRow}>
                {recording ? (
                  <Pressable testID="stop-record" style={[styles.smallBtn, { backgroundColor: colors.error }]} onPress={stopRecording}>
                    <Stop size={16} color="#fff" weight="fill" /><Text style={[styles.smallBtnText, { color: "#fff" }]}>Stop</Text>
                  </Pressable>
                ) : (
                  <Pressable testID="start-record" style={[styles.smallBtn, { backgroundColor: colors.brandPrimary }]} onPress={startRecording}>
                    <Play size={16} color="#fff" weight="fill" /><Text style={[styles.smallBtnText, { color: "#fff" }]}>Start</Text>
                  </Pressable>
                )}
                <Pressable testID="clear-points" style={styles.smallBtn} onPress={clear}><Text style={styles.smallBtnText}>Clear</Text></Pressable>
              </View>
            </>
          )}

          <Text style={styles.groupLabel}>Segment freedom</Text>
          <View style={styles.chipRow}>
            {(["free", "caution", "leash"] as Freedom[]).map((f) => (
              <Pressable key={f} testID={`freedom-${f}`} onPress={() => setFreedom(f)} style={[styles.chip, freedom === f && styles.chipActive]}>
                <View style={[styles.dot, { backgroundColor: f === "free" ? colors.success : f === "caution" ? colors.warning : colors.error }]} />
                <Text style={[styles.chipText, freedom === f && styles.chipTextActive]}>{f === "free" ? "Off-leash" : f === "caution" ? "Caution" : "Leash"}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.groupLabel}>Details</Text>
          <TextInput testID="walk-title" style={styles.input} placeholder="Walk title" placeholderTextColor={colors.muted} value={title} onChangeText={setTitle} />
          <TextInput testID="walk-desc" style={[styles.input, { minHeight: 80 }]} placeholder="Description (optional)" placeholderTextColor={colors.muted} value={description} onChangeText={setDescription} multiline />
          <TextInput testID="walk-duration" style={styles.input} placeholder="Duration in minutes" placeholderTextColor={colors.muted} value={duration} onChangeText={setDuration} keyboardType="number-pad" />

          <Text style={styles.subLabel}>Environment</Text>
          <View style={styles.chipRow}>
            {Object.entries(environmentLabels).map(([k, v]) => (
              <Pressable key={k} testID={`env-${k}`} onPress={() => setEnvironment(k)} style={[styles.chip, environment === k && styles.chipActive]}>
                <Text style={[styles.chipText, environment === k && styles.chipTextActive]}>{v}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.subLabel}>Difficulty</Text>
          <View style={styles.chipRow}>
            {Object.entries(difficultyLabels).map(([k, v]) => (
              <Pressable key={k} testID={`diff-${k}`} onPress={() => setDifficulty(k)} style={[styles.chip, difficulty === k && styles.chipActive]}>
                <Text style={[styles.chipText, difficulty === k && styles.chipTextActive]}>{v}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.subLabel}>Overall dog freedom</Text>
          <View style={styles.chipRow}>
            {Object.entries(freedomLabels).map(([k, v]) => (
              <Pressable key={k} testID={`dogfree-${k}`} onPress={() => setDogFreedom(k)} style={[styles.chip, dogFreedom === k && styles.chipActive]}>
                <Text style={[styles.chipText, dogFreedom === k && styles.chipTextActive]}>{v}</Text>
              </Pressable>
            ))}
          </View>

          {!!err && <Text style={styles.err}>{err}</Text>}

          <Pressable testID="publish-walk" style={styles.primaryBtn} onPress={publish} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : (<><Check size={18} color="#fff" /><Text style={styles.primaryBtnText}>Publish walk</Text></>)}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  title: { fontSize: 22, fontWeight: "700", color: colors.onSurface },
  modeRow: { flexDirection: "row", gap: spacing.sm },
  modeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  modeBtnActive: { backgroundColor: colors.brandPrimary },
  modeText: { fontSize: 13, fontWeight: "600", color: colors.onSurface },
  modeTextActive: { color: colors.onBrand },
  mapWrap: { height: 340, marginBottom: spacing.md },
  section: { paddingHorizontal: spacing.lg, gap: spacing.sm, marginBottom: spacing.lg },
  hint: { color: colors.muted, fontSize: 13 },
  actionsRow: { flexDirection: "row", gap: spacing.sm },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  smallBtnText: { color: colors.onSurface, fontWeight: "600", fontSize: 13 },
  groupLabel: { fontSize: 13, fontWeight: "700", color: colors.onSurface, marginTop: spacing.md, textTransform: "uppercase", letterSpacing: 0.5 },
  subLabel: { fontSize: 12, fontWeight: "700", color: colors.muted, marginTop: spacing.sm, textTransform: "uppercase" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, color: colors.muted, fontWeight: "600" },
  chipTextActive: { color: colors.onBrand },
  dot: { width: 10, height: 10, borderRadius: 5 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 15, color: colors.onSurface, backgroundColor: colors.surfaceSecondary },
  err: { color: colors.error, fontSize: 13, marginTop: spacing.sm },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.md },
  primaryBtnText: { color: colors.onBrand, fontWeight: "700", fontSize: 15 },
});
