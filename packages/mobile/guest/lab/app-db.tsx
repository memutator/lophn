// Lab for the app database module (modules/lophn-app-db): the host side of the boundary checks in the README's
// "앱 DB native module" section. It opens a file as the host, binds it to a guest that runs guest/fixtures/app-db-probe,
// and runs every probe in order. Each result is a row on screen and an `APPDB` line in logcat.
// Debug: the guest loads this same entry from Metro. Release: the guest loads the embedded bundle.
import SandboxReactNativeView, { type SandboxReactNativeViewRef } from "@callstack/react-native-sandbox";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { readChangeset } from "../../../base/changeset-invert.ts";
import { ensureSyncTables, readOutbox } from "../../../protocol/apps/sync/tables.ts";
import { type AppDbConnection, bind, openHost, unbind } from "../../modules/lophn-app-db/index.ts";
import { APP_DB_SUBSTITUTION } from "../../src/apps/guest/app-db.ts";
import type { ProbeRequest, Refusal } from "../fixtures/app-db-probe.tsx";

const DIR = "/data/data/dev.lophn.mobile/files";
const GUEST_BUNDLE = __DEV__ ? "guest/lab/app-db-entry" : "index.android.bundle";
const SCHEMA = `
create table item (id text primary key, title text not null, n integer, b blob);
create table stress (id text primary key, who text not null, n integer not null, at integer not null);
`;

type Line = { name: string; pass: boolean; detail: string };
type Reply = { id: number; ok: boolean; value?: unknown; error?: string };
type Slot = { origin: string; db: boolean };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x));

export function AppDbLab() {
  const [lines, setLines] = useState<Line[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [state, setState] = useState("starting");
  const ref = useRef<SandboxReactNativeViewRef>(null);
  const waiters = useRef(new Map<number, (r: Reply) => void>());
  const seq = useRef(0);

  const add = (name: string, pass: boolean, detail: unknown) => {
    const line = { name, pass, detail: typeof detail === "string" ? detail : text(detail) };
    console.log(`APPDB ${pass ? "PASS" : "FAIL"} ${name} ${line.detail}`);
    setLines((all) => [...all, line]);
  };

  const ask = (type: string, extra: Partial<ProbeRequest> = {}) =>
    new Promise<Reply>((resolve, reject) => {
      const id = ++seq.current;
      const timer = setTimeout(() => reject(new Error(`no reply to ${type}`)), 60_000);
      waiters.current.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      ref.current?.postMessage({ id, type, ...extra });
    });

  const receive = (raw: unknown) => {
    const r = (typeof raw === "string" ? JSON.parse(raw) : raw) as Reply;
    const waiter = waiters.current.get(r.id);
    waiters.current.delete(r.id);
    waiter?.(r);
  };

  const mount = async (db: boolean, path: string | null) => {
    const origin = `lab-appdb:${Date.now().toString(36)}`;
    if (db && path) bind(origin, path, { record: true });
    const ready = new Promise<Reply>((resolve) => waiters.current.set(0, resolve));
    setSlot({ origin, db });
    await ready;
    return origin;
  };

  const probes = async () => {
    const path = `${DIR}/lab-appdb-${Date.now()}.sqlite`;
    let host: AppDbConnection;
    try {
      host = openHost(path);
      host.exec(SCHEMA);
      ensureSyncTables(host, "phone-lab");
    } catch (thrown) {
      add("host open", false, String(thrown));
      return;
    }
    hostChecks(host, add);

    const origin = await mount(true, path);
    const install = await ask("install");
    add("guest install()", install.ok, install.ok ? install.value : install.error);

    // (a) the guest sees one file
    const list = await ask("database_list");
    const rows = (list.value ?? []) as { name: string; file: string }[];
    add("(a) guest database_list is the bound file", list.ok && rows.length === 1 && rows[0]?.file === path, list.value ?? list.error);

    // (b) refused
    const refused = await ask("refusals", { dir: DIR });
    for (const r of (refused.value ?? []) as Refusal[]) add(`(b) refused: ${r.name}`, r.refused, r.error || "allowed");
    if (!refused.ok) add("(b) refusals", false, refused.error);
    const own = await ask("own_tables");
    const ownValue = own.value as { t?: string; l?: number; blob?: number } | undefined;
    add("guest own table, empty blob stays a blob", own.ok && ownValue?.t === "blob" && ownValue.l === 0 && ownValue.blob === 0, own.value ?? own.error);

    // (c) 500 host + 500 guest interleaved writes
    const insert = host.prepare("insert into stress (id, who, n, at) values (?, 'host', ?, ?)");
    const guestStress = ask("stress", { n: 500 });
    const t = Date.now();
    let hostErrors = 0;
    for (let i = 0; i < 500; i++) {
      try {
        insert.run([`host-${i}`, BigInt(i), BigInt(Date.now())]);
      } catch {
        hostErrors++;
      }
      if (i % 10 === 9) await sleep(0);
    }
    const hostMs = Date.now() - t;
    const guestResult = await guestStress;
    const counts = host.all("select who, count(*) as n from stress group by who order by who");
    const order = host.all("select who from stress order by at, rowid").map((r) => r["who"]);
    let switches = 0;
    for (let i = 1; i < order.length; i++) if (order[i] !== order[i - 1]) switches++;
    const integrity = host.all("pragma integrity_check")[0]?.["integrity_check"];
    const gv = guestResult.value as { errors: number } | undefined;
    add(
      "(c) 500 host + 500 guest interleaved, integrity_check",
      integrity === "ok" && hostErrors === 0 && gv?.errors === 0 && counts.length === 2,
      { integrity, counts, switches, host: { errors: hostErrors, ms: hostMs }, guest: guestResult.value ?? guestResult.error },
    );

    // (d) a call writes one outbox row in its transaction; an aborted call leaves nothing
    const call = await ask("call");
    const outbox = readOutbox(host);
    const decoded = outbox[0] ? readChangeset(outbox[0].changeset) : null;
    const bytes = (call.value as { bytes?: number } | undefined)?.bytes;
    add(
      "(d) endCall writes one outbox row, host reads it",
      call.ok && outbox.length === 1 && outbox[0]?.changeset.length === bytes && outbox[0]?.hlc === null && decoded?.ok === true && decoded.value[0]?.table === "item",
      { call: call.value ?? call.error, outbox: outbox.map((o) => ({ ...o, changeset: o.changeset.length })), tables: decoded?.ok ? decoded.value.map((c) => `${c.op} ${c.table}`) : decoded },
    );
    const aborted = await ask("call_abort");
    const afterAbort = readOutbox(host).length;
    const abortedRow = host.all("select count(*) as n from item where id = 'call-aborted'")[0]?.["n"];
    add("(d) abortCall leaves nothing", aborted.ok && afterAbort === 1 && abortedRow === 0, { guest: aborted.value ?? aborted.error, outbox: afterAbort, row: abortedRow });
    const empty = await ask("call_empty");
    add("(d) a call without changes writes no outbox row", empty.ok && readOutbox(host).length === 1, empty.value ?? empty.error);

    // (e) a runaway query is stopped at 5 s; host and guest keep running
    let ticks = 0;
    const timer = setInterval(() => {
      ticks++;
    }, 100);
    const long = ask("long_query");
    await sleep(1000);
    let hostDuring = "";
    try {
      hostDuring = text(host.prepare("select count(*) as n from item").get());
    } catch (thrown) {
      hostDuring = String(thrown);
    }
    const longReply = await long;
    clearInterval(timer);
    const lv = longReply.value as { ms: number; error: string; after?: unknown } | undefined;
    add(
      "(e) 5 s query stopped, guest and host keep running",
      longReply.ok && lv !== undefined && lv.error !== "" && lv.ms >= 4900 && lv.ms < 7000 && lv.after !== undefined && ticks >= 40,
      { guest: longReply.value ?? longReply.error, hostTicks: ticks, hostReadDuring: hostDuring },
    );

    // numbers: 1,000 writes
    const writes = await ask("writes");
    const ht = Date.now();
    const hostInsert = host.prepare("insert into item (id, title) values (?, ?)");
    for (let i = 0; i < 1000; i++) hostInsert.run([`host-timed-${i}`, `host ${i}`]);
    add("1,000 writes", writes.ok, { guestCallsWithOutbox: writes.value ?? writes.error, hostAutocommitMs: Date.now() - ht, outboxRows: readOutbox(host).length });

    // (f) unbind closes the guest's connection (and its open transaction); its handle fails from then on
    const hold = await ask("hold");
    unbind(origin);
    const after = await ask("after_unbind");
    for (const r of (after.value ?? []) as Refusal[]) add(`(f) ${r.name}`, r.refused, r.error || "allowed");
    const wt = Date.now();
    let freed = "";
    try {
      host.prepare("insert into item (id, title) values ('after-unbind', 'host')").run();
      freed = "ok";
    } catch (thrown) {
      freed = String(thrown);
    }
    const held = host.all("select count(*) as n from item where id = 'held'")[0]?.["n"];
    add("(f) unbind rolled back the guest's open call, host writes at once", hold.ok && freed === "ok" && held === 0 && Date.now() - wt < 1000, { freed, ms: Date.now() - wt, held });
    setSlot(null);
    await sleep(500);
    const finalIntegrity = host.all("pragma integrity_check")[0]?.["integrity_check"];
    add("integrity_check at the end", finalIntegrity === "ok", finalIntegrity);
    host.close();
  };

  useEffect(() => {
    void (async () => {
      try {
        await probes();
      } catch (thrown) {
        add("lab", false, String(thrown));
      }
      setState("done");
      console.log("APPDB DONE");
    })();
    // biome-ignore lint/correctness/useExhaustiveDependencies: runs once
  }, []);

  // For memory numbers: mount a guest with or without the database and leave it mounted.
  const hold = async (db: boolean) => {
    setSlot(null);
    await sleep(300);
    const path = `${DIR}/lab-appdb-mem.sqlite`;
    if (db) {
      const host = openHost(path);
      host.exec("create table if not exists item (id text primary key, title text not null, n integer, b blob)");
      ensureSyncTables(host, "phone-lab");
      host.close();
    }
    await mount(db, db ? path : null);
    if (db) {
      await ask("install");
      await ask("writes");
    }
    setState(db ? "guest with database" : "guest without database");
    console.log(`APPDB HOLD ${db ? "db" : "plain"}`);
  };

  const failed = lines.filter((l) => !l.pass).length;
  return (
    <View style={{ flex: 1, paddingTop: 40, backgroundColor: "#fff" }}>
      <Text style={{ fontSize: 16, fontWeight: "600", paddingHorizontal: 12 }}>
        App DB lab ({__DEV__ ? "debug" : "release"}) · {state} · {lines.length - failed} pass, {failed} fail
      </Text>
      <View style={{ flexDirection: "row", gap: 8, padding: 8 }}>
        <Button label="Hold guest + DB" onPress={() => void hold(true)} />
        <Button label="Hold plain guest" onPress={() => void hold(false)} />
        <Button
          label="Unmount"
          onPress={() => {
            setSlot(null);
            setState("no guest");
            console.log("APPDB HOLD none");
          }}
        />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12 }}>
        {lines.map((l, i) => (
          <Text key={`${i}-${l.name}`} style={{ fontSize: 11, color: l.pass ? "#14532d" : "#b91c1c" }}>
            {l.pass ? "PASS" : "FAIL"} {l.name}: {l.detail.slice(0, 300)}
          </Text>
        ))}
      </ScrollView>
      <View style={{ height: 40 }}>
        {slot && (
          <SandboxReactNativeView
            key={slot.origin}
            ref={ref}
            origin={slot.origin}
            componentName="AppDbProbe"
            jsBundleSource={GUEST_BUNDLE}
            turboModuleSubstitutions={slot.db ? APP_DB_SUBSTITUTION : undefined}
            onMessage={receive}
            onError={(e) => add("guest error", false, e)}
            style={{ flex: 1 }}
          />
        )}
      </View>
    </View>
  );
}

function Button(props: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={{ padding: 8, backgroundColor: "#e5e7eb", borderRadius: 6 }}>
      <Text style={{ fontSize: 12 }}>{props.label}</Text>
    </Pressable>
  );
}

function hostChecks(host: AppDbConnection, add: (name: string, pass: boolean, detail: unknown) => void) {
  try {
    host.run("insert into item (id, title, b) values (?, ?, ?)", ["host-empty-blob", "x", new Uint8Array(0)]);
    const r = host.prepare("select typeof(b) as t, length(b) as l, b from item where id = ?").get(["host-empty-blob"]);
    const b = r?.["b"];
    add("host: empty Uint8Array stays an empty blob", r?.["t"] === "blob" && r["l"] === 0 && b instanceof Uint8Array && b.length === 0, { t: r?.["t"], l: r?.["l"] });

    const big = 2n ** 62n + 1n;
    host.run("insert into item (id, title, n) values (?, ?, ?), (?, ?, ?)", ["big", "x", big, "small", "x", 42n]);
    const rows = host.all("select id, n, typeof(n) as t from item where id in ('big', 'small') order by id");
    add("host: INTEGER above 2^53 reads as bigint, small as number", rows[0]?.["n"] === big && rows[1]?.["n"] === 42 && rows[0]?.["t"] === "integer", rows);
    const real = host.prepare("select typeof(?) as t").get([1]);
    add("host: JS number binds as REAL", real?.["t"] === "real", real);

    const s = host.session();
    host.run("insert into item (id, title) values (?, ?)", ["in-session", "x"]);
    host.run("insert into lophn_sync_state (key, value) values ('cursor', '1') on conflict (key) do update set value = excluded.value");
    const cs = s.changeset();
    s.close();
    const changes = readChangeset(cs);
    const tables = changes.ok ? changes.value.map((c) => c.table) : [];
    add("host: session records user tables only", tables.length === 1 && tables[0] === "item", { bytes: cs.length, tables });
  } catch (thrown) {
    add("host checks", false, String(thrown));
  }
}
