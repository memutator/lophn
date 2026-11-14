import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { hermesChecks, pairAndCall } from "./src/spike.ts";

// Spike screen. The QR JSON comes from `EXPO_PUBLIC_LOPHN_QR` when Metro starts; the emulator reaches the host at 10.0.2.2.
const QR = process.env.EXPO_PUBLIC_LOPHN_QR;
const ADDRESS = process.env.EXPO_PUBLIC_LOPHN_ADDRESS ?? "10.0.2.2";

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
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 40, backgroundColor: "#fff" },
  log: { flex: 1, paddingHorizontal: 8 },
  line: { fontSize: 11, fontFamily: "monospace" },
});
