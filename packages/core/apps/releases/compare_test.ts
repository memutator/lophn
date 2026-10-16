import { assert, assertEquals } from "@std/assert";
import type { AppGrant, DataChange } from "../../../protocol/apps/mod.ts";
import { asksFor, compareForActivation } from "./compare.ts";
import { dataChangesOf } from "./activation/desired.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const HASH = "a".repeat(64);

const net = (host: string) => ({
  kind: "net.fetch" as const,
  scope: { host, port: 443 },
  reason: "test",
});
const grantFor = (host: string): AppGrant => ({
  id: "grt_01arz3ndektsv4rrffq69g5fav",
  app: APP,
  scope: { kind: "net.fetch", host, port: 443 },
  status: "active",
  created_at: "2026-10-16T00:00:00.000Z",
  revoked_at: null,
} as AppGrant);

const step = (loss: DataChange["loss"]): DataChange => ({
  from: 1,
  to: 2,
  script_hash: HASH,
  description: "step",
  loss,
});

Deno.test("손실을 선언하면 묻는다", () => {
  const previous = { id: "rel_01arz3ndektsv4rrffq69g5fb1", data_schema: 1 };
  const same = { permissions: [net("a.example")], app_connections: [] };
  const cases: {
    name: string;
    previous: typeof previous | null;
    grants: AppGrant[];
    declarations: typeof same;
    changes: DataChange[];
    asks: boolean;
  }[] = [
    {
      name: "선언이 같고 손실이 없다",
      previous,
      grants: [grantFor("a.example")],
      declarations: same,
      changes: [step([])],
      asks: false,
    },
    {
      name: "지나는 단계가 손실을 선언했다",
      previous,
      grants: [grantFor("a.example")],
      declarations: same,
      changes: [step([{ kind: "drop_table", table: "old" }])],
      asks: true,
    },
    {
      name: "이미 지난 단계의 손실은 묻지 않는다",
      previous: { ...previous, data_schema: 2 },
      grants: [grantFor("a.example")],
      declarations: same,
      changes: [step([{ kind: "drop_table", table: "old" }])],
      asks: false,
    },
    {
      name: "grant가 덮지 않는 바깥 자원이 있다",
      previous,
      grants: [grantFor("a.example")],
      declarations: {
        permissions: [net("a.example"), net("b.example")],
        app_connections: [],
      },
      changes: [],
      asks: true,
    },
    {
      name: "이전 release가 없다",
      previous: null,
      grants: [],
      declarations: { permissions: [], app_connections: [] },
      changes: [],
      asks: true,
    },
  ];
  for (const one of cases) {
    const comparison = compareForActivation({
      previous: one.previous,
      grants: one.grants,
      declarations: one.declarations,
      next: { data_changes: one.changes },
    });
    assertEquals(asksFor(comparison), one.asks, one.name);
  }
});

Deno.test("migration 파일 머리의 loss 줄이 비교까지 닿는다", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/migrations`);
    const sql =
      "-- drop the old table\n-- loss: drop_table old\ndrop table old;\n";
    await Deno.writeTextFile(`${root}/migrations/1-2.sql`, sql);
    const changes = await dataChangesOf({
      root,
      manifest: {
        entrypoint: "main.ts",
        files: [{ path: "migrations/1-2.sql", hash: HASH }],
        sdk_dependencies: [],
        dependencies: [],
      },
    });
    assert(changes.ok);
    assertEquals(changes.value[0].description, "drop the old table");
    const comparison = compareForActivation({
      previous: { id: "rel_01arz3ndektsv4rrffq69g5fb1", data_schema: 1 },
      grants: [],
      declarations: { permissions: [], app_connections: [] },
      next: { data_changes: changes.value },
    });
    assertEquals(comparison.loss_steps.length, 1);
    assert(asksFor(comparison));
    // 줄이 틀리면 release 준비가 거절된다.
    await Deno.writeTextFile(
      `${root}/migrations/1-2.sql`,
      "-- loss: lose_everything\nselect 1;\n",
    );
    const bad = await dataChangesOf({
      root,
      manifest: {
        entrypoint: "main.ts",
        files: [{ path: "migrations/1-2.sql", hash: HASH }],
        sdk_dependencies: [],
        dependencies: [],
      },
    });
    assert(!bad.ok);
    assertEquals(bad.error.code, "invalid_input");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
