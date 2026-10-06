import { err, ok, type Result } from "../../../base/mod.ts";
import {
  runBody,
  runBodyInputSchema,
} from "../../../contracts/lophn-agent/mod.ts";
import {
  type ApiReadDefinition,
  parseActor,
} from "../../../contracts/platform/mod.ts";
import {
  type MessageBodyEnvironment,
  readBodyBytes,
} from "../../conversation/mod.ts";

// ReadRunBody. 복구가 저장된 run basis·model 응답·tool 결과를 다시 읽는 길이다. 참조 행 판정은 ledger
// snapshot에서 짧게 하고 blob 바이트는 그 뒤에 읽는다(ReadMessageBody와 같은 길). machine만 읽고 그
// 밖의 자격이나 없는 대상은 모두 같은 not_found다. 참조가 없거나 바이트를 읽지 못하거나 hash가 다르면
// 일부만 돌려주지 않고 unavailable이다.

export type RunBodyEnvironment = MessageBodyEnvironment;

// 이 읽기가 한 번에 돌려주는 값의 상한. model 응답·tool 결과는 이보다 작게 저장된다.
export const RUN_BODY_MAX_BYTES = 4 * 1024 * 1024;

const SOURCES = {
  run_basis: {
    sql: "select id as run, basis as hash from runs where id = ?",
    owner: "run",
    field: "basis",
  },
  model_call_output: {
    sql: "select id, run, output as hash from model_calls where id = ?",
    owner: "model_call",
    field: "output",
  },
  tool_call_output: {
    sql: "select id, run, output as hash from tool_calls where id = ?",
    owner: "tool_call",
    field: "output",
  },
} as const;

function absent(): Result<never> {
  return err({ code: "not_found", message: "body not found" });
}

function unavailable(): Result<never> {
  return err({ code: "unavailable", message: "run body is not available" });
}

type Found = { run: string; hash: string; size: number; asOf: string };

export function runBodyRead(
  environment: RunBodyEnvironment,
): ApiReadDefinition<typeof runBody> {
  return {
    route: runBody,
    async handle(ctx, input) {
      if (parseActor(ctx.actor)?.kind !== "machine") return absent();
      const parsed = runBodyInputSchema.safeParse(input);
      if (!parsed.success) {
        return err({ code: "invalid_input", message: "invalid read input" });
      }
      const { kind, id } = parsed.data;
      const source = SOURCES[kind];
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
          run: String(row["run"]),
          hash,
          size: Number(size),
          asOf: asOfSeq,
        });
      });
      if (!found.ok) return found;
      if (found.value === undefined) return absent();
      const { run, hash, size, asOf } = found.value;
      if (size < 1 || size > RUN_BODY_MAX_BYTES) return unavailable();
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
      return ok({
        kind,
        id,
        run,
        hash,
        size_bytes: size,
        value: value as never,
        as_of_seq: asOf,
        next_cursor: null,
      });
    },
  };
}
