// Web never imports the native SDK. Metro resolves .native.tsx on Android/iOS.
import type { MapProps } from './DoggoMap';
export default function NativeGoogleMap(_props: MapProps) { return null; }