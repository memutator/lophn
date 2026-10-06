// 준비 worker로 가는 요청 배분. codec은 contracts/platform supervision 하나고,
// 여기는 그 위에 request envelope(architecture 2.1: request_id, operation, input_ref,
// basis)과 1MiB 이하 byte chunk를 싣는 일만 한다. 새 codec을 만들지 않는다.
import { FORMAT_CHECK_CONTENT_MAX_BYTES } from "../../contracts/documents/mod.ts";
import {
  type Frame,
  STREAM_CHUNK_MAX_BYTES,
} from "../../contracts/platform/mod.ts";
// architecture 2.1의 stdio frame 요청 본문. op별 입력·출력 schema는
// 소유 contracts가 worker_response 경계에서 다시 검사한다.
export type RequestPayload = {
  operation: string;
  input_ref: string;
  basis: Record<string, unknown>;
};

export type WorkerPreparing = {
  request_id: string;
  payload: RequestPayload;
};

export type IpcWriter = {
  write(frame: Frame): Promise<void>;
};

// IPC 종료는 진행 요청의 unavailable이다(architecture 2.1). 성공으로 바꾸지 않는다.
export function markUnavailable(worker: WorkerPreparing): {
  request_id: string;
  ok: false;
  error: { code: "unavailable"; message: string };
} {
  return {
    request_id: worker.request_id,
    ok: false,
    error: {
      code: "unavailable",
      message: "documents worker ipc ended",
    },
  };
}

// 요청 envelope와 배분 batch를 보낸다. batch 후보는 1MiB 이하 byte chunk로 싣는다.
// bytes 채널은 request JSON의 channel 필드로 묶는다(contracts#T6).
export async function sendPreparationRequest(
  writer: IpcWriter,
  request: { request_id: string; payload: RequestPayload; channel?: number },
  batch: readonly {
    root: string;
    path: string;
    observedAt: string;
  }[],
): Promise<void> {
  const channel = request.channel ?? 1;
  const frames: Frame[] = [{
    kind: "json",
    channel: 0,
    payload: {
      type: "worker_request",
      request_id: request.request_id,
      op: request.payload.operation,
      channel,
      payload: request.payload,
    },
  }];
  frames.push(...batchToChunks(request.request_id, batch, channel));
  for (const frame of frames) await writer.write(frame);
}

// 배분 후보를 1MiB 이하 byte chunk로 싣는다. 세다 end frame으로 닫는다.
export function batchToChunks(
  requestId: string,
  batch: readonly {
    root: string;
    path: string;
    observedAt: string;
  }[],
  channel: number,
): Frame[] {
  const body = new TextEncoder().encode(JSON.stringify({
    request_id: requestId,
    batch,
  }));
  const frames: Frame[] = [];
  for (let offset = 0; offset < body.length; offset += STREAM_CHUNK_MAX_BYTES) {
    frames.push({
      kind: "bytes",
      channel,
      payload: body.subarray(offset, offset + STREAM_CHUNK_MAX_BYTES),
    });
  }
  frames.push({ kind: "end", channel });
  return frames;
}

// core가 documents worker에 보내는 요청의 op 이름. 입력·출력 모양은 아래 op별 type이
// 정한다. core와 worker가 같은 이름을 쓰도록 여기 한 곳에 둔다.
export const DOCUMENT_OPS = {
  // 대상의 마지막 관측(FileStatus 메모리). 입력은 FileTarget이다.
  fileStatus: "documents.file_status",
  // core가 snapshot에서 읽은 tracking 규칙과 경로→문서 연결(Q15). 바뀔 때마다 다시 보낸다.
  observationBasis: "documents.observation_basis",
  // 저장 준비의 format 검사(file-tracking#R5, versions#R4). 원문 바이트는 이 요청 앞에
  // byte chunk frame으로 먼저 가고, 요청은 channel과 길이로 그 바이트를 가리킨다.
  validateFiles: "documents.validate_files",
} as const;

// `documents.validate_files` 요청 본문. 파일마다 앞서 보낸 byte channel과 그 길이다. 검사가
// 바이트를 읽는 파일(대표 파일)만 channel이 있고, 나머지는 channel이 null이며 바이트를
// 보내지 않는다(bytes는 파일 크기다).
export type ValidateFilesRequest = {
  files: {
    path: string;
    media_type: string;
    primary: boolean;
    bytes: number;
    // 파일 바이트의 sha256. 바이트를 보내지 않은 대표 파일의 input_hash가 이 값이다.
    blob_hash: string;
    channel: number | null;
  }[];
  format: { name: string; module_hash: string; explicit: boolean };
};

// 검사로 보내는 바이트의 상한은 contracts의 FORMAT_CHECK_CONTENT_MAX_BYTES(대표 파일
// 1 MiB)다. 넘는 검사는 요청하지 않는다. 미지원처럼 꾸미지 않고 한도를 밝힌
// invalid_input이다(architecture/documents 2.2).
export const VALIDATE_INPUT_MAX_BYTES = FORMAT_CHECK_CONTENT_MAX_BYTES;

export function parseValidateFilesRequest(
  value: unknown,
): ValidateFilesRequest | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const body = value as Record<string, unknown>;
  const format = body.format as Record<string, unknown> | undefined;
  if (
    !Array.isArray(body.files) || body.files.length === 0 ||
    typeof format !== "object" || format === null ||
    typeof format.name !== "string" || format.name.length === 0 ||
    typeof format.module_hash !== "string" ||
    typeof format.explicit !== "boolean"
  ) return undefined;
  const files: ValidateFilesRequest["files"] = [];
  let total = 0;
  for (const raw of body.files) {
    if (typeof raw !== "object" || raw === null) return undefined;
    const entry = raw as Record<string, unknown>;
    if (
      typeof entry.path !== "string" || entry.path.length === 0 ||
      typeof entry.media_type !== "string" ||
      typeof entry.blob_hash !== "string" ||
      !/^[0-9a-f]{64}$/.test(entry.blob_hash) ||
      typeof entry.primary !== "boolean" ||
      !Number.isSafeInteger(entry.bytes) || (entry.bytes as number) < 0 ||
      !(entry.channel === null ||
        (Number.isSafeInteger(entry.channel) && (entry.channel as number) >= 1))
    ) return undefined;
    // 바이트를 보낸 파일만 입력 상한에 든다.
    if (entry.channel !== null) total += entry.bytes as number;
    files.push({
      path: entry.path,
      media_type: entry.media_type,
      primary: entry.primary,
      bytes: entry.bytes as number,
      blob_hash: entry.blob_hash,
      channel: entry.channel as number | null,
    });
  }
  if (total > VALIDATE_INPUT_MAX_BYTES) return undefined;
  return {
    files,
    format: {
      name: format.name,
      module_hash: format.module_hash,
      explicit: format.explicit,
    },
  };
}
