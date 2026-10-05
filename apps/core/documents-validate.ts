// 준비 route의 format 검사(file-tracking#R5, versions#R4). core는 파일을 열지 않는다: I/O
// worker가 설치한 원문 blob을 창 단위로 읽어 감독 pipe의 byte chunk frame으로 documents
// coordinator에 넘기고, 같은 channel을 가리키는 `documents.validate_files` 요청을 보낸다.
// coordinator가 권한 없는 format runner로 검사하고 그 결과를 돌려준다. 바이트는 core
// 메모리에 창 하나보다 오래 머물지 않는다.
import { err, ok, type Result } from "../../packages/base/mod.ts";
import { formatValidationResultSchema } from "../../packages/contracts/documents/mod.ts";
import { BLOB_READ_MAX_BYTES } from "../../packages/contracts/platform/mod.ts";
import {
  DOCUMENT_OPS,
  VALIDATE_INPUT_MAX_BYTES,
} from "../../packages/documents/file-tracking/mod.ts";
import type { ValidatePort } from "../../packages/documents/versions/work.ts";

export type ValidateDeps = {
  // I/O worker가 설치한 blob의 구간.
  readBlob(
    hash: string,
    offset: number,
    length: number,
  ): Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;
  // coordinator pipe에 byte chunk frame을 쓴다. 쓰지 못하면 false다.
  sendBytes(channel: number, chunk: Uint8Array): Promise<boolean>;
  // coordinator에 요청하고 답을 기다린다.
  request(
    op: string,
    payload: unknown,
    timeoutMs: number,
  ): Promise<Result<unknown>>;
  timeoutMs?: number;
};

// runner 호출의 기한(5초)과 입력 이동을 덮는 여유. 창 읽기마다 따로 기한이 있다.
const REQUEST_TIMEOUT_MS = 30_000;

function unavailable(message: string) {
  return err({ code: "unavailable" as const, message });
}

export function createValidatePort(deps: ValidateDeps): ValidatePort {
  // 한 번에 하나만 보낸다. coordinator는 요청을 순서대로 처리하므로 앞 검사의 바이트가
  // 그 요청 뒤에 줄을 서서 pipe의 read-ahead 한도를 넘기지 않게 한다.
  let tail: Promise<unknown> = Promise.resolve();
  let channelCounter = 0;

  async function run(
    files: Parameters<ValidatePort>[0],
    format: Parameters<ValidatePort>[1],
  ): ReturnType<ValidatePort> {
    const total = files.reduce((sum, file) => sum + file.bytes, 0);
    if (total > VALIDATE_INPUT_MAX_BYTES) {
      // 입력 한도를 넘는 검사는 통과로 꾸미지 않는다.
      return unavailable("validation input exceeds the limit");
    }
    const described: {
      path: string;
      media_type: string;
      primary: boolean;
      bytes: number;
      channel: number;
    }[] = [];
    for (const file of files) {
      channelCounter = channelCounter % 0xffffffff + 1;
      const channel = channelCounter;
      let offset = 0;
      while (offset < file.bytes) {
        const read = await deps.readBlob(
          file.blob_hash,
          offset,
          Math.min(BLOB_READ_MAX_BYTES, file.bytes - offset),
        );
        if (!read.ok) return unavailable("validation input was not readable");
        if (read.value.bytes.length === 0) {
          return unavailable("validation input ended early");
        }
        if (!await deps.sendBytes(channel, read.value.bytes)) {
          return unavailable("validation input was not delivered");
        }
        offset += read.value.bytes.length;
      }
      described.push({
        path: file.path,
        media_type: file.media_type,
        primary: file.primary,
        bytes: file.bytes,
        channel,
      });
    }
    const answered = await deps.request(
      DOCUMENT_OPS.validateFiles,
      { files: described, format },
      deps.timeoutMs ?? REQUEST_TIMEOUT_MS,
    );
    if (!answered.ok) {
      return err({
        code: answered.error.code === "not_found"
          ? "not_found" as const
          : "unavailable" as const,
        message: "format validation did not complete",
      });
    }
    const parsed = formatValidationResultSchema.safeParse(answered.value);
    if (!parsed.success || !Array.isArray(parsed.data.diagnostics)) {
      return unavailable("format validation answer is invalid");
    }
    return ok({ ...parsed.data, diagnostics: parsed.data.diagnostics });
  }

  return (files, format) => {
    const next = tail.then(() => run(files, format));
    tail = next.catch(() => undefined);
    return next;
  };
}
