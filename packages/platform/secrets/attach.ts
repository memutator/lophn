// secret 전송 부착(platform/secrets#R3, R5, platform/security#R9).
// 값은 keychain과 전송 callback 메모리에만 있고 결과·오류·log에는 없다.

import { err, type Result } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  SecretSendInput,
  SecretSendOutput,
  SecretValue,
} from "../../contracts/platform/mod.ts";
import { authorize } from "../identity/mod.ts";
import type { KeychainAdapter } from "./adapters/keychain.ts";
import { attachAllowed } from "./model.ts";

export const SECRET_SEND = "secret.send";

export type SecretAllowance = {
  // 현재 참조·판·용도와 사람이 허용한 목적지. 앱 사용은 현재 grant를 반영한 결과만 온다.
  current(use: SecretSendInput["use"]): Promise<
    Result<{
      sealedRef: string;
      revision: number;
      purpose: SecretSendInput["use"]["purpose"];
      destination: SecretSendInput["use"]["destination"];
    }>
  >;
};

export type ProcessLiveness = {
  // credential에 묶인 process가 아직 살아 있는지(platform/secrets#R5).
  alive(process: string): Promise<boolean>;
};

export type SecretAttach = {
  // 값은 callback 인자로만 넘긴다. 이 함수의 결과는 전송 여부뿐이다.
  send(
    input: SecretSendInput,
    transmit: (value: SecretValue) => Promise<Result<SecretSendOutput>>,
  ): Promise<Result<SecretSendOutput>>;
};

const FORBIDDEN = {
  code: "forbidden" as const,
  message: "secret 전송을 허용하지 않는다",
};
const CONFLICT = {
  code: "conflict" as const,
  message: "현재 참조와 판이 다르다",
};

export function createSecretAttach(options: {
  keychain: KeychainAdapter;
  allowance: SecretAllowance;
  processes: ProcessLiveness;
}): SecretAttach {
  return {
    async send(input, transmit) {
      const admitted = admit(input.context);
      if (!admitted.ok) return admitted;
      if (!(await options.processes.alive(input.context.conditions.process!))) {
        return err(FORBIDDEN);
      }
      const allowed = await options.allowance.current(input.use);
      if (!allowed.ok) return allowed;
      const verdict = attachAllowed(
        allowed.value,
        input.use,
        allowed.value.destination,
      );
      if (verdict === "conflict") return err(CONFLICT);
      if (verdict !== "ok") return err(FORBIDDEN);
      const loaded = await options.keychain.load(allowed.value.sealedRef);
      if (!loaded.ok) {
        return err({
          code: "unavailable",
          message: "OS keychain을 사용할 수 없다",
        });
      }
      // callback 메모리에서만 값이 산다. 결과에는 전송 여부만 남긴다.
      return await transmit(loaded.value);
    },
  };
}

function admit(context: AuthenticatedContext): Result<void> {
  if (
    context.actor !== "machine" ||
    context.conditions.process === undefined ||
    context.conditions.task === undefined
  ) {
    return err(FORBIDDEN);
  }
  return authorize(context, SECRET_SEND, {
    process: context.conditions.process,
    task: context.conditions.task,
  });
}
