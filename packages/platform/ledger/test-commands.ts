import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import {
  defineCommand,
  defineEvent,
  type Tx,
} from "../../contracts/platform/mod.ts";
import { defineSyncCommand } from "./handler.ts";

export const noteCreated = defineEvent("NoteCreated", {
  subject: z.string(),
  payload: z.strictObject({ name: z.string() }),
});

// 테스트 전용 command. 제품 route 표에는 없다.
export const recordNote = defineCommand({
  resource: "notes",
  method: "record",
  name: "RecordNote",
  input: z.strictObject({
    name: z.string(),
  }),
  output: z.strictObject({ name: z.string(), seq: z.string() }),
  compare: z.unknown(),
  actors: ["user", "machine"],
  errors: ["invalid_input", "conflict", "forbidden", "unavailable"],
});

export const recordNoteCommand = defineSyncCommand(
  recordNote,
  (tx, _ctx, input, compare) => {
    const nameHash = compare !== null && typeof compare === "object"
      ? (compare as Record<string, unknown>)["name_hash"]
      : undefined;
    if (nameHash !== undefined && nameHash !== input.name) {
      return err({
        code: "conflict",
        message: "CAS 기준이 현재 기록과 다르다",
      });
    }
    const seq = tx.emit(noteCreated, `note:${input.name}`, {
      name: input.name,
    });
    return ok({ name: input.name, seq });
  },
);

// z.unknown() output field가 있어야 JSON 경계(jsonSafe)가 schema보다 먼저 거절되지 않는다.
// strict output은 등록 밖 key를 schema에서 먼저 거절해 이 경계를 증명하지 못한다(테스트 전용).
export const wideNote = defineCommand({
  resource: "notes",
  method: "record-wide",
  name: "RecordWideNote",
  input: z.strictObject({ name: z.string() }),
  output: z.strictObject({
    name: z.string(),
    seq: z.string(),
    extra: z.unknown(),
  }),
  compare: z.unknown(),
  actors: ["user", "machine"],
  errors: ["invalid_input", "conflict", "forbidden", "unavailable"],
});

// 실제 Deno Worker는 JS 함수·symbol을 postMessage로 받을 수 없다. mode로 handler 안에서
// 직접 함수·symbol·bigint·순환·fresh rejecting Promise·unknown details fn을 만든다(테스트 전용).
export const WIDE_NOTE_MODES = [
  "ok",
  "function",
  "symbol",
  "bigint",
  "cycle",
  "details-function",
  "reject",
  "retain",
  "use-retained",
  "late",
] as const;

export const recordWideNote = defineCommand({
  resource: "notes",
  method: "record-wide-fixture",
  name: "RecordWideNoteFixture",
  input: z.strictObject({
    name: z.string(),
    mode: z.enum(WIDE_NOTE_MODES),
  }),
  output: z.strictObject({
    name: z.string(),
    seq: z.string(),
    extra: z.unknown(),
  }),
  compare: z.unknown(),
  actors: ["user", "machine"],
  errors: ["invalid_input", "conflict", "forbidden", "unavailable", "internal"],
});

function wideCycle(): { self?: unknown } {
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  return cycle;
}

// 앞 command가 붙잡아 둔 Tx다. Worker 안 테스트 fixture에만 있다(제품 상태가 아니다).
let retainedTx: Tx | undefined;

// 닫힌 Tx로 transaction 밖 SQL·event를 시도한다. 던지면 아무것도 바뀌지 않는다.
function touchClosed(tx: Tx | undefined, subject: string): string {
  try {
    tx?.sql.run(
      "insert into events (type, subject, actor, run, payload, at) values ('NoteCreated', ?, 'user', null, '{}', 'x')",
      [subject],
    );
    tx?.emit(noteCreated, subject, { name: subject });
    return "open";
  } catch {
    return "closed";
  }
}

function lateCommit(tx: Tx, name: string): Promise<unknown> {
  return (async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    touchClosed(tx, `note:${name}-late`);
    return ok({ name, seq: "0", extra: null });
  })();
}

export const recordWideNoteCommand = defineSyncCommand(
  recordWideNote,
  (tx, _ctx, input) => {
    if (input.mode === "late") return lateCommit(tx, input.name) as never;
    if (input.mode === "retain") {
      retainedTx = tx;
      setTimeout(() => touchClosed(tx, `note:${input.name}-timer`), 0);
    }
    const stale = input.mode === "use-retained"
      ? touchClosed(retainedTx, `note:${input.name}-stale`)
      : null;
    if (input.mode === "details-function") {
      return err({
        code: "conflict",
        message: "거절",
        details: { fn: (() => input.name) as never },
      });
    }
    if (input.mode === "reject") {
      return Promise.reject(new Error(`wide reject ${input.name}`)) as never;
    }
    const seq = tx.emit(noteCreated, `note:${input.name}`, {
      name: input.name,
    });
    const extra = input.mode === "function"
      ? ((() => input.name) as never)
      : input.mode === "symbol"
      ? (Symbol("wide") as never)
      : input.mode === "bigint"
      ? (1n as never)
      : input.mode === "cycle"
      ? (wideCycle() as never)
      : stale;
    return ok({ name: input.name, seq, extra });
  },
);

// 비strict output. schema strip·-0·transform이 raw 비JSON을 숨기지 못하는지 본다(테스트 전용).
// 앞 셋은 저장·송신되는 정상 mode다. 나머지는 모두 internal이어야 한다.
export const LOOSE_VALID_MODES = ["ok", "strip-extra", "plus-zero"] as const;

export const LOOSE_NOTE_MODES = [
  ...LOOSE_VALID_MODES,
  "strip-function",
  "strip-symbol",
  "undefined",
  "minus-zero",
  "transform",
  "details-strip",
  "number-zero",
  "strip-zero",
  "details-zero",
] as const;

export const recordLooseNote = defineCommand({
  resource: "notes",
  method: "record-loose-fixture",
  name: "RecordLooseNoteFixture",
  input: z.strictObject({
    name: z.string(),
    mode: z.enum(LOOSE_NOTE_MODES),
  }),
  output: z.object({
    name: z.string(),
    seq: z.string(),
    sign: z.number().refine((value) => Object.is(value, -0)).optional(),
    label: z.string().transform((value) => value.length).optional(),
    count: z.number().optional(),
  }),
  compare: z.unknown(),
  actors: ["user", "machine"],
  errors: ["invalid_input", "conflict", "forbidden", "unavailable", "internal"],
});

export const recordLooseNoteCommand = defineSyncCommand(
  recordLooseNote,
  (tx, _ctx, input) => {
    const seq = tx.emit(noteCreated, `note:${input.name}`, {
      name: input.name,
    });
    const base = { name: input.name, seq };
    switch (input.mode) {
      case "strip-function":
        return ok({ ...base, unsafe: () => input.name } as never);
      case "strip-symbol":
        return ok({ ...base, unsafe: Symbol("loose") } as never);
      case "undefined":
        return ok({ ...base, sign: undefined });
      case "minus-zero":
        return ok({ ...base, sign: -0 });
      case "transform":
        return ok({ ...base, label: "abc" } as never);
      case "strip-extra":
        return ok({ ...base, note: "dropped" } as never);
      case "plus-zero":
        return ok({ ...base, count: 0 });
      case "number-zero":
        return ok({ ...base, count: -0 });
      case "strip-zero":
        return ok({ ...base, dropped: -0 } as never);
      case "details-zero":
        return err({
          code: "conflict",
          message: "거절",
          details: { count: -0 },
        });
      case "details-strip":
        return err({
          code: "conflict",
          message: "거절",
          hint: () => input.name,
        } as never);
      default:
        return ok(base);
    }
  },
);

export const markAlpha = defineCommand({
  resource: "alpha",
  method: "mark",
  name: "MarkAlpha",
  input: z.strictObject({ name: z.string() }),
  output: z.strictObject({ name: z.string(), seq: z.string() }),
  compare: z.strictObject({ name_hash: z.string().optional() }).optional(),
  actors: ["user"],
  errors: ["invalid_input", "conflict", "forbidden"],
});

export const markBeta = defineCommand({
  resource: "beta",
  method: "mark",
  name: "MarkBeta",
  input: z.strictObject({ name: z.string() }),
  output: z.strictObject({ name: z.string(), seq: z.string() }),
  compare: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "conflict", "forbidden"],
});

export const markAlphaCommand = defineSyncCommand(
  markAlpha,
  (tx, _ctx, input, compare) => {
    const nameHash = compare?.name_hash;
    if (nameHash !== undefined && nameHash !== input.name) {
      return err({
        code: "conflict",
        message: "CAS 기준이 현재 기록과 다르다",
      });
    }
    const seq = tx.emit(noteCreated, `alpha:${input.name}`, {
      name: input.name,
    });
    return ok({ name: input.name, seq });
  },
  { dispatchable: true },
);

export const markBetaCommand = defineSyncCommand(
  markBeta,
  (tx, _ctx, input) => {
    const called = tx.call(markAlpha, input, {});
    if (!called.ok) return called;
    const seq = tx.emit(noteCreated, `beta:${input.name}`, {
      name: input.name,
    });
    return ok({ name: input.name, seq });
  },
);
