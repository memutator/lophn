import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import {
  type CommandDefinition,
  type ReadDefinition,
  TargetAuthorization,
  type Tx,
} from "../../protocol/server/mod.ts";
import {
  ACTOR_KINDS,
  defineCommand,
  definePort,
  defineRead,
  type JsonValue,
  withReadCommon,
} from "../../protocol/base/mod.ts";
import { CONDITION_TARGET_KEYS } from "../server/identity/mod.ts";
import { runAdmission } from "../storage/ledger/mod.ts";
import {
  defineTxPort,
  type LedgerTestEnvironment,
  type LedgerTestRegistration,
} from "./ledger.ts";

function domainTargets(
  targets: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const domain: Record<string, JsonValue> = {};
  for (const key of Object.getOwnPropertyNames(targets)) {
    if (!(CONDITION_TARGET_KEYS as readonly string[]).includes(key)) {
      domain[key] = targets[key];
    }
  }
  return domain;
}

const input = z.object({
  key: z.string(),
  fail: z.boolean().default(false),
  blob: z.boolean().default(false),
});
const output = z.object({
  serial: z.number(),
  actor: z.string(),
  run: z.string().nullable(),
  mode: z.string().nullable(),
});
export const createRoute = defineCommand({
  resource: "owner",
  method: "create",
  name: "owner.create",
  input,
  output,
  actors: ACTOR_KINDS,
  errors: ["conflict", "forbidden", "unavailable"],
});
export const lifecycleRoute = defineCommand({
  resource: "owner",
  method: "finish",
  name: "owner.finish",
  input: z.object({}),
  output: z.object({ sealed: z.boolean() }),
  actors: ACTOR_KINDS,
  errors: [],
});
export const crashRoute = defineCommand({
  resource: "owner",
  method: "crash",
  name: "owner.crash",
  input: z.object({}),
  output: z.object({}),
  actors: ACTOR_KINDS,
  errors: [],
});
export const readRoute = defineRead({
  resource: "owner",
  method: "read",
  name: "owner.read",
  input: z.object({}),
  output: withReadCommon(
    z.object({
      keys: z.array(z.string()),
      actor: z.string(),
      mode: z.string().nullable(),
      run: z.string().nullable(),
      port: z.string(),
      sealed: z.boolean(),
    }),
  ),
  actors: ACTOR_KINDS,
  errors: [],
});
const portKey = definePort<
  { serial: number; tx: Tx; write(key: string): void }
>("owner.write");
const readPort = definePort<string>("owner.read");

// fixture는 Worker 안에서만 함수를 재조립하고 Deno.test side effect를 만들지 않는다.
export function createLedgerTestRegistration(
  environment: LedgerTestEnvironment,
): LedgerTestRegistration {
  let serial = 0;
  let previous: ReturnType<Tx["port"]> | undefined;
  let previousTx: Tx | undefined;
  let escapedBlobTx: Tx | undefined;
  const commands: CommandDefinition[] = [{
    route: createRoute,
    handle(tx, ctx, raw) {
      const parsed = input.parse(raw);
      const current = environment.currentCredential(ctx.credential_ref);
      if (!current.ok) return current;
      if (
        current.value.actor !== ctx.actor ||
        current.value.scope.operations.join() !== ctx.scope.operations.join()
      ) throw new Error("not current context");
      const allowed = tx.port(TargetAuthorization)(
        ctx,
        createRoute.name,
        domainTargets(current.value.scope.targets),
      );
      if (!allowed.ok) return allowed;
      const implementation = tx.port(portKey);
      if (
        implementation !== tx.port(portKey) ||
        !Object.isFrozen(implementation) || implementation === previous
      ) throw new Error("port identity differs");
      previous = implementation;
      implementation.write(parsed.key);
      const seq = tx.emit(
        {
          type: "OwnerCreated",
          payload: z.object({ key: z.string(), id: z.string() }),
        },
        `owner:${parsed.key}`,
        { key: parsed.key, id: tx.newId("doc") },
      );
      if (parsed.blob) {
        const registered = tx.registerBlobRef({
          owner_kind: "owner",
          owner_key: parsed.key,
          field: "body",
          registered_seq: seq,
          source: {
            kind: "prepared",
            blob: {
              preparation: "prepared",
              principal: ctx.principal,
              purpose: "owner_body",
              hash: "a".repeat(64),
              size_bytes: 1,
            },
          },
        });
        if (!registered.ok) return registered;
      }
      previousTx = tx;
      if (parsed.fail) return err({ code: "conflict", message: "owner 실패" });
      return ok({
        serial: implementation.serial,
        actor: ctx.actor,
        run: ctx.run ?? null,
        mode: ctx.conditions.mode ?? null,
      });
    },
  }];
  const testCommands: CommandDefinition[] = [{
    route: lifecycleRoute,
    handle() {
      let sealed = false;
      try {
        previousTx?.now();
      } catch {
        sealed = true;
      }
      if (escapedBlobTx) {
        try {
          escapedBlobTx.sql.run("insert into owners values ('escaped')", []);
          sealed = false;
        } catch { /* guarded Tx */ }
      }
      return ok({ sealed });
    },
  }, {
    route: crashRoute,
    handle() {
      // 이 fixture만 Worker failure의 pending settlement를 재현한다.
      queueMicrotask(() => {
        throw new Error("fixture Worker failure");
      });
      return ok({});
    },
  }];
  const reads: ReadDefinition[] = [{
    route: readRoute,
    handle(snapshot, ctx) {
      const allowed = snapshot.port(TargetAuthorization)(
        ctx,
        readRoute.name,
        domainTargets(ctx.scope.targets),
      );
      if (!allowed.ok) return allowed;
      let sealed = false;
      try {
        snapshot.sql.all(
          "insert into owners values ('reader-write') returning key",
          [],
        );
      } catch {
        sealed = true;
      }
      return ok({
        keys: snapshot.sql.all("select key from owners order by key", []).map((
          row,
        ) => String(row.key)),
        actor: ctx.actor,
        mode: ctx.conditions.mode ?? null,
        run: ctx.run ?? null,
        port: snapshot.port(readPort),
        sealed,
        as_of_seq: "999",
        next_cursor: null,
      });
    },
  }];
  return {
    schemaSteps: [{
      id: "owner-tables",
      sql:
        "create table owners (key text primary key); create table owner_blob_refs (owner_key text primary key, hash text not null, registered_seq integer references events(seq));",
    }],
    commands,
    testCommands,
    reads,
    ports: [
      defineTxPort(portKey, (tx) =>
        Object.freeze({
          serial: ++serial,
          tx,
          write: (key: string) => {
            tx.sql.run("insert into owners values (?)", [key]);
          },
        })),
      // agent command는 run 판정이 있어야 한다. 이 등록의 테스트는 진행 중 run만 본다.
      defineTxPort(runAdmission, () => ({ status: () => "active" as const })),
    ],
    readPorts: new Map([[readPort, "reader-local-port"]]),
    registerBlobRef(tx, ctx, reference) {
      escapedBlobTx = tx;
      if (
        reference.source.kind !== "prepared" ||
        reference.source.blob.principal !== ctx.principal
      ) return err({ code: "forbidden", message: "blob owner가 다르다" });
      tx.sql.run("insert into owner_blob_refs values (?, ?, ?)", [
        reference.owner_key,
        reference.source.blob.hash,
        BigInt(reference.registered_seq),
      ]);
      return ok({
        owner_kind: reference.owner_kind,
        owner_key: reference.owner_key,
        field: reference.field,
        hash: reference.source.blob.hash,
        registered_seq: reference.registered_seq,
      });
    },
  };
}
