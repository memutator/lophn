// 준비 참조의 core 메모리 보관(platform/blob-store#R1). principal·purpose·hash·
// 크기와 10분 수명만 쥔다. 파일 관측과 hash는 worker의 몫이며 core는 다시 하지 않는다.

import type { PreparedBlob } from "../../contracts/platform/mod.ts";
import { BLOB_PREPARATION_TTL_MS } from "../../contracts/platform/mod.ts";
import { err, ok, type Result } from "../../base/mod.ts";

export type PreparationRegistry = {
  // 준비 결과를 등록한다. 수명은 등록 시각부터 10분이다.
  register(
    prepared: PreparedBlob,
    nowMs: number,
  ): Result<void>;
  // 살아 있는 준비 참조면 등록값을 답한다. 만기·없음은 not_found다.
  live(
    prepared: Pick<PreparedBlob, "hash" | "principal" | "purpose">,
    nowMs: number,
  ): Result<boolean>;
  // 만기 참조를 떨어뜨린다. 파일은 GC가 맡는다.
  prune(nowMs: number): void;
  readonly size: number;
};

export function createPreparationRegistry(): PreparationRegistry {
  const refs = new Map<
    string,
    { prepared: PreparedBlob; registeredAtMs: number }
  >();
  return {
    register(prepared, nowMs) {
      const key =
        `${prepared.principal}\u0000${prepared.purpose}\u0000${prepared.hash}`;
      if (refs.has(key)) {
        return err({ code: "conflict", message: "같은 준비 참조가 이미 있다" });
      }
      refs.set(key, { prepared, registeredAtMs: nowMs });
      return ok(undefined);
    },
    live(prepared, nowMs) {
      const key =
        `${prepared.principal}\u0000${prepared.purpose}\u0000${prepared.hash}`;
      const found = refs.get(key);
      if (found === undefined) return ok(false);
      if (nowMs - found.registeredAtMs >= BLOB_PREPARATION_TTL_MS) {
        return ok(false);
      }
      return ok(true);
    },
    prune(nowMs) {
      for (const [key, ref] of refs) {
        if (nowMs - ref.registeredAtMs >= BLOB_PREPARATION_TTL_MS) {
          refs.delete(key);
        }
      }
    },
    get size() {
      return refs.size;
    },
  };
}
