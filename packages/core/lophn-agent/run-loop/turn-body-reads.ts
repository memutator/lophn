import { err, ok, type Result } from "../../../base/mod.ts";
import {
  TURN_BODY_VIEW_MAX_BYTES,
  turnBody,
  turnBodyInputSchema,
  turnBodyView,
  turnBodyViewInputSchema,
} from "../../../protocol/lophn-agent/turn-reads.ts";
import type { ApiReadDefinition } from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { type MessageBodyEnvironment, readBodyBytes } from "../session/mod.ts";

// ReadTurnBody. 저장된 turn basis·model 응답·tool 결과를 다시 읽는 길이다. 참조 행 판정은 ledger
// snapshot에서 짧게 하고 blob 바이트는 그 뒤에 읽는다(ReadMessageBody와 같은 길). machine만 읽고 그
// 밖의 자격이나 없는 대상은 모두 같은 not_found다. 참조가 없거나 바이트를 읽지 못하거나 hash가 다르면
// 일부만 돌려주지 않고 unavailable이다.

export type TurnBodyEnvironment = MessageBodyEnvironment;

// 이 읽기가 한 번에 돌려주는 값의 상한. model 응답·tool 결과는 이보다 작게 저장된다.
export const TURN_BODY_MAX_BYTES = 4 * 1024 * 1024;

const SOURCES = {
  turn_basis: {
    sql: "select id as turn, basis as hash from turns where id = ?",
    owner: "turn",
    field: "basis",
  },
  // turn이 고정한 resolved agent 전체 값이다. 표 열이 없어 참조 행이 곧 근거다.
  turn_resolved: {
    sql:
      "select owner_key as turn, hash from blob_refs where owner_kind = 'turn' and field = 'resolved' and owner_key = ?",
    owner: "turn",
    field: "resolved",
  },
  tool_call_input: {
    sql: "select id, turn, input as hash from tool_calls where id = ?",
    owner: "tool_call",
    field: "input",
  },
  model_call_output: {
    sql:
      "select id, turn, output as hash from model_calls where id = ? and turn is not null",
    owner: "model_call",
    field: "output",
  },
  tool_call_output: {
    sql: "select id, turn, output as hash from tool_calls where id = ?",
    owner: "tool_call",
    field: "output",
  },
} as const;

function absent(): Result<never> {
  return err({ code: "not_found", message: "body not found" });
}

function unavailable(): Result<never> {
  return err({ code: "unavailable", message: "turn body is not available" });
}

type Found = { turn: string; hash: string; size: number; asOf: string };

type Source = (typeof SOURCES)[keyof typeof SOURCES];

// 참조 행 판정(ledger snapshot)과 blob 바이트 읽기, hash 확인, JSON 해석. 두 읽기가 같이 쓴다.
async function loadStored(
  environment: TurnBodyEnvironment,
  source: Source,
  id: string,
): Promise<
  Result<
    { turn: string; hash: string; size: number; asOf: string; value: unknown }
  >
> {
  const found = environment.snapshot<Found | undefined>((sql, asOfSeq) => {
    const row = sql.get(source.sql, [id]);
    if (row === undefined) return ok(undefined);
    const hash = row["hash"];
    if (typeof hash !== "string") return unavailable();
    const ref = sql.get(
      `select hash, size_bytes from blob_refs
       where owner_kind = ? and owner_key = ? and field = ?`,
      [source.owner, id, source.field],
    );
    const size = ref?.["size_bytes"];
    if (
      ref?.["hash"] !== hash ||
      (typeof size !== "bigint" && typeof size !== "number")
    ) return unavailable();
    return ok({
      turn: String(row["turn"]),
      hash,
      size: Number(size),
      asOf: asOfSeq,
    });
  });
  if (!found.ok) return found;
  if (found.value === undefined) return absent();
  const { turn, hash, size, asOf } = found.value;
  if (size < 1 || size > TURN_BODY_MAX_BYTES) return unavailable();
  const bytes = await readBodyBytes(environment, hash, size);
  if (!bytes.ok) return unavailable();
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.value),
    );
  } catch {
    return unavailable();
  }
  return ok({ turn, hash, size, asOf, value });
}

export function turnBodyRead(
  environment: TurnBodyEnvironment,
): ApiReadDefinition<typeof turnBody> {
  return {
    route: turnBody,
    async handle(ctx, input) {
      if (parseActor(ctx.actor)?.kind !== "machine") return absent();
      const parsed = turnBodyInputSchema.safeParse(input);
      if (!parsed.success) {
        return err({ code: "invalid_input", message: "invalid read input" });
      }
      const { kind, id } = parsed.data;
      const stored = await loadStored(environment, SOURCES[kind], id);
      if (!stored.ok) return stored;
      const { turn, hash, size, asOf, value } = stored.value;
      return ok({
        kind,
        id,
        turn,
        hash,
        size_bytes: size,
        value: value as never,
        as_of_seq: asOf,
        next_cursor: null,
      });
    },
  };
}

// 글 값마다 지금의 redaction을 거친다. 끝내지 못한 글이 하나라도 있으면 null이다(값을 내보내지 않는다).
function redactValue(
  value: unknown,
  redact: (text: string) => string | null,
): { ok: true; value: unknown } | { ok: false } {
  if (typeof value === "string") {
    const redacted = redact(value);
    return redacted === null ? { ok: false } : { ok: true, value: redacted };
  }
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      const done = redactValue(item, redact);
      if (!done.ok) return done;
      items.push(done.value);
    }
    return { ok: true, value: items };
  }
  if (typeof value === "object" && value !== null) {
    const entries: [string, unknown][] = [];
    for (const [key, item] of Object.entries(value)) {
      const done = redactValue(item, redact);
      if (!done.ok) return done;
      entries.push([key, done.value]);
    }
    return { ok: true, value: Object.fromEntries(entries) };
  }
  return { ok: true, value };
}

// UTF-8 문자 중간에서 자르지 않는다.
function utf8Prefix(text: string, limit: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= limit) return text;
  let end = limit;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return new TextDecoder().decode(bytes.slice(0, end));
}

export type TurnBodyViewEnvironment = TurnBodyEnvironment & {
  /** 지금의 redaction. 끝내지 못하면 null이다. */
  readonly redact: (text: string) => string | null;
};

// ReadTurnBodyView. 사람 화면이 turn 근거·tool 입력·tool 결과를 펼쳐 보는 길이다. 저장된 본문을 같은
// 길로 읽고 지금의 redaction을 한 번 더 거친 값만 준다. 사람이 아니거나 없는 대상은 모두 not_found다.
export function turnBodyViewRead(
  environment: TurnBodyViewEnvironment,
): ApiReadDefinition<typeof turnBodyView> {
  return {
    route: turnBodyView,
    async handle(ctx, input) {
      if (parseActor(ctx.actor)?.kind !== "user") return absent();
      const parsed = turnBodyViewInputSchema.safeParse(input);
      if (!parsed.success) {
        return err({ code: "invalid_input", message: "invalid read input" });
      }
      const { kind, id } = parsed.data;
      const stored = await loadStored(environment, SOURCES[kind], id);
      if (!stored.ok) return stored;
      const { turn, size, asOf, value } = stored.value;
      const safe = redactValue(value, environment.redact);
      if (!safe.ok) return unavailable();
      const text = JSON.stringify(safe.value);
      const cut =
        new TextEncoder().encode(text).length > TURN_BODY_VIEW_MAX_BYTES;
      return ok({
        kind,
        id,
        turn,
        size_bytes: size,
        truncated: cut,
        value: (cut
          ? utf8Prefix(text, TURN_BODY_VIEW_MAX_BYTES)
          : safe.value) as never,
        as_of_seq: asOf,
        next_cursor: null,
      });
    },
  };
}
