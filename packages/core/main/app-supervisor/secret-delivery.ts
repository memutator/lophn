// 앱의 `secrets/use`를 받으면 core에서 값을 받아 메모리에 두고, 같은 invocation의 net/fetch가 그 목적지로
// 보낼 때 Authorization으로 붙인다. 값은 앱 응답·오류·log에 나가지 않고 이 map 밖에 복사본이 없다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { appsSecretValue } from "../../../protocol/apps/mod.ts";
import type {
  RedactionGate,
  SecretDelivery,
} from "../../apps/permissions/mod.ts";

// invocation이 끝났음을 supervisor가 알 자리가 없어서 값마다 만료를 둔다. 그 안에서도 다른 invocation·
// 다른 목적지에는 붙지 않는다.
const SECRET_TTL_MS = 60_000;

// core는 값을 내보내기 전에 알려진 값 registry에 이미 등록하고(`apps.secret_value`), 모르면 값을 주지 않는다.
// supervisor 쪽에는 따로 등록할 것이 없다.
export const registeredByCore: RedactionGate = { ensure: () => ok(undefined) };

export function createSecretDelivery(deps: {
  // supervisor의 machine credential로 core route를 부른다.
  core: (path: string, body: unknown) => Promise<Result<unknown>>;
  nowMs: () => number;
}): SecretDelivery {
  const values = new Map<string, { value: string; expires: number }>();
  const keyOf = (invocation: string, host: string, port: number) =>
    `${invocation}|${host}|${port}`;
  return {
    async use(request) {
      if (request.invocation === null) {
        return err({
          code: "invalid_input",
          message: "secret use needs a running command to attach the value to",
        });
      }
      const answered = await deps.core(
        `${appsSecretValue.resource}/${appsSecretValue.method}`,
        {
          app: request.app,
          release: request.release,
          process_nonce: request.processNonce,
          invocation: request.invocation,
          name: request.name,
          destination: request.destination,
        },
      );
      if (!answered.ok) return answered;
      const parsed = appsSecretValue.output.safeParse(answered.value);
      if (!parsed.success) {
        return err({
          code: "unavailable",
          message: "core answered the secret value badly",
        });
      }
      const now = deps.nowMs();
      for (const [key, held] of values) {
        if (held.expires <= now) values.delete(key);
      }
      const { host, port } = request.destination;
      values.set(keyOf(request.invocation, host, port), {
        value: parsed.data.value,
        expires: now + SECRET_TTL_MS,
      });
      return ok({ sent: true });
    },
    attached(invocation, host, port) {
      const key = keyOf(invocation, host, port);
      const held = values.get(key);
      if (held === undefined) return undefined;
      if (held.expires <= deps.nowMs()) {
        values.delete(key);
        return undefined;
      }
      return held.value;
    },
  };
}
