// handoff 내용의 core 쪽 길. 호출자(agent runtime)는 blob을
// 준비하지 않고 무엇·왜·제외·기대 결과 값을 요청에 싣는다. core가 command 앞에서 문자열을
// redaction(pattern과 알려진 secret 값)해 정규 직렬화 bytes로 blob을 준비하고, 요청의 `body`를 그
// bytes의 hash로 맞춘다. command가 같은 값에서 같은 hash를 다시 만들어 보고 같은 transaction에서
// 영구 참조를 등록한다. 메시지 본문(message-body.ts)·질문 글(question-text.ts)과 같은 길이다.
import { ok, type Result } from "../../../../base/mod.ts";
import {
  handoffContentSchema,
  handoffSubmit,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import {
  type CommandEnvelope,
  type KnownSecretMatch,
  type Writer,
} from "../../../storage/ledger/mod.ts";
import {
  HANDOFF_CONTENT_MAX_BYTES,
  HANDOFF_CONTENT_PURPOSE,
  handoffBodyHash,
  handoffContentBytes,
} from "./mod.ts";
import { createProductRedactor } from "../../../projects/outline-and-search/redactor.ts";
import { prepareBytes, rejected } from "../../session/message-body.ts";
import type { BodyPrepare } from "../../session/message-body.ts";

const SOURCE = {
  concern: "lophn-agent/handoff",
  revision: "1",
  scope: "handoff-content",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function createHandoffBodyPreparer(deps: {
  // 준비 통로. I/O worker가 뜨기 전에는 없다(unavailable).
  relay(): BodyPrepare | undefined;
  // 알려진 secret 값의 matcher. 값을 아직 다 모르는 동안은 안전화를 끝낼 수 없어 막는다.
  known?(): KnownSecretMatch | undefined;
}): (
  ctx: AuthenticatedContext,
  envelope: CommandEnvelope,
) => Promise<Result<CommandEnvelope>> {
  return async (ctx, envelope) => {
    if (envelope.command !== handoffSubmit.name) return ok(envelope);
    if (!isRecord(envelope.input)) return ok(envelope);
    // 모양이 틀린 요청은 건드리지 않고 지나가 command의 schema 검사가 거절한다.
    const parsed = handoffContentSchema.safeParse(envelope.input["content"]);
    if (!parsed.success) return ok(envelope);
    const redactText = createProductRedactor(deps.known?.());
    const safe = (text: string): string | null =>
      redactText(SOURCE, "text/plain", text);
    const what = safe(parsed.data.what);
    const why = safe(parsed.data.why);
    const excludes = parsed.data.excludes.map(safe);
    const outputs = parsed.data.expected_outputs.map(safe);
    if (
      what === null || why === null || excludes.includes(null) ||
      outputs.includes(null)
    ) {
      return rejected("unavailable", "handoff redaction did not finish");
    }
    // redaction 뒤 내용이 다시 계약 안인지 본다. 대체 문구가 길어 상한을 넘을 수 있다.
    const content = handoffContentSchema.safeParse({
      what,
      why,
      excludes,
      expected_outputs: outputs,
    });
    if (!content.success) {
      return rejected("invalid_input", "handoff content is not valid");
    }
    const bytes = handoffContentBytes(content.data);
    if (bytes.length > HANDOFF_CONTENT_MAX_BYTES) {
      return rejected("invalid_input", "handoff content is too large");
    }
    const relay = deps.relay();
    if (relay === undefined) {
      return rejected("unavailable", "blob preparation is not available");
    }
    const prepared = await prepareBytes(
      relay,
      ctx,
      HANDOFF_CONTENT_PURPOSE,
      bytes,
      "handoff content",
    );
    if (!prepared.ok) return prepared;
    return ok({
      ...envelope,
      input: {
        ...envelope.input,
        content: content.data,
        body: handoffBodyHash(content.data),
      },
    });
  };
}

// writer.command 앞에 내용 준비를 끼운다. 나머지 Writer 동작은 그대로다.
export function withHandoffBody(
  writer: Writer,
  prepare: ReturnType<typeof createHandoffBodyPreparer>,
): Writer {
  return {
    ...writer,
    async command(ctx, envelope) {
      const ready = await prepare(ctx, envelope);
      if (!ready.ok) return ready;
      return await writer.command(ctx, ready.value);
    },
  };
}
