// command 밖의 OS 준비·정리(platform/secrets#R1, R6, R7).
// 값은 이 모듈과 keychain 메모리에만 있고 결과에는 참조만 남는다.

import { err, ok, type Result } from "../../base/mod.ts";
import type {
  SecretCleanupResult,
  SecretPreparation,
  SecretPrepareInput,
  SecretValue,
} from "../../protocol/secrets/mod.ts";
import type { KnownSecretRegistry } from "../../base/redaction/mod.ts";
import type { KeychainAdapter } from "./adapters/keychain.ts";
import { cleanupResult, type SecretRecord } from "./model.ts";

export type PreparationStore = {
  // 준비 증거를 ledger에 남긴다. 값은 넣지 않는다.
  record(preparation: SecretPreparation): Promise<Result<void>>;
  // 현재 참조가 아닌 준비·이전 참조를 고아로 구별한다(R6).
  orphans(current: readonly string[]): Promise<Result<readonly string[]>>;
};

export type ProcessWatch = {
  // 이 참조를 쓴 프로세스가 모두 끝났는지 실제 관측으로만 답한다(R7).
  ended(sealedRef: string): Promise<boolean>;
};

export type CleanupTarget = {
  // 교체·제거로 더 이상 현재 참조가 아닌 이전 값.
  previous: SecretRecord;
  // ledger commit이 이 참조를 현재 사용에서 막았는지.
  referenceBlocked: boolean;
};

export type SecretWork = {
  prepare(
    input: SecretPrepareInput,
    value: SecretValue,
  ): Promise<Result<SecretPreparation>>;
  cleanup(target: CleanupTarget): Promise<SecretCleanupResult>;
};

function bytesOf(value: SecretValue): Uint8Array {
  return typeof value === "string" ? new TextEncoder().encode(value) : value;
}

function textOf(value: SecretValue): string {
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}

export function createSecretWork(options: {
  keychain: KeychainAdapter;
  // ledger에 직접 쓸 수 있는 곳에서만 둔다. I/O worker는 ledger를 쓰지 못하므로 두지 않고,
  // 값 없는 준비 증거(SecretPreparation)를 응답으로 돌려주면 core의 writer가 남긴다.
  preparations?: PreparationStore;
  // 준비한 값을 곧바로 알려진 값으로 등록할 registry. I/O worker는 값을 쥐지 않으므로 두지
  // 않는다: 알려진 값은 ledger가 그 참조를 현재로 확정한 뒤 core가 keychain에서 읽어 등록한다.
  registry?: KnownSecretRegistry;
  // 이 참조를 쓴 프로세스의 종료 관측. 없으면 종료를 관측하지 못한 것이라 processes_ended는
  // false다(R7).
  processes?: ProcessWatch;
  // 준비 증거 id. 값에서 파생하지 않는다.
  preparationId: () => string;
}): SecretWork {
  return {
    async prepare(input, value) {
      const status = await options.keychain.status();
      if (status !== "available") {
        return err({
          code: "unavailable",
          message: "OS keychain을 사용할 수 없다",
        });
      }
      const stored = await options.keychain.store({
        name: input.owner,
        purpose: input.purpose,
        owner: input.owner,
        value: bytesOf(value),
      });
      if (!stored.ok) return stored;
      const preparation: SecretPreparation = {
        preparation: options.preparationId(),
        sealed_ref: stored.value,
        purpose: input.purpose,
        owner: input.owner,
      };
      const recorded = await options.preparations?.record(preparation) ??
        ok(undefined);
      if (!recorded.ok) {
        // 증거를 남기지 못한 준비는 고아다. 실패해도 이전 참조는 건드리지 않는다.
        await options.keychain.remove(stored.value);
        return recorded;
      }
      options.registry?.register([textOf(value)]);
      return ok(preparation);
    },
    async cleanup(target) {
      // 세 사실은 서로 추론하지 않는다. 삭제가 늦어도 차단은 차단이다(R7).
      const osDeleted =
        (await options.keychain.remove(target.previous.sealedRef)).ok;
      const processesEnded = options.processes === undefined
        ? false
        : await options.processes.ended(target.previous.sealedRef);
      return cleanupResult({
        referenceBlocked: target.referenceBlocked,
        osDeleted,
        processesEnded,
      });
    },
  };
}
