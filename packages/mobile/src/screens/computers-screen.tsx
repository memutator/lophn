import { Button, FlatList, StyleSheet, Text, View } from "react-native";
import type { ConnectionState } from "../connection/connection.ts";
import type { Computer } from "../pairing/store.ts";

const LABELS: Record<ConnectionState["state"], string> = {
  starting: "Connecting…",
  ready: "Connected",
  stale: "Not reachable, retrying",
};

export function ComputersScreen(props: {
  computers: Computer[];
  states: Record<string, ConnectionState>;
  onAdd: () => void;
  onRemove: (computer: Computer) => void;
}) {
  return (
    <View style={styles.box}>
      <Text style={styles.title}>Computers</Text>
      <FlatList
        data={props.computers}
        keyExtractor={(computer) => computer.key}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Text style={styles.name}>
              {item.addresses[0] ?? "?"}:{item.port} · {item.key.slice(0, 8)}…
            </Text>
            <Text>
              {item.revoked
                ? "Disconnected. Pair again."
                : LABELS[props.states[item.key]?.state ?? "starting"]}
            </Text>
            <Button title="Remove" onPress={() => props.onRemove(item)} />
          </View>
        )}
      />
      <Button title="Pair a computer" onPress={props.onAdd} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: "600" },
  item: { paddingVertical: 8, borderBottomWidth: 1, borderColor: "#ddd" },
  name: { fontFamily: "monospace" },
});
