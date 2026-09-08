module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins || []),
    ["react-native-maps", {
      androidGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY,
      iosGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY,
    }],
  ],
  android: {
    ...config.android,
    permissions: [...new Set([...(config.android?.permissions || []), "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"])],
  },
  ios: {
    ...config.ios,
    infoPlist: { ...config.ios?.infoPlist, NSLocationWhenInUseUsageDescription: "Enregistrez votre balade et retrouvez votre point de départ." },
  },
  extra: {
    ...config.extra,
    backendUrl: process.env.EXPO_PUBLIC_BACKEND_URL,
    googleNativeAndroid: !!process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY,
    googleNativeIos: !!process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY,
  },
});