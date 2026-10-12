import { err, ok, type Result } from "../../base/mod.ts";
import { sessionSummary } from "../../protocol/lophn-agent/mod.ts";
import type { ApiReadDefinition, Sql } from "../../protocol/platform/mod.ts";
import { type MessageBodyEnvironment, readBodyBytes } from "./body-read.ts";
import { sessionVisible } from "./guards.ts";
import { loadSession } from "./model.ts";

// ReadSessionSummary. Compact가 session에 이은 요약의 본문이다. 요약은 원문을 대체하지 않는 derived라
// session에는 요약 call 참조만 있고 본문은 그 call의 출력 blob이 정본이다. 판정은 ledger snapshot에서
// 짧게 하고 blob 바이트는 그 뒤에 읽는다(ReadMessageBody와 같은 길). 사람·그 assignment의 agent·machine
// 만 읽고 그 밖이거나 요약이 없으면 없는 session과 똑같이 not_found다. `revert`를 주면 그 rewind("Summarize
// from here")가 접은 구간의 요약을 같은 길로 읽는다.

// 요약 본문은 400 token 안이라 이보다 훨씬 작다. 이 상한은 잘못 큰 blob을 읽지 않는 안전선이다.
const SUMMARY_MAX_BYTES = 1024 * 1024;

type Found = {
  compaction: { through_seq: string; summary_call: string };
  hash: string;
  size: number;
  asOf: string;
};

function compactionOf(
  session: NonNullable<ReturnType<typeof loadSession>>,
): Found["compaction"] | undefined {
  return session.compaction_through_seq === null ||
      session.compaction_summary_call === null
    ? undefined
    : {
      through_seq: session.compaction_through_seq,
      summary_call: session.compaction_summary_call,
    };
}

// "Summarize from here"가 접은 구간이다. 접수된(applied) 요약 rewind만 있다.
function foldOf(
  sql: Pick<Sql, "get">,
  session: string,
  revert: string,
): Found["compaction"] | undefined {
  const row = sql.get(
    `select cast(result_seq as text) as through_seq, summary_call from reverts
      where id = ? and session = ? and kind = 'rewind' and choice = 'summarize'
        and outcome = 'applied'`,
    [revert, session],
  );
  return row === undefined ? undefined : {
    through_seq: String(row["through_seq"]),
    summary_call: String(row["summary_call"]),
  };
}

function absent(): Result<never> {
  return err({ code: "not_found", message: "summary not found" });
}

function unavailable(): Result<never> {
  return err({ code: "unavailable", message: "summary is not available" });
}

export function sessionSummaryRead(
  environment: MessageBodyEnvironment,
): ApiReadDefinition<typeof sessionSummary> {
  return {
    route: sessionSummary,
    async handle(ctx, input) {
      const parsed = sessionSummary.input.safeParse(input);
      if (!parsed.success) {
        return err({ code: "invalid_input", message: "invalid read input" });
      }
      const id = parsed.data.session;
      const revert = parsed.data.revert;
      const found = environment.snapshot<Found | undefined>((sql, asOfSeq) => {
        const session = loadSession({ sql }, id);
        if (session === undefined || !sessionVisible(ctx, session)) {
          return ok(undefined);
        }
        const compaction = revert === undefined
          ? compactionOf(session)
          : foldOf(sql, id, revert);
        if (compaction === undefined) return ok(undefined);
        const ref = sql.get(
          `select hash, size_bytes from blob_refs
           where owner_kind = 'model_call' and owner_key = ? and field = 'output'`,
          [compaction.summary_call],
        );
        const hash = ref?.["hash"];
        const size = ref?.["size_bytes"];
        if (
          typeof hash !== "string" ||
          (typeof size !== "bigint" && typeof size !== "number")
        ) return unavailable();
        return ok({
          compaction,
          hash,
          size: Number(size),
          asOf: asOfSeq,
        });
      });
      if (!found.ok) return found;
      if (found.value === undefined) return absent();
      const { compaction, hash, size, asOf } = found.value;
      if (size < 1 || size > SUMMARY_MAX_BYTES) return unavailable();
      const bytes = await readBodyBytes(environment, hash, size);
      if (!bytes.ok) return unavailable();
      const text = textOfOutput(bytes.value);
      if (text === undefined) return unavailable();
      return ok({
        session: id,
        compaction,
        text,
        as_of_seq: asOf,
        next_cursor: null,
      });
    },
  };
}

// model call의 출력 blob은 `{ text, tools }`다. 요약은 글만 쓴다. 다른 모양이면 읽지 못한 것이다.
function textOfOutput(bytes: Uint8Array): string | undefined {
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as { text?: unknown };
    return typeof value.text === "string" && value.text.trim() !== ""
      ? value.text
      : undefined;
  } catch {
    return undefined;
  }
}
