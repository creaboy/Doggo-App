import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { MapTrifold, Heart, Plus, User } from "phosphor-react-native";
import { colors } from "../../src/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surfaceSecondary,
          borderTopColor: colors.border,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="explore" options={{
        title: "Explore",
        tabBarIcon: ({ color, size }) => <MapTrifold color={color} size={size} weight="regular" />,
      }} />
      <Tabs.Screen name="favorites" options={{
        title: "Favorites",
        tabBarIcon: ({ color, size }) => <Heart color={color} size={size} weight="regular" />,
      }} />
      <Tabs.Screen name="create" options={{
        title: "Create",
        tabBarIcon: ({ color, size }) => <Plus color={color} size={size} weight="bold" />,
      }} />
      <Tabs.Screen name="profile" options={{
        title: "Profile",
        tabBarIcon: ({ color, size }) => <User color={color} size={size} weight="regular" />,
      }} />
      <Tabs.Screen name="search" options={{ href: null }} />
    </Tabs>
  );
}
