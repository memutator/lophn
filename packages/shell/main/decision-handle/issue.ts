// 사람 결정 handle 발급. 기능 화면(provider 끊기)에서 사람이 누르면
// renderer가 결정 이름과 대상만 보낸다. 여기서 정본을 core에서 다시 읽어 내용 기준을 만들고 core에
// handle을 등록한다. renderer는 handle 참조만 받아 `confirmation: required` route를 부른다.
// 원문은 core가 만들고 이 모듈에는 참조만 온다. 정본과 맞지 않는 결정은 handle을 받지 못한다.
import type { DecisionHandleRequest } from "../../ipc/confirmation.ts";
import { type DecisionCore, failed, type Read } from "./core.ts";
import { contentBasis, earlierDeadline } from "./handle.ts";
import {
  PROVIDER_CONCERN,
  PROVIDER_DISCONNECT,
  readProviderDisconnect,
} from "./provider-disconnect.ts";

interface HandleRegistration {
  readonly type: "confirmation_handle_register";
  readonly window_id: string;
  readonly target_ref: string;
  readonly content_hash: string;
  readonly allowed_decisions: readonly string[];
  readonly expires_at: string;
}

type HandleIssue =
  | { ok: true; confirmation: string; expires_at: string }
  | { ok: false; error: { code: string; message: string } };

function readCanonical(
  core: DecisionCore,
  request: DecisionHandleRequest,
): Promise<Read> {
  const { concern, decision } = request;
  if (concern === PROVIDER_CONCERN && decision === PROVIDER_DISCONNECT) {
    return readProviderDisconnect(core, request);
  }
  return Promise.resolve(failed("forbidden", "handle을 받을 수 없는 결정이다"));
}

export async function issueDecisionHandle(input: {
  core: DecisionCore;
  register(
    request: HandleRegistration,
  ): Promise<
    | { ok: true; confirmation: string; expiresAt: string }
    | { ok: false; error: { code: string; message: string } }
  >;
  /** 요청한 일반 shell 창. */
  windowId: string;
  request: DecisionHandleRequest;
  nowMs: number;
}): Promise<HandleIssue> {
  const read = await readCanonical(input.core, input.request);
  if (!read.ok) return read;
  const canonical = read.value;
  if (canonical.allowed.length === 0) {
    return failed("conflict", "지금은 고를 수 없는 결정이다");
  }
  const deadline = earlierDeadline(input.nowMs, canonical.expiresAt);
  if (deadline === null) return failed("conflict", "대상의 기한이 지났다");
  const registered = await input.register({
    type: "confirmation_handle_register",
    window_id: input.windowId,
    target_ref: canonical.targetRef,
    content_hash: contentBasis(canonical.content),
    allowed_decisions: [...canonical.allowed],
    expires_at: new Date(deadline).toISOString(),
  });
  if (!registered.ok) return registered;
  return {
    ok: true,
    confirmation: registered.confirmation,
    expires_at: registered.expiresAt,
  };
}
