// route 앞단의 용어 출현 확인(documents/terms, 질문 Q8). `term.propose`와 근거를 바꾸는
// `term.update`는 writer에 닿기 전에 고정 판의 section 또는 줄 범위에 이름이 실제로 나오는지
// 확인한다. 읽기는 derived store를 여는 reader Worker의 내부 read(documents-reader.ts)다:
// core graph는 node:sqlite를 열지 않는다. 거절하면 command를 부르지 않는다.
import type { Result } from "../../packages/base/mod.ts";
import type { RequestContext } from "../../packages/contracts/platform/mod.ts";
import type {
  CommandEnvelope,
  Writer,
} from "../../packages/platform/ledger/mod.ts";

export const TERM_OCCURRENCE_COMMANDS: ReadonlySet<string> = new Set([
  "term.propose",
  "term.update",
]);

export type TermOccurrenceCheck = (
  ctx: RequestContext,
  command: "term.propose" | "term.update",
  input: unknown,
) => Promise<Result<unknown>>;

// writer.command 앞에 출현 확인을 끼운다. 나머지 command와 Writer 동작은 그대로다.
export function withTermOccurrence(
  writer: Writer,
  check: TermOccurrenceCheck,
): Writer {
  return {
    ...writer,
    async command(ctx, envelope: CommandEnvelope) {
      if (!TERM_OCCURRENCE_COMMANDS.has(envelope.command)) {
        return await writer.command(ctx, envelope);
      }
      const checked = await check(
        ctx,
        envelope.command as "term.propose" | "term.update",
        envelope.input,
      );
      if (!checked.ok) return checked;
      return await writer.command(ctx, envelope);
    },
  };
}
