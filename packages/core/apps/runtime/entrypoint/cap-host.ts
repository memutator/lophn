// cap-net·cap-notify·cap-secret·cap-store가 앱 프로세스 host에 닿는 전역 port다. SDK는
// packages/core/apps를 import하지 않아서 두 쪽이 같은 symbol과 모양으로 맞춘다(packages/sdk/cap-net/host.ts).
// 자식 credential과 process nonce는 이 port 안에만 있고 앱 코드와 SDK는 보지 못한다. 이 port가 없으면
// capability는 unavailable이다.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import {
  type Migration,
  migrationOfSql,
} from "../../../../protocol/apps/activation/migration-sql.ts";
import { canonicalJson } from "../../../../protocol/apps/declaration/mod.ts";
import type { JsonValue } from "../../../../protocol/apps/declaration/mod.ts";
import type { InvocationContext } from "../../invocations/context.ts";
import type { BrokerResponse } from "./broker-client.ts";

const CAP_HOST = Symbol.for("lophn.cap-host");
// cap-store가 설치하는 changeset 훅이다(packages/sdk/cap-store/host.ts의 STORE_HOOKS와 같다).
const STORE_HOOKS = Symbol.for("lophn.cap-store");

type ApplyOutcome = { ok: true } | { ok: false; message: string };

type StoreHooks = {
  beginChangeset(): void;
  endChangeset(): Uint8Array | null;
  applyChangesets(changesets: readonly Uint8Array[]): ApplyOutcome;
};

// runtime이 쓰는 앱 DB의 changeset 접근이다. 앱 시작처럼 SDK가 load되기 전에 session 구간이 시작될 수
// 있어서 구간 여부(recording)를 여기서 들고, cap-store는 연결을 열 때 그것을 본다.
export type StoreAccess = {
  recording(): boolean;
  begin(): void;
  end(): Uint8Array | null;
  apply(changesets: readonly Uint8Array[]): ApplyOutcome;
};

export function createStoreAccess(): StoreAccess {
  let recording = false;
  const hooks = () =>
    (globalThis as Record<symbol, unknown>)[STORE_HOOKS] as
      | StoreHooks
      | undefined;
  return {
    recording: () => recording,
    begin() {
      recording = true;
      hooks()?.beginChangeset();
    },
    end() {
      recording = false;
      return hooks()?.endChangeset() ?? null;
    },
    apply(changesets) {
      const found = hooks();
      if (found) return found.applyChangesets(changesets);
      // cap-store를 load하지 않은 앱은 DB가 없다.
      return changesets.length === 0
        ? { ok: true }
        : { ok: false, message: "app database is not available" };
    },
  };
}

export function encodeChangeset(bytes: Uint8Array | null): string | null {
  return bytes === null ? null : Buffer.from(bytes).toString("base64");
}

export function decodeChangeset(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64"));
}

type CapHostPort = {
  mode: "live" | "preview";
  // cap-store가 읽는 앱 data 영역(시작 입력의 data_path)이다.
  dataPath: string;
  store: {
    recording(): boolean;
    migrations(): { target: number; steps: Migration[] };
  };
  post(
    path: string,
    body: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<BrokerResponse>;
  // 지금 실행 중인 호출의 문맥이다. 호출 밖(시작 코드 등)이면 null이다. `command`는 broker 요청이
  // 쓰는 이름이고 handler 이름(operation이든 command든)이다.
  call(): {
    command: string;
    inputHash: string;
    release: string | null;
    invocation: string | null;
  } | null;
};

// 정규 입력의 sha256이다. 호출 경계는 이미 입력을 검증하고 default를 채웠고, 입력이 없으면 정규 JSON
// null이다. 선언의 `canonicalInputHash`와 같은 값이다.
export function inputHashOf(input: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(input === undefined ? null : (input as JsonValue)))
    .digest("hex");
}

function aborted(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

// bundle의 `migrations/<from>-<to>.sql`을 단계로 읽는다. 앱이 `store.migrate()`를 인자 없이 부를 때(preview) 쓴다.
// target은 bundle의 data schema(가장 큰 `to`)다. live는 schema를 바꾸지 않으므로 이미 target이다.
export function bundleMigrations(
  bundleDir: string,
  target: number,
): { target: number; steps: Migration[] } {
  const steps: Migration[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(`${bundleDir}/migrations`);
  } catch {
    // migrations 폴더가 없으면 DB를 쓰지 않는 앱이다.
  }
  for (const name of names) {
    const match = /^(\d+)-(\d+)\.sql$/.exec(name);
    if (!match) continue;
    const step = migrationOfSql(
      Number(match[1]),
      Number(match[2]),
      readFileSync(`${bundleDir}/migrations/${name}`, "utf8"),
    );
    if (!step.ok) throw new Error(`${name}: ${step.error.message}`);
    steps.push(step.value);
  }
  return { target, steps };
}

export function createCapHost(deps: {
  mode: CapHostPort["mode"];
  dataPath: string;
  store: StoreAccess;
  migrations(): { target: number; steps: Migration[] };
  post(path: string, body: unknown): Promise<BrokerResponse>;
  current(): InvocationContext | null;
}): CapHostPort {
  return {
    mode: deps.mode,
    dataPath: deps.dataPath,
    store: {
      recording: () => deps.store.recording(),
      migrations: () => deps.migrations(),
    },
    post(path, body, options) {
      const signal = options?.signal;
      if (signal?.aborted) return Promise.reject(aborted(signal));
      const request = deps.post(path, body);
      if (signal === undefined) return request;
      // transport는 도중에 끊을 수 없다. 앱 쪽 기다림만 중단하고 이미 간 요청의 결과는 버린다.
      return new Promise<BrokerResponse>((resolve, reject) => {
        const onAbort = () => reject(aborted(signal));
        signal.addEventListener("abort", onAbort, { once: true });
        request
          .then(resolve, reject)
          .finally(() => signal.removeEventListener("abort", onAbort));
      });
    },
    call() {
      const context = deps.current();
      if (
        context === null ||
        context.name === undefined ||
        context.name === null ||
        context.inputHash === undefined ||
        context.inputHash === null
      )
        return null;
      return {
        command: context.name,
        inputHash: context.inputHash,
        release: context.release,
        invocation: context.invocation,
      };
    },
  };
}

// 앱 프로세스마다 시작 입력은 하나라 한 번만 설치한다.
export function installCapHost(port: CapHostPort): void {
  (globalThis as Record<symbol, unknown>)[CAP_HOST] = port;
}
