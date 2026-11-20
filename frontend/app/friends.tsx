import React, { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { emptySocialProfile } from '../src/social';
import type { Friend, Member, SocialProfile } from '../src/social';
import { colors, radius, spacing } from '../src/theme';

export default function FriendsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [profile, setProfile] = useState<SocialProfile>();
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('');
  const [results, setResults] = useState<Member[]>();
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const active = useRef(false);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const list: Friend[] = await api('/me/friends');
    if (active.current && request === generation.current) setFriends(list);
  }, []);
  useFocusEffect(useCallback(() => {
    active.current = true;
    void refresh().catch(() => { if (active.current) setMessage('Impossible de charger les amis.'); });
    void api('/me/social').then((value: SocialProfile) => { if (active.current) setProfile(value); }).catch(() => {});
    const interval = setInterval(() => { void refresh().catch(() => {}); }, 10000);
    return () => { active.current = false; generation.current++; clearInterval(interval); };
  }, [refresh]));

  async function search(byArea: boolean) {
    if (searching) return;
    const value = byArea ? area.trim() || profile?.area : query.trim();
    if (!value || (!byArea && value.length < 2)) {
      setMessage(byArea ? 'Indique une ville dans la recherche ou dans ton profil.' : 'Saisis au moins deux lettres du prénom.');
      return;
    }
    setSearching(true);
    setMessage('');
    try { setResults(await api(`/members/search?${byArea ? 'area' : 'q'}=${encodeURIComponent(value)}`)); }
    catch { setMessage('Recherche indisponible. Réessaie dans un instant.'); }
    finally { setSearching(false); }
  }

  async function changeFriend(id: string, action: 'invite' | 'accept' | 'remove') {
    if (pending) return;
    setPending(id);
    setMessage('');
    try {
      await api(`/me/friends/${encodeURIComponent(id)}${action === 'accept' ? '/accept' : ''}`,
        { method: action === 'remove' ? 'DELETE' : 'POST' });
      await refresh();
    } catch { setMessage('Impossible de mettre à jour cette invitation. Réessaie.'); }
    finally { setPending(undefined); }
  }

  async function saveProfile() {
    if (!profile || saving) return;
    setSaving(true);
    setMessage('');
    try {
      setProfile(await api('/me/social', { method: 'PUT', body: JSON.stringify(profile) }));
      setEditing(false);
      setMessage('Profil enregistré.');
    } catch { setMessage('Impossible d’enregistrer ton profil. Réessaie.'); }
    finally { setSaving(false); }
  }

  async function openSettings() {
    if (profile) { setEditing(!editing); return; }
    try { setProfile(await api('/me/social')); setEditing(true); }
    catch { setMessage('Impossible de charger tes réglages. Réessaie.'); }
  }

  const incoming = friends.filter(friend => friend.status === 'incoming');
  const confirmed = friends.filter(friend => friend.status === 'friend');
  const outgoing = friends.filter(friend => friend.status === 'outgoing');
  const available = results?.filter(member => !friends.some(friend => friend.id === member.id));
  const info = profile || emptySocialProfile;

  return <ScrollView style={styles.screen} keyboardShouldPersistTaps="handled"
    contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl }]}>
    <Pressable onPress={() => router.back()} accessibilityRole="button"><Text style={styles.link}>‹ Profil</Text></Pressable>
    <View style={styles.row}><Text style={[styles.title, styles.grow]}>Amis</Text>
      <Button label={editing ? 'Fermer les réglages' : 'Profil et visibilité'} onPress={openSettings} />
    </View>
    {!!message && <Text style={styles.hint} accessibilityLiveRegion="polite">{message}</Text>}
    {editing && profile && <View style={styles.card}>
      <Text style={styles.label}>Prénom</Text>
      <TextInput style={styles.input} accessibilityLabel="Prénom" value={info.first_name} maxLength={40}
        placeholder="Le prénom affiché dans les recherches" placeholderTextColor={colors.muted}
        onChangeText={first_name => setProfile({ ...info, first_name })} />
      <Text style={styles.label}>Description</Text>
      <TextInput style={[styles.input, styles.bio]} accessibilityLabel="Description" multiline value={info.bio} maxLength={240}
        placeholder="Présente-toi en quelques mots" placeholderTextColor={colors.muted} onChangeText={bio => setProfile({ ...info, bio })} />
      <Text style={styles.label}>Ville ou commune</Text>
      <TextInput style={styles.input} accessibilityLabel="Ta ville" value={info.area} maxLength={80}
        placeholder="Facultatif · pour les suggestions" placeholderTextColor={colors.muted} onChangeText={area => setProfile({ ...info, area })} />
      <View style={styles.row}>
        <Text style={[styles.label, styles.grow]}>Visible pendant mes balades</Text>
        <Switch accessibilityLabel="Visible pendant mes balades" value={info.share_walks}
          onValueChange={share_walks => setProfile({ ...info, share_walks })} />
      </View>
      <Text style={styles.hint}>Tes amis voient la balade que tu fais. Ta position GPS reste privée.</Text>
      <Button label={saving ? 'Enregistrement…' : 'Enregistrer mon profil'} disabled={saving} onPress={saveProfile} primary />
    </View>}
    {incoming.length > 0 && <Text style={styles.section}>Invitations reçues</Text>}
    {incoming.map(member => <MemberCard key={member.id} member={member}>
      <Button label="Accepter" disabled={!!pending} onPress={() => changeFriend(member.id, 'accept')} primary />
      <Button label="Refuser" disabled={!!pending} onPress={() => changeFriend(member.id, 'remove')} />
    </MemberCard>)}
    <Text style={styles.section}>Mes amis</Text>
    {confirmed.length === 0 && <Text style={styles.hint}>Tu peux inviter un membre depuis la recherche.</Text>}
    {confirmed.map(member => <MemberCard key={member.id} member={member}>
      {member.walk && <>
        <Text style={styles.hint}>En balade · {member.walk.title}{member.walk.variant !== 'A' ? ` · ${member.walk.variant}` : ''}</Text>
        <Button label="Faire cette balade" primary onPress={() => router.push({
          pathname: '/navigate/[id]', params: { id: member.walk!.id, variant: member.walk!.variant },
        })} />
      </>}
      <Button label="Retirer" disabled={!!pending} onPress={() => changeFriend(member.id, 'remove')} />
    </MemberCard>)}
    {outgoing.length > 0 && <Text style={styles.section}>Invitations envoyées</Text>}
    {outgoing.map(member => <MemberCard key={member.id} member={member}>
      <Button label="Annuler l’invitation" disabled={!!pending} onPress={() => changeFriend(member.id, 'remove')} />
    </MemberCard>)}
    <Text style={styles.section}>Trouver des amis</Text>
    <View style={styles.row}>
      <TextInput style={[styles.input, styles.grow]} accessibilityLabel="Rechercher un prénom" value={query}
        onChangeText={setQuery} placeholder="Prénom" placeholderTextColor={colors.muted} maxLength={60}
        returnKeyType="search" onSubmitEditing={() => search(false)} />
      <Button label="Rechercher" onPress={() => search(false)} disabled={searching} />
    </View>
    <View style={styles.row}>
      <TextInput style={[styles.input, styles.grow]} accessibilityLabel="Ville ou commune à rechercher" value={area}
        onChangeText={setArea} placeholder={info.area || 'Ville ou commune'} placeholderTextColor={colors.muted} maxLength={80}
        returnKeyType="search" onSubmitEditing={() => search(true)} />
      <Button label="Suggestions" onPress={() => search(true)} disabled={searching} />
    </View>
    {available?.length === 0 && <Text style={styles.hint}>Aucun nouveau membre trouvé.</Text>}
    {available?.map(member => <MemberCard key={member.id} member={member}>
      <Button label="Inviter" disabled={!!pending} onPress={() => changeFriend(member.id, 'invite')} primary />
    </MemberCard>)}
  </ScrollView>;
}

function MemberCard({ member, children }: { member: Member; children: React.ReactNode }) {
  return <View style={styles.card}>
    <Text style={styles.label}>{member.name}</Text>
    {!!member.bio && <Text style={styles.hint}>{member.bio}</Text>}
    <View style={styles.row}>{children}</View>
  </View>;
}

function Button({ label, onPress, disabled, primary }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return <Pressable accessibilityRole="button" style={[styles.button, primary && styles.primary, disabled && styles.disabled]}
    disabled={disabled} onPress={onPress}>
    <Text style={primary ? styles.onBrand : styles.link}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 28, fontWeight: '800', color: colors.onSurface },
  section: { fontSize: 18, fontWeight: '800', color: colors.onSurface, marginTop: spacing.sm },
  label: { fontWeight: '700', color: colors.onSurface },
  hint: { fontSize: 14, lineHeight: 19, color: colors.muted },
  link: { fontWeight: '700', color: colors.brandPrimary },
  card: { padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, color: colors.onSurface, paddingHorizontal: spacing.md },
  bio: { minHeight: 70, paddingVertical: spacing.sm, textAlignVertical: 'top' },
  button: { minHeight: 42, justifyContent: 'center', borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceTertiary },
  primary: { backgroundColor: colors.brandPrimary },
  onBrand: { fontWeight: '700', color: colors.onBrand },
  disabled: { opacity: 0.5 },
});
