import React, { useEffect, useState } from "react";
import { View, Text, TextInput, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MagnifyingGlass } from "phosphor-react-native";
import { api } from "../../src/api";
import { colors, radius, spacing } from "../../src/theme";
import { WalkCard } from "./explore";

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const [walks, setWalks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await api("/walks");
        setWalks(data);
      } catch {} finally { setLoading(false); }
    })();
  }, []);

  const filtered = walks.filter((w) =>
    q.trim() === "" ||
    w.title.toLowerCase().includes(q.toLowerCase()) ||
    (w.description || "").toLowerCase().includes(q.toLowerCase())
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Search</Text>
        <View style={styles.searchBox}>
          <MagnifyingGlass size={18} color={colors.muted} />
          <TextInput
            testID="search-input"
            style={styles.input}
            placeholder="Search walks by name or description"
            placeholderTextColor={colors.muted}
            value={q}
            onChangeText={setQ}
          />
        </View>
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(w) => w.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl }}
          renderItem={({ item }) => <WalkCard walk={item} onPress={() => router.push(`/walk/${item.id}`)} />}
          ListEmptyComponent={<View style={styles.center}><Text style={styles.muted}>No walks match "{q}"</Text></View>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  title: { fontSize: 22, fontWeight: "700", color: colors.onSurface },
  searchBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, paddingHorizontal: spacing.md },
  input: { flex: 1, paddingVertical: 12, color: colors.onSurface, fontSize: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  muted: { color: colors.muted },
});
