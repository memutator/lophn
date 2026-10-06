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
import { createTargetAuthorizer } from "./target-authorization.ts";

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

Deno.test("platform/identity#R3, coding-agent/connection#R5: owner가 준 target이 고정 조건과 다르면 조건 값으로 덮지 않고 거절한다", () => {
  const A = "app_00000000000000000000000000";
  const B = "app_00000000000000000000000001";
  const ctx = {
    ...user("owner-1"),
    actor: "coding_agent:cac_00000000000000000000000000" as const,
    scope: { operations: ["app.get"], targets: {} },
    conditions: { app: A },
  };
  const authorize = createTargetAuthorizer(ctx);
  assert(authorize(ctx, "app.get", { app: A }).ok);
  // 조건이 앱 A로 고정된 credential이 앱 B를 가리키면 없는 대상과 같은 거절이다.
  assertEquals(code(authorize(ctx, "app.get", { app: B })), "not_found");
  // 대상을 주지 않으면 조건의 값으로 채운다.
  assert(authorize(ctx, "app.get", {}).ok);
});

Deno.test("platform/identity#R3, coding-agent/connection#R5: 앱 하나 범위 coding connection(targets.app·conditions.app)은 owner가 target의 앱을 직접 줘야 통과하고 앱을 말하지 않은 target은 조건으로 채워 통과시키지 않는다", () => {
  const A = "app_00000000000000000000000000";
  const B = "app_00000000000000000000000001";
  const ctx = {
    ...user("owner-1"),
    actor: "coding_agent:cac_00000000000000000000000000" as const,
    scope: { operations: ["doc.get"], targets: { app: A } },
    conditions: { app: A },
  };
  const authorize = createTargetAuthorizer(ctx);
  assert(authorize(ctx, "doc.get", { document: "d", app: A }).ok);
  // 다른 앱의 대상은 없는 대상과 같은 not_found다.
  assertEquals(
    code(authorize(ctx, "doc.get", { document: "d", app: B })),
    "not_found",
  );
  // 앱을 말하지 않은 target(project 문서·project 읽기)은 자기 앱으로 통과하지 않는다.
  assertEquals(code(authorize(ctx, "doc.get", { document: "d" })), "forbidden");
});
