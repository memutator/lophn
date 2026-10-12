import { assert, assertEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import { definePort, type PortKey } from "../../../protocol/base/mod.ts";
import { deps, fileLedger, note, user } from "./command-harness.ts";
import { defineSyncCommand } from "./handler.ts";
import { recordNote } from "./test-commands.ts";
import { defineTxPort, type TxPortRegistration } from "./tx-ports.ts";
import { runCommand } from "./writer.ts";

type Value = { n: number };
const SELF = definePort<Value>("self");
const LEFT = definePort<Value>("left");
const RIGHT = definePort<Value>("right");
const MISSING = definePort<Value>("missing");
type Case = {
  label: string;
  ports: readonly TxPortRegistration[];
  key?: PortKey<Value>;
};

function throwingThen(): object {
  return Object.defineProperty({}, "then", {
    get() {
      throw new Error("secret then inspection");
    },
  });
}

function asyncFactory(
  label: string,
  value: (tx: Tx) => unknown,
): Case {
  return {
    label,
    ports: [defineTxPort(SELF, (tx) => {
      tx.sql.run("insert into reservation (name) values (?)", ["factory"]);
      return value(tx) as Value;
    })],
  };
}

async function rollbackCases(cases: readonly Case[]) {
  const dir = await Deno.makeTempDir({ prefix: "lophn-ports-failure-" });
  let connection:
    | Awaited<ReturnType<typeof fileLedger>>["connection"]
    | undefined;
  try {
    connection = (await fileLedger(dir)).connection;
    connection.sql.run("create table reservation (name text)", []);
    for (const { label, ports, key = SELF } of cases) {
      const bound = deps();
      bound.ports = ports;
      const handler = defineSyncCommand(recordNote, (tx) => {
        try {
          tx.sql.run("insert into reservation (name) values (?)", [label]);
          tx.port(key);
        } catch {
          // 오류를 삼킨 handler도 command를 commit할 수 없다.
        }
        return ok({ name: label, seq: "0" });
      });
      const result = await runCommand(
        connection,
        bound,
        [handler],
        user(),
        note(label, label),
      );
      assert(!result.ok, label);
      if (!result.ok) {
        assertEquals(result.error.code, "internal", label);
        assertEquals(result.error.message, "internal error", label);
      }
      for (const table of ["reservation", "events", "command_results"]) {
        const rows = connection.sql.get(
          `select count(*) as n from ${table}`,
          [],
        );
        assertEquals(rows?.["n"], 0n, `${label}: ${table}`);
      }
    }
  } finally {
    try {
      connection?.close();
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
}

Deno.test("platform/ledger#R13: malformed·없는 key·중복·순환은 handler가 삼켜도 전체 rollback한다", async () => {
  const opaqueFactory = Object.defineProperty({ key: SELF }, "create", {
    get() {
      throw new Error("secret factory accessor");
    },
  }) as TxPortRegistration;
  const opaqueKey = Object.defineProperty({}, "name", {
    get() {
      throw new Error("secret key accessor");
    },
  });
  await rollbackCases([
    { label: "missing", key: MISSING, ports: [] },
    { label: "null-entry", ports: [null as never] },
    { label: "undefined-entry", ports: [undefined as never] },
    {
      label: "undefined-key",
      ports: [{ key: undefined as never, create: () => 1 }],
    },
    { label: "null-key", ports: [{ key: null as never, create: () => 1 }] },
    {
      label: "primitive-key",
      ports: [{ key: "self" as never, create: () => 1 }],
    },
    { label: "empty-key", ports: [{ key: { name: "" }, create: () => 1 }] },
    { label: "nonfunction", ports: [{ key: SELF, create: "no" as never }] },
    { label: "factory-getter", ports: [opaqueFactory] },
    {
      label: "key-getter",
      ports: [{ key: opaqueKey as never, create: () => 1 }],
    },
    { label: "nonarray-registry", ports: new Map() as never },
    {
      label: "duplicate",
      ports: [
        defineTxPort(SELF, () => ({ n: 1 })),
        defineTxPort(SELF, () => ({ n: 2 })),
      ],
    },
    { label: "self", ports: [defineTxPort(SELF, (tx) => tx.port(SELF))] },
    {
      label: "cycle",
      key: LEFT,
      ports: [
        defineTxPort(LEFT, (tx) => tx.port(RIGHT)),
        defineTxPort(RIGHT, (tx) => tx.port(LEFT)),
      ],
    },
  ]);
});

Deno.test("platform/ledger#R13: factory·returned/thrown then 검사 실패는 side effect 뒤 삼켜도 rollback한다", async () => {
  const callable = Object.assign(() => ({ n: 1 }), { then: () => {} });
  const opaqueProxy = new Proxy({}, {
    get() {
      throw new Error("secret proxy inspection");
    },
  });
  await rollbackCases([
    asyncFactory("throw", () => {
      throw new Error("secret factory detail");
    }),
    asyncFactory("promise", () => Promise.reject(new Error("secret"))),
    asyncFactory("thenable", () => ({ then: () => ({ n: 1 }) })),
    asyncFactory("callable-thenable", () => callable),
    asyncFactory("returned-then-getter", () => throwingThen()),
    asyncFactory("thrown-then-getter", () => {
      throw throwingThen();
    }),
    asyncFactory("nested-then-getter", () =>
      Object.defineProperty({}, "then", {
        get() {
          throw throwingThen();
        },
      })),
    asyncFactory("thrown-proxy", () => {
      throw opaqueProxy;
    }),
    asyncFactory("thrown-promise", () => {
      throw Promise.reject(new Error("secret rejection"));
    }),
  ]);
});
