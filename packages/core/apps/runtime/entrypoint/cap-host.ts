// cap-net·cap-secret·cap-save·cap-store가 앱 프로세스 host에 닿는 전역 port다. SDK는 packages/core/apps를
// import하지 않아서 두 쪽이 같은 symbol과 모양으로 맞춘다(packages/sdk/cap-net/host.ts). 자식 credential과
// process nonce는 이 port 안에만 있고 앱 코드와 SDK는 보지 못한다. 이 port가 없으면 capability는
// unavailable이다(apps/sdk#R22–R32).
import { createHash } from "node:crypto";
import { canonicalJson } from "../../blueprint/mod.ts";
import type { JsonValue } from "../../blueprint/mod.ts";
import type { InvocationContext } from "../../invocations/mod.ts";
import type { BrokerResponse } from "./broker-client.ts";

export const CAP_HOST = Symbol.for("lophn.cap-host");

export type CapHostPort = {
  mode: "live" | "preview" | "test";
  // cap-store가 읽는 앱 data 영역(시작 입력의 data_path)이다.
  dataPath: string;
  post(
    path: string,
    body: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<BrokerResponse>;
  // 지금 실행 중인 command 호출의 문맥이다. 호출 밖(시작 코드 등)이면 null이다.
  call(): {
    command: string;
    inputHash: string;
    release: string | null;
    invocation: string | null;
  } | null;
};

// 정규 입력의 sha256이다. 호출 경계는 이미 입력을 검증하고 default를 채웠고, 입력이 없으면 정규 JSON
// null이다. blueprint의 `canonicalInputHash`와 같은 값이다.
export function inputHashOf(input: unknown): string {
  return createHash("sha256").update(
    canonicalJson(input === undefined ? null : input as JsonValue),
  ).digest("hex");
}

function aborted(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

export function createCapHost(deps: {
  mode: CapHostPort["mode"];
  dataPath: string;
  post(path: string, body: unknown): Promise<BrokerResponse>;
  current(): InvocationContext | null;
}): CapHostPort {
  return {
    mode: deps.mode,
    dataPath: deps.dataPath,
    post(path, body, options) {
      const signal = options?.signal;
      if (signal?.aborted) return Promise.reject(aborted(signal));
      const request = deps.post(path, body);
      if (signal === undefined) return request;
      // transport는 도중에 끊을 수 없다. 앱 쪽 기다림만 중단하고 이미 간 요청의 결과는 버린다.
      return new Promise<BrokerResponse>((resolve, reject) => {
        const onAbort = () => reject(aborted(signal));
        signal.addEventListener("abort", onAbort, { once: true });
        request.then(resolve, reject).finally(() =>
          signal.removeEventListener("abort", onAbort)
        );
      });
    },
    call() {
      const context = deps.current();
      if (
        context === null || context.command === undefined ||
        context.command === null || context.inputHash === undefined ||
        context.inputHash === null
      ) return null;
      return {
        command: context.command,
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
