// secret 전송 부착(파일 저장소). 값은 파일 사본과 전송 callback 메모리에만 있고 결과·오류·log에는 없다.
// 순서: machine context 확인 → process 확인 → allowance(grant) 확인 → 허용 목적지 비교 → 값 읽기 →
// transmit(value). 이름이 파일에 없으면 not_found다.
import { err, type Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import {
  type ProcessLivenessCheck,
  SECRET_SEND_OP,
  type SecretAllowanceCheck,
  type SecretAttachPort,
  type SecretDestination,
} from "../../protocol/secrets/mod.ts";
import { authorize } from "../server/identity/mod.ts";
import type { SecretFileStore } from "./file-store.ts";
import { sameDestination } from "./model.ts";

// owner concern(provider·MCP·앱)이 그 secret을 보낼 수 있는 목적지를 답한다. redirect로 목적지가 바뀌었는지
// 보려고 쓴다. 모르는 이름은 빈 목록이다.
type SecretDestinations = {
  allowed(name: string): readonly SecretDestination[];
};

const FORBIDDEN = {
  code: "forbidden" as const,
  message: "secret 전송을 허용하지 않는다",
};

export function createFileSecretAttach(options: {
  file: Pick<SecretFileStore, "get">;
  // contract port. 앱 사용의 현재 grant를 판정한다.
  allowance: SecretAllowanceCheck;
  // contract port. context의 process가 살아 있는지 답한다.
  processes: ProcessLivenessCheck;
  destinations: SecretDestinations;
}): SecretAttachPort {
  return {
    async send(input, transmit) {
      const admitted = admit(input.context);
      if (!admitted.ok) return admitted;
      if (!options.processes(input.context)) return err(FORBIDDEN);
      const { name, destination } = input.use;
      const granted = options.allowance({
        context: input.context,
        name,
        // 사용 입력에는 용도가 없다. 앱 principal이 아니면 앱 secret이 아니다.
        purpose: input.context.principal.startsWith("app:")
          ? "app_secret"
          : "provider_credential",
        destination,
      });
      if (!granted.ok) return granted;
      if (
        !options.destinations.allowed(name).some((allowed) =>
          sameDestination(allowed, destination)
        )
      ) return err(FORBIDDEN);
      const loaded = options.file.get(name);
      if (!loaded.ok) return loaded;
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
  return authorize(context, SECRET_SEND_OP, {
    process: context.conditions.process,
    task: context.conditions.task,
  });
}
