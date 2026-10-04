import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { manualClock, ok, type Result } from "../../base/mod.ts";
import {
  defineCommand,
  defineRead,
  TargetAuthorization,
  withReadCommon,
} from "../../contracts/platform/mod.ts";
import { applyMigrations } from "../backup-and-migration/mod.ts";
import { TARGET_AUTHORIZATION_UNAVAILABLE } from "../identity/mod.ts";
import { deps, START, user } from "./command-harness.ts";
import { executeCommand } from "./executor.ts";
import { defineSyncCommand } from "./handler.ts";
import { openConnection, openLedger } from "./mod.ts";
import { openReaderConnection } from "./reader-connection.ts";
import { executeRead } from "./reads.ts";
import { LEDGER_SCHEMA_STEPS } from "./schema.ts";

function code(result: Result<unknown>): string {
  assert(!result.ok);
  return result.error.code;
}

const PROJECT = "prj_00000000000000000000000000";
const OTHER = "prj_00000000000000000000000001";

function scoped() {
  return {
    ...user("owner-1"),
    scope: {
      operations: ["RecordDomain", "domain/get"],
      targets: { project: PROJECT, mode: "edit" },
    },
    conditions: { mode: "edit" },
  };
}

const recordDomain = defineCommand({
  resource: "domain",
  method: "record",
  name: "RecordDomain",
  input: z.strictObject({ project: z.string() }),
  output: z.strictObject({ project: z.string() }),
  actors: ["user"],
  errors: ["forbidden", "invalid_input"],
});

const definition = defineSyncCommand(recordDomain, (tx, ctx, input) => {
  const allowed = tx.port(TargetAuthorization)(ctx, "RecordDomain", {
    project: input.project,
  });
  if (!allowed.ok) return allowed;
  return ok({ project: input.project });
});

function envelope(project: string) {
  return {
    command: "RecordDomain",
    idempotency_key: `key-${project}`,
    input: { project },
    compare: {},
    prepared: [],
  };
}

Deno.test("platform/identity#R3 platform/identity#R8: domain target은 owner port에서 일치하면 ok이고 다르면 forbidden이다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-target-auth-" });
  const path = `${dir}/ledger.db`;
  try {
    const applied = await applyMigrations(path, LEDGER_SCHEMA_STEPS, {
      clock: manualClock(START),
    });
    assert(applied.ok);
    const opened = openConnection(path);
    assert(opened.ok);
    const ctx = scoped();
    const matched = await executeCommand(
      opened.value,
      deps(),
      new Map([[definition.route.name, definition]]),
      ctx,
      envelope(PROJECT),
    );
    const missed = await executeCommand(
      opened.value,
      deps(),
      new Map([[definition.route.name, definition]]),
      ctx,
      envelope(OTHER),
    );
    const condition = await executeCommand(
      opened.value,
      deps(),
      new Map([[definition.route.name, definition]]),
      { ...ctx, conditions: { mode: "view" } },
      envelope("condition"),
    );
    assert(matched.ok);
    assertEquals(matched.value.result, { project: PROJECT });
    assertEquals(code(missed), "forbidden");
    assertEquals(code(condition), "forbidden");
    opened.value.close();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/identity#R3 platform/identity#R8: port를 주입하지 않은 transaction은 target 판정이 forbidden이다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-target-auth-" });
  const path = `${dir}/ledger.db`;
  try {
    const applied = await applyMigrations(path, LEDGER_SCHEMA_STEPS, {
      clock: manualClock(START),
    });
    assert(applied.ok);
    const ledger = openLedger(path, deps());
    assert(ledger.ok);
    const ctx = scoped();
    const missing = ledger.value.transaction(
      { actor: ctx.actor },
      (tx) =>
        tx.port(TargetAuthorization)(ctx, "RecordDomain", { project: PROJECT }),
    );
    assertEquals(missing, TARGET_AUTHORIZATION_UNAVAILABLE);
    ledger.value.close();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/identity#R3 platform/identity#R8: read snapshot port도 domain target을 판정한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-target-auth-" });
  const path = `${dir}/ledger.db`;
  try {
    const applied = await applyMigrations(path, LEDGER_SCHEMA_STEPS, {
      clock: manualClock(START),
    });
    assert(applied.ok);
    const opened = openReaderConnection(path);
    assert(opened.ok);
    const route = defineRead({
      resource: "domain",
      method: "get",
      name: "domain/get",
      input: z.strictObject({ project: z.string() }),
      output: withReadCommon(z.strictObject({ project: z.string() })),
      actors: ["user"],
      errors: ["forbidden"],
    });
    const ctx = scoped();
    const read = (project: string) =>
      executeRead(
        opened.value,
        {
          route,
          handle(snapshot, current, input) {
            const body = input as { project: string };
            const allowed = snapshot.port(TargetAuthorization)(
              current,
              route.name,
              { project: body.project },
            );
            if (!allowed.ok) return allowed;
            return ok({
              project: body.project,
              as_of_seq: snapshot.as_of_seq,
              next_cursor: null,
            });
          },
        },
        new Map(),
        ctx,
        { project },
      );
    const matched = read(PROJECT);
    const reopened = openReaderConnection(path);
    assert(reopened.ok);
    const missed = executeRead(
      reopened.value,
      {
        route,
        handle(snapshot, current, input) {
          const body = input as { project: string };
          const allowed = snapshot.port(TargetAuthorization)(
            current,
            route.name,
            { project: body.project },
          );
          if (!allowed.ok) return allowed;
          return ok({
            project: body.project,
            as_of_seq: snapshot.as_of_seq,
            next_cursor: null,
          });
        },
      },
      new Map(),
      ctx,
      { project: OTHER },
    );
    assert(matched.ok);
    assertEquals(code(missed), "forbidden");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
