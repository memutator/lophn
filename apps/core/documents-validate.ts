// 준비 route의 format 검사(file-tracking#R5, versions#R4). core는 파일을 열지 않는다: I/O
// worker가 설치한 원문 blob을 창 단위로 읽어 감독 pipe의 byte chunk frame으로 documents
// coordinator에 넘기고, 같은 channel을 가리키는 `documents.validate_files` 요청을 보낸다.
// coordinator가 권한 없는 format runner로 검사하고 그 결과를 돌려준다. 바이트는 core
// 메모리에 창 하나보다 오래 머물지 않는다. 바이트는 검사가 읽는 format의 대표 파일만
// 보낸다(첨부와 pdf·image·data는 보내지 않는다). 그 대표 파일이 한도(1 MiB)를 넘으면
// 보내지 않고 검사를 하지 못한 결과(명시 format은 error, 미지정은 warning, 한도를 밝힌
// 진단)를 돌려준다. unavailable로 숨기지 않고 통과로 꾸미지도 않는다.
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  formatChecksContent,
  formatValidationResultSchema,
} from "../../packages/protocol/projects/mod.ts";
import { BLOB_READ_MAX_BYTES } from "../../packages/protocol/platform/mod.ts";
import {
  DOCUMENT_OPS,
  VALIDATE_INPUT_MAX_BYTES,
} from "../../packages/core/projects/file-tracking/mod.ts";
import { overLimitOutcome } from "../../packages/core/projects/formats/mod.ts";
import type { ValidatePort } from "../../packages/core/projects/versions/work.ts";

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

export type StreamedFile = {
  path: string;
  media_type: string;
  primary: boolean;
  bytes: number;
  // 파일 바이트의 sha256. 바이트를 보내지 않은 파일도 이 값으로 가리킨다.
  blob_hash: string;
  // 바이트를 보낸 파일만 channel이 있다.
  channel: number | null;
};

// coordinator pipe로 원문 바이트를 보내는 통로. 검사(validate)와 search 추출이 같은 pipe와
// 같은 channel 번호 공간을 쓰므로 한 인스턴스를 나눠 쓴다. 한 번에 하나만 보낸다:
// coordinator는 요청을 순서대로 처리하므로 앞 일의 바이트가 그 요청 뒤에 줄을 서서 pipe의
// read-ahead 한도를 넘지 않게 한다.
export type StreamInput = {
  path: string;
  blob_hash: string;
  bytes: number;
  media_type: string;
  primary: boolean;
};

export type Streamer = {
  // 바이트를 보내는 일부터 그 바이트를 쓰는 요청이 끝날 때까지를 한 묶음으로 직렬화한다.
  exclusive<T>(run: () => Promise<T>): Promise<T>;
  // `reads`가 참인 파일만 blob을 읽어 channel로 보내고, 나머지는 바이트 없이 설명만 낸다
  // (guest는 대표 파일 밖의 바이트를 읽지 않는다). exclusive 안에서 부른다.
  stream(
    files: readonly StreamInput[],
    reads: (file: StreamInput) => boolean,
  ): Promise<Result<StreamedFile[]>>;
};

export function createStreamer(
  deps: Pick<ValidateDeps, "readBlob" | "sendBytes">,
): Streamer {
  let tail: Promise<unknown> = Promise.resolve();
  let channelCounter = 0;
  return {
    exclusive<T>(run: () => Promise<T>): Promise<T> {
      const next = tail.then(run);
      tail = next.catch(() => undefined);
      return next;
    },
    async stream(files, reads) {
      const total = files.reduce(
        (sum, file) => sum + (reads(file) ? file.bytes : 0),
        0,
      );
      if (total > VALIDATE_INPUT_MAX_BYTES) {
        // 입력 한도를 넘는 일은 통과로 꾸미지 않는다.
        return unavailable("validation input exceeds the limit");
      }
      const described: StreamedFile[] = [];
      for (const file of files) {
        if (!reads(file)) {
          described.push({
            path: file.path,
            media_type: file.media_type,
            primary: file.primary,
            bytes: file.bytes,
            blob_hash: file.blob_hash,
            channel: null,
          });
          continue;
        }
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
          blob_hash: file.blob_hash,
          channel,
        });
      }
      return ok(described);
    },
  };
}

export function createValidatePort(
  deps: ValidateDeps,
  streamer: Streamer = createStreamer(deps),
): ValidatePort {
  async function run(
    files: Parameters<ValidatePort>[0],
    format: Parameters<ValidatePort>[1],
  ): ReturnType<ValidatePort> {
    // 검사가 읽는 바이트: 바이트를 읽는 format의 대표 파일뿐이다.
    const reads = (file: (typeof files)[number]) =>
      formatChecksContent(format.name) && file.primary;
    const primary = files.find((file) => file.primary);
    if (primary !== undefined) {
      // 입력 한도를 넘는 검사는 통과로 꾸미지 않고 한도를 밝힌 결과를 낸다.
      const skipped = overLimitOutcome(primary, format);
      if (skipped !== null) return ok(skipped);
    }
    const described = await streamer.stream(files, reads);
    if (!described.ok) return unavailable(described.error.message);
    const answered = await deps.request(
      DOCUMENT_OPS.validateFiles,
      { files: described.value, format },
      deps.timeoutMs ?? REQUEST_TIMEOUT_MS,
    );
    if (!answered.ok) {
      return err({
        code: answered.error.code === "not_found" ||
            answered.error.code === "invalid_input"
          ? answered.error.code
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

  return (files, format) => streamer.exclusive(() => run(files, format));
}
