import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../src/AuthContext";
import { colors, radius, spacing } from "../../src/theme";

export default function LoginScreen() {
  const { loginEmail, registerEmail, loginGoogle } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("demo@doggo.app");
  const [password, setPassword] = useState("demo1234");
  const [username, setUsername] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      if (mode === "login") await loginEmail(email.trim(), password);
      else await registerEmail(email.trim(), password, username.trim() || email.split("@")[0]);
    } catch (e: any) {
      setErr(e.message || "Error");
    } finally { setBusy(false); }
  };

  const googleLogin = async () => {
    setErr(""); setBusy(true);
    try { await loginGoogle(); } catch (e: any) { setErr(e.message || "Google sign-in failed"); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.logoWrap}>
          <View style={styles.logoBox}><Text style={styles.logoText}>Doggo</Text></View>
          <Text style={styles.tagline}>Discover dog-friendly walks around you.</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.tabsRow}>
            <Pressable testID="auth-tab-login" style={[styles.tab, mode === "login" && styles.tabActive]} onPress={() => setMode("login")}>
              <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>Sign in</Text>
            </Pressable>
            <Pressable testID="auth-tab-register" style={[styles.tab, mode === "register" && styles.tabActive]} onPress={() => setMode("register")}>
              <Text style={[styles.tabText, mode === "register" && styles.tabTextActive]}>Create account</Text>
            </Pressable>
          </View>

          {mode === "register" && (
            <TextInput testID="auth-username-input" style={styles.input} placeholder="Username" placeholderTextColor={colors.muted}
              value={username} onChangeText={setUsername} autoCapitalize="none" />
          )}
          <TextInput testID="auth-email-input" style={styles.input} placeholder="Email" placeholderTextColor={colors.muted}
            value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <TextInput testID="auth-password-input" style={styles.input} placeholder="Password" placeholderTextColor={colors.muted}
            value={password} onChangeText={setPassword} secureTextEntry />

          {!!err && <Text testID="auth-error" style={styles.err}>{err}</Text>}

          <Pressable testID="auth-submit-button" style={styles.primaryBtn} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{mode === "login" ? "Sign in" : "Create account"}</Text>}
          </Pressable>

          <View style={styles.divider}><View style={styles.line} /><Text style={styles.orText}>OR</Text><View style={styles.line} /></View>

          <Pressable testID="auth-google-button" style={styles.googleBtn} onPress={googleLogin} disabled={busy}>
            <Text style={styles.googleBtnText}>Continue with Google</Text>
          </Pressable>

          <Pressable testID="auth-guest-button" style={styles.guestBtn} onPress={() => router.replace("/(tabs)/explore")}>
            <Text style={styles.guestBtnText}>Browse as guest</Text>
          </Pressable>
        </View>

        <Text style={styles.hint}>Demo account: demo@doggo.app / demo1234</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, paddingHorizontal: spacing.lg, gap: spacing.xl },
  logoWrap: { alignItems: "center", gap: spacing.sm },
  logoBox: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.lg },
  logoText: { color: colors.onBrand, fontSize: 32, fontWeight: "700", letterSpacing: 0.5 },
  tagline: { color: colors.muted, fontSize: 15, textAlign: "center", marginTop: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  tabsRow: { flexDirection: "row", backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.surfaceSecondary },
  tabText: { color: colors.muted, fontWeight: "600" },
  tabTextActive: { color: colors.onSurface },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 15, color: colors.onSurface, backgroundColor: colors.surface },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: "center" },
  primaryBtnText: { color: colors.onBrand, fontWeight: "700", fontSize: 15 },
  divider: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginVertical: spacing.xs },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  googleBtn: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingVertical: 13, alignItems: "center" },
  googleBtnText: { color: colors.onSurface, fontWeight: "600", fontSize: 15 },
  guestBtn: { alignItems: "center", paddingVertical: 8 },
  guestBtnText: { color: colors.muted, fontSize: 13, textDecorationLine: "underline" },
  err: { color: colors.error, fontSize: 13 },
  hint: { textAlign: "center", color: colors.muted, fontSize: 12 },
});
