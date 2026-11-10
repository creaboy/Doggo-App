module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    permissions: [...new Set([...(config.android?.permissions || []), "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"])],
  },
  ios: {
    ...config.ios,
    infoPlist: { ...config.ios?.infoPlist, NSLocationWhenInUseUsageDescription: "Enregistrez votre balade et retrouvez votre point de départ." },
  },
});
