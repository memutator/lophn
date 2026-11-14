import { CameraView, useCameraPermissions } from "expo-camera";
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import { parseQr } from "../pairing/pair.ts";
import type { RemotePairing } from "../remote.ts";

// Scan or paste, then show what was read and pair only when the person presses Pair.
export function PairScreen(props: {
  onPair: (qr: RemotePairing) => Promise<string | undefined>;
  onCancel?: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [pasted, setPasted] = useState("");
  const [qr, setQr] = useState<RemotePairing>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const read = (text: string) => {
    const parsed = parseQr(text);
    if (parsed) {
      setQr(parsed);
      setError(undefined);
    } else {
      setError("This is not a lophn pairing code.");
    }
  };

  if (qr) {
    return (
      <View style={styles.box}>
        <Text style={styles.title}>Pair with this computer?</Text>
        <Text>Key: {qr.key.slice(0, 8)}…</Text>
        <Text>
          Address: {qr.addresses.join(", ")} port {qr.port}
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.row}>
          <Button
            title={busy ? "Pairing…" : "Pair"}
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              const failed = await props.onPair(qr);
              setBusy(false);
              if (failed) setError(failed);
            }}
          />
          <Button
            title="Back"
            disabled={busy}
            onPress={() => {
              setQr(undefined);
              setError(undefined);
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Pair a computer</Text>
      <Text>On the computer, open phone pairing and scan its QR code.</Text>
      {permission?.granted ? (
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => read(data)}
        />
      ) : (
        <Button title="Use the camera" onPress={requestPermission} />
      )}
      <Text>Or paste the pairing code:</Text>
      <TextInput
        style={styles.input}
        value={pasted}
        onChangeText={setPasted}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button title="Read" onPress={() => read(pasted)} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {props.onCancel ? <Button title="Cancel" onPress={props.onCancel} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: "600" },
  camera: { height: 280 },
  input: {
    borderWidth: 1,
    borderColor: "#999",
    minHeight: 80,
    padding: 8,
    fontFamily: "monospace",
  },
  row: { flexDirection: "row", gap: 12 },
  error: { color: "#b00020" },
});
