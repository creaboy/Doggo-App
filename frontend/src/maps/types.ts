import type { StyleProp, ViewStyle } from "react-native";

export type LatLng = { latitude: number; longitude: number };
export type SegmentInput = { coordinates: LatLng[]; freedom: "free" | "caution" | "leash"; generated?: boolean; pending?: boolean };
export type MarkerInput = { id: string; coordinate: LatLng; color?: string; label?: string; badge?: string; pointIndex?: number; onPress?: () => void };
export type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

export type MapProps = {
  // Applied when the map is created. Changing it later never moves the camera:
  // use `locationFocus` to follow the user and `fitToRoute`/`fitRevision` to frame a route.
  initialRegion?: Region;
  segments?: SegmentInput[];
  markers?: MarkerInput[];
  onPress?: (c: LatLng) => void;
  showsUserLocation?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  fitToRoute?: boolean;
  fitRevision?: number;
  userCoordinate?: LatLng | null;
  userAccuracy?: number | null;
  locationStale?: boolean;
  locationFocus?: { id: number; coordinate: LatLng; zoom?: number };
  onSegmentPress?: (index: number, coordinate?: LatLng) => void;
  selectedSegmentIndex?: number;
  selectedPointIndex?: number;
  // Center once on the first live GPS fix (app/creation opening). `focusUserZoom` defaults to 17.
  focusUserOnLoad?: boolean;
  focusUserZoom?: number;
};

export type MapScene = Pick<MapProps, 'segments' | 'selectedSegmentIndex' | 'selectedPointIndex' | 'fitToRoute' | 'fitRevision'> & {
  segmentEditable: boolean;
  markers: Omit<MarkerInput, 'onPress'>[];
};
export type Basemap = 'liberty' | 'voyager';
export type MapPayload = Pick<MapProps, 'userCoordinate' | 'userAccuracy' | 'locationStale' | 'locationFocus'> & { scene: MapScene; basemap: Basemap };
export type MapMessage = { type: 'ready' | 'error' | 'tilesLoaded' | 'basemapLoading' | 'press' | 'segmentPress' | 'markerPress'; lat?: number; lng?: number; index?: number; id?: string; message?: string };
export type MapSurfaceProps = { html: string; payload: MapPayload; onMessage: (message: MapMessage) => void; testID: string };
