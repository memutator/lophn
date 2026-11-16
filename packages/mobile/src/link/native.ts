import * as Location from "expo-location";
import type { LocationFix, LocationPort } from "./location.ts";

const ACCURACY = {
  low: Location.Accuracy.Low,
  balanced: Location.Accuracy.Balanced,
  high: Location.Accuracy.High,
};

const fixOf = (position: Location.LocationObject): LocationFix => ({
  lat: position.coords.latitude,
  lon: position.coords.longitude,
  accuracyM: position.coords.accuracy ?? 0,
  atMs: position.timestamp,
});

export const expoLocationPort: LocationPort = {
  async permission() {
    const now = await Location.getForegroundPermissionsAsync();
    if (now.granted) return true;
    // Only the first ask shows the OS dialog; after a denial the person changes it in system settings.
    if (now.status !== Location.PermissionStatus.UNDETERMINED) return false;
    return (await Location.requestForegroundPermissionsAsync()).granted;
  },
  servicesEnabled: () => Location.hasServicesEnabledAsync(),
  async lastKnown(maxAgeMs) {
    const position = await Location.getLastKnownPositionAsync({
      maxAge: maxAgeMs,
    });
    return position ? fixOf(position) : null;
  },
  async current(accuracy) {
    return fixOf(
      await Location.getCurrentPositionAsync({ accuracy: ACCURACY[accuracy] }),
    );
  },
};
