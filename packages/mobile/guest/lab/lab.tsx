// The guest runtime lab: a development app (a build with EXPO_PUBLIC_LOPHN_GUEST_LAB=1 opens it instead of the phone
// app; metro.config.js swaps App.tsx) that runs the fixture screens (guest/fixtures) in GuestScreen and prints what
// happens as plain text, read with `adb shell uiautomator dump` and screenshots. English only: it is a developer tool.
// `local` and `local-throw` mount an app that runs on the phone: the local screen fixture with local-backend.js (or
// throw-backend.js) and a fresh database file the lab migrates and binds, as the phone host will.
import { Directory, File, Paths } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { PhoneBackendManifest } from "../../../protocol/apps/phone-backend.ts";
import {
  type PhoneLocal,
  type PhoneManifest,
  phoneCanRun,
} from "../../../protocol/apps/phone-screen.ts";
import { ensureSyncTables, readOutbox } from "../../../protocol/apps/sync/tables.ts";
import type { JsonValue } from "../../../protocol/base/json-values.ts";
import {
  type AppEvent,
  type CallOutcome,
  ensureBase,
  GuestScreen,
  type GuestState,
  guestHostInfo,
} from "../../src/apps/guest/mod.ts";
import { pathOf } from "../../src/apps/guest/files.ts";
import { type AppDbConnection, openHost } from "../../modules/lophn-app-db/index.ts";

const FIXTURES = ["tasks", "top-throw", "raw-throw", "misbehave", "probe", "big", "local", "local-backend", "throw-backend"];
const PROBE = process.env.EXPO_PUBLIC_LOPHN_GUEST_LAB_PROBE ?? "http://10.0.2.2:8237";

// A value only the host runtime has; the probe fixture looks for it.
(globalThis as Record<string, unknown>).__lophnHostMarker = "host-only";

// An app that runs on the phone: its backend file, what its phone/backend.json says, and its database file.
type Local = { backend: string; local: PhoneLocal; db: string };
type Slot = { key: number; fixture: string; file: string; at: number; state: string; local?: Local };

async function extractFixtures(): Promise<string> {
  const dir = new Directory(Paths.document, "guest/lab");
  dir.create({ idempotent: true, intermediates: true });
  for (const name of FIXTURES) {
    const target = new File(dir, `${name}.js`);
    if (target.exists) target.delete();
    await new File(`asset:///guest/fixtures/${name}.js`).copy(target);
  }
  return pathOf(dir);
}

const describe = (state: GuestState) =>
  typeof state === "string" ? state : `failed ${state.failed}`;

export default function Lab() {
  const [dir, setDir] = useState<string>();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [lines, setLines] = useState<string[]>([]);
  const [taps, setTaps] = useState(0);
  const [scheme, setScheme] = useState<"light" | "dark">("light");
  const next = useRef(1);
  const tasks = useRef([{ id: 1, title: "Water the plants" }]);
  const listeners = useRef(new Set<(event: AppEvent) => void>());
  const waiters = useRef(new Map<number, (state: string) => void>());
  const databases = useRef(new Map<number, AppDbConnection>());

  const log = (line: string) => {
    console.log(`LAB ${line}`);
    setLines((all) => [...all.slice(-24), line]);
  };

  useEffect(() => {
    void (async () => {
      try {
        const base = await ensureBase();
        const fixtures = await extractFixtures();
        log(`base ${base} ${new File(`file://${base}`).size} B`);
        setDir(fixtures);
      } catch (error) {
        log(`setup failed: ${String(error)}`);
      }
    })();
  }, []);

  const call = async (operation: string, input: JsonValue, slot?: Slot): Promise<CallOutcome> => {
    log(`call ${operation} ${JSON.stringify(input).slice(0, 120)}`);
    if (operation === "lab.result") return { ok: true, value: null };
    if (operation === "lab.first_local") {
      const at = Number((input as { at?: unknown })?.at);
      log(`slot ${slot?.key} first local call ${at - (slot?.at ?? at)} ms after mount`);
      return { ok: true, value: null };
    }
    if (operation === "send_report") return { ok: true, value: { sent: true, via: "host" } };
    if (operation === "tasks.list") return { ok: true, value: tasks.current };
    if (operation === "tasks.add") {
      const title = String((input as { title?: unknown })?.title ?? "");
      tasks.current = [...tasks.current, { id: tasks.current.length + 1, title }];
      return { ok: true, value: tasks.current };
    }
    if (operation === "lab.probe") {
      for (const [key, value] of Object.entries(input as Record<string, string>)) log(`probe ${key}: ${value}`);
      return { ok: true, value: null };
    }
    return { ok: false, error: { code: "not_found", message: `no operation ${operation}` } };
  };

  const mount = (fixture: string, file = `${dir}/${fixture}.js`, local?: Local) => {
    const key = next.current++;
    setSlots((all) => [...all, { key, fixture, file, at: Date.now(), state: "mounting", local }]);
    return key;
  };
  // A fresh database file, migrated and with the sync tables, as the phone host leaves it before a mount.
  const mountLocal = (backend: string) => {
    const db = `${dir}/local-${Date.now()}.sqlite`;
    const host = openHost(db);
    host.exec(new File("asset:///guest/fixtures/local-0-1.sql").textSync());
    ensureSyncTables(host, "phone-lab");
    const manifest = JSON.parse(
      new File("asset:///guest/fixtures/local-backend.json").textSync(),
    ) as PhoneBackendManifest;
    const local = { operations: manifest.operations, data_schema: manifest.data_schema };
    const key = mount("local", `${dir}/local.js`, { backend: `${dir}/${backend}.js`, local, db });
    databases.current.set(key, host);
  };
  const outbox = (key: number) => {
    const host = databases.current.get(key);
    return host ? readOutbox(host).map((row) => row.operation).join(",") : "?";
  };
  const onState = (key: number) => (state: GuestState) => {
    setSlots((all) =>
      all.map((slot) => {
        if (slot.key !== key) return slot;
        const ms = Date.now() - slot.at;
        log(`slot ${key} ${slot.fixture}: ${describe(state)} after ${ms} ms`);
        return { ...slot, state: `${describe(state)} @${ms}ms` };
      }),
    );
    if (state !== "starting") waiters.current.get(key)?.(describe(state));
  };
  const emit = (event: string, payload: JsonValue) => {
    for (const listener of listeners.current) listener({ source: "lab", event, payload });
  };
  const remountTen = async () => {
    setSlots([]);
    for (let i = 0; i < 10; i++) {
      const done = new Promise<string>((resolve) => waiters.current.set(next.current, resolve));
      setSlots([]);
      const key = mount("tasks");
      const state = await done;
      waiters.current.delete(key);
      log(`remount ${i + 1}/10 ${state}`);
    }
  };
  const canRun = () => {
    const manifest = JSON.parse(new File("asset:///guest/fixtures/tasks.json").textSync()) as PhoneManifest;
    const host = guestHostInfo();
    const newerKit = { ...manifest, kit: { ...manifest.kit, "@lophn/ui-native": "0.2.0" } };
    const olderMajor = { ...manifest, kit: { ...manifest.kit, "@lophn/app-ui-native": "0.9.0" } };
    log(`canrun same ${JSON.stringify(phoneCanRun(manifest, host))}`);
    log(`canrun newer kit ${JSON.stringify(phoneCanRun(newerKit, host))}`);
    log(`canrun old phone ${JSON.stringify(phoneCanRun(manifest, { ...host, app_ui_native: "0.9.0" }))}`);
    log(`canrun old major ${JSON.stringify(phoneCanRun(olderMajor, host))}`);
    log(`host ${JSON.stringify(host)}`);
  };

  const actions: [string, () => void][] = [
    ...FIXTURES.filter((name) => !name.includes("backend")).map((name): [string, () => void] =>
      name === "local" ? [name, () => mountLocal("local-backend")] : [name, () => mount(name)],
    ),
    ["local-throw", () => mountLocal("throw-backend")],
    ["two", () => {
      mount("tasks");
      mount("tasks");
    }],
    ["remount10", () => void remountTen()],
    ["missing", () => mount("missing", `${dir}/missing.js`)],
    ["unmount", () => setSlots([])],
    ["note", () => emit("note", `note at ${new Date().toISOString().slice(11, 19)}`)],
    ...["render", "handler", "reject", "busy", "alloc", "add", "refuse", "offline", "report", "list"].map((name): [string, () => void] => [
      `do:${name}`,
      () => emit("do", name),
    ]),
    ["canrun", canRun],
    ["scheme", () => setScheme((s) => (s === "light" ? "dark" : "light"))],
    [`host tap ${taps}`, () => setTaps((n) => n + 1)],
    ["host fetch", () => {
      fetch(`${PROBE}/host-fetch`).then(
        (r) => log(`host fetch ${r.status}`),
        (e: unknown) => log(`host fetch failed ${String(e)}`),
      );
    }],
  ];

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#f4f1ea" }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, padding: 4 }}>
          {actions.map(([label, run]) => (
            <Pressable
              key={label}
              disabled={!dir}
              onPress={run}
              style={{ paddingHorizontal: 8, paddingVertical: 6, backgroundColor: "#dcd5c6", borderRadius: 4 }}
            >
              <Text style={{ fontSize: 12 }}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <ScrollView style={{ maxHeight: 260, paddingHorizontal: 6 }}>
          {slots.map((slot) => (
            <Text key={`s${slot.key}`} style={{ fontSize: 11 }}>{`slot ${slot.key} ${slot.fixture}: ${slot.state}`}</Text>
          ))}
          {lines.map((line, i) => (
            <Text key={`l${i}`} style={{ fontSize: 11 }}>{line}</Text>
          ))}
        </ScrollView>
        <View style={{ flex: 1, flexDirection: "row" }}>
          {slots.map((slot) => (
            <View key={slot.key} style={{ flex: 1, borderWidth: 1, borderColor: "#b9ae98" }}>
              <GuestScreen
                view={`lab-${slot.key}`}
                screenFile={slot.file}
                place={{ place: "phone", params: { probe: PROBE }, workspace: null }}
                scheme={scheme}
                locale="en"
                call={(operation, input) => call(operation, input, slot)}
                subscribe={(listener) => {
                  listeners.current.add(listener);
                  return () => listeners.current.delete(listener);
                }}
                onState={onState(slot.key)}
                log={(line) => log(line.slice(0, 300))}
                backendFile={slot.local?.backend}
                local={slot.local?.local}
                appDb={slot.local && { path: slot.local.db, record: true }}
                onLocalChange={() => log(`slot ${slot.key} local_change, outbox ${outbox(slot.key)}`)}
              />
            </View>
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
