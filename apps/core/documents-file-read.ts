// `files.read`를 core가 stream으로 서빙하는 조립(documents#T12). 현재 디스크 파일을 한 JSON
// frame에 싣지 않는다: 헤더(hash·크기·identity)를 먼저 받고, 본문은 창(256 KiB) 하나씩
// coordinator에 요청해 byte chunk frame으로 받고, 소비자(HTTP 응답)가 당길 때만 다음 창을
// 요청한다(backpressure, core 메모리는 열린 창 하나). 읽는 동안 sha256을 이어 갱신하고, 끝에서
// 크기·hash가 헤더와 다르면 마지막 창을 보내지 않고 응답을 오류로 끝낸다(#289의
// `storedFileStreams`와 같은 규칙). 창마다 준비 worker가 파일 identity를 다시 보므로 읽는
// 사이 파일이 바뀌면 일부 바이트로 꾸미지 않고 오류다. 상한은 문서 upload 상한이다.
import { createHash } from "node:crypto";
import {
  err,
  ERROR_CODES,
  type ErrorCode,
  ok,
  type Result,
  sha256Hex,
} from "../../packages/base/mod.ts";
import {
  filesRead,
  type FileTarget,
} from "../../packages/protocol/projects/mod.ts";
import {
  DOCUMENT_OPS,
  type WorkingCopyCheck,
} from "../../packages/core/projects/file-tracking/mod.ts";
import {
  FILE_WINDOW_MAX_BYTES,
  fileIdentitySchema,
} from "../../packages/core/projects/file-tracking/file-ipc.ts";
import type { AuthenticatedContext } from "../../packages/protocol/server/mod.ts";
import type { FileStreamHandler } from "../../packages/core/server/mod.ts";
import type { FileWindows } from "./documents-file-windows.ts";
import { STORED_FILE_MAX_BYTES } from "./documents-serving.ts";
import { z } from "zod";

export type FileReadDeps = {
  // documents coordinator 요청 통로.
  request(
    op: string,
    payload: unknown,
    timeoutMs?: number,
  ): Promise<Result<unknown>>;
  // coordinator 감독 pipe가 묶여 있는지.
  bound(): boolean;
  windows: FileWindows;
  // 요청 credential이 아직 현재인지(창마다 다시 본다).
  current(credentialRef: string): { ok: boolean };
  // working copy 목표의 문서 근거. 요청 credential로 reader Worker의 snapshot을 읽는다.
  copyCheck(
    ctx: AuthenticatedContext,
    document: string,
  ): Promise<Result<WorkingCopyCheck>>;
};

const READ_TIMEOUT_MS = 15_000;

const headerSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  size_bytes: z.number().int().min(0),
  identity: fileIdentitySchema,
});

function workerCode(code: string): ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code)
    ? code as ErrorCode
    : "internal";
}

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

// 범위 밖·없는 대상·허용하지 않는 종류는 같은 답이다(존재를 새지 않는다).
function notAvailable(): Result<never> {
  return err({ code: "invalid_input", message: "target is not available" });
}

export function fileReadStreams(
  deps: FileReadDeps,
): Map<string, FileStreamHandler> {
  const key = `${filesRead.resource}/${filesRead.method}`;
  return new Map([[key, async (ctx, input) => {
    const parsed = filesRead.input.safeParse(input);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid input" });
    }
    const target: FileTarget = parsed.data.target;
    if (!deps.bound()) return unavailable("documents worker is not ready");
    if (target.kind === "working_copy") {
      // working copy 목표는 core가 ledger에서 본 원본 없는 활성 문서에만 닿는다.
      const checked = await deps.copyCheck(ctx, target.document);
      if (!checked.ok) {
        return err({
          code: workerCode(checked.error.code),
          message: "failed",
        });
      }
      if (!checked.value.eligible) return notAvailable();
    } else if (
      target.kind !== "project_file" && target.kind !== "instruction_file"
    ) {
      // 지침 파일은 coordinator가 exact 등록과 맞춰 본다(file-tracking#R19).
      return notAvailable();
    }
    const opened = await deps.request(
      DOCUMENT_OPS.fileRead,
      { target },
      READ_TIMEOUT_MS,
    );
    if (!opened.ok) {
      return err({ code: workerCode(opened.error.code), message: "failed" });
    }
    const header = headerSchema.safeParse(opened.value);
    if (!header.success) return unavailable("file header is invalid");
    const { hash, size_bytes: size, identity } = header.data;
    if (size > STORED_FILE_MAX_BYTES) {
      return unavailable("file exceeds the serving limit");
    }
    const contentType = "application/octet-stream";
    if (size === 0) {
      if (await sha256Hex(new Uint8Array()) !== hash) {
        return unavailable("file bytes do not match");
      }
      return ok({
        contentType,
        length: 0,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        }),
      });
    }
    const digest = createHash("sha256");
    let offset = 0;
    // 다음 창 하나를 요청해 받고 검사한다. 마지막 창이면 전체 hash까지 맞아야 돌려준다.
    const window = async (): Promise<Result<Uint8Array>> => {
      if (!deps.current(ctx.credential_ref).ok) {
        return unavailable("credential is no longer current");
      }
      const length = Math.min(FILE_WINDOW_MAX_BYTES, size - offset);
      const slot = deps.windows.open();
      try {
        const done = await deps.request(
          DOCUMENT_OPS.fileWindow,
          { target, identity, offset, length, channel: slot.channel },
          READ_TIMEOUT_MS,
        );
        if (!done.ok) {
          return err({
            code: workerCode(done.error.code),
            message: "failed",
          });
        }
        const sent = (done.value as { bytes?: unknown } | null)?.bytes;
        const bytes = sent === length ? slot.take(length) : undefined;
        if (bytes === undefined) {
          return unavailable("file bytes did not arrive");
        }
        digest.update(bytes);
        offset += length;
        if (offset === size && digest.digest("hex") !== hash) {
          return unavailable("file bytes do not match");
        }
        return ok(bytes);
      } finally {
        slot.close();
      }
    };
    // 첫 창은 응답을 열기 전에 읽는다. 바뀐 파일·읽지 못한 파일, 한 창짜리 파일의 hash
    // 불일치는 헤더를 보내기 전에 오류가 된다.
    const first = await window();
    if (!first.ok) return first;
    let pending: Uint8Array | undefined = first.value;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        let chunk = pending;
        pending = undefined;
        if (chunk === undefined) {
          const next = await window();
          if (!next.ok) {
            // 이미 일부를 보냈다. 응답을 끝내지 않고 오류로 끊는다.
            controller.error(new Error(next.error.message));
            return;
          }
          chunk = next.value;
        }
        controller.enqueue(chunk);
        if (offset >= size) controller.close();
      },
    }, { highWaterMark: 0 });
    return ok({ contentType, length: size, body });
  }]]);
}
