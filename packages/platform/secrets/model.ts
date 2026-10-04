// secret 참조의 순수 전이(platform/secrets#R4, R6, R7). IO 없음.

import { err, ok, type Result } from "../../base/mod.ts";
import type {
  SecretCleanupResult,
  SecretDestination,
  SecretStatus,
  SecretUse,
} from "../../contracts/platform/mod.ts";

export type SecretRecord = {
  name: string;
  sealedRef: string;
  revision: number;
};

export type SecretCompare =
  | { sealed_ref: null; revision: null }
  | { sealed_ref: string; revision: number };

// 부재와 이름 부재 CAS는 같은 자리로 본다. 권한 밖 이름은 이 함수에 오지 않는다(R4).
export function compareMatches(
  current: SecretRecord | undefined,
  compare: SecretCompare,
): boolean {
  if (current === undefined) {
    return compare.sealed_ref === null && compare.revision === null;
  }
  return compare.sealed_ref === current.sealedRef &&
    compare.revision === current.revision;
}

export function nextRevision(current: SecretRecord | undefined): number {
  return current === undefined ? 1 : current.revision + 1;
}

export function applySet(
  current: SecretRecord | undefined,
  compare: SecretCompare,
  name: string,
  sealedRef: string,
): Result<SecretRecord> {
  if (!compareMatches(current, compare)) {
    return err({ code: "conflict", message: "이전 참조와 판이 다르다" });
  }
  return ok({ name, sealedRef, revision: nextRevision(current) });
}

export function applyRemove(
  current: SecretRecord | undefined,
  compare: { sealed_ref: string; revision: number },
): Result<SecretRecord> {
  if (current === undefined) {
    return err({ code: "not_found", message: "secret이 없다" });
  }
  if (!compareMatches(current, compare)) {
    return err({ code: "conflict", message: "이전 참조와 판이 다르다" });
  }
  return ok(current);
}

export function toStatus(
  record: SecretRecord | undefined,
  name: string,
): SecretStatus {
  return record === undefined
    ? { name, configured: false, revision: null }
    : { name, configured: true, revision: record.revision };
}

// 세 사실은 각각 관측한다. 하나를 다른 하나에서 추론하지 않는다(R7).
// redirect는 새 전송이다. 목적지가 바뀌면 인증을 넘기지 않는다(platform/security#R9).
export function destinationHost(destination: SecretDestination): string {
  return destination.kind === "https"
    ? new URL(destination.origin).host
    : destination.server_connection;
}

export function sameDestination(
  current: SecretDestination,
  next: SecretDestination,
): boolean {
  return destinationHost(current) === destinationHost(next) &&
    current.kind === next.kind;
}

// 참조·판·용도가 현재 허용과 같고 목적지가 같아야 값을 붙인다(platform/secrets#R5).
export function attachAllowed(
  current: {
    sealedRef: string;
    revision: number;
    purpose: SecretUse["purpose"];
  },
  use: SecretUse,
  allowed: SecretDestination,
): "ok" | "conflict" | "forbidden" {
  if (
    use.sealed_ref !== current.sealedRef || use.revision !== current.revision
  ) {
    return "conflict";
  }
  if (
    use.purpose !== current.purpose ||
    !sameDestination(use.destination, allowed)
  ) {
    return "forbidden";
  }
  return "ok";
}

export function cleanupResult(observed: {
  referenceBlocked: boolean;
  osDeleted: boolean;
  processesEnded: boolean;
}): SecretCleanupResult {
  return {
    reference_blocked: observed.referenceBlocked,
    os_deleted: observed.osDeleted,
    processes_ended: observed.processesEnded,
  };
}
