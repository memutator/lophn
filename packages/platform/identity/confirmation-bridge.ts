import { err, type Result } from "../../base/mod.ts";
import type { ConfirmationRef } from "../../contracts/platform/mod.ts";
import {
  ConfirmationRegistry,
  type ConfirmationUse,
} from "./confirmation.ts";

// writer Worker는 handle 원문을 갖지 않는다. core 프로세스의 registry에 동기 호출로 묻는다.
// 다리의 메서드는 모두 동기라 transaction 안에서 await 없이 검증·소비할 수 있다.
export type ConfirmationBridge = {
  reserve(use: ConfirmationUse): Result<void>;
  consume(ref: ConfirmationRef): void;
  release(ref: ConfirmationRef): void;
};

const unavailable = (): Result<never> =>
  err({ code: "unavailable", message: "사람 결정 확인을 사용할 수 없다" });

// 다리가 없으면 confirmation route는 unavailable이다. 없는 확인을 성공으로 넘기지 않는다.
export function disconnectedConfirmationBridge(): ConfirmationBridge {
  return {
    reserve: () => unavailable(),
    consume: () => undefined,
    release: () => undefined,
  };
}

export function confirmationBridge(
  registry: ConfirmationRegistry,
): ConfirmationBridge {
  return {
    reserve: (use) => registry.reserve(use),
    consume: (ref) => registry.consume(ref),
    release: (ref) => registry.release(ref),
  };
}
