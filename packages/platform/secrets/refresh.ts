// 갱신 결과 저장(platform/secrets#R11).
// keychain 준비를 먼저 끝내고 값 없는 SecretPreparation과 CAS만 소유 command에 제출한다.

import { err, ok, type Result } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  CommandDefinition,
  ProcessLivenessCheck,
  SecretAllowanceCheck,
  SecretPreparation,
  SecretStoreRefreshInput,
  SecretStoreRefreshOutput,
  SecretValue,
  Tx,
} from "../../protocol/platform/mod.ts";
import { authorize } from "../identity/mod.ts";
import { compareMatches, type SecretCompare } from "./model.ts";
import type { SecretWork } from "./work.ts";

export const SECRET_STORE_REFRESH = "secret.store-refresh";

export type OwnerCredential = {
  sealedRef: string;
  revision: number;
  purpose: SecretStoreRefreshInput["purpose"];
  destination: SecretStoreRefreshInput["destination"];
};

// 소유 concern이 등록한 command 정의. 입력 모양은 그 concern이 정한다.
export type OwnerCredentialCommand = CommandDefinition;

export type RefreshSubmission = {
  // 현재 소유 참조·판·용도·목적지. 소유 기록은 이 concern 밖에 있다.
  current(owner: string): Promise<Result<OwnerCredential>>;
  // 값 없는 준비와 이전 CAS를 소유 concern command에 제출한다.
  command: OwnerCredentialCommand;
  // command 입력은 소유 concern이 정한다. 값은 이 함수에 오지 않는다.
  input(owner: string, preparation: SecretPreparation): unknown;
};

export type SecretRefresh = {
  // 갱신된 값은 callback 인자로만 받는다. 결과는 안전 새 참조·판뿐이다.
  store(
    input: SecretStoreRefreshInput,
    value: () => Promise<SecretValue | undefined>,
  ): Promise<Result<SecretStoreRefreshOutput>>;
};

export function createSecretRefresh(options: {
  work: SecretWork;
  submit: RefreshSubmission;
  // contract port. 목적지·용도의 현재 허용을 판정한다. 등록되지 않으면 fail closed다.
  allowance?: SecretAllowanceCheck;
  // contract port. context의 process가 살아 있는지 답한다.
  processes: ProcessLivenessCheck;
  // 제출은 소유 command를 같은 transaction에서 부른다. 실패는 이전 참조를 유지한다.
  transaction(
    run: (tx: Tx) => Result<SecretStoreRefreshOutput>,
  ): Promise<Result<SecretStoreRefreshOutput>>;
}): SecretRefresh {
  return {
    async store(input, value) {
      const admitted = admit(input.context);
      if (!admitted.ok) return admitted;
      if (!options.processes(input.context)) {
        return err({
          code: "forbidden",
          message: "secret 갱신을 허용하지 않는다",
        });
      }
      // SecretAllowance port 없음은 갱신 허용이 아니라 거절이다.
      if (!options.allowance) {
        return err({
          code: "forbidden",
          message: "secret 갱신을 허용하지 않는다",
        });
      }
      const granted = options.allowance({
        context: input.context,
        name: input.owner,
        purpose: input.purpose,
        destination: input.destination,
      });
      if (!granted.ok) return granted;
      const current = await options.submit.current(input.owner);
      if (!current.ok) return current;
      const compare: SecretCompare = {
        sealed_ref: current.value.sealedRef,
        revision: current.value.revision,
      };
      if (
        !compareMatches(
          {
            name: input.owner,
            sealedRef: input.sealed_ref,
            revision: input.revision,
          },
          compare,
        ) ||
        input.purpose !== current.value.purpose ||
        input.destination.kind !== current.value.destination.kind
      ) {
        return err({ code: "conflict", message: "현재 참조와 판이 다르다" });
      }
      const bytes = await value();
      if (bytes === undefined) {
        return err({ code: "invalid_input", message: "갱신 값이 없다" });
      }
      // 준비는 command 밖에서 끝난다. 값은 SecretPreparation에 들어가지 않는다(R11).
      const prepared = await options.work.prepare(
        {
          context: input.context,
          purpose: input.purpose,
          owner: input.owner,
        },
        bytes,
      );
      if (!prepared.ok) return prepared;
      const submitted = await options.transaction((tx) =>
        tx.call(
          options.submit.command.route,
          options.submit.input(input.owner, prepared.value),
          compare,
        ) as Result<SecretStoreRefreshOutput>
      );
      if (!submitted.ok) {
        // commit·CAS 실패는 이전 참조를 유지하고 방금 준비한 값을 고아로 정리한다.
        await options.work.cleanup({
          previous: {
            name: input.owner,
            sealedRef: prepared.value.sealed_ref,
            revision: input.revision,
          },
          referenceBlocked: false,
        });
        return submitted;
      }
      return ok(submitted.value);
    },
  };
}

function admit(context: AuthenticatedContext): Result<void> {
  if (
    context.actor !== "machine" ||
    context.conditions.process === undefined ||
    context.conditions.task === undefined
  ) {
    return err({ code: "forbidden", message: "secret 갱신을 허용하지 않는다" });
  }
  return authorize(context, SECRET_STORE_REFRESH, {
    process: context.conditions.process,
    task: context.conditions.task,
  });
}
