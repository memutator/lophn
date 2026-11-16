// Guest side of the app database lab (guest/lab/app-db.tsx). Runs inside a guest runtime, takes the database handle
// the host bound to it, and answers the lab's requests one at a time: each request is one message back.
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { bind, type GuestAppDb, installGuest, openHost } from "../../modules/lophn-app-db/index.ts";

declare const globalThis: {
  postMessage(message: unknown): void;
  setOnMessage(listener: (message: unknown) => void): void;
};

export type ProbeRequest = { id: number; type: string; n?: number; dir?: string };
export type Refusal = { name: string; refused: boolean; error: string };

const LONG_QUERY =
  "with recursive c(x) as (select 1 union all select x + 1 from c) select count(*) as n from c";

function message(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

function refusal(name: string, run: () => unknown): Refusal {
  try {
    run();
    return { name, refused: false, error: "" };
  } catch (thrown) {
    return { name, refused: true, error: message(thrown) };
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let db: GuestAppDb | null = null;
const handle = (): GuestAppDb => {
  if (db === null) throw new Error("not installed");
  return db;
};

const handlers: Record<string, (r: ProbeRequest) => unknown> = {
  install() {
    db = installGuest();
    return Object.keys(db).sort();
  },
  database_list: () => handle().prepare("pragma database_list").all(),
  refusals(r) {
    const d = handle();
    const dir = r.dir ?? "/data/data/dev.lophn.mobile/files";
    return [
      refusal("second install()", () => installGuest()),
      refusal("open another path", () => (d as unknown as { open(p: string): unknown }).open(`${dir}/other.sqlite`)),
      refusal("ATTACH", () => d.exec(`attach database '${dir}/other.sqlite' as other`)),
      refusal("VACUUM INTO", () => d.exec(`vacuum into '${dir}/copy.sqlite'`)),
      refusal("load_extension", () => d.prepare("select load_extension('libc.so') as x").get()),
      refusal("read lophn_sync_outbox", () => d.prepare("select * from lophn_sync_outbox").all()),
      refusal("read LOPHN_SYNC_STATE", () => d.prepare("select * from LOPHN_SYNC_STATE").all()),
      refusal("write lophn_sync_outbox", () =>
        d.exec("insert into lophn_sync_outbox (id, operation, started_at, changeset) values ('x', 'y', 'z', x'00')"),
      ),
      refusal("delete lophn_sync_row", () => d.exec("delete from lophn_sync_row")),
      refusal("drop lophn_sync_col", () => d.exec("drop table lophn_sync_col")),
      refusal("pragma table_info(lophn_sync_outbox)", () => d.prepare("pragma table_info(lophn_sync_outbox)").all()),
      refusal("create trigger", () => d.exec("create trigger t after insert on item begin select 1; end")),
      refusal("COMMIT inside a call", () => {
        d.beginCall();
        try {
          d.exec("commit");
        } finally {
          d.abortCall();
        }
      }),
      refusal("blob over 64 MiB", () => d.prepare("select zeroblob(70000000) as b").get()),
      refusal("host bind()", () => bind("other", `${dir}/other.sqlite`, { record: false })),
      refusal("host openHost()", () => openHost(`${dir}/other.sqlite`)),
    ];
  },
  // Control: the guest still reads and writes its own tables.
  own_tables() {
    const d = handle();
    d.prepare("insert into item (id, title, b) values (?, ?, ?)").run(["guest-empty-blob", "x", new Uint8Array(0)]);
    const row = d.prepare("select typeof(b) as t, length(b) as l, b from item where id = ?").get(["guest-empty-blob"]);
    const b = row?.["b"];
    return { t: row?.["t"], l: row?.["l"], blob: b instanceof Uint8Array ? b.length : String(b) };
  },
  async stress(r) {
    const d = handle();
    const insert = d.prepare("insert into stress (id, who, n, at) values (?, 'guest', ?, ?)");
    const n = r.n ?? 500;
    const t = Date.now();
    let errors = 0;
    let first = "";
    for (let i = 0; i < n; i++) {
      try {
        insert.run([`guest-${i}`, BigInt(i), BigInt(Date.now())]);
      } catch (thrown) {
        errors++;
        first ||= message(thrown);
      }
      if (i % 10 === 9) await tick();
    }
    return { n, errors, first, ms: Date.now() - t };
  },
  call() {
    const d = handle();
    d.beginCall();
    d.prepare("insert into item (id, title) values (?, ?)").run(["call-1", "written in a call"]);
    return d.endCall({ id: "change-1", operation: "save_item", started_at: "2026-11-16T00:00:00.000Z" });
  },
  call_abort() {
    const d = handle();
    d.beginCall();
    d.prepare("insert into item (id, title) values (?, ?)").run(["call-aborted", "rolled back"]);
    d.abortCall();
    return d.prepare("select count(*) as n from item where id = 'call-aborted'").get();
  },
  call_empty() {
    const d = handle();
    d.beginCall();
    d.prepare("select count(*) as n from item").get();
    return d.endCall({ id: "change-empty", operation: "page_items", started_at: "2026-11-16T00:00:00.000Z" });
  },
  long_query() {
    const d = handle();
    const t = Date.now();
    let error = "";
    try {
      d.prepare(LONG_QUERY).get();
    } catch (thrown) {
      error = message(thrown);
    }
    const ms = Date.now() - t;
    const after = d.prepare("select count(*) as n from item").get();
    return { ms, error, after };
  },
  writes() {
    const d = handle();
    const insert = d.prepare("insert into item (id, title) values (?, ?)");
    const t = Date.now();
    for (let i = 0; i < 1000; i++) {
      d.beginCall();
      insert.run([`timed-${i}`, `call ${i}`]);
      d.endCall({ id: `timed-${i}`, operation: "save_item", started_at: "2026-11-16T00:00:00.000Z" });
    }
    return { calls: 1000, ms: Date.now() - t };
  },
  // Leaves a write transaction open, so the lab can show that unbind releases it.
  hold() {
    const d = handle();
    d.beginCall();
    d.prepare("insert into item (id, title) values (?, ?)").run(["held", "never committed"]);
    return "holding";
  },
  after_unbind() {
    const d = handle();
    return [
      refusal("prepare after unbind", () => d.prepare("select 1 as one").get()),
      refusal("exec after unbind", () => d.exec("select 1")),
      refusal("endCall after unbind", () => d.endCall({ id: "x", operation: "y", started_at: "z" })),
    ];
  },
};

export function AppDbProbe() {
  const [last, setLast] = useState("waiting");
  useEffect(() => {
    globalThis.setOnMessage(async (raw) => {
      const r = (typeof raw === "string" ? JSON.parse(raw) : raw) as ProbeRequest;
      const handler = handlers[r.type];
      try {
        if (!handler) throw new Error(`unknown request ${r.type}`);
        const value = await handler(r);
        globalThis.postMessage({ id: r.id, ok: true, value: JSON.parse(JSON.stringify(value, plain)) });
      } catch (thrown) {
        globalThis.postMessage({ id: r.id, ok: false, error: message(thrown) });
      }
      setLast(r.type);
    });
    globalThis.postMessage({ id: 0, ok: true, value: "ready" });
  }, []);
  return (
    <View style={{ padding: 8 }}>
      <Text>guest probe: {last}</Text>
    </View>
  );
}

// Messages are JSON: bigints and blobs go as text.
function plain(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return `${value}n`;
  if (value instanceof Uint8Array) return `blob(${value.length})`;
  return value;
}
