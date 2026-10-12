import {
  type Clock,
  createIdSource,
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  CommandDefinition,
} from "../../../protocol/server/mod.ts";
import { applyMigrations } from "../migration/mod.ts";
import { advanceSubscriberCursorCommand } from "./commands.ts";
import { LEDGER_SCHEMA_STEPS } from "./schema.ts";
import { openConnection } from "./sqlite.ts";
import { createSubscriberGate } from "../../events/subscriber-registration.ts";
import { recordNoteCommand } from "./test-commands.ts";
import type { TxDeps } from "./tx.ts";

export const START = Date.parse("2026-01-01T00:00:00.000Z");
export const NOW = "2026-01-01T00:00:00.000Z";

export function user(principal = "user-1"): AuthenticatedContext {
  return {
    principal,
    actor: "user",
    scope: {
      operations: [
        "RecordNote",
        "RecordWideNote",
        "RecordWideNoteFixture",
        "RecordLooseNoteFixture",
        "AdvanceSubscriberCursor",
        "CommandResult",
      ],
      targets: {},
    },
    conditions: {},
    credential_ref: "cred-1",
  };
}

export function machine(): AuthenticatedContext {
  return {
    principal: "machine-1",
    actor: "machine",
    scope: { operations: ["AdvanceSubscriberCursor"], targets: {} },
    conditions: {},
    credential_ref: "cred-m",
  };
}

export function deps(clock: Clock = manualClock(START)): TxDeps & {
  checkCredential: (ctx: AuthenticatedContext) => Result<AuthenticatedContext>;
} {
  return {
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
    ports: [],
    registerBlobRef: () => err({ code: "unavailable", message: "blob 없음" }),
    call: () => err({ code: "unavailable", message: "dispatch 없음" }),
    subscriberGate: ownedCursorGate(),
    checkCredential: (ctx) => {
      if (ctx.expires_at !== undefined && ctx.expires_at < clock.now()) {
        return err({ code: "unauthorized", message: "자격이 만료되었다" });
      }
      return ok(ctx);
    },
  };
}

// 테스트가 명시한 현재 자격만 cursor를 올린다. 등록 밖 이름·다른 자격은 거절한다.
function ownedCursorGate() {
  const gate = createSubscriberGate([{
    name: "notifications",
    authorize: (ctx) =>
      ok(
        (ctx.principal === "user-1" || ctx.principal === "machine-1") &&
          (ctx.credential_ref === "cred-1" || ctx.credential_ref === "cred-m"),
      ),
  }, {
    name: "notes",
    authorize: (ctx) =>
      ok(ctx.principal === "user-1" && ctx.credential_ref === "cred-1"),
  }, {
    name: "limit",
    authorize: (ctx) =>
      ok(ctx.principal === "user-1" && ctx.credential_ref === "cred-1"),
  }]);
  if (!gate.ok) throw new Error("subscriber gate");
  return gate.value;
}

export async function fileLedger(dir: string) {
  const path = `${dir}/ledger.db`;
  const applied = await applyMigrations(path, LEDGER_SCHEMA_STEPS, {
    clock: manualClock(START),
  });
  if (!applied.ok) throw new Error("migration");
  const opened = openConnection(path);
  if (!opened.ok) throw new Error("open");
  return { path, connection: opened.value };
}

export const commands: CommandDefinition[] = [
  recordNoteCommand,
  advanceSubscriberCursorCommand,
];

export function note(
  name: string,
  key = "k1",
  compare: Record<string, string> = {},
) {
  return {
    command: "RecordNote",
    input: { name },
    idempotency_key: key,
    compare,
    prepared: [] as string[],
  };
}

// z.unknown() output 경계 테스트용. RecordNote와 입력 모양은 같고 output만 넓다.
export function wideCase(name: string, key = "k1") {
  return {
    command: "RecordWideNote",
    input: { name },
    idempotency_key: key,
    compare: {},
    prepared: [] as string[],
  };
}

// 실제 Worker fixture에 등록된 고정 handler용. mode로 함수·symbol·bigint·순환·reject를 고른다.
export function wideFixtureCase(name: string, mode: string, key = "k1") {
  return {
    command: "RecordWideNoteFixture",
    input: { name, mode },
    idempotency_key: key,
    compare: {},
    prepared: [] as string[],
  };
}

// 비strict output fixture. mode로 strip·undefined·-0·transform·details strip을 고른다.
export function looseFixtureCase(name: string, mode: string, key = "k1") {
  return {
    command: "RecordLooseNoteFixture",
    input: { name, mode },
    idempotency_key: key,
    compare: {},
    prepared: [] as string[],
  };
}
