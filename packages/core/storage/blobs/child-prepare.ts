// 신뢰 자식의 blob 준비 요청을 받는 core 쪽 처리(platform Q6, blob-store#R1).
// 자식은 감독 pipe로 blob_prepare_request json을 보내고, core가 준 credit 안에서
// 자기 channel의 bytes frame을 보내고, end로 닫는다. core는 바이트를 해석하거나 hash하지
// 않고 core.prepareBlob(I/O worker 중계)으로 넘긴다. principal은 core가 자식 kind에서
// 정하고, 자식이 주장한 hash·principal은 받지 않는다(요청 schema에 field가 없다).

import { err, type ErrorCode, type Result } from "../../../base/mod.ts";
import {
  BLOB_PREPARE_CREDIT_WINDOW,
  BLOB_PREPARE_ERROR_CODES,
  type BlobPrepareRequest,
  type ChildMessage,
  type Frame,
  type ParentMessage,
} from "../../../protocol/supervision/mod.ts";
import { BLOB_PREPARE_MAX_BYTES } from "../../../protocol/storage/mod.ts";
import {
  AGENT_RUNTIME_PRINCIPAL,
  RUN_BLOB_PURPOSES,
} from "../../../protocol/lophn-agent/mod.ts";
import type { BlobPrepareCall } from "../../main/daemon/core.ts";
import type { BufferGauge, PreparedRelayResult } from "./prepare-relay.ts";
import { problemsReportDefinitions } from "../../problems/register.ts";

// kind별 허용. kind가 여기 없으면 요청은 forbidden이다(자식 spec이 준 권한이 아니라
// core가 정한 목록이다). 상한은 purpose를 등록한 소유 concern의 max_size_bytes다.
export type ChildBlobPolicy = {
  principal: string;
  purposes: ReadonlyMap<string, number>;
};

const REPORT_PURPOSE_CAPS = new Map<string, number>(
  problemsReportDefinitions.blobPurposes.map((
    purpose,
  ) => [purpose.purpose, purpose.max_size_bytes] as const),
);

export const CHILD_BLOB_POLICIES: ReadonlyMap<string, ChildBlobPolicy> =
  new Map(
    [
      [
        "documents/worker",
        {
          // 준비 참조의 principal은 document.save가 보는 현재 자격의 principal과 같아야
          // 등록된다(blob-store register). core가 documents/worker에 주는 machine
          // credential의 principal이 `machine:documents`다.
          principal: "machine:documents",
          // 원본 파일 내용(document_file)과 파일 목록(document_files)이다.
          purposes: new Map([
            ["document_file", BLOB_PREPARE_MAX_BYTES],
            ["document_files", BLOB_PREPARE_MAX_BYTES],
          ]),
        },
      ],
      [
        "lophn-agent/runtime",
        {
          // run 근거·결과와 model·tool 기록의 본문이다. 준비 principal은 command가 보는 현재 자격의
          // principal(core가 runtime에 주는 machine credential)과 같아야 등록된다.
          principal: AGENT_RUNTIME_PRINCIPAL,
          purposes: new Map(
            Object.values(RUN_BLOB_PURPOSES).map((
              purpose,
            ) => [purpose, 16 * 1024 * 1024] as const),
          ),
        },
      ],
      [
        "problems/report-collector",
        {
          // registerBlobs 원주체 검사: report.principal과 준비 principal이 같아야 한다.
          principal: "collector",
          purposes: new Map(
            [
              "report_text",
              "report_details",
              "snapshot_stack",
              "snapshot_logs",
              "feedback_state",
              "feedback_screenshot",
            ].flatMap((purpose) => {
              const cap = REPORT_PURPOSE_CAPS.get(purpose);
              return cap === undefined ? [] : [[purpose, cap] as const];
            }),
          ),
        },
      ],
    ],
  );

export type ChildBlobPrepareDeps = {
  // 이 handler가 받는 자식의 kind. hello로 core가 정한 값이다(자식 주장이 아니다).
  kind: string;
  // core.prepareBlob. 바이트는 해석 없이 stream으로 넘긴다.
  prepareBlob(call: BlobPrepareCall): Promise<Result<PreparedRelayResult>>;
  // 자식에게 json frame을 쓴다. 쓰지 못하면 false다.
  send(message: ParentMessage): Promise<boolean>;
  policies?: ReadonlyMap<string, ChildBlobPolicy>;
  // core가 쥔 바이트(받아 두고 아직 넘기지 않은 chunk)를 관측한다. 없으면 관측하지 않는다.
  gauge?: BufferGauge;
  // 자식 하나가 동시에 열 수 있는 준비 수.
  maxStreams?: number;
  // frame이 이만큼 없으면 그 stream을 버린다. 자식이 죽어도 core 메모리가 남지 않게 한다.
  idleMs?: number;
};

export type ChildBlobPrepare = {
  // childMessage를 소비하면 true다.
  onMessage(message: ChildMessage): boolean;
  // bytes·end·abort frame. 열려 있는 stream만 받고 나머지는 버린다.
  onFrame(frame: Frame): void;
  // 자식이 멈추거나 끊겼다. 열린 stream을 모두 닫고 blob을 만들지 않는다.
  close(): void;
  readonly open: number;
};

export const CHILD_BLOB_MAX_STREAMS = 4;
export const CHILD_BLOB_IDLE_MS = 30_000;

// 오류는 코드마다 고정 문구뿐이다. 경로·I/O worker 메시지·hash 원문은 자식에게 가지 않는다.
const SAFE_MESSAGES: Record<
  (typeof BLOB_PREPARE_ERROR_CODES)[number],
  string
> = {
  invalid_input: "blob prepare request is invalid",
  forbidden: "blob prepare is not allowed",
  unavailable: "blob prepare is unavailable",
  internal: "blob prepare failed",
};

function failure(
  requestId: string,
  code: keyof typeof SAFE_MESSAGES,
): ParentMessage {
  return {
    type: "blob_prepare_result",
    request_id: requestId,
    ok: false,
    error: { code, message: SAFE_MESSAGES[code] },
  };
}

function safeCode(code: ErrorCode): keyof typeof SAFE_MESSAGES {
  return code === "invalid_input" || code === "forbidden" ||
      code === "unavailable"
    ? code
    : code === "conflict" || code === "not_found" || code === "unauthorized"
    ? "unavailable"
    : "internal";
}

type Stream = {
  request: BlobPrepareRequest;
  // 자식에게 준 credit 누계와 받은 바이트. received가 granted를 넘으면 위반이다.
  granted: number;
  received: number;
  queue: Uint8Array[];
  // queue에 쌓인 바이트 수. 자식이 보낸 것 중 consumer가 아직 읽지 않은 양이다.
  queuedBytes: number;
  // consumer가 더 읽지 않기로 했다(I/O worker가 먼저 오류로 답했다). 이어 오는 frame은
  // 버리고, consumer가 돌려준 오류를 자식에게 알린다.
  cancelled: boolean;
  // 자식이 end를 보냈다.
  ended: boolean;
  // 실패한 stream. 값이 있으면 consumer를 그 오류로 끝낸다.
  failed: { code: keyof typeof SAFE_MESSAGES; silent: boolean } | undefined;
  wake: (() => void) | undefined;
  idle: ReturnType<typeof setTimeout> | undefined;
  settled: boolean;
  // 실패 결과를 이미 자식에게 보냈다.
  replied: boolean;
};

export function createChildBlobPrepare(
  deps: ChildBlobPrepareDeps,
): ChildBlobPrepare {
  const policy = (deps.policies ?? CHILD_BLOB_POLICIES).get(deps.kind);
  const maxStreams = deps.maxStreams ?? CHILD_BLOB_MAX_STREAMS;
  const idleMs = deps.idleMs ?? CHILD_BLOB_IDLE_MS;
  const streams = new Map<number, Stream>();
  let closed = false;

  // queue를 비우며 관측하는 바이트도 돌려준다.
  function drop(stream: Stream) {
    deps.gauge?.add(-stream.queuedBytes);
    stream.queuedBytes = 0;
    stream.queue.length = 0;
  }

  function touch(channel: number, stream: Stream) {
    if (stream.idle !== undefined) clearTimeout(stream.idle);
    stream.idle = setTimeout(() => {
      // 자식이 멈춘 채 말이 없다. 열려 있는 만큼의 메모리를 돌려받는다.
      fail(channel, stream, "unavailable", true);
    }, idleMs);
  }

  function fail(
    channel: number,
    stream: Stream,
    code: keyof typeof SAFE_MESSAGES,
    silent: boolean,
  ) {
    if (stream.failed === undefined) stream.failed = { code, silent };
    // 위반은 I/O worker 응답을 기다리지 않고 바로 알린다.
    if (!stream.failed.silent && !stream.replied) {
      stream.replied = true;
      void deps
        .send(failure(stream.request.request_id, stream.failed.code))
        .catch(() => false);
    }
    drop(stream);
    const wake = stream.wake;
    stream.wake = undefined;
    wake?.();
    if (streams.get(channel) === stream) {
      // 이 channel은 더 받지 않는다. 늦게 온 frame은 열린 stream이 없어 버려진다.
      release(channel, stream);
    }
  }

  function release(channel: number, stream: Stream) {
    if (stream.idle !== undefined) clearTimeout(stream.idle);
    stream.idle = undefined;
    drop(stream);
    if (streams.get(channel) === stream) streams.delete(channel);
  }

  async function grant(stream: Stream, window: number) {
    const remaining = stream.request.size_bytes - stream.granted;
    const amount = Math.min(window, remaining);
    if (amount <= 0) return;
    stream.granted += amount;
    await deps.send({
      type: "credit",
      channel: stream.request.channel,
      window: amount,
    }).catch(() => false);
  }

  function bodyOf(stream: Stream): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        for (;;) {
          if (stream.failed) {
            controller.error(new Error("blob prepare stream failed"));
            return;
          }
          const chunk = stream.queue.shift();
          if (chunk !== undefined) {
            stream.queuedBytes -= chunk.length;
            deps.gauge?.add(-chunk.length);
            controller.enqueue(chunk);
            // consumer가 가져간 만큼만 credit을 다시 준다(backpressure).
            await grant(stream, chunk.length);
            return;
          }
          if (stream.ended) {
            controller.close();
            return;
          }
          await new Promise<void>((resolve) => {
            stream.wake = resolve;
          });
        }
      },
      cancel() {
        // consumer가 읽기를 그만뒀다. 자식은 abort한 것이 아니므로 결과를 알려야 한다:
        // 쌓인 바이트를 버리고 open()이 consumer가 돌려준 오류를 자식에게 보낸다.
        stream.cancelled = true;
        drop(stream);
      },
    }, { highWaterMark: 0 });
  }

  async function open(request: BlobPrepareRequest) {
    const stream: Stream = {
      request,
      granted: 0,
      received: 0,
      queue: [],
      queuedBytes: 0,
      cancelled: false,
      ended: false,
      failed: undefined,
      wake: undefined,
      idle: undefined,
      settled: false,
      replied: false,
    };
    streams.set(request.channel, stream);
    touch(request.channel, stream);
    const reply = (message: ParentMessage) =>
      deps.send(message).catch(() => false);
    // 준비는 바이트가 모두 들어와야 끝난다. credit을 먼저 줘서 자식이 보내기 시작하게 한다.
    await grant(stream, BLOB_PREPARE_CREDIT_WINDOW);
    let outcome: Result<PreparedRelayResult>;
    try {
      outcome = await deps.prepareBlob({
        principal: policy!.principal,
        purpose: request.purpose,
        bytes: bodyOf(stream),
      });
    } catch {
      outcome = err({ code: "internal", message: "blob prepare failed" });
    }
    stream.settled = true;
    const failed = stream.failed;
    release(request.channel, stream);
    // 자식이 abort했으면 아무도 결과를 기다리지 않는다.
    if (failed?.silent || stream.replied) return;
    if (failed !== undefined) {
      await reply(failure(request.request_id, failed.code));
      return;
    }
    if (!outcome.ok) {
      await reply(failure(request.request_id, safeCode(outcome.error.code)));
      return;
    }
    const prepared = outcome.value;
    // hash·크기는 I/O worker가 계산한 값이다. 선언 크기와 다르면 자식에게 성공을 주지 않는다.
    if (prepared.size_bytes !== request.size_bytes) {
      await reply(failure(request.request_id, "internal"));
      return;
    }
    await reply({
      type: "blob_prepare_result",
      request_id: request.request_id,
      ok: true,
      prepared: {
        preparation: prepared.preparation,
        principal: prepared.principal,
        purpose: prepared.purpose,
        hash: prepared.hash,
        size_bytes: prepared.size_bytes,
      },
    });
  }

  return {
    get open() {
      return streams.size;
    },
    onMessage(message) {
      if (message.type !== "blob_prepare_request") return false;
      const reply = (code: keyof typeof SAFE_MESSAGES) =>
        void deps.send(failure(message.request_id, code)).catch(() => false);
      // 허용되지 않은 kind·purpose는 존재 여부를 알리지 않는 같은 forbidden이다.
      const cap = policy?.purposes.get(message.purpose);
      if (policy === undefined || cap === undefined || closed) {
        reply("forbidden");
        return true;
      }
      if (message.size_bytes > cap) {
        reply("invalid_input");
        return true;
      }
      if (streams.has(message.channel)) {
        // 같은 channel을 다시 열면 진행 중인 stream은 건드리지 않고 이 요청만 거절한다.
        reply("invalid_input");
        return true;
      }
      if (streams.size >= maxStreams) {
        reply("unavailable");
        return true;
      }
      void open(message);
      return true;
    },
    onFrame(frame) {
      if (frame.kind === "json") return;
      const stream = streams.get(frame.channel);
      if (stream === undefined) return;
      touch(frame.channel, stream);
      if (frame.kind === "abort") {
        fail(frame.channel, stream, "unavailable", true);
        return;
      }
      if (stream.cancelled) return;
      if (frame.kind === "end") {
        if (stream.received !== stream.request.size_bytes) {
          fail(frame.channel, stream, "invalid_input", false);
          return;
        }
        stream.ended = true;
        const wake = stream.wake;
        stream.wake = undefined;
        wake?.();
        return;
      }
      if (frame.kind !== "bytes") return;
      if (stream.ended) {
        fail(frame.channel, stream, "invalid_input", false);
        return;
      }
      // credit을 넘긴 바이트나 선언 크기를 넘긴 바이트는 위반이다. 더 받지 않고 abort한다.
      stream.received += frame.payload.length;
      if (
        stream.received > stream.granted ||
        stream.received > stream.request.size_bytes
      ) {
        fail(frame.channel, stream, "invalid_input", false);
        return;
      }
      stream.queue.push(frame.payload);
      stream.queuedBytes += frame.payload.length;
      deps.gauge?.add(frame.payload.length);
      const wake = stream.wake;
      stream.wake = undefined;
      wake?.();
    },
    close() {
      closed = true;
      for (const [channel, stream] of [...streams]) {
        fail(channel, stream, "unavailable", true);
      }
    },
  };
}
