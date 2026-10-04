// 준비 worker로 가는 요청 배분. codec은 contracts/platform supervision 하나고,
// 여기는 그 위에 request envelope(architecture 2.1: request_id, operation, input_ref,
// basis)과 1MiB 이하 byte chunk를 싣는 일만 한다. 새 codec을 만들지 않는다.
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
