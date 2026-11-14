import { useEffect, useRef, useState } from "react";
import {
  Button,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BUNDLE_ENTRY, currentBundle, syncBundle } from "../bundle/cache.ts";
import { bundleRoot, bundleStore } from "../bundle/files.ts";
import type { Connection, ConnectionState } from "../connection/connection.ts";
import type { Computer } from "../pairing/store.ts";
import { LophnWebView, type LophnWebViewHandle } from "../webview/LophnWebView.tsx";
import { linkPage } from "./link.ts";


const label = (computer: Computer) =>
  `${computer.addresses[0] ?? "?"} · ${computer.key.slice(0, 6)}`;

// One computer's remote screen: the last confirmed bundle in the WebView, the bridge joined to the connection.
// The page shows the connection state itself. A thin native bar switches computers and opens the computer list.
// Mount with `key={computer.key}`: switching computers starts a fresh screen.
export function RemoteScreen(props: {
  computer: Computer;
  computers: Computer[];
  connection: Connection | undefined;
  state: ConnectionState | undefined;
  onOpen: (computer: Computer) => void;
  onManage: () => void;
}) {
  const { computer, connection } = props;
  const [bundle, setBundle] = useState(() =>
    currentBundle(bundleStore(computer.key)),
  );
  const [failed, setFailed] = useState(false);
  const web = useRef<LophnWebViewHandle>(null);
  const link = useRef<ReturnType<typeof linkPage>>(undefined);
  // The app draws edge to edge, so the window does not shrink for the keyboard; lift the page above it.
  const [keyboard, setKeyboard] = useState(0);

  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", (event) =>
      setKeyboard(event.endCoordinates.height),
    );
    const hidden = Keyboard.addListener("keyboardDidHide", () => setKeyboard(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  useEffect(() => {
    if (!connection) return;
    const next = linkPage(connection, (message) => web.current?.send(message));
    link.current = next;
    return () => next.close();
  }, [connection]);

  // Check the bundle each time the connection becomes ready; `ready` repeats on every watch, so only on the edge.
  useEffect(() => {
    if (!connection) return;
    let wasReady = false;
    let syncing = false;
    const check = async () => {
      if (syncing) return;
      syncing = true;
      const name = await syncBundle(connection.call, bundleStore(computer.key));
      syncing = false;
      if (name) setBundle(name);
      setFailed(!name);
    };
    const seen = (state: ConnectionState) => {
      const ready = state.state === "ready";
      if (ready && !wasReady) void check();
      wasReady = ready;
    };
    seen(connection.current());
    return connection.subscribe(seen);
  }, [connection, computer.key]);

  const state = props.state?.state ?? "starting";
  return (
    <View style={[styles.box, { paddingBottom: keyboard }]}>
      <View style={styles.bar}>
        <ScrollView horizontal contentContainerStyle={styles.tabs}>
          {props.computers.map((other) => (
            <Text
              key={other.key}
              onPress={() => props.onOpen(other)}
              style={[styles.tab, other.key === computer.key && styles.chosen]}
            >
              {label(other)}
            </Text>
          ))}
        </ScrollView>
        <Button title="Computers" onPress={props.onManage} />
      </View>
      {computer.revoked ? (
        <Text style={styles.center}>Disconnected. Pair again.</Text>
      ) : bundle ? (
        <LophnWebView
          ref={web}
          root={bundleRoot(computer.key, bundle)}
          entry={BUNDLE_ENTRY}
          onMessage={(message) => link.current?.receive(message)}
          style={styles.box}
        />
      ) : (
        // No bundle yet: the native screen says why.
        <Text style={styles.center}>
          {state === "ready"
            ? failed
              ? "Could not load the screen from this computer."
              : "Loading the screen…"
            : state === "stale"
              ? "Cannot reach this computer."
              : "Connecting…"}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderColor: "#ddd",
  },
  tabs: { gap: 8, alignItems: "center" },
  tab: { fontFamily: "monospace", paddingVertical: 8, color: "#666" },
  chosen: { color: "#000", fontWeight: "600" },
  center: { flex: 1, textAlign: "center", textAlignVertical: "center", padding: 24 },
});
