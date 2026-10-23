// secret 전송 부착(파일 저장소). 값은 파일 사본과 전송 callback 메모리에만 있고 결과·오류·log에는 없다.
// 순서: machine context 확인 → process 확인 → 이름 공간의 용도 → allowance(grant) 확인 → 허용 목적지 비교 →
// 값 읽기 → transmit(value). 이름이 파일에 없으면 not_found다.
//
// 용도는 이름의 앞머리가 정한다: `provider.`는 provider credential, `mcp.`(사람이 넣은 MCP credential)와
// `mcp-oauth.`(MCP OAuth token)는 외부 MCP credential이다. 앞머리가 없는 이름은 앱 secret이고, 앱을 대신하는
// 호출(context의 `conditions.app`)만 보낸다. 앱 호출이 앞의 셋을 가리키거나 앱 호출이 아닌 쪽이 앱 secret을
// 가리키면 거절한다. 이름 공간이 갈라져 있어야 설정이 다른 이름 공간의 이름을 가리켜도 그 값이 엉뚱한
// 목적지로 가지 않는다.
// `app-oauth.`(앱 OAuth의 refresh·meta·client)와 `provider-oauth.`(provider 로그인 token·host id)는 core 밖으로
// 나가지 않는 이름이라 누가 불러도 막는다. 앞머리 없음으로 떨어뜨리면 앱 호출이 allowance만 맞아 보낼 수 있다.
import { err, type Result } from "../../base/mod.ts";
import { APP_OAUTH_PREFIX } from "../../protocol/apps/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import {
  type ProcessLivenessCheck,
  SECRET_SEND_OP,
  type SecretAllowanceCheck,
  type SecretAttachPort,
  type SecretDestination,
  type SecretPurpose,
} from "../../protocol/secrets/mod.ts";
import { authorize } from "../server/identity/mod.ts";
import type { SecretFileStore } from "./file-store.ts";

// owner concern(provider·MCP)이 그 secret을 보낼 수 있는 목적지를 답한다. redirect로 목적지가 바뀌었는지
// 보려고 쓴다. 모르는 이름은 빈 목록이다.
type SecretDestinations = {
  allowed(
    name: string,
  ): readonly SecretDestination[] | Promise<readonly SecretDestination[]>;
};

// `provider-oauth.`의 정의는 lophn-agent/providers/oauth-secrets.ts다(secrets는 harness를 import하지 못해 literal).
const PROVIDER_OAUTH_PREFIX = "provider-oauth.";

// 앞머리가 정하는 용도다. 어느 호출에도 보내지 않는 이름은 undefined다.
function purposeOf(name: string): SecretPurpose | undefined {
  if (
    name.startsWith(APP_OAUTH_PREFIX) || name.startsWith(PROVIDER_OAUTH_PREFIX)
  ) return undefined;
  if (name.startsWith("provider.")) return "provider_credential";
  if (name.startsWith("mcp.") || name.startsWith("mcp-oauth.")) {
    return "external_mcp_credential";
  }
  return "app_secret";
}

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
      const purpose = purposeOf(name);
      if (purpose === undefined) return err(FORBIDDEN);
      const forApp = input.context.conditions.app !== undefined;
      if ((purpose === "app_secret") !== forApp) return err(FORBIDDEN);
      const granted = options.allowance({
        context: input.context,
        name,
        purpose,
        destination,
      });
      if (!granted.ok) return granted;
      // 앱 secret의 목적지는 위 allowance(선언 ∩ grant)가 이미 정했다.
      if (purpose !== "app_secret") {
        const allowed = await options.destinations.allowed(name);
        if (!allowed.some((one) => sameDestination(one, destination))) {
          return err(FORBIDDEN);
        }
      }
      const loaded = options.file.get(name);
      if (!loaded.ok) return loaded;
      // callback 메모리에서만 값이 산다. 결과에는 전송 여부만 남긴다.
      return await transmit(loaded.value);
    },
  };
}

// redirect는 새 전송이다. 목적지(종류와 host)가 바뀌면 값을 넘기지 않는다.
function sameDestination(
  allowed: SecretDestination,
  next: SecretDestination,
): boolean {
  return allowed.kind === next.kind &&
    new URL(allowed.origin).host === new URL(next.origin).host;
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
