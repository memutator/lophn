// coding connection credential의 OS keychain 준비·읽기·정리(platform/secrets#R12).
// 앱 secret·provider 인증과 용도가 다르다. 위치는 connection에서 정해지는 고정 참조 하나라서
// 읽는 쪽이 ledger 표나 다른 secret 이름 공간을 거치지 않는다. 원문은 이 module의 호출 인자와
// keychain에만 있고 오류·log에는 참조도 값도 싣지 않는다. 평문 파일·환경 변수 fallback은 없다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  CREDENTIAL_DELIVERY_TIMEOUT_MS,
  type CredentialDeliveryFailure,
} from "../../contracts/coding-agent/mod.ts";
import { connectionIdSchema } from "../../contracts/coding-agent/mod.ts";
import type { KeychainAdapter } from "./adapters/keychain.ts";

export const CODING_CREDENTIAL_PURPOSE = "coding_connection_credential";

const REF_PREFIX = "coding-agent/";

// 고정 위치는 connection id 하나에서만 정해진다. 다른 용도의 참조는 이 이름 공간에 없다.
export function codingCredentialRef(connection: string): string | undefined {
  const parsed = connectionIdSchema.safeParse(connection);
  return parsed.success ? `${REF_PREFIX}${parsed.data}` : undefined;
}

export type CodingCredentialKeychain = {
  // 값을 keychain에 둔다. 이미 있는 위치는 덮지 않는다. 잠김·보관 실패는 unavailable이다.
  prepare(connection: string, token: string): Promise<Result<void>>;
  // 보호 전달이 쓴다. 실패 이유는 계약의 네 가지 중 하나다.
  read(
    connection: string,
  ): Promise<Result<string, CredentialDeliveryFailure>>;
  // 실제로 지워진 것을 확인한 경우만 ok다. 없는 것은 not_found다.
  discard(connection: string): Promise<Result<void>>;
  // 고정 위치 이름 공간에 있는 connection id 목록. 값은 내지 않는다. 시작 때 고아를 찾는 데 쓴다.
  list(): Promise<Result<readonly string[]>>;
};

function invalid(): Result<never> {
  return err({
    code: "invalid_input",
    message: "connection 참조가 올바르지 않다",
  });
}

function unavailable(): Result<never> {
  return err({
    code: "unavailable",
    message: "OS keychain을 사용할 수 없다",
  });
}

// keychain 오류가 잠김을 알리면 locked, 그 밖의 사용 불가는 secret service 없음이다.
function failureOf(
  error: { code: string; details?: Record<string, unknown> },
): CredentialDeliveryFailure {
  if (error.code === "not_found") return "not_found";
  return error.details?.reason === "locked" ? "locked" : "no_secret_service";
}

export function createCodingCredentialKeychain(options: {
  keychain: KeychainAdapter;
  timeoutMs?: number;
}): CodingCredentialKeychain {
  const timeoutMs = options.timeoutMs ?? CREDENTIAL_DELIVERY_TIMEOUT_MS;
  return {
    async prepare(connection, token) {
      const ref = codingCredentialRef(connection);
      if (ref === undefined || token.length === 0) return invalid();
      if (await options.keychain.status() !== "available") {
        return unavailable();
      }
      const existing = await options.keychain.load(ref);
      if (existing.ok) {
        existing.value.fill(0);
        return err({
          code: "conflict",
          message: "이미 준비된 credential 위치다",
        });
      }
      if (existing.error.code !== "not_found") return unavailable();
      const stored = await options.keychain.store({
        name: connection,
        purpose: CODING_CREDENTIAL_PURPOSE,
        owner: `coding_agent:${connection}`,
        value: new TextEncoder().encode(token),
        ref,
      });
      return stored.ok ? ok(undefined) : unavailable();
    },
    async read(connection) {
      const ref = codingCredentialRef(connection);
      if (ref === undefined) return err("not_found");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<Result<string, CredentialDeliveryFailure>>(
        (resolve) => {
          timer = setTimeout(() => resolve(err("timeout")), timeoutMs);
        },
      );
      const read = (async (): Promise<
        Result<string, CredentialDeliveryFailure>
      > => {
        try {
          if (await options.keychain.status() !== "available") {
            return err("no_secret_service");
          }
          const loaded = await options.keychain.load(ref);
          if (!loaded.ok) return err(failureOf(loaded.error));
          const text = new TextDecoder().decode(loaded.value).replace(
            /\n$/,
            "",
          );
          loaded.value.fill(0);
          return text.length === 0 ? err("not_found") : ok(text);
        } catch {
          return err("no_secret_service");
        }
      })();
      try {
        return await Promise.race([read, timeout]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    async list() {
      if (options.keychain.listRefs === undefined) return unavailable();
      if (await options.keychain.status() !== "available") {
        return unavailable();
      }
      const refs = await options.keychain.listRefs(
        CODING_CREDENTIAL_PURPOSE,
        REF_PREFIX,
      );
      if (!refs.ok) return unavailable();
      const ids = refs.value.map((ref) => ref.slice(REF_PREFIX.length)).filter((
        id,
      ) => connectionIdSchema.safeParse(id).success);
      return ok(ids);
    },
    async discard(connection) {
      const ref = codingCredentialRef(connection);
      if (ref === undefined) return invalid();
      return await options.keychain.remove(ref);
    },
  };
}
