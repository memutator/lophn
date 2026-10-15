// 사람 결정 handle의 내용 기준과 기한. 발급·검증·소비는 core가 하고 원문은 renderer로 가지 않는다.
// 여기는 정본에서 내용 기준을 만들고 등록할 기한을 정하는 일만 한다.
import { createHash } from "node:crypto";

import { canonicalize } from "./canonical.ts";

/** contracts CONFIRMATION_HANDLE_TTL_MS. 발급 시각에서 120초. */
export const HANDLE_TTL_MS = 120_000;

/**
 * 내용 기준. core confirmationBinding과 같이 canonical JSON의 sha256 hex다.
 * route binding field만 넘긴다. 키 순서가 달라도 같은 hash가 된다.
 */
export function contentBasis(bound: unknown): string {
  return createHash("sha256").update(canonicalize(bound)).digest("hex");
}

/** 발급 시각에서 120초와 대상 기한 중 이른 시각. 이미 지났으면 null. */
export function earlierDeadline(
  nowMs: number,
  targetExpiresAt: string | null,
): number | null {
  const ttl = nowMs + HANDLE_TTL_MS;
  const target = targetExpiresAt === null ? ttl : Date.parse(targetExpiresAt);
  if (!Number.isFinite(target)) return null;
  const at = Math.min(ttl, target);
  return at > nowMs ? at : null;
}
