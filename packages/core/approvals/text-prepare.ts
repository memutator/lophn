// approval 설명 글의 core 쪽 길(platform/approvals#R1, R2, R14, R17). 호출자(agent runtime·machine·
// app)는 blob을 준비하지 않고 글 값(이유·변경·외부 영향·되돌림, 거절·취소의 종료 이유)을 요청에 싣는다. core가
// command 앞에서 글을 redaction해 UTF-8 bytes로 blob을 준비하고, command가 같은 transaction에서
// 영구 참조를 등록한다. 읽기(ReadApprovalText)는 packages/core/main/daemon/platform-register.ts가 붙인다. 메시지 본문
// (message-body.ts)·질문 글(question-text.ts)과 같은 길이다.
import { ok, type Result } from "../../base/mod.ts";
import { waitRun } from "../../protocol/lophn-agent/mod.ts";
import {
  APPROVAL_TEXT_PURPOSE,
  approvalTextBytes,
  approvalTextSchema,
  cancelApprovalRequest,
  createApprovalRequest,
  rejectApprovalRequest,
} from "../../protocol/server/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import { type CommandEnvelope, type Writer } from "../storage/ledger/mod.ts";
import type { KnownSecretMatch } from "../storage/ledger/mod.ts";
import { createProductRedactor } from "../projects/outline-and-search/redactor.ts";
import { prepareBytes, rejected } from "../lophn-agent/session/message-body.ts";
import type { BodyPrepare } from "../lophn-agent/session/message-body.ts";

const SOURCE = {
  concern: "platform/approvals",
  revision: "1",
  scope: "approval-text",
};

type Slot = {
  read(): unknown;
  write(text: string): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// 글 자리. 요청 모양이 틀리면 건드리지 않고 지나가 command의 schema 검사가 거절한다.
function slotsOf(command: string, input: Record<string, unknown>): Slot[] {
  const slot = (owner: Record<string, unknown>, key: string): Slot => ({
    read: () => owner[key],
    write: (text) => {
      owner[key] = text;
    },
  });
  // 거절·취소는 이유 글 하나다(null이면 글이 없다).
  if (command !== createApprovalRequest.name) {
    return [slot(input, "closed_reason")];
  }
  const slots = [slot(input, "reason")];
  const effect = input["effect"];
  if (isRecord(effect)) {
    slots.push(
      slot(effect, "changes"),
      slot(effect, "external"),
      slot(effect, "reversibility"),
    );
  }
  return slots;
}

// 사람 기다림(WaitRun)의 approval 제출은 요청 생성 입력을 그대로 싣는다. 글 자리는 같고 한 단계
// 안(`request.input`)에 있다. 질문 제출이나 모양이 틀린 요청은 건드리지 않고 지나간다.
function waitApprovalInput(
  input: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const request = input["request"];
  if (!isRecord(request) || request["kind"] !== "approval") return undefined;
  const created = request["input"];
  return isRecord(created) ? created : undefined;
}

// 글을 싣는 command의 앞 단계. 글은 redaction을 거친 값으로 바뀌어 writer에 가고, 그 바이트는
// 보낸 자격의 이름으로 준비되어 있다. 다른 command는 그대로 지나간다.
export function createApprovalTextPreparer(deps: {
  // 준비 통로. I/O worker가 뜨기 전에는 없다(unavailable).
  relay(): BodyPrepare | undefined;
  // 알려진 secret 값의 matcher(core 프로세스의 secret store). pattern 규칙에 더해 그 값도
  // 가린다. 값을 아직 다 모르는 동안(matcher가 ready가 아님)은 안전화를 끝낼 수 없어 막는다.
  known?(): KnownSecretMatch | undefined;
}): (
  ctx: AuthenticatedContext,
  envelope: CommandEnvelope,
) => Promise<Result<CommandEnvelope>> {
  return async (ctx, envelope) => {
    const waiting = envelope.command === waitRun.name;
    if (
      !waiting &&
      envelope.command !== createApprovalRequest.name &&
      envelope.command !== rejectApprovalRequest.name &&
      envelope.command !== cancelApprovalRequest.name
    ) return ok(envelope);
    if (!isRecord(envelope.input)) return ok(envelope);
    const input = structuredClone(envelope.input);
    const target = waiting ? waitApprovalInput(input) : input;
    if (target === undefined) return ok(envelope);
    const slots = slotsOf(
      waiting ? createApprovalRequest.name : envelope.command,
      target,
    ).filter((slot) => typeof slot.read() === "string");
    if (slots.length === 0) return ok(envelope);
    const redactText = createProductRedactor(deps.known?.());
    const texts: string[] = [];
    for (const slot of slots) {
      const redacted = redactText(SOURCE, "text/plain", slot.read() as string);
      if (redacted === null) {
        return rejected("unavailable", "approval redaction did not finish");
      }
      // redaction 뒤 글이 다시 계약 안인지 본다. 대체 문구가 길어 상한을 넘을 수 있다.
      if (!approvalTextSchema.safeParse(redacted).success) {
        return rejected("invalid_input", "approval text is not valid");
      }
      slot.write(redacted);
      texts.push(redacted);
    }
    const relay = deps.relay();
    if (relay === undefined) {
      return rejected("unavailable", "blob preparation is not available");
    }
    for (const text of new Set(texts)) {
      const prepared = await prepareBytes(
        relay,
        ctx,
        APPROVAL_TEXT_PURPOSE,
        approvalTextBytes(text),
        "approval text",
      );
      if (!prepared.ok) return prepared;
    }
    return ok({ ...envelope, input });
  };
}

// writer.command 앞에 글 준비를 끼운다. 나머지 Writer 동작은 그대로다.
export function withApprovalText(
  writer: Writer,
  prepare: ReturnType<typeof createApprovalTextPreparer>,
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
