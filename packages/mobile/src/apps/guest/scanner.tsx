// lophn's own scanner for `code.scan`, shown over one app screen while a scan is open. The guest stays mounted under it
// and gets the answer through the host as for any other capability. Closing it answers cancelled (not an error).
import { t } from "@lophn/i18n";
import { IconButton } from "@lophn/ui-native";
import { CameraView } from "expo-camera";
import { X } from "lucide-react-native";
import { useEffect, useSyncExternalStore } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ScanPort } from "../../link/capabilities.ts";

type ScanResult = Awaited<ReturnType<ScanPort["scan"]>>;

// The camera screen stays dark in either theme.
const FLOOR = "#0b0b0b";

interface Scanner {
  // At most one scan at a time (the host lets one interactive capability run at once).
  scan(): Promise<ScanResult>;
  finish(result: ScanResult): void;
  close(): void;
  isOpen(): boolean;
  subscribe(listener: () => void): () => void;
}

export function createScanner(): Scanner {
  let pending: ((result: ScanResult) => void) | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const finish = (result: ScanResult) => {
    const resolve = pending;
    pending = null;
    notify();
    resolve?.(result);
  };
  return {
    scan: () =>
      new Promise((resolve) => {
        pending = resolve;
        notify();
      }),
    finish,
    close: () => finish({ cancelled: true }),
    isOpen: () => pending !== null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function ScannerOverlay({ scanner }: { scanner: Scanner }) {
  const open = useSyncExternalStore(scanner.subscribe, scanner.isOpen);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!open) return;
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      scanner.close();
      return true;
    });
    return () => back.remove();
  }, [open, scanner]);
  if (!open) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: FLOOR, paddingTop: insets.top }]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        onBarcodeScanned={({ type, data }) => scanner.finish({ cancelled: false, format: type, text: data })}
      />
      <View style={{ height: 60, paddingHorizontal: 8, justifyContent: "center", alignItems: "flex-start" }}>
        {/* A dark disc behind the button: the camera image under it can be light. */}
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.55)",
          }}
        >
          <IconButton icon={X} label={t("common.button.close")} tone="camera" onPress={scanner.close} />
        </View>
      </View>
    </View>
  );
}
