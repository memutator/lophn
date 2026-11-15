// Scanning the computer's pairing code. The camera is asked for when this screen opens, not before.
import { t } from "@lophn/i18n";
import { IconButton, Text } from "@lophn/ui-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Flashlight, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, StatusBar, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RootParams } from "../../app/root-params.ts";
import { parseQr } from "../../pairing/pair.ts";
import { EnterCodeSheet } from "./enter-code.tsx";

// The camera screen stays dark in either theme (phone.module.css [data-tone="camera"]).
const INK = "#f3f3f0";
const FLOOR = "#0b0b0b";
const SIDE = 252;
const CORNER = 56;

// One corner of the finder: two edges of a rounded square.
function Corner({ at }: { at: "tl" | "tr" | "bl" | "br" }) {
  const top = at[0] === "t";
  const left = at[1] === "l";
  return (
    <View
      style={{
        position: "absolute",
        width: CORNER,
        height: CORNER,
        top: top ? -3 : undefined,
        bottom: top ? undefined : -3,
        left: left ? -3 : undefined,
        right: left ? undefined : -3,
        borderColor: INK,
        borderTopWidth: top ? 3 : 0,
        borderBottomWidth: top ? 0 : 3,
        borderLeftWidth: left ? 3 : 0,
        borderRightWidth: left ? 0 : 3,
        borderTopLeftRadius: at === "tl" ? 30 : 0,
        borderTopRightRadius: at === "tr" ? 30 : 0,
        borderBottomLeftRadius: at === "bl" ? 30 : 0,
        borderBottomRightRadius: at === "br" ? 30 : 0,
      }}
    />
  );
}

export function ScanScreen({
  navigation,
}: NativeStackScreenProps<RootParams, "scan">) {
  const insets = useSafeAreaInsets();
  const [permission, request] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [entering, setEntering] = useState(false);
  const read = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void request();
    }
  }, [permission, request]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: FLOOR,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <StatusBar barStyle="light-content" />
      <View
        style={{
          height: 52,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 8,
        }}
      >
        <IconButton
          icon={X}
          label={t("common.button.close")}
          tone="camera"
          onPress={() => navigation.goBack()}
        />
        <IconButton
          icon={Flashlight}
          label={t("mobile.start.button.flashlight")}
          tone="camera"
          onPress={() => setTorch((on) => !on)}
        />
      </View>
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 28,
        }}
      >
        <View style={{ width: SIDE, height: SIDE }}>
          <View
            style={{
              flex: 1,
              overflow: "hidden",
              borderRadius: 28,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#1d1d1b",
            }}
          >
            {permission?.granted ? (
              // The camera's surface ignores the rounded clip on Android, so it sits inside the corners.
              <CameraView
                style={[StyleSheet.absoluteFill, { margin: 10, borderRadius: 18 }]}
                facing="back"
                enableTorch={torch}
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={({ data }) => {
                  const qr = parseQr(data);
                  if (qr === undefined || read.current) return;
                  read.current = true;
                  navigation.replace("pairing", { qr });
                }}
              />
            ) : (
              permission?.canAskAgain === false && (
                <Text
                  variant="detail"
                  align="center"
                  style={{ color: INK, paddingHorizontal: 24 }}
                >
                  {t("mobile.start.notice.no-camera")}
                </Text>
              )
            )}
          </View>
          <Corner at="tl" />
          <Corner at="tr" />
          <Corner at="bl" />
          <Corner at="br" />
        </View>
        <Text
          variant="heading"
          weight="semibold"
          align="center"
          style={{ color: INK, marginTop: 32, letterSpacing: 0 }}
        >
          {t("mobile.start.heading.scan")}
        </Text>
        <Text
          variant="detail"
          align="center"
          style={{ color: "rgba(243,243,240,0.66)", marginTop: 6 }}
        >
          {t("mobile.start.label.scan-path")}
        </Text>
      </View>
      <View
        style={{
          alignItems: "center",
          paddingTop: 12,
          paddingHorizontal: 20,
          paddingBottom: 24,
        }}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => setEntering(true)}
          style={({ pressed }) => ({
            height: 40,
            justifyContent: "center",
            paddingHorizontal: 16,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.24)",
            borderRadius: 999,
            backgroundColor: pressed ? "rgba(255,255,255,0.14)" : "transparent",
          })}
        >
          <Text variant="detail" weight="medium" style={{ color: INK }}>
            {t("mobile.start.button.enter-code")}
          </Text>
        </Pressable>
      </View>
      <EnterCodeSheet
        open={entering}
        onClose={() => setEntering(false)}
        onCode={(qr) => navigation.replace("pairing", { qr })}
      />
    </View>
  );
}
