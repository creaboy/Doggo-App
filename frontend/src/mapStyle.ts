import { colors } from './theme';

// Keep businesses, their icons and all labels visible. Only soften the base geometry.
export const googleMapStyle = [
  { elementType: 'geometry', stylers: [{ saturation: -65 }, { lightness: 12 }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ saturation: -90 }, { lightness: 22 }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ saturation: -55 }, { lightness: 8 }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ saturation: -50 }, { lightness: 12 }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'on' }] },
];
export const mapColors = { free: colors.success, caution: colors.warning, leash: colors.error, outline: colors.surfaceSecondary, location: colors.info };