// 준비 참조 registry의 순수 규칙(platform/blob-store#R1). IO 없음.

import { err, ok, type Result } from "../../../base/mod.ts";
import {
  BLOB_PREPARATION_TTL_MS,
  type PreparedBlob,
} from "../../../protocol/storage/mod.ts";

export type PreparationRef = {
  preparation: string;
  principal: string;
  purpose: string;
  hash: string;
  size_bytes: number;
  // 만기판별은 이 시각만으로 한다. core는 파일을 다시 hash하지 않는다.
  registered_at_ms: number;
};

// 같은 hash·주체·purpose의 준비 참조는 하나뿐이다. 만기면 없는 것으로 본다.
export function liveRef(
  refs: readonly PreparationRef[],
  prepared: PreparedBlob,
  nowMs: number,
): Result<PreparationRef | undefined> {
  const found = refs.find((ref) =>
    ref.hash === prepared.hash &&
    ref.principal === prepared.principal &&
    ref.purpose === prepared.purpose
  );
  if (found === undefined) return ok(undefined);
  if (nowMs - found.registered_at_ms >= BLOB_PREPARATION_TTL_MS) {
    return ok(undefined);
  }
  return ok(found);
}

// 준비 참조 등록. identity·purpose·hash·크기는 준비 결과와 같아야 한다.
export function registerRef(
  refs: readonly PreparationRef[],
  prepared: PreparedBlob,
  nowMs: number,
  preparation: string,
): Result<readonly PreparationRef[]> {
  const live = refs.filter((ref) =>
    nowMs - ref.registered_at_ms < BLOB_PREPARATION_TTL_MS
  );
  if (
    live.some((ref) =>
      ref.hash === prepared.hash &&
      ref.principal === prepared.principal &&
      ref.purpose === prepared.purpose
    )
  ) {
    return err({ code: "conflict", message: "같은 준비 참조가 이미 있다" });
  }
  return ok([
    ...live,
    {
      preparation,
      principal: prepared.principal,
      purpose: prepared.purpose,
      hash: prepared.hash,
      size_bytes: prepared.size_bytes,
      registered_at_ms: nowMs,
    },
  ]);
}

// 만기 참조는 registry에서 떨어진다. 파일은 GC(T44)가 맡는다.
export function expiredRefs(
  refs: readonly PreparationRef[],
  nowMs: number,
): readonly PreparationRef[] {
  return refs.filter((ref) =>
    nowMs - ref.registered_at_ms < BLOB_PREPARATION_TTL_MS
  );
}
