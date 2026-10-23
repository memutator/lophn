// secret은 읽을 수 없다. 이 client는 "이 secret을 이 목적지로 보낼 때 플랫폼 전송부가 인증 값을
// 붙여 달라"는 요청 하나만 낸다. 같은 command 안에서 그 목적지로 netFetch하면 broker가 Authorization으로 붙인다. 값 읽기·생성·교체·삭제 통로는 없다. secret 값의
// 저장과 변경은 사람의 확인과 OS 보관 경계를 지난다.
import {
  CapabilityError,
  fromBroker,
  missingHost,
  outsideCommand,
} from "./errors.ts";
import { type CapHost, readHost } from "./host.ts";

export const SECRETS_USE_PATH = "/_lophn/broker/secrets/use";

export type SecretDestination = {
  // grant가 허락한 정확한 host와 port다. 전송은 https이고, 이 기계 밖으로 나가지 않는 loopback만 http다.
  host: string;
  port: number;
};

export type SecretUseRequest = {
  // 선언하고 grant를 받은 secret 이름이다.
  name: string;
  destination: SecretDestination;
};

// 값은 어디에도 없다. standIn은 실제 전송 없이 대역이 답했다는 표시다.
export type SecretUseResult = { used: true; standIn?: true };

export type SecretClient = {
  use(request: SecretUseRequest): Promise<SecretUseResult>;
};

export type SecretStandIn = SecretClient & {
  // 대역이 받은 사용 요청. 시험과 preview 확인용이다.
  readonly uses: readonly SecretUseRequest[];
};

// broker(net.fetch)가 http를 허락하는 host와 같은 규칙이다. SDK는 apps 구현을 import하지 않는다.
function isLoopback(host: string): boolean {
  const lower = host.toLowerCase();
  return lower === "localhost" || lower === "::1" || lower === "::" ||
    lower === "0.0.0.0" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower);
}

function invalid(message: string): CapabilityError {
  return new CapabilityError({ code: "invalid_input", message });
}

function check(request: SecretUseRequest): void {
  if (typeof request.name !== "string" || request.name.length === 0) {
    throw invalid("secret name is required");
  }
  const { host, port } = request.destination ?? {};
  if (typeof host !== "string" || host.length === 0) {
    throw invalid("destination host must be an exact host name");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw invalid("destination port must be an integer from 1 to 65535");
  }
}

// preview·test의 대역이다. 외부에도 broker에도 나가지 않고 값도 없다. allowed를 주면 그 밖의
// 이름은 운영 broker처럼 permission 이름과 scope를 담아 거절한다.
export function createSecretStandIn(
  options: { allowed?: readonly string[] } = {},
): SecretStandIn {
  const uses: SecretUseRequest[] = [];
  return {
    uses,
    use(request) {
      try {
        check(request);
      } catch (error) {
        return Promise.reject(error);
      }
      if (options.allowed && !options.allowed.includes(request.name)) {
        return Promise.reject(
          new CapabilityError({
            code: "forbidden",
            message:
              `secret.use {"name":"${request.name}"} is not permitted. Declare this permission in the declaration and ask the person to grant it.`,
            permission: "secret.use",
            scope: { name: request.name },
          }),
        );
      }
      uses.push({
        name: request.name,
        destination: { ...request.destination },
      });
      return Promise.resolve({ used: true, standIn: true });
    },
  };
}

export type SecretClientDeps = {
  host?: CapHost;
  // live가 아닌 mode에서 쓰는 대역. 없으면 client마다 기본 대역을 만든다.
  standIn?: SecretClient;
};

export function createSecretClient(deps: SecretClientDeps = {}): SecretClient {
  const standIn = deps.standIn ?? createSecretStandIn();
  return {
    async use(request) {
      check(request);
      const host = deps.host ?? readHost();
      if (!host) throw missingHost();
      if (host.mode !== "live") return await standIn.use(request);
      const context = host.call();
      if (!context) throw outsideCommand();
      if (context.release === null) {
        throw invalid("secret use needs a live release");
      }
      const requested = {
        permission: "secret.use",
        scope: { name: request.name },
      };
      let response;
      try {
        response = await host.post(SECRETS_USE_PATH, {
          release: context.release,
          invocation: context.invocation,
          command: context.command,
          input_hash: context.inputHash,
          name: request.name,
          destination: {
            scheme: isLoopback(request.destination.host) ? "http" : "https",
            host: request.destination.host,
            port: request.destination.port,
          },
        });
      } catch {
        // 전송 중에 끊기면 값이 붙은 요청이 나갔는지 모른다. 다시 부르지 않는다.
        throw new CapabilityError({
          code: "unavailable",
          message: "secret use could not reach the broker",
          outcome: "unknown",
        });
      }
      if (response.status !== 200) {
        const failure = fromBroker(response.body, requested);
        throw failure.code === "unavailable"
          ? new CapabilityError({
            code: failure.code,
            message: failure.message,
            outcome: "unknown",
          })
          : failure;
      }
      const used = (response.body as { used?: unknown } | null)?.used;
      if (used !== true) {
        throw new CapabilityError({
          code: "unavailable",
          message: "broker answered with an unknown shape",
        });
      }
      return { used: true };
    },
  };
}

// 앱 코드가 쓰는 기본 client다. host는 호출할 때 읽는다.
const shared = createSecretClient();

export function useSecret(request: SecretUseRequest): Promise<SecretUseResult> {
  return shared.use(request);
}
