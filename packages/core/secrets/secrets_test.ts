import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  seededRandom,
} from "../../base/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import type { SecretPreparation } from "../../protocol/secrets/mod.ts";
import { applyMigrations } from "../storage/migration/mod.ts";
import { LEDGER_SCHEMA_STEPS, openLedger } from "../storage/ledger/mod.ts";
import { createKnownSecretRegistry } from "../../base/redaction/mod.ts";
import { createFakeKeychain } from "./adapters/fake-keychain.ts";
import {
  createLinuxSecretServiceAdapter,
  type SecretToolRunner,
  sessionEnv,
} from "./adapters/linux-secret-service.ts";
import { unavailableAdapter } from "./adapters/keychain.ts";
import { removeSecretCommand, setSecretCommand } from "./commands.ts";
import { readSecretStatuses } from "./reads.ts";
import { SECRET_SCHEMA_STEPS } from "./schema.ts";
import {
  createSecretWork,
  type PreparationStore,
  type ProcessWatch,
} from "./work.ts";
import type { SecretRecord } from "./model.ts";

const START = Date.parse("2026-01-01T00:00:00.000Z");

function ledgerAt(path: string) {
  const clock = manualClock(START);
  return openLedger(path, {
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
    registerBlobRef: () => err({ code: "unavailable", message: "blob 없음" }),
    call: () => err({ code: "unavailable", message: "dispatch 없음" }),
  });
}

async function migrated(prefix: string) {
  const dir = await Deno.makeTempDir({ prefix });
  const path = `${dir}/ledger.db`;
  const applied = await applyMigrations(
    path,
    [...LEDGER_SCHEMA_STEPS, ...SECRET_SCHEMA_STEPS],
    { clock: manualClock(START) },
  );
  assert(applied.ok);
  const opened = ledgerAt(path);
  assert(opened.ok);
  return { dir, ledger: opened.value };
}

function recordPreparation(tx: Tx, preparation: SecretPreparation) {
  tx.sql.run(
    "insert into secret_preparations (preparation, sealed_ref, purpose, owner) values (?, ?, ?, ?)",
    [
      preparation.preparation,
      preparation.sealed_ref,
      preparation.purpose,
      preparation.owner,
    ],
  );
}

function preparation(
  name: string,
  ref: string,
  id = `prep-${ref}`,
): SecretPreparation {
  return {
    preparation: id,
    sealed_ref: ref,
    purpose: "app_secret",
    owner: name,
  };
}

function storedRef(tx: Tx, name: string): string | undefined {
  const row = tx.sql.get(
    "select sealed_ref from secrets where name = ?",
    [name],
  );
  return row === undefined ? undefined : String(row["sealed_ref"]);
}

Deno.test("platform/secrets#R1 platform/secrets#R6: SetSecret은 준비 참조만 저장하고 값은 ledger에 없다", async () => {
  const { dir, ledger } = await migrated("secrets-set-");
  try {
    const name = "service.key";
    const value = "raw-secret-value";
    const first = ledger.transaction({ actor: "user" }, (tx) => {
      recordPreparation(tx, preparation(name, "ref-1"));
      return setSecretCommand.handle(
        tx,
        {
          principal: "user-1",
          actor: "user",
          scope: { operations: [], targets: {} },
          conditions: {},
          credential_ref: "c",
        },
        { name, preparation: preparation(name, "ref-1") },
        { sealed_ref: null, revision: null },
      );
    });
    assert(first.ok);
    assertEquals(first.value, { name, configured: true, revision: 1 });

    const inspect = ledger.transaction({ actor: "user" }, (tx) => {
      const row = tx.sql.get(
        "select sealed_ref, revision from secrets where name = ?",
        [name],
      );
      const event = tx.sql.get("select payload from events where subject = ?", [
        `secret:${name}`,
      ]);
      return ok({
        ref: String(row?.["sealed_ref"]),
        payload: String(event?.["payload"]),
      });
    });
    assert(inspect.ok);
    assertEquals(inspect.value.ref, "ref-1");
    assert(!inspect.value.payload.includes(value));
    assert(!inspect.value.payload.includes("sealed_ref"));
  } finally {
    ledger.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/secrets#R6: CAS가 실패하면 이전 참조와 판을 유지한다", async () => {
  const { dir, ledger } = await migrated("secrets-cas-");
  try {
    const name = "service.key";
    const ctx = {
      principal: "user-1",
      actor: "user" as const,
      scope: { operations: [], targets: {} },
      conditions: {},
      credential_ref: "c",
    };
    const created = ledger.transaction({ actor: "user" }, (tx) => {
      recordPreparation(tx, preparation(name, "ref-1"));
      return setSecretCommand.handle(tx, ctx, {
        name,
        preparation: preparation(name, "ref-1"),
      }, { sealed_ref: null, revision: null });
    });
    assert(created.ok);

    const stale = ledger.transaction({ actor: "user" }, (tx) => {
      recordPreparation(tx, preparation(name, "ref-2", "prep-2"));
      return setSecretCommand.handle(
        tx,
        ctx,
        { name, preparation: preparation(name, "ref-2", "prep-2") },
        { sealed_ref: "ref-1", revision: 9 },
      );
    });
    assert(!stale.ok);
    assertEquals(stale.error.code, "conflict");

    const kept = ledger.transaction(
      { actor: "user" },
      (tx) =>
        ok({
          ref: storedRef(tx, name),
          revision: tx.sql.get("select revision from secrets where name = ?", [
            name,
          ]),
        }),
    );
    assert(kept.ok);
    assertEquals(kept.value.ref, "ref-1");
    assertEquals(Number(kept.value.revision?.["revision"]), 1);
  } finally {
    ledger.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/secrets#R6: 준비 증거가 없으면 참조를 바꾸지 않는다", async () => {
  const { dir, ledger } = await migrated("secrets-prep-");
  try {
    const name = "service.key";
    const rejected = ledger.transaction(
      { actor: "user" },
      (tx) =>
        setSecretCommand.handle(
          tx,
          {
            principal: "u",
            actor: "user",
            scope: { operations: [], targets: {} },
            conditions: {},
            credential_ref: "c",
          },
          { name, preparation: preparation(name, "ref-1") },
          { sealed_ref: null, revision: null },
        ),
    );
    assert(!rejected.ok);
    assertEquals(rejected.error.code, "forbidden");
    const empty = ledger.transaction(
      { actor: "user" },
      (tx) => ok(tx.sql.get("select name from secrets", [])),
    );
    assert(empty.ok);
    assertEquals(empty.value, undefined);
  } finally {
    ledger.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/secrets#R7: RemoveSecret은 참조 차단만 확정하고 삭제·종료는 확정하지 않는다", async () => {
  const { dir, ledger } = await migrated("secrets-remove-");
  try {
    const name = "service.key";
    const ctx = {
      principal: "u",
      actor: "user" as const,
      scope: { operations: [], targets: {} },
      conditions: {},
      credential_ref: "c",
    };
    ledger.transaction({ actor: "user" }, (tx) => {
      recordPreparation(tx, preparation(name, "ref-1"));
      return setSecretCommand.handle(tx, ctx, {
        name,
        preparation: preparation(name, "ref-1"),
      }, { sealed_ref: null, revision: null });
    });
    const removed = ledger.transaction(
      { actor: "user" },
      (tx) =>
        removeSecretCommand.handle(tx, ctx, { name }, {
          sealed_ref: "ref-1",
          revision: 1,
        }),
    );
    assert(removed.ok);
    assertEquals(removed.value, {
      reference_blocked: true,
      os_deleted: false,
      processes_ended: false,
    });
    const gone = ledger.transaction(
      { actor: "user" },
      (tx) => ok(storedRef(tx, name)),
    );
    assert(gone.ok);
    assertEquals(gone.value, undefined);
  } finally {
    ledger.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/secrets#R4: 권한 없는 이름과 없는 이름은 같은 거절이고 결과는 설정 여부만 담는다", async () => {
  const { dir, ledger } = await migrated("secrets-list-");
  try {
    const name = "service.key";
    ledger.transaction({ actor: "user" }, (tx) => {
      recordPreparation(tx, preparation(name, "ref-1"));
      return setSecretCommand.handle(
        tx,
        {
          principal: "u",
          actor: "user",
          scope: { operations: [], targets: {} },
          conditions: {},
          credential_ref: "c",
        },
        { name, preparation: preparation(name, "ref-1") },
        { sealed_ref: null, revision: null },
      );
    });
    const listed = ledger.transaction(
      { actor: "user" },
      (tx) => readSecretStatuses(tx.sql, [name], [name]),
    );
    assert(listed.ok);
    assertEquals(listed.value.secrets, [{
      name,
      configured: true,
      revision: 1,
    }]);
    assert(!JSON.stringify(listed.value).includes("ref-1"));

    const absent = ledger.transaction(
      { actor: "user" },
      (tx) => readSecretStatuses(tx.sql, [name], ["missing.key"]),
    );
    const forbidden = ledger.transaction(
      { actor: "user" },
      (tx) => readSecretStatuses(tx.sql, [name], ["other.key"]),
    );
    assert(!absent.ok && !forbidden.ok);
    assertEquals(absent.error, forbidden.error);
  } finally {
    ledger.close();
    await Deno.remove(dir, { recursive: true });
  }
});

function memoryStore(): PreparationStore & { rows: SecretPreparation[] } {
  const rows: SecretPreparation[] = [];
  return {
    rows,
    record(preparation) {
      rows.push(preparation);
      return Promise.resolve(ok(undefined));
    },
    orphans(current) {
      const stale = rows
        .map((row) => row.sealed_ref)
        .filter((ref) => !current.includes(ref));
      return Promise.resolve(ok(stale));
    },
  };
}

Deno.test("platform/secrets#R1 platform/secrets#R8: fake adapter는 값을 keychain에만 두고 잠기면 unavailable이다", async () => {
  const keychain = createFakeKeychain();
  const registry = createKnownSecretRegistry();
  const store = memoryStore();
  let ended = false;
  const processes: ProcessWatch = { ended: () => Promise.resolve(ended) };
  const work = createSecretWork({
    keychain,
    preparations: store,
    registry,
    processes,
    preparationId: () => "prep-1",
  });
  const value = "rotated-secret-value";
  const prepared = await work.prepare(
    {
      context: {
        principal: "machine-1",
        actor: "machine",
        scope: { operations: ["secret.prepare"], targets: {} },
        conditions: { process: "io", task: "secrets" },
        credential_ref: "cred",
      },
      purpose: "app_secret",
      owner: "service.key",
    },
    value,
  );
  assert(prepared.ok);
  assertEquals(prepared.value.owner, "service.key");
  assert(!prepared.value.sealed_ref.includes(value));
  assertEquals(registry.count, 1);
  const loaded = await keychain.load(prepared.value.sealed_ref);
  assert(loaded.ok);
  assertEquals(new TextDecoder().decode(loaded.value), value);

  const record: SecretRecord = {
    name: "service.key",
    sealedRef: prepared.value.sealed_ref,
    revision: 1,
  };
  keychain.holdRemovals(true);
  const waiting = await work.cleanup({
    previous: record,
    referenceBlocked: true,
  });
  assertEquals(waiting, {
    reference_blocked: true,
    os_deleted: false,
    processes_ended: false,
  });
  assert(keychain.stored.has(record.sealedRef));
  keychain.holdRemovals(false);
  keychain.confirmRemovals();
  ended = true;
  const done = await work.cleanup({ previous: record, referenceBlocked: true });
  assertEquals(done, {
    reference_blocked: true,
    os_deleted: true,
    processes_ended: true,
  });

  keychain.setStatus("unavailable");
  const blocked = await work.prepare(
    {
      context: {
        principal: "machine-1",
        actor: "machine",
        scope: { operations: ["secret.prepare"], targets: {} },
        conditions: { process: "io", task: "secrets" },
        credential_ref: "cred",
      },
      purpose: "app_secret",
      owner: "service.key",
    },
    "next-value",
  );
  assert(!blocked.ok);
  assertEquals(blocked.error.code, "unavailable");
  assertEquals(registry.count, 1);
});

Deno.test("platform/secrets#R8: keychain이 없으면 secret 기능만 unavailable이고 fallback 저장이 없다", async () => {
  const keychain = unavailableAdapter();
  const registry = createKnownSecretRegistry();
  const work = createSecretWork({
    keychain,
    preparations: memoryStore(),
    registry,
    processes: { ended: () => Promise.resolve(false) },
    preparationId: () => "prep",
  });
  const result = await work.prepare(
    {
      context: {
        principal: "machine-1",
        actor: "machine",
        scope: { operations: ["secret.prepare"], targets: {} },
        conditions: { process: "io", task: "secrets" },
        credential_ref: "cred",
      },
      purpose: "provider_credential",
      owner: "provider.openai",
    },
    "sk-value",
  );
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
  assertEquals(registry.count, 0);
});

function scriptedRunner(script: {
  search?: number;
  store?: number;
  lookup?: { code: number; stdout?: Uint8Array };
  clear?: number;
  lookupAfter?: number;
}): SecretToolRunner & { calls: { args: string[]; stdin?: Uint8Array }[] } {
  const calls: { args: string[]; stdin?: Uint8Array }[] = [];
  return {
    calls,
    run(args, stdin) {
      calls.push({ args: [...args], stdin });
      const command = args[0];
      if (command === "search") {
        return Promise.resolve(
          ok({ code: script.search ?? 1, stdout: new Uint8Array() }),
        );
      }
      if (command === "store") {
        return Promise.resolve(
          ok({ code: script.store ?? 0, stdout: new Uint8Array() }),
        );
      }
      if (
        command === "lookup" &&
        calls.filter((call) => call.args[0] === "lookup").length > 1
      ) {
        return Promise.resolve(
          ok({ code: script.lookupAfter ?? 1, stdout: new Uint8Array() }),
        );
      }
      if (command === "lookup") {
        return Promise.resolve(
          ok({
            code: script.lookup?.code ?? 0,
            stdout: script.lookup?.stdout ?? new Uint8Array(),
          }),
        );
      }
      if (command === "clear") {
        return Promise.resolve(
          ok({ code: script.clear ?? 0, stdout: new Uint8Array() }),
        );
      }
      return Promise.resolve(
        err({ code: "unavailable" as const, message: "없다" }),
      );
    },
  };
}

Deno.test("platform/secrets#R1 platform/secrets#R8: Linux adapter는 값을 stdin으로만 보내고 없으면 unavailable이다", async () => {
  const value = new TextEncoder().encode("linux-secret-value");
  const runner = scriptedRunner({ lookup: { code: 0, stdout: value } });
  let serial = 0;
  const adapter = createLinuxSecretServiceAdapter({
    runner,
    randomRef: () => `ref-${++serial}`,
  });
  assertEquals(await adapter.status(), "available");
  const stored = await adapter.store({
    name: "service.key",
    purpose: "app_secret",
    owner: "service.key",
    value,
  });
  assert(stored.ok);
  const storeCall = runner.calls.find((call) => call.args[0] === "store");
  assert(storeCall !== undefined);
  assertEquals(storeCall.stdin, value);
  assert(!storeCall.args.join(" ").includes("linux-secret-value"));
  const loaded = await adapter.load(stored.value);
  assert(loaded.ok);
  assertEquals(loaded.value, value);
  const removed = await adapter.remove(stored.value);
  assert(removed.ok);

  const missing = createLinuxSecretServiceAdapter({
    runner: {
      run: () =>
        Promise.resolve(
          err({ code: "unavailable", message: "secret-tool 없음" }),
        ),
    },
    randomRef: () => "ref",
  });
  assertEquals(await missing.status(), "unavailable");
  const refused = await missing.store({
    name: "service.key",
    purpose: "app_secret",
    owner: "service.key",
    value,
  });
  assert(!refused.ok);
  assertEquals(refused.error.code, "unavailable");
});

Deno.test("platform/secrets#R6: 현재 참조가 아닌 준비는 고아로 구별한다", async () => {
  const store = memoryStore();
  await store.record(preparation("service.key", "current", "prep-current"));
  await store.record(preparation("service.key", "orphan", "prep-orphan"));
  const found = await store.orphans(["current"]);
  assert(found.ok);
  assertEquals(found.value, ["orphan"]);
});

Deno.test("platform/secrets#R1 platform/secrets#R8: secret-tool 자식 env는 session bus 주소만 받는다", () => {
  const parent: Record<string, string> = {
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    XDG_RUNTIME_DIR: "/run/user/1000",
    PATH: "/usr/bin",
    LOPHN_TOKEN: "lophn-secret-value",
    HOME: "/home/someone",
  };
  assertEquals(sessionEnv((name) => parent[name]), {
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    XDG_RUNTIME_DIR: "/run/user/1000",
    PATH: "/usr/bin",
  });
});
