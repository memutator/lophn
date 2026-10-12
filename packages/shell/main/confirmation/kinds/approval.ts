// approval request. 정본은 approvals/get(정확한 동작·대상·입력·기한·상태)과 ReadApprovalText
// (이유·변경·외부 영향·되돌림 글)다. 글은 core가 redaction한 값이고 하나라도 못 읽으면 일부만
// 보이지 않는다. 허락·거절은 일회 handle을, 대기 요청의 명시 취소는 user command를 쓴다.
import type { LiveHandle } from "../handle.ts";
import { CANCEL, GRANT, REJECT } from "../choice.ts";
import type { ApprovalPreselect } from "../types.ts";
import { readAppsView } from "./apps.ts";
import {
  bindingOf,
  failed,
  type KindCore,
  type Read,
  readFailure,
  record,
  sendCommand,
  type Sent,
  text,
} from "./core.ts";

export { CANCEL, GRANT, REJECT };

/**
 * grant·reject의 binding(contracts approvals). 거절 이유는 binding에 들어가지 않는다.
 * grant는 사람이 고른 scope도 묶지만 once는 기본값이라 빠진다(빠진 칸과 기본값은 같은 뜻이다).
 * 그래서 once 허락과 거절의 내용은 같고 session 허락만 scope를 더한다.
 */
const BINDING = ["approval", "created_seq", "binding_hash"] as const;
const SESSION_BINDING = [...BINDING, "scope"] as const;

/** contracts APPROVAL_TEXT_MAX_BYTES. */
const TEXT_MAX_BYTES = 32768;

export async function readApproval(
  core: KindCore,
  approval: string,
  preselect?: ApprovalPreselect,
): Promise<Read> {
  const got = await core.internal("read", "approvals", "get", { approval });
  if (!got.ok) return readFailure(got);
  const request = record(record(got.value).request);
  if (request.status !== "pending") {
    return failed("conflict", "이미 끝난 요청이다");
  }
  const action = record(request.action);
  const createdSeq = String(request.created_seq);
  const bindingHash = String(action.binding_hash);
  // 글 blob 하나라도 읽지 못하면 unavailable이다. 일부만 보이지 않는다.
  const read = await core.internal("read", "approvals", "text", { approval });
  if (!read.ok) return readFailure(read);
  const words = record(read.value);
  // session 허락은 session_grantable인 request만 갖는다(platform/approvals#R20). 아니면 session을
  // 미리 골라도 once만 있고, 미리 고른 결정을 request가 허락하는 범위로 좁혀 view에 싣는다.
  const sessionGrantable = request.session_grantable === true;
  const chosen: ApprovalPreselect =
    preselect === "allow_session" && !sessionGrantable
      ? "allow_once"
      : preselect ?? "allow_once";
  const bound = bindingOf(
    chosen === "allow_session" ? SESSION_BINDING : BINDING,
    {
      approval,
      created_seq: createdSeq,
      binding_hash: bindingHash,
      scope: "session",
    },
  );
  const effect = record(request.effect);
  const view = {
    kind: "approval",
    requester: text(request.requester),
    concern: text(action.concern),
    command: text(action.command),
    targets: Array.isArray(action.targets) ? action.targets : [],
    input: record(action.input),
    comparison: record(action.comparison),
    reason: text(words.reason),
    changes: text(words.changes),
    external: text(words.external),
    reversible: effect.reversible === true,
    reversibility: text(words.reversibility),
    expires_at: text(request.expires_at),
    session_grantable: sessionGrantable,
    preselect: chosen,
  };
  // 앱 결정(activation·grant·confirm·automation)은 같은 approval이고 표시만 apps read로 채운다.
  const apps = await readAppsView(core, action, view);
  if (!apps.ok) return apps;
  return {
    ok: true,
    value: {
      targetRef: bound.target,
      content: bound.content,
      allowed: [GRANT, REJECT, CANCEL],
      expiresAt: text(request.expires_at),
      secondConfirm: false,
      request: {
        kind: "approval_request",
        approval,
        created_seq: createdSeq,
        binding_hash: bindingHash,
      },
      view: apps.view ?? view,
    },
  };
}

/** 거절·취소 이유. 공백뿐이면 보내지 않고, 32KiB를 넘으면 받지 않는다. */
function reasonOf(
  commandInput: unknown,
): { ok: true; value: string | null } | { ok: false } {
  const reason = record(commandInput).reason;
  if (reason === undefined || reason === null) return { ok: true, value: null };
  if (typeof reason !== "string") return { ok: false };
  if (reason.trim().length === 0) return { ok: true, value: null };
  if (new TextEncoder().encode(reason).length > TEXT_MAX_BYTES) {
    return { ok: false };
  }
  return { ok: true, value: reason };
}

/** 허락은 결정 접수다. 실제 동작은 요청자가 따로 적용하므로 결과는 accepted다. */
export async function submitApproval(
  core: KindCore,
  input: {
    handle: LiveHandle;
    decision: string;
    approval: string;
    createdSeq: string;
    bindingHash: string;
    commandInput: unknown;
    /** handle을 만든 정본의 scope. 빠지면 once다. renderer가 보낸 값이 아니다. */
    scope?: "once" | "session";
  },
): Promise<Sent> {
  const base = {
    approval: input.approval,
    created_seq: input.createdSeq,
  };
  const compare = { created_seq: input.createdSeq };
  const key = `confirmation:${input.handle.ref}`;
  let sent;
  if (input.decision === GRANT) {
    sent = await sendCommand(core, "approvals", "grant", {
      input: {
        ...base,
        binding_hash: input.bindingHash,
        // once는 기본값이라 싣지 않는다. 사람이 session을 골랐을 때만 그 범위가 간다.
        ...(input.scope === "session" ? { scope: "session" } : {}),
      },
      idempotency_key: key,
      compare,
      prepared: [],
      confirmation: input.handle.ref,
    });
  } else if (input.decision === REJECT || input.decision === CANCEL) {
    const reason = reasonOf(input.commandInput);
    if (!reason.ok) {
      return {
        ok: false,
        unknown: false,
        error: { code: "invalid_input", message: "이유 글이 너무 길다" },
      };
    }
    sent = input.decision === REJECT
      ? await sendCommand(core, "approvals", "reject", {
        input: {
          ...base,
          binding_hash: input.bindingHash,
          closed_reason: reason.value,
        },
        idempotency_key: key,
        compare,
        prepared: [],
        confirmation: input.handle.ref,
      })
      // 명시 취소는 사람 handle을 쓰지 않는 user command다. 창 닫기와 다르다.
      : await sendCommand(core, "approvals", "cancel", {
        input: { ...base, closed_reason: reason.value },
        idempotency_key: `${key}:cancel`,
        compare,
        prepared: [],
      });
  } else {
    return {
      ok: false,
      unknown: false,
      error: { code: "forbidden", message: "허용되지 않은 결정이다" },
    };
  }
  if (!sent.ok) return sent;
  return {
    ok: true,
    value: {
      receipt: { kind: "entity", id: input.approval },
      result: "accepted",
    },
  };
}
