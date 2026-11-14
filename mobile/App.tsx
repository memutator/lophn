import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { AppState, Button, StyleSheet, Text, View } from "react-native";
import { forgetBundles } from "./src/bundle/files.ts";
import {
  type Connection,
  type ConnectionState,
  createConnection,
} from "./src/connection/connection.ts";
import { dialSocket } from "./src/connection/socket.ts";
import { pair } from "./src/pairing/pair.ts";
import {
  type Computer,
  deviceKey,
  loadComputers,
  random,
  saveComputers,
} from "./src/pairing/store.ts";
import type { KeyPair } from "./src/remote.ts";
import { RemoteScreen } from "./src/remote/remote-screen.tsx";
import { ComputersScreen } from "./src/screens/computers-screen.tsx";
import { PairScreen } from "./src/screens/pair-screen.tsx";

// Dev only: the emulator reaches the host at 10.0.2.2, not at the LAN address the QR carries. Raced with the QR's addresses.
const DEV_ADDRESS = __DEV__
  ? process.env.EXPO_PUBLIC_LOPHN_EXTRA_ADDRESS
  : undefined;
const withDev = (addresses: string[]) =>
  DEV_ADDRESS ? [...addresses, DEV_ADDRESS] : addresses;

export default function App() {
  const [phone, setPhone] = useState<KeyPair>();
  const [computers, setComputers] = useState<Computer[]>();
  const [states, setStates] = useState<Record<string, ConnectionState>>({});
  const [pairing, setPairing] = useState(false);
  const [managing, setManaging] = useState(false);
  // Key of the computer whose remote screen is open; the first paired one until the person picks another.
  const [open, setOpen] = useState<string>();
  const connections = useRef(new Map<string, Connection>());

  useEffect(() => {
    void Promise.all([deviceKey(), loadComputers()]).then(([key, saved]) => {
      setPhone(key);
      setComputers(saved);
    });
  }, []);

  const update = (next: Computer[]) => {
    setComputers(next);
    void saveComputers(next);
  };

  // One connection per paired computer that is not revoked; closed when the computer leaves the list.
  useEffect(() => {
    if (!phone || !computers) return;
    const live = connections.current;
    const wanted = new Set(
      computers.filter((c) => !c.revoked).map((c) => c.key),
    );
    for (const [key, connection] of live) {
      if (wanted.has(key)) continue;
      connection.close();
      live.delete(key);
    }
    for (const computer of computers) {
      if (computer.revoked || live.has(computer.key)) continue;
      const connection = createConnection({
        endpoint: { ...computer, addresses: withDev(computer.addresses) },
        phone,
        dial: dialSocket,
        random,
        now: Date.now,
        wait: (ms, fn) => {
          const timer = setTimeout(fn, ms);
          return () => clearTimeout(timer);
        },
        onRevoked: () =>
          setComputers((all) => {
            const next = (all ?? []).map((c) =>
              c.key === computer.key ? { ...c, revoked: true } : c,
            );
            void saveComputers(next);
            return next;
          }),
      });
      live.set(computer.key, connection);
      const show = (state: ConnectionState) =>
        setStates((all) => ({ ...all, [computer.key]: state }));
      show(connection.current());
      connection.subscribe(show);
    }
  }, [phone, computers]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      for (const connection of connections.current.values()) {
        if (state === "active") connection.resume();
        else connection.pause();
      }
    });
    return () => subscription.remove();
  }, []);

  if (!phone || !computers) {
    return (
      <View style={styles.container}>
        <Text>Loading…</Text>
      </View>
    );
  }

  const shown = computers.find((c) => c.key === open) ?? computers[0];
  return (
    <View style={styles.container}>
      {pairing || computers.length === 0 ? (
        <PairScreen
          onCancel={computers.length ? () => setPairing(false) : undefined}
          onPair={async (qr) => {
            const result = await pair(
              { ...qr, addresses: withDev(qr.addresses) },
              { phone, dial: dialSocket },
            );
            if (!result.ok) return result.message;
            // Store the QR's own addresses; the dev address is added again at connect time.
            const computer = { ...result.computer, addresses: qr.addresses };
            connections.current.get(computer.key)?.close();
            connections.current.delete(computer.key);
            update([
              ...computers.filter((c) => c.key !== computer.key),
              computer,
            ]);
            setPairing(false);
            setManaging(false);
            setOpen(computer.key);
            return undefined;
          }}
        />
      ) : managing || !shown ? (
        <>
          <ComputersScreen
            computers={computers}
            states={states}
            onAdd={() => setPairing(true)}
            onRemove={(computer) => {
              forgetBundles(computer.key);
              update(computers.filter((c) => c.key !== computer.key));
            }}
          />
          {shown && <Button title="Back" onPress={() => setManaging(false)} />}
        </>
      ) : (
        <RemoteScreen
          key={shown.key}
          computer={shown}
          computers={computers}
          connection={connections.current.get(shown.key)}
          state={states[shown.key]}
          onOpen={(computer) => setOpen(computer.key)}
          onManage={() => setManaging(true)}
        />
      )}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 40, backgroundColor: "#fff" },
});
