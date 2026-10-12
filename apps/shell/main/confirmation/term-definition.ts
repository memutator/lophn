// 고정 term.define·app.create 선택지. 사람이 질문에서 그 선택지를 확정하면 확인 창을 열지 않고
// 정본을 다시 읽어 AnswerQuestionAction으로 접수한다(묶음 단위). 적용은 machine이 그 답으로 한다.
// 이 두 command만 확인 창 없이 접수하고(flow new-app 3, documents/terms#R2), 그 밖 action은
// 읽은 정본의 command가 allowlist에 없으면 forbidden이다.
import { contentBasis, earlierDeadline, type LiveHandle } from "./handle.ts";
import type { ConfirmationHandleRegister } from "./types.ts";
import type { KindCore } from "./kinds/core.ts";
import { readOptionAction, submitOptionAction } from "./kinds/option-action.ts";

const WITHOUT_WINDOW = new Set([
  "term.define",
  "app.create",
  "apply_settings",
]);

type Code =
  | "forbidden"
  | "invalid_input"
  | "conflict"
  | "not_found"
  | "unavailable";

type Registered =
  | { ok: true; confirmation: string; expiresAt: string }
  | { ok: false; error: { code: string; message: string } };

export type TermDefinitionResult = { ok: true } | { ok: false; code: Code };

function codeOf(value: string): Code {
  if (
    value === "forbidden" || value === "invalid_input" ||
    value === "conflict" || value === "not_found" || value === "unavailable"
  ) return value;
  return "unavailable";
}

export async function confirmTermDefinition(input: {
  core: KindCore;
  register: (request: ConfirmationHandleRegister) => Promise<Registered>;
  windowId: string;
  group: string;
  optionKey: string;
  nowMs: number;
}): Promise<TermDefinitionResult> {
  const read = await readOptionAction(
    input.core,
    input.group,
    input.optionKey,
  );
  if (!read.ok) return { ok: false, code: codeOf(read.error.code) };
  const request = read.value.request;
  if (
    read.value.view === undefined ||
    !WITHOUT_WINDOW.has(String(read.value.view.command)) ||
    request.kind !== "question_option_action"
  ) return { ok: false, code: "forbidden" };
  const deadline = earlierDeadline(input.nowMs, read.value.expiresAt);
  if (deadline === null) return { ok: false, code: "conflict" };
  const contentHash = contentBasis(read.value.content);
  const registered = await input.register({
    type: "confirmation_handle_register",
    window_id: input.windowId,
    target_ref: read.value.targetRef,
    content_hash: contentHash,
    allowed_decisions: [...read.value.allowed],
    expires_at: new Date(deadline).toISOString(),
  });
  if (!registered.ok) return { ok: false, code: codeOf(registered.error.code) };
  const handle: LiveHandle = {
    ref: registered.confirmation,
    windowId: input.windowId,
    displayId: "",
    targetRef: read.value.targetRef,
    contentHash,
    allowed: read.value.allowed,
    epoch: "",
    expiresAtMs: deadline,
    spent: false,
    unknown: false,
  };
  const sent = await submitOptionAction(input.core, {
    handle,
    group: input.group,
    question: request.question,
    optionKey: input.optionKey,
    createdSeq: request.created_seq,
    bindingHash: request.binding_hash,
  });
  if (!sent.ok) {
    return { ok: false, code: sent.unknown ? "unavailable" : "conflict" };
  }
  return { ok: true };
}
