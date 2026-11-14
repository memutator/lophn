import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  LophnWebView,
  type LophnWebViewHandle,
} from "./modules/lophn-webview/src/LophnWebView.tsx";
import { hermesChecks, pairAndCall } from "./src/spike.ts";

// Spike screen. The QR JSON comes from `EXPO_PUBLIC_LOPHN_QR` when Metro starts; the emulator reaches the host at 10.0.2.2.
const QR = process.env.EXPO_PUBLIC_LOPHN_QR;
const ADDRESS = process.env.EXPO_PUBLIC_LOPHN_ADDRESS ?? "10.0.2.2";
const ORIGINS = ["lophn-app://remote/", "https://remote.lophn.invalid/"];

export default function App() {
  const [lines, setLines] = useState<string[]>([]);
  const log = (line: string) => {
    console.log(`spike ${line}`);
    setLines((all) => [...all, line]);
  };

  useEffect(() => {
    for (const line of hermesChecks()) log(line);
    if (!QR) return log("no EXPO_PUBLIC_LOPHN_QR, skipping pairing");
    pairAndCall(JSON.parse(QR), ADDRESS, log).catch((e: Error) =>
      log(`remote FAIL ${e.message}`),
    );
  }, []);

  return (
    <View style={styles.container}>
      <ScrollView style={styles.log}>
        {lines.map((line, i) => (
          <Text key={i} style={styles.line}>
            {line}
          </Text>
        ))}
      </ScrollView>
      {ORIGINS.map((origin) => (
        <Page key={origin} origin={origin} log={log} />
      ))}
      <StatusBar style="auto" />
    </View>
  );
}

function Page(props: { origin: string; log: (line: string) => void }) {
  const ref = useRef<LophnWebViewHandle>(null);
  return (
    <LophnWebView
      ref={ref}
      origin={props.origin}
      style={styles.web}
      onMessage={({ nativeEvent }) => {
        props.log(`bridge ${props.origin} <- ${nativeEvent.data}`);
        const message = JSON.parse(nativeEvent.data) as { type: string };
        if (message.type === "probes") {
          ref.current?.postMessage(`hello from native to ${props.origin}`);
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 40, backgroundColor: "#fff" },
  log: { flex: 1, paddingHorizontal: 8 },
  line: { fontSize: 11, fontFamily: "monospace" },
  web: { flex: 1, borderTopWidth: 1 },
});
