export const colors = {
  surface: "#FDFDFB",
  onSurface: "#1A1C19",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#1A1C19",
  surfaceTertiary: "#F1F4EE",
  onSurfaceTertiary: "#2D332B",
  surfaceInverse: "#1A1C19",
  onSurfaceInverse: "#FFFFFF",
  brand: "#2D5A27",
  onBrand: "#FFFFFF",
  brandPrimary: "#2D5A27",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#8B5E3C",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#E2E8CE",
  onBrandTertiary: "#2D5A27",
  success: "#3A7D44",
  onSuccess: "#FFFFFF",
  warning: "#D97736",
  onWarning: "#FFFFFF",
  error: "#B33939",
  onError: "#FFFFFF",
  info: "#566573",
  onInfo: "#FFFFFF",
  border: "#E3E8DF",
  borderStrong: "#C1C9BA",
  divider: "#F1F4EE",
  muted: "#6D756A",
};

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48,
};

export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };

export const useTheme = () => ({ colors, spacing, radius });
