// 종류 테스트의 가짜 core. route별 답을 정하고 부른 것을 모두 남긴다.
import type { LiveHandle } from "../handle.ts";
import type { Called, KindCore } from "./core.ts";

export interface Call {
  kind: string;
  resource: string;
  method: string;
  body: unknown;
  bytes?: Uint8Array;
}

export function fakeCore(
  answers: Record<string, (body: unknown) => Called>,
): KindCore & { calls: Call[] } {
  const calls: Call[] = [];
  const answer = (key: string, body: unknown): Called => {
    const found = answers[key];
    return found === undefined
      ? { ok: false, error: { code: "not_found", message: `no ${key}` } }
      : found(body);
  };
  return {
    calls,
    internal(kind, resource, method, body) {
      calls.push({ kind, resource, method, body });
      return Promise.resolve(answer(`${kind}:${resource}/${method}`, body));
    },
    upload(resource, method, input, bytes) {
      // 나중에 지워져도 테스트가 보낸 순간의 바이트를 본다.
      calls.push({
        kind: "upload",
        resource,
        method,
        body: input,
        bytes: bytes.slice(),
      });
      return Promise.resolve(answer(`upload:${resource}/${method}`, input));
    },
  };
}

export function ok(value: unknown): Called {
  return { ok: true, value };
}

export function handle(windowId = "cfw_1"): LiveHandle {
  return {
    ref: "H".repeat(43),
    windowId,
    displayId: "dsp_1",
    targetRef: "t",
    contentHash: "c".repeat(64),
    allowed: [],
    epoch: "e",
    expiresAtMs: Number.MAX_SAFE_INTEGER,
    spent: false,
    unknown: false,
  };
}

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";

export function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}
