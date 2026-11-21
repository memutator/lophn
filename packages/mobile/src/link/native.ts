import { Camera } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import * as Network from "expo-network";
import { Linking, Share } from "react-native";
import type {
  CapabilityCtx,
  ClipboardPort,
  HapticsPort,
  LinkingPort,
  NetworkPort,
  ScanPort,
  SharePort,
} from "./capabilities.ts";
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

const expoLocationPort: LocationPort = {
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

const expoNetworkPort: NetworkPort = {
  async state() {
    const now = await Network.getNetworkStateAsync();
    const type =
      now.type === Network.NetworkStateType.WIFI
        ? "wifi"
        : now.type === Network.NetworkStateType.CELLULAR
          ? "cellular"
          : now.type === Network.NetworkStateType.NONE
            ? "none"
            : "other";
    // isInternetReachable is unknown (undefined) right after a change; connected then counts as online.
    return {
      online: now.isConnected === true && now.isInternetReachable !== false,
      type,
    };
  },
};

const IMPACT = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
};
const NOTIFICATION = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
};

const expoHapticsPort: HapticsPort = {
  async play(kind) {
    if (kind === "selection") await Haptics.selectionAsync();
    else if (kind === "light" || kind === "medium" || kind === "heavy") {
      await Haptics.impactAsync(IMPACT[kind]);
    } else await Haptics.notificationAsync(NOTIFICATION[kind]);
  },
};

const expoClipboardPort: ClipboardPort = {
  async readText() {
    return (await Clipboard.hasStringAsync()) ? Clipboard.getStringAsync() : null;
  },
  async writeText(text) {
    await Clipboard.setStringAsync(text);
  },
};

const nativeLinkingPort: LinkingPort = {
  async open(url) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      return false;
    }
  },
};

const nativeSharePort: SharePort = {
  async text(text, title) {
    await Share.share({ message: text, ...(title === undefined ? {} : { title }) });
  },
};

// The camera permission of the scanner. Unlike location (asked once), this asks again for as long as the OS allows it
// (`canAskAgain`): the person just tapped something that scans, so asking again is what they expect. After "don't ask again"
// the OS no longer shows the dialog and the answer is a refusal until they change it in the system settings.
export const cameraPermission: ScanPort["permission"] = async () => {
  const now = await Camera.getCameraPermissionsAsync();
  if (now.granted) return true;
  if (!now.canAskAgain) return false;
  return (await Camera.requestCameraPermissionsAsync()).granted;
};

// Everything a handler uses except the scanner, which is lophn's own screen over one app screen (`apps/guest`).
export const phonePorts: Omit<CapabilityCtx, "scanner"> = {
  location: expoLocationPort,
  network: expoNetworkPort,
  haptics: expoHapticsPort,
  clipboard: expoClipboardPort,
  linking: nativeLinkingPort,
  share: nativeSharePort,
};
