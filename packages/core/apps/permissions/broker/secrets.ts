// broker `/_lophn/broker/secrets/use`. 앱 입력은 SecretUseContext와 목적지뿐이고 원값을 읽거나
// 바꾸는 통로가 아니다. 선언 이름∩grant와 그 목적지의 net.fetch host·port를 검사한 뒤 플랫폼
// net/fetch가 전송 직전에 인증 값을 붙이고(redirect로 목적지가 바뀌면 net/fetch가 다시 판정한다), 앱에는
// 안전한 사용 결과만 돌려준다.
// 누가 command를 불렀는지(사람 화면·agent·다른 앱)로 막지 않는다.
import { ok, type Result } from "../../../../base/mod.ts";
import {
  brokerSecretUseInputSchema,
  type brokerSecretUseOutputSchema,
} from "../../../../protocol/apps/mod.ts";
import type { SecretDestination } from "../../../../protocol/secrets/mod.ts";
import type { z } from "zod";
import type { EffectiveScope } from "../effective.ts";
import {
  type BrokerAccess,
  currentAccess,
  invalid,
  liveOnly,
  normalHost,
  refuse,
  secretGranted,
  unavailable,
} from "./access.ts";
import type { BrokerChild } from "./invocations.ts";
import {
  destinationAllowed,
  isLoopbackHost,
  urlHost,
  urlPort,
} from "./net-fetch.ts";

type SecretUseOutput = z.infer<typeof brokerSecretUseOutputSchema>;

type SecretUseDestination = {
  scheme: string;
  host: string;
  port: number;
};

type SecretDeliveryRequest = {
  app: string;
  release: string;
  processNonce: string;
  invocation: string | null;
  command: string;
  inputHash: string;
  name: string;
  destination: SecretUseDestination;
};

// 전송 부착 경계를 감싼 포트다. `use`가 성공하면 같은 invocation의 net/fetch가 `attached`로 값을 찾아
// 붙일 준비가 된 것이고, 앱에 돌려주는 모양에는 원값이 없다.
export interface SecretDelivery {
  use(request: SecretDeliveryRequest): Promise<Result<{ sent: true }>>;
  // net/fetch가 목적지 요청을 보내기 직전에 읽는다. 없거나 만료됐으면 undefined다.
  attached(invocation: string, host: string, port: number): string | undefined;
}

// 알려진 값 등록이다. 등록에 성공해야 값이 경계를 나갈 수 있다.
export interface RedactionGate {
  ensure(name: string): Promise<Result<void>> | Result<void>;
}

type SecretUseDeps = {
  access: BrokerAccess;
  delivery: SecretDelivery;
  redaction: RedactionGate;
  platformPorts: readonly number[];
};

export type SecretUseService = {
  use(child: BrokerChild, body: unknown): Promise<Result<SecretUseOutput>>;
};

// secret 허락 판정(`SecretAllowanceCheck`)의 규칙이다. 같은 규칙을 broker와 platform이 함께 쓴다.
export function secretAllowed(
  scope: EffectiveScope,
  platformPorts: readonly number[],
  name: string,
  destination: SecretDestination | null,
): boolean {
  if (destination === null) return false;
  const url = new URL(destination.origin);
  // http는 이 기계 밖으로 나가지 않는 loopback host만이다. net.fetch의 규칙과 같다.
  if (destination.kind === "loopback_http" && !isLoopbackHost(urlHost(url))) {
    return false;
  }
  const granted = scope.access.some((entry) =>
    entry.kind === "secret.use" && entry.scope.name === name
  );
  if (!granted) return false;
  return destinationAllowed(
    { release: "", scope, app_api: [] },
    platformPorts,
    urlHost(url),
    urlPort(url),
  );
}

export function createSecretUseService(deps: SecretUseDeps): SecretUseService {
  return {
    async use(child, body) {
      const parsed = brokerSecretUseInputSchema.safeParse(body);
      if (!parsed.success) return invalid("secret use input is invalid");
      const input = parsed.data;
      const refused = liveOnly(child, "secret.use", { name: input.name });
      if (refused) return refused;
      if (input.release !== child.release) {
        return refuse("secret.use", { name: input.name });
      }
      const host = normalHost(input.destination.host);
      if (host === undefined) return invalid("destination host is invalid");
      const destination = {
        scheme: input.destination.scheme,
        host,
        port: input.destination.port,
      };
      if (input.destination.scheme === "http" && !isLoopbackHost(host)) {
        return refuse("net.fetch", { host, port: input.destination.port });
      }
      const access = await currentAccess(deps.access, child);
      if (!access.ok) return access;
      const state = access.value;
      if (
        state === null || !state.app_api.includes(input.command) ||
        !secretGranted(state, input.name)
      ) {
        return refuse("secret.use", { name: input.name });
      }
      if (
        !destinationAllowed(
          state,
          deps.platformPorts,
          host,
          input.destination.port,
        )
      ) {
        return refuse("net.fetch", { host, port: input.destination.port });
      }
      // 등록에 실패하면 값은 어떤 경로로도 나가지 않는다.
      const registered = await deps.redaction.ensure(input.name);
      if (!registered.ok) {
        return unavailable("secret cannot be delivered safely");
      }
      const sent = await deps.delivery.use({
        app: child.app,
        release: input.release,
        processNonce: child.processNonce,
        invocation: input.invocation,
        command: input.command,
        inputHash: input.input_hash,
        name: input.name,
        destination,
      });
      if (!sent.ok) return sent;
      return ok({ used: true });
    },
  };
}
