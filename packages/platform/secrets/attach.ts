// secret 전송 부착(platform/secrets#R3, R5, platform/security#R9).
// 값은 keychain과 전송 callback 메모리에만 있고 결과·오류·log에는 없다.

import { err, type Result } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  ProcessLivenessCheck,
  SecretAllowanceCheck,
  SecretSendInput,
  SecretSendOutput,
  SecretValue,
} from "../../protocol/platform/mod.ts";
import { authorize } from "../identity/mod.ts";
import type { KeychainAdapter } from "./adapters/keychain.ts";
import { attachAllowed } from "./model.ts";

export const SECRET_SEND = "secret.send";

// 현재 참조·판·용도·허용 목적지. grant 판정(SecretAllowance)과 분리한다.
export type SecretReferenceLookup = {
  current(use: SecretSendInput["use"]): Promise<
    Result<{
      name: string;
      sealedRef: string;
      revision: number;
      purpose: SecretSendInput["use"]["purpose"];
      destination: SecretSendInput["use"]["destination"];
    }>
  >;
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
  references: SecretReferenceLookup;
  // contract port. 앱 사용의 현재 grant를 판정한다. 등록되지 않으면 fail closed다.
  allowance?: SecretAllowanceCheck;
  // contract port. context의 process가 살아 있는지 답한다.
  processes: ProcessLivenessCheck;
}): SecretAttach {
  return {
    async send(input, transmit) {
      const admitted = admit(input.context);
      if (!admitted.ok) return admitted;
      if (!options.processes(input.context)) return err(FORBIDDEN);
      // SecretAllowance port 없음은 전송 허용이 아니라 거절이다.
      if (!options.allowance) return err(FORBIDDEN);
      const current = await options.references.current(input.use);
      if (!current.ok) return current;
      const granted = options.allowance({
        context: input.context,
        name: current.value.name,
        purpose: input.use.purpose,
        destination: input.use.destination,
      });
      if (!granted.ok) return granted;
      const verdict = attachAllowed(
        current.value,
        input.use,
        current.value.destination,
      );
      if (verdict === "conflict") return err(CONFLICT);
      if (verdict !== "ok") return err(FORBIDDEN);
      const loaded = await options.keychain.load(current.value.sealedRef);
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
