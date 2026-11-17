// (f) What a screen can reach. The results go to the host as a call (lab.probe) and on the screen. `params.probe` is the
// base URL of a server on the computer: a request that arrives there is a way out.
import { useOperation, usePlace } from "@lophn/app-ui-native";
import { Screen, Text } from "@lophn/ui-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Image, Linking, NativeModules, Share, TurboModuleRegistry, View } from "react-native";

const DOT =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const look = (read: () => unknown) => {
  try {
    const value = read();
    return value === undefined || value === null ? String(value) : `reachable ${typeof value}`;
  } catch (error) {
    return `threw ${String((error as Error).message).slice(0, 60)}`;
  }
};

const settle = async (start: () => Promise<unknown>) => {
  try {
    const value = await Promise.race([
      start(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);
    return `ok ${String(value).slice(0, 40)}`;
  } catch (error) {
    return `failed ${String((error as Error).message).slice(0, 60)}`;
  }
};

export default function Probe() {
  const base = String(usePlace().params.probe ?? "http://10.0.2.2:8237");
  const report = useOperation({ name: "lab.probe" });
  const [lines, setLines] = useState<Record<string, string>>({});
  const results = useRef<Record<string, string>>({});
  const put = (key: string, value: string) => {
    results.current = { ...results.current, [key]: value };
    setLines(results.current);
  };
  useEffect(() => {
    const g = globalThis as Record<string, unknown>;
    const now: Record<string, string> = {
      "host marker": look(() => g.__lophnHostMarker),
      "globalThis.expo": look(() => g.expo),
      "NativeModules.ExpoSecureStore": look(() => (NativeModules as Record<string, unknown>).ExpoSecureStore),
    };
    for (const name of ["ExpoSecureStore", "ExpoFileSystem", "Networking", "WebSocketModule", "BlobModule", "FileReaderModule", "ImageLoader", "IntentAndroid", "LinkingManager", "Clipboard", "ShareModule", "Vibration", "DialogManagerAndroid", "ToastAndroid", "PermissionsAndroid", "SoundManager", "StatusBarManager", "DevLoadingView", "ImageStoreManager", "PlatformConstants", "DeviceInfo", "DeviceEventManager", "AppState", "Appearance", "I18nManager", "SourceCode", "ExceptionsManager", "DevSettings", "DevMenu", "LogBox", "HeadlessJsTaskSupport", "RedBox", "EventDispatcher", "SettingsManager", "KeyboardObserver", "AccessibilityInfo", "AccessibilityManager", "FrameRateLogger", "ReactDevToolsRuntimeSettingsModule", "NativeAnimatedModule", "NativeAnimatedTurboModule", "RNCSafeAreaContext", "KeyboardController", "StatusBarManagerCompat", "ReanimatedModule", "WorkletsModule"]) {
      now[`module ${name}`] = look(() => TurboModuleRegistry.get(name));
    }
    now.eval = look(() => eval("1 + 1"));
    now["new Function"] = look(() => new Function("return 7")());
    for (const [key, value] of Object.entries(now)) put(key, value);
    void (async () => {
      const done: Record<string, string> = {};
      done.fetch = await settle(() => fetch(`${base}/fetch?probe`).then((r) => r.status));
      done.xhr = await settle(
        () =>
          new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.onload = () => resolve(xhr.status);
            xhr.onerror = () => reject(new Error("xhr error"));
            xhr.open("GET", `${base}/xhr?probe`);
            xhr.send();
          }),
      );
      done.websocket = await settle(
        () =>
          new Promise((resolve, reject) => {
            const socket = new WebSocket(`${base.replace("http", "ws")}/ws?probe`);
            socket.onopen = () => resolve("open");
            socket.onerror = () => reject(new Error("socket error"));
          }),
      );
      done.prefetch = await settle(() => Image.prefetch(`${base}/prefetch.png?probe`));
      // Ways out through other apps: a browser with data in the query, the dialer, mail, an intent, the share sheet.
      done["openURL http"] = await settle(() => Linking.openURL(`${base}/linking?probe&data=secret`));
      done["openURL tel"] = await settle(() => Linking.openURL("tel:5550100"));
      done["openURL mailto"] = await settle(() => Linking.openURL("mailto:a@example.invalid?body=secret"));
      done["openURL intent"] = await settle(() => Linking.openURL(`intent:${base.slice(5)}/intent?probe#Intent;scheme=http;end`));
      done.canOpenURL = await settle(() => Linking.canOpenURL(`${base}/can?probe`));
      done.share = await settle(() => Share.share({ message: "secret" }));
      done.alert = look(() => Alert.alert("probe", "an alert from a screen"));
      for (const [key, value] of Object.entries(done)) put(key, value);
      // the image loads have settled by now
      await new Promise((resolve) => setTimeout(resolve, 1000));
      void report.run(results.current);
    })();
  }, []);
  return (
    <Screen scroll>
      <View style={{ padding: 16, gap: 4 }}>
        {Object.entries(lines).map(([key, value]) => (
          <Text key={key} variant="detail">{`${key}: ${value}`}</Text>
        ))}
        <Image
          source={{ uri: DOT }}
          style={{ width: 24, height: 24 }}
          onLoad={() => put("image data", "loaded")}
          onError={() => put("image data", "error")}
        />
        <Image
          source={{ uri: `${base}/image.png?probe` }}
          style={{ width: 24, height: 24 }}
          onLoad={() => put("image http", "loaded")}
          onError={() => put("image http", "error")}
        />
      </View>
    </Screen>
  );
}
