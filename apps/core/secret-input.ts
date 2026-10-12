// 보호 입력의 core 쪽 길(platform/secrets#R1, R2, 계획 Q7). 사람의 보호 입력창이 보낸 값의
// 바이트는 `/v1/secrets/input` upload route로 와서 이 중계를 지나 I/O worker의 `secret.prepare`
// pipe로만 간다. 지키는 것:
// - core는 값을 해석·hash·보관하지 않는다. 받은 chunk를 그대로 worker로 넘기고 이어 붙이지
//   않는다. 요청 JSON(용도·owner)에도, 응답에도, 오류·log에도 값이 없다.
// - 값은 worker의 keychain adapter에만 간다. core와 ledger가 보는 것은 값 없는 준비 증거
//   (SecretPreparation: preparation·sealed_ref·purpose·owner)뿐이다.
// - 준비 증거는 core의 writer가 ledger에 남긴다(I/O worker는 ledger를 쓰지 않는다). 남기지
//   못하면 준비는 실패다.
// - 순서는 byte chunk(worker가 channel별로 받아 둔다)가 먼저고 worker_request가 나중이다.
//   중간에 끊기면 abort로 worker가 받아 둔 chunk를 비우게 한다.
import {
  err,
  type ErrorCode,
  ok,
  type Result,
} from "../../packages/base/mod.ts";
import {
  type ChildMessage,
  SECRET_INPUT_MAX_BYTES,
  SECRET_PREPARE_OP,
  secretInput,
  type SecretPreparation,
  secretPreparationSchema,
  STREAM_CHUNK_MAX_BYTES,
} from "../../packages/protocol/server/mod.ts";
import type { UploadHandler } from "../../packages/core/server/mod.ts";

// I/O worker의 응답을 기다리는 시간. keychain 잠금 해제 같은 사람 상호작용은 이 안에 없다.
export const SECRET_INPUT_RESPONSE_MS = 30_000;

// blob 준비 중계가 쓰는 channel(1..0x7fffffff)과 겹치지 않는 구간이다.
const CHANNEL_BASE = 0x80000000;
const CHANNEL_END = 0xffffffff;

export type SecretInputRelayDeps = {
  // I/O worker에 worker_request json frame을 쓴다.
  send(payload: unknown): Promise<void>;
  sendBytes(channel: number, chunk: Uint8Array): Promise<void>;
  sendAbort(channel: number): Promise<void>;
  // 값 없는 준비 증거를 writer가 ledger에 남긴다.
  record(preparation: SecretPreparation): Promise<Result<void>>;
  responseMs?: number;
};

export type SecretInputRelay = {
  prepare(
    input: { purpose: SecretPreparation["purpose"]; owner: string },
    bytes: ReadableStream<Uint8Array>,
  ): Promise<Result<SecretPreparation>>;
  // worker→core worker_response. 기다리는 요청이 없는 응답은 버린다.
  accept(message: ChildMessage): void;
  // I/O worker가 끝났다. 응답을 기다리던 준비는 기한(30초)까지 기다리지 않고 바로 unavailable이다.
  failPending(message: string): void;
};

type Answer =
  | { ok: true; payload: unknown }
  | { ok: false; error: { code: ErrorCode; message: string } };

// worker_request에 실리는 신뢰 context. 호출한 사람의 credential을 빌리지 않고 core가 이 한
// 입구에 대해서만 만든다(secretAdapterContextSchema: machine·process·task).
const ADAPTER_CONTEXT = {
  principal: "machine:secret-input",
  actor: "machine" as const,
  scope: { operations: [SECRET_PREPARE_OP], targets: {} },
  conditions: { process: "platform/io", task: "secret-input" },
  credential_ref: "machine:secret-input",
};

const UNAVAILABLE = (message: string) =>
  err({ code: "unavailable" as const, message });

export function createSecretInputRelay(
  deps: SecretInputRelayDeps,
): SecretInputRelay {
  const responseMs = deps.responseMs ?? SECRET_INPUT_RESPONSE_MS;
  let counter = CHANNEL_BASE - 1;
  const waiting = new Map<string, (answer: Answer) => void>();

  function nextChannel(): number {
    counter = counter >= CHANNEL_END ? CHANNEL_BASE : counter + 1;
    return counter;
  }

  async function prepare(
    input: { purpose: SecretPreparation["purpose"]; owner: string },
    bytes: ReadableStream<Uint8Array>,
  ): Promise<Result<SecretPreparation>> {
    const channel = nextChannel();
    const requestId = `secret-prepare-${channel}-${crypto.randomUUID()}`;
    const reader = bytes.getReader();
    let sent = 0;
    let requested = false;
    const abort = async () => {
      if (requested) return;
      requested = true;
      await deps.sendAbort(channel).catch(() => {});
    };
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        sent += next.value.length;
        if (sent > SECRET_INPUT_MAX_BYTES) {
          await reader.cancel().catch(() => {});
          await abort();
          return err({
            code: "invalid_input",
            message: "보호 입력이 너무 크다",
          });
        }
        for (
          let offset = 0;
          offset < next.value.length;
          offset += STREAM_CHUNK_MAX_BYTES
        ) {
          await deps.sendBytes(
            channel,
            next.value.subarray(offset, offset + STREAM_CHUNK_MAX_BYTES),
          );
        }
      }
      if (sent === 0) {
        return err({ code: "invalid_input", message: "보호 입력 값이 없다" });
      }
      const answered = new Promise<Answer>((resolve) => {
        waiting.set(requestId, resolve);
      });
      await deps.send({
        type: "worker_request",
        request_id: requestId,
        op: SECRET_PREPARE_OP,
        channel,
        payload: {
          context: ADAPTER_CONTEXT,
          purpose: input.purpose,
          owner: input.owner,
        },
      });
      // 요청이 worker에 닿았다. 이제 worker가 받아 둔 chunk를 쓴다.
      requested = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), responseMs);
      });
      const answer = await Promise.race([answered, timeout]).finally(() =>
        clearTimeout(timer)
      );
      if (answer === "timeout") {
        return UNAVAILABLE("보호 입력 응답이 없다");
      }
      if (!answer.ok) return err(answer.error);
      const parsed = secretPreparationSchema.safeParse(answer.payload);
      if (
        !parsed.success || parsed.data.purpose !== input.purpose ||
        parsed.data.owner !== input.owner
      ) {
        return err({
          code: "internal",
          message: "보호 입력 결과가 요청과 다르다",
        });
      }
      const recorded = await deps.record(parsed.data);
      if (!recorded.ok) return recorded;
      return ok(parsed.data);
    } catch {
      await reader.cancel().catch(() => {});
      await abort();
      return UNAVAILABLE("보호 입력을 넘기지 못했다");
    } finally {
      waiting.delete(requestId);
      try {
        reader.releaseLock();
      } catch { /* 읽기가 아직 끝나지 않은 stream */ }
    }
  }

  return {
    prepare,
    failPending(message) {
      for (const [id, resolve] of [...waiting]) {
        waiting.delete(id);
        resolve({ ok: false, error: { code: "unavailable", message } });
      }
    },
    accept(message) {
      if (message.type !== "worker_response") return;
      const resolve = waiting.get(message.request_id);
      if (resolve === undefined) return;
      waiting.delete(message.request_id);
      resolve(
        message.ok
          ? { ok: true, payload: message.payload }
          : { ok: false, error: message.error },
      );
    },
  };
}

// `/v1/secrets/input` handler. 선언한 크기와 body가 같을 때만 흘린다. 중계가 아직 없으면
// (I/O worker가 뜨기 전) unavailable이다.
export function secretInputHandler(relay: {
  current?: SecretInputRelay;
}): UploadHandler {
  return (_ctx, rawInput, body) => {
    const input = secretInput.input.safeParse(rawInput);
    if (
      !input.success ||
      (body.length !== undefined && input.data.bytes !== body.length)
    ) {
      body.bytes.cancel().catch(() => {});
      return Promise.resolve(err({
        code: "invalid_input",
        message: "secret input does not match the body",
      }));
    }
    const current = relay.current;
    if (current === undefined) {
      body.bytes.cancel().catch(() => {});
      return Promise.resolve(UNAVAILABLE("보호 입력 통로가 아직 없다"));
    }
    const mismatch = { value: false };
    let total = 0;
    const counted = body.bytes.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          total += chunk.byteLength;
          if (total > input.data.bytes) {
            mismatch.value = true;
            throw new Error("body longer than declared");
          }
          controller.enqueue(chunk);
        },
        flush() {
          if (total !== input.data.bytes) {
            mismatch.value = true;
            throw new Error("body shorter than declared");
          }
        },
      }),
    );
    return current.prepare(
      { purpose: input.data.purpose, owner: input.data.owner },
      counted,
    ).then((prepared) =>
      !prepared.ok && mismatch.value
        ? err({
          code: "invalid_input" as const,
          message: "secret input does not match the body",
        })
        : prepared
    );
  };
}
