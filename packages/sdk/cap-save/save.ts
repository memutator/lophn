// 앱이 선언한 문서 key에 새 version을 저장하는 client다(apps/sdk#R30). 문서 place는 고르지
// 못한다. broker가 호출한 앱 자리의 (앱 자리, key)로만 보내고 기대 version 충돌과 재전송 중복은
// documents/versions가 판정한다.
import {
  CapabilityError,
  fromBroker,
  missingHost,
  outsideCommand,
} from "./errors.ts";
import { type CapHost, readHost } from "./host.ts";

export const DOCUMENTS_SAVE_PATH = "/_lophn/broker/documents/save";

export const SAVE_RETRIES = 2;
export const SAVE_RETRY_DELAYS_MS: readonly number[] = [200, 400];

export type SaveRequest = {
  // blueprint documents[].key로 선언하고 document.save grant를 받은 key다.
  key: string;
  // 이 저장이 이어받는 version이다. 첫 저장이면 null이다.
  baseVersion: string | null;
  // 같은 저장을 다시 보낼 때 같은 값이다. 같은 값은 version을 하나만 만든다.
  idempotencyKey: string;
};

export type SaveResult = {
  saved: boolean;
  version: string | null;
  // 실제 documents 저장 없이 대역이 답했다는 표시다.
  standIn?: true;
};

export type SaveClient = {
  save(request: SaveRequest): Promise<SaveResult>;
};

function invalid(message: string): CapabilityError {
  return new CapabilityError({ code: "invalid_input", message });
}

function check(request: SaveRequest): void {
  if (
    typeof request.key !== "string" || request.key.trim().length === 0 ||
    /\p{Cc}/u.test(request.key)
  ) {
    throw invalid("document key cannot be blank or contain controls");
  }
  if (request.baseVersion !== null && typeof request.baseVersion !== "string") {
    throw invalid("baseVersion must be a version id or null");
  }
  if (
    typeof request.idempotencyKey !== "string" ||
    request.idempotencyKey.length === 0
  ) {
    throw invalid("idempotencyKey is required");
  }
}

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function versionId(counter: number): string {
  let rest = counter;
  let tail = "";
  while (tail.length < 26) {
    tail = ALPHABET[rest % 32] + tail;
    rest = Math.floor(rest / 32);
  }
  return `ver_${tail}`;
}

// preview·test의 문서 대역이다. broker·documents에 나가지 않고 같은 규칙(기대 version 충돌,
// 같은 재전송 key는 같은 결과)을 메모리에서 지킨다.
export function createSaveStandIn(): SaveClient & {
  readonly versions: ReadonlyMap<string, readonly string[]>;
} {
  const versions = new Map<string, string[]>();
  const retries = new Map<string, SaveResult>();
  let counter = 0;
  return {
    versions,
    save(request) {
      try {
        check(request);
      } catch (error) {
        return Promise.reject(error);
      }
      const retry = `${request.key}\u0000${request.idempotencyKey}`;
      const known = retries.get(retry);
      if (known) return Promise.resolve(known);
      const kept = versions.get(request.key) ?? [];
      const latest = kept.at(-1) ?? null;
      if (request.baseVersion !== latest) {
        return Promise.reject(
          new CapabilityError({
            code: "conflict",
            message: "baseVersion is not the latest version of this document",
          }),
        );
      }
      counter += 1;
      const version = versionId(counter);
      versions.set(request.key, [...kept, version]);
      const result: SaveResult = { saved: true, version, standIn: true };
      retries.set(retry, result);
      return Promise.resolve(result);
    },
  };
}

export type SaveClientDeps = {
  host?: CapHost;
  sleep?: (ms: number) => Promise<void>;
  // live가 아닌 mode에서 쓰는 대역. 없으면 client마다 기본 대역을 만든다.
  standIn?: SaveClient;
};

export function createSaveClient(deps: SaveClientDeps = {}): SaveClient {
  const sleep = deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const standIn = deps.standIn ?? createSaveStandIn();
  return {
    async save(request) {
      check(request);
      const host = deps.host ?? readHost();
      if (!host) throw missingHost();
      if (host.mode !== "live") return await standIn.save(request);
      if (!host.call()) throw outsideCommand();
      const body = {
        key: request.key,
        base_version: request.baseVersion,
        idempotency_key: request.idempotencyKey,
      };
      const requested = {
        permission: "document.save",
        scope: { key: request.key },
      };
      // 같은 idempotency key로 다시 보내므로 재시도가 version을 둘 만들지 않는다.
      let last: CapabilityError | undefined;
      for (let attempt = 0; attempt <= SAVE_RETRIES; attempt += 1) {
        if (attempt > 0) {
          await sleep(SAVE_RETRY_DELAYS_MS[attempt - 1] ?? 0);
        }
        let response;
        try {
          response = await host.post(DOCUMENTS_SAVE_PATH, body);
        } catch {
          last = new CapabilityError({
            code: "unavailable",
            message:
              "document save could not reach the broker; send the same request again with the same idempotencyKey",
            outcome: "unknown",
          });
          continue;
        }
        if (response.status === 200) {
          const answer = response.body as
            | { saved?: unknown; version?: unknown }
            | null;
          if (
            answer === null || typeof answer !== "object" ||
            typeof answer.saved !== "boolean" ||
            (answer.version !== null && typeof answer.version !== "string")
          ) {
            throw new CapabilityError({
              code: "unavailable",
              message: "broker answered with an unknown shape",
            });
          }
          return { saved: answer.saved, version: answer.version };
        }
        const failure = fromBroker(response.body, requested);
        if (failure.code !== "unavailable") throw failure;
        last = new CapabilityError({
          code: "unavailable",
          message:
            `${failure.message}; send the same request again with the same idempotencyKey`,
          outcome: "unknown",
        });
      }
      throw last as CapabilityError;
    },
  };
}

// 앱 코드가 쓰는 기본 client다. host는 호출할 때 읽는다.
const shared = createSaveClient();

export function saveDocument(request: SaveRequest): Promise<SaveResult> {
  return shared.save(request);
}
