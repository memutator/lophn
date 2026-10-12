import {
  type ChildSession,
  type ChildStreams,
  createIoScheduler,
  startChild,
} from "../../supervision/responsiveness/mod.ts";
import {
  createDiagnosticIngress,
  createLogFiles,
  createSafeLog,
  type DiagnosticAuthority,
  type DiagnosticCatalog,
} from "../../diagnostics/mod.ts";
import { createBlobStoreWork, systemQuota } from "../../storage/blobs/mod.ts";
import { observeBlobGc } from "../../storage/blobs/worker/gc.ts";
import { readUnreferencedRecords } from "../../storage/blobs/worker/maintenance.ts";
import {
  BACKUP_INTERVAL_MS,
  backupDue,
  backupStamp,
  createBackup,
} from "../../storage/migration/mod.ts";
import {
  type Clock,
  type ErrorCode,
  ok,
  type Result,
  systemClock,
} from "../../../base/mod.ts";
import { DatabaseSync } from "node:sqlite";
import {
  type BlobPipe,
  type BlobPipeRequest,
  createBlobPipe,
} from "../../storage/blobs/worker/pipe.ts";
import {
  createSettingsPipe,
  type SettingsPipe,
  type SettingsPipeRequest,
} from "../../config/worker/pipe.ts";
import {
  type Frame,
  SECRET_INPUT_MAX_BYTES,
  SECRET_PREPARE_OP,
  SETTINGS_EXPORT_OP,
  SETTINGS_IMPORT_OP,
  STREAM_CHUNK_MAX_BYTES,
} from "../../../protocol/server/mod.ts";
import {
  createSecretWork,
  productKeychain,
  SECRET_TOOL_PATHS,
} from "../../secrets/mod.ts";
import {
  createSecretPipe,
  type SecretPipe,
  type SecretPipeRequest,
} from "../../secrets/worker/pipe.ts";

// 하루 backup check 주기. 차례가 지나면 만든다. 만들기가 늦어도 다음 check가 본다.
export const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;

// blob GC check 주기(R10: 기동 시와 매일). 관측은 삭제가 아니다.
export const GC_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// worker가 받아 두기로 한 blob 바이트 전체의 상한(credit budget). 모든 blob.prepare
// channel이 이 하나를 나눠 쓴다: 준 credit 중 아직 blob store가 읽어 가지 않은 합이 이
// 값을 넘지 않는다. dispatch가 느린 요청에 묶여 있어도 pipe에서 미리 읽은 frame이
// child.ts의 read-ahead 한도(두 chunk)에서 제어 frame 몫을 남기도록 chunk 하나로 잡는다.
export const BLOB_PREPARE_WORKER_BUDGET = STREAM_CHUNK_MAX_BYTES;
// 한 channel이 쥘 수 있는 credit. 아직 시작하지 못한(scheduler 대기) 준비는 한 조각만
// 쥐게 해서, 돌고 있는 준비가 budget을 다 쓰지 못하는 일이 없게 한다.
export const BLOB_PREPARE_WORKER_WINDOW = BLOB_PREPARE_WORKER_BUDGET;
const BLOB_PREPARE_GRANT_QUANTUM = 256 * 1024;
// 이보다 작은 credit은 쪼개 주지 않는다(frame이 잘게 쪼개지는 것을 막는다).
const BLOB_PREPARE_GRANT_MIN = 32 * 1024;

// 열린 blob 준비 하나. 요청 json이 먼저 오고 bytes·end(또는 abort) frame이 이어 온다.
type PrepareStream = {
  queue: Uint8Array[];
  // 준 credit 누계와 받은 바이트. received가 granted를 넘으면 위반이다.
  granted: number;
  received: number;
  // 받아서 blob store가 아직 읽어 가지 않은 바이트(queue의 합).
  queued: number;
  // 닫는 frame(end·abort)을 본 뒤 받지 못한 credit을 budget에 돌려줬다.
  reserveReturned: boolean;
  // scheduler가 준비를 시작했다.
  running: boolean;
  // core가 end를 보냈다.
  ended: boolean;
  // 중단됐다(abort·위반·session 정지). 값이 있으면 blob store가 읽는 stream은 오류로 끝난다.
  failed: boolean;
  wake: (() => void) | undefined;
  // end·abort frame을 봤다. 준비가 먼저 답한 뒤에도 이어 오는 frame은 이 channel이
  // 닫힐 때까지 버려야 하므로 둘이 다 되어야 channel을 놓는다.
  closed: boolean;
  // 준비가 답했다.
  answered: boolean;
};

export type PlatformIoOptions = {
  root: string;
  streams: ChildStreams;
  catalog: DiagnosticCatalog;
  currentAuthority(): DiagnosticAuthority | undefined;
  // blob 준비 통로. 없으면 blob.prepare는 거절한다.
  blob?: BlobPipe;
  // settings 교환 통로. 없으면 settings.import·export는 거절한다.
  settings?: SettingsPipe;
  // 보호 입력 통로(secret.prepare). 없으면 secret.prepare는 거절한다. 값은 keychain adapter
  // 안에서만 쓰이고 응답에는 값 없는 준비 증거만 있다.
  secrets?: SecretPipe;
  // 준비 파일 접미사. 내용에서 파생하지 않는다.
  suffix?: () => string;
};

// byte chunk는 제어 메시지가 아니다. 요청의 channel에 묶인다(Q6).
export async function createPlatformIo(
  options: PlatformIoOptions,
): Promise<ChildSession> {
  const files = await createLogFiles(options.root);
  const log = createSafeLog({ catalog: options.catalog, sink: files.write });
  const scheduler = createIoScheduler();
  // blob.prepare 준비는 chunk가 오는 내내 자리를 쥔다. 일반 scheduler를 나눠 쓰면 준비가
  // 자리를 다 쥔 채 chunk를 기다리고, settings·diagnostics 요청이 자리를 기다리며 dispatch를
  // 막아 그 chunk를 못 읽는 교착이 된다. 준비는 자기 scheduler를 쓴다.
  const prepareScheduler = createIoScheduler();
  const blob = options.blob ?? createBlobPipe({
    work: createBlobStoreWork({
      root: options.root,
      suffix: options.suffix ?? (() => crypto.randomUUID()),
      // 제품 여유는 실제 관측이다. 테스트가 fake quota를 넣는다.
      quota: systemQuota(),
    }),
    suffix: options.suffix ?? (() => crypto.randomUUID()),
  });
  const settings = options.settings ?? createSettingsPipe();
  // blob 준비는 요청 json에 앞서(뒤에) 오는 byte chunk를 channel별로 모은다(Q6).
  // core는 해석·hash 없이 넘기고, 이 worker만 모아 내용을 만든다.
  const pending = new Map<
    number,
    { chunks: Uint8Array[]; request?: BlobPipeRequest }
  >();
  // blob.prepare는 요청 json이 먼저 오고 chunk가 이어 온다(Q6). 준비는 chunk가 오는 동안
  // 이미 hash·write를 시작하고, 받아 둔 바이트는 credit window를 넘지 않는다.
  const prepares = new Map<number, PrepareStream>();
  // 모든 준비가 나눠 쓰는 credit budget의 남은 양.
  const budget = { available: BLOB_PREPARE_WORKER_BUDGET };
  const ingress = createDiagnosticIngress({
    log,
    currentAuthority: () =>
      session.credentialUsable ? options.currentAuthority() : undefined,
  });
  function wakePrepare(stream: PrepareStream) {
    const wake = stream.wake;
    stream.wake = undefined;
    wake?.();
  }

  // 준비를 중단한다. blob store가 읽는 stream은 오류로 끝나고 임시 파일은 버려진다.
  function failPrepare(stream: PrepareStream) {
    stream.failed = true;
    budget.available += stream.queued;
    stream.queued = 0;
    stream.queue.length = 0;
    wakePrepare(stream);
    redistribute();
  }

  // 닫는 frame이 왔다. 그 앞의 bytes frame은 모두 도착했으므로 받지 않은 credit을 돌려준다.
  function returnReserve(stream: PrepareStream) {
    if (stream.reserveReturned) return;
    stream.reserveReturned = true;
    budget.available += Math.max(0, stream.granted - stream.received);
    redistribute();
  }

  // budget에서 credit을 나눈다. 준비마다 한 조각씩 돌아가며 주고, 한 준비에 몰아주지 않는다.
  // 받은 credit은 준비마다 모아 credit message 하나로 보낸다.
  function redistribute() {
    const amounts = new Map<number, number>();
    for (let progressed = true; progressed;) {
      progressed = false;
      for (const [channel, stream] of prepares) {
        if (budget.available <= 0) break;
        if (stream.failed || stream.closed || stream.answered) continue;
        const held = stream.granted - stream.received + stream.queued;
        const cap = stream.running
          ? BLOB_PREPARE_WORKER_WINDOW
          : BLOB_PREPARE_GRANT_QUANTUM;
        const room = cap - held;
        if (room <= 0) continue;
        const amount = Math.min(
          BLOB_PREPARE_GRANT_QUANTUM,
          room,
          budget.available,
        );
        // 아무것도 쥐지 못한 준비는 작은 조각이라도 받는다. 아니면 모일 때까지 기다린다.
        if (amount < BLOB_PREPARE_GRANT_MIN && held > 0 && amount < room) {
          continue;
        }
        budget.available -= amount;
        stream.granted += amount;
        amounts.set(channel, (amounts.get(channel) ?? 0) + amount);
        progressed = true;
      }
    }
    for (const [channel, window] of amounts) {
      void session.send({ type: "credit", channel, window }).catch(() => {});
    }
  }

  function settlePrepare(channel: number, stream: PrepareStream) {
    if (stream.closed && stream.answered && prepares.get(channel) === stream) {
      prepares.delete(channel);
    }
  }

  // core가 보낸 bytes·end·abort frame을 그 준비에 붙인다. 내용은 해석하지 않는다.
  function feedPrepare(frame: Frame, stream: PrepareStream) {
    if (frame.kind === "json") return;
    if (frame.kind === "abort") {
      stream.closed = true;
      failPrepare(stream);
      returnReserve(stream);
      settlePrepare(frame.channel, stream);
      return;
    }
    if (frame.kind === "end") {
      stream.closed = true;
      stream.ended = true;
      wakePrepare(stream);
      returnReserve(stream);
      settlePrepare(frame.channel, stream);
      return;
    }
    if (frame.kind !== "bytes") return;
    // 중단됐거나 닫힌 뒤에 온 chunk는 버린다.
    if (stream.failed || stream.closed) return;
    stream.received += frame.payload.length;
    if (stream.received > stream.granted) {
      // 준 credit보다 많이 보냈다. 더 받지 않는다.
      failPrepare(stream);
      return;
    }
    if (frame.payload.length === 0) return;
    stream.queue.push(frame.payload);
    stream.queued += frame.payload.length;
    wakePrepare(stream);
  }

  function respondBlob(
    requestId: string,
    response:
      | { ok: true; payload: unknown }
      | { ok: false; error: { code: ErrorCode; message: string } },
  ): Promise<void> {
    if (!session.credentialUsable) return Promise.resolve();
    return session.send(
      response.ok
        ? {
          type: "worker_response",
          request_id: requestId,
          ok: true,
          payload: response.payload,
        }
        : {
          type: "worker_response",
          request_id: requestId,
          ok: false,
          error: response.error,
        },
    ).catch(() => {});
  }

  // blob.prepare를 받는다. core의 chunk가 오는 대로 blob store가 읽어 hash·write하고,
  // 읽어 간 만큼만 credit을 다시 준다(Q2·Q6). 응답은 준비가 끝난 뒤에 따로 보낸다.
  async function startPrepare(request: BlobPipeRequest, channel: number) {
    if (prepares.has(channel)) {
      // 같은 channel을 다시 열면 진행 중인 준비는 건드리지 않는다.
      await respondBlob(request.request_id, {
        ok: false,
        error: {
          code: "invalid_input",
          message: "blob 준비 channel이 이미 열려 있다",
        },
      });
      return;
    }
    const stream: PrepareStream = {
      queue: [],
      granted: 0,
      received: 0,
      queued: 0,
      reserveReturned: false,
      running: false,
      ended: false,
      failed: false,
      wake: undefined,
      closed: false,
      answered: false,
    };
    prepares.set(channel, stream);
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        for (;;) {
          if (stream.failed) {
            controller.error(new Error("blob prepare stream failed"));
            return;
          }
          const chunk = stream.queue.shift();
          if (chunk !== undefined) {
            controller.enqueue(chunk);
            // blob store가 가져간 만큼만 budget에 돌려주고, 기다리는 준비들이 나눠 받는다
            // (backpressure).
            stream.queued -= chunk.length;
            budget.available += chunk.length;
            redistribute();
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
        failPrepare(stream);
      },
    }, { highWaterMark: 0 });
    const submission = prepareScheduler.submit(
      "blob",
      async () => {
        // 이제 돌고 있다. 더 큰 credit을 받을 수 있다.
        stream.running = true;
        redistribute();
        return await blob.handle(request, () => Promise.resolve(body));
      },
    );
    if (!submission.ok) {
      failPrepare(stream);
      stream.answered = true;
      settlePrepare(channel, stream);
      await respondBlob(request.request_id, {
        ok: false,
        error: submission.error,
      });
      return;
    }
    const job = submission.value.result;
    void (async () => {
      const result = await job;
      // 준비가 끝났다. 읽지 않은 바이트가 있으면(오류로 일찍 끝남) 더 받지 않고 버린다.
      if (!stream.ended || !result.ok) failPrepare(stream);
      stream.answered = true;
      settlePrepare(channel, stream);
      if (!result.ok) {
        await respondBlob(request.request_id, {
          ok: false,
          error: result.error,
        });
        return;
      }
      const response = result.value.response;
      await respondBlob(
        request.request_id,
        response.ok
          ? { ok: true, payload: response.payload }
          : { ok: false, error: response.error },
      );
    })();
    // 첫 credit. 이 요청을 받은 뒤에야 core가 chunk를 보낸다. budget이 비어 있으면
    // 다른 준비가 읽어 가 돌려줄 때 받는다.
    redistribute();
  }

  // secret.prepare를 처리한다. 값은 이 함수 안에서만 이어 붙이고 응답 뒤 바로 0으로 채운다.
  // 값은 로그·응답·오류에 넣지 않는다.
  async function respondSecretPrepare(
    request: SecretPipeRequest & { channel?: number },
  ): Promise<void> {
    const channel = request.channel;
    const entry = channel === undefined ? undefined : pending.get(channel);
    if (channel !== undefined) pending.delete(channel);
    const chunks = entry?.chunks ?? [];
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const value = new Uint8Array(total > SECRET_INPUT_MAX_BYTES ? 0 : total);
    let written = 0;
    if (total <= SECRET_INPUT_MAX_BYTES) {
      for (const chunk of chunks) {
        value.set(chunk, written);
        written += chunk.length;
      }
    }
    for (const chunk of chunks) chunk.fill(0);
    try {
      const submission = options.secrets === undefined
        ? undefined
        : scheduler.submit(
          "secret",
          () =>
            options.secrets!.handle(
              {
                request_id: request.request_id,
                op: request.op,
                payload: request.payload,
              },
              () => Promise.resolve(value.length === 0 ? undefined : value),
            ),
        );
      const result = submission === undefined
        ? undefined
        : submission.ok
        ? await submission.value.result
        : submission;
      if (!session.credentialUsable) return;
      if (result === undefined) {
        await respondBlob(request.request_id, {
          ok: false,
          error: {
            code: "unavailable",
            message: "보호 입력 통로가 열려 있지 않다",
          },
        });
        return;
      }
      if (!result.ok) {
        await respondBlob(request.request_id, {
          ok: false,
          error: result.error,
        });
        return;
      }
      const response = result.value;
      await respondBlob(
        request.request_id,
        response.ok
          ? { ok: true, payload: response.payload }
          : { ok: false, error: response.error },
      );
    } finally {
      value.fill(0);
    }
  }

  const session = startChild(options.streams, {
    onHello(hello) {
      if (hello.kind !== "platform/io") throw new Error("invalid worker kind");
      return session.send({ type: "ready" });
    },
    onStop() {
      for (const stream of prepares.values()) failPrepare(stream);
      // 요청을 만나지 못한 채 받아 둔 chunk(보호 입력 값 포함)를 비운다.
      for (const entry of pending.values()) {
        for (const chunk of entry.chunks) chunk.fill(0);
      }
      pending.clear();
      scheduler.close();
      prepareScheduler.close();
      log.close();
      return session.send({ type: "stopped" });
    },
    // bytes frame은 요청의 channel에 묶인다. 내용을 해석하지 않는다.
    onFrame(frame) {
      const stream = prepares.get(frame.channel);
      if (stream !== undefined) {
        feedPrepare(frame, stream);
        return;
      }
      // core가 요청을 보내기 전에 중단한 channel의 chunk는 값이 있어도 비우고 버린다.
      if (frame.kind === "abort") {
        const dropped = pending.get(frame.channel);
        if (dropped !== undefined) {
          for (const chunk of dropped.chunks) chunk.fill(0);
          pending.delete(frame.channel);
        }
        return;
      }
      if (frame.kind !== "bytes") return;
      // 빈 chunk는 내용이 아니다. settings 교환은 요청 json 앞에 온 chunk만 쓴다.
      if (frame.payload.length === 0) return;
      const entry = pending.get(frame.channel) ?? { chunks: [] };
      entry.chunks.push(frame.payload);
      pending.set(frame.channel, entry);
    },
    async onParent(message) {
      if (message.type !== "worker_request") return;
      // blob.prepare는 worker_request의 channel에 묶인 byte chunk로 온다(Q6).
      // core는 해석·hash 없이 backpressure를 지키며 넘기고, 설치는 이 worker만 한다.
      const request = message as unknown as BlobPipeRequest & {
        channel?: number;
      };
      // 보호 입력. 값은 요청 json에 앞서 온 byte chunk이고 JSON에는 용도·owner뿐이다.
      // 응답은 값 없는 준비 증거이며, 값은 keychain adapter가 저장한 뒤 바로 비운다.
      if (request.op === SECRET_PREPARE_OP) {
        await respondSecretPrepare(
          message as unknown as SecretPipeRequest & {
            channel?: number;
          },
        );
        return;
      }
      // settings 교환은 channel에 묶인 byte chunk로 온다. import는 문서를 모아
      // parse하고, export는 JSON payload의 mutations를 stringify한다(R3, R26).
      // byte chunk는 요청 json보다 먼저 도착해 있다.
      if (
        request.op === SETTINGS_IMPORT_OP || request.op === SETTINGS_EXPORT_OP
      ) {
        const settingsRequest = message as unknown as SettingsPipeRequest & {
          channel?: number;
        };
        const channel = settingsRequest.channel;
        const entry = channel === undefined
          ? { chunks: [] as Uint8Array[] }
          : pending.get(channel) ?? { chunks: [] as Uint8Array[] };
        if (channel !== undefined) pending.delete(channel);
        const submission = scheduler.submit("settings", async () => {
          if (settingsRequest.op === SETTINGS_EXPORT_OP) {
            return await settings.handle(
              {
                request_id: settingsRequest.request_id,
                op: settingsRequest.op,
                payload: settingsRequest.payload,
              },
              () => Promise.resolve(undefined),
            );
          }
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of entry.chunks) controller.enqueue(chunk);
              controller.close();
            },
          });
          const sink: Uint8Array[] = [];
          await stream.pipeTo(
            new WritableStream<Uint8Array>({
              write(chunk) {
                sink.push(chunk);
              },
            }),
          );
          const total = sink.reduce((sum, chunk) => sum + chunk.length, 0);
          const document = new Uint8Array(total);
          let offset = 0;
          for (const chunk of sink) {
            document.set(chunk, offset);
            offset += chunk.length;
          }
          return await settings.handle(
            {
              request_id: settingsRequest.request_id,
              op: settingsRequest.op,
              payload: settingsRequest.payload,
            },
            () => Promise.resolve(document),
          );
        });
        const result = submission.ok
          ? await submission.value.result
          : submission;
        if (!session.credentialUsable) return;
        if (!result.ok) {
          await session.send({
            type: "worker_response",
            request_id: message.request_id,
            ok: false,
            error: result.error,
          });
          return;
        }
        const response = result.value;
        await session.send(
          response.ok
            ? {
              type: "worker_response",
              request_id: message.request_id,
              ok: true,
              payload: response.payload,
            }
            : {
              type: "worker_response",
              request_id: message.request_id,
              ok: false,
              error: response.error,
            },
        );
        return;
      }
      // blob.read는 channel이 없다. blob.prepare만 channel의 chunk를 쓴다.
      if (
        request.op !== "blob.prepare" && request.op !== "blob.read" ||
        request.op === "blob.prepare" && request.channel === undefined
      ) {
        const authority = options.currentAuthority();
        if (!session.credentialUsable || !authority) {
          await session.send({
            type: "worker_response",
            request_id: message.request_id,
            ok: false,
            error: {
              code: "forbidden",
              message: "diagnostics authority required",
            },
          });
          return;
        }
        const submission = scheduler.submit(
          authority.principal,
          () => Promise.resolve(ingress.accept(message)),
        );
        const result = submission.ok
          ? await submission.value.result
          : submission;
        if (!session.credentialUsable) return;
        const response = result.ok ? result.value : result;
        await session.send(
          response.ok
            ? {
              type: "worker_response",
              request_id: message.request_id,
              ok: true,
              payload: response.value,
            }
            : {
              type: "worker_response",
              request_id: message.request_id,
              ok: false,
              error: response.error,
            },
        );
        return;
      }
      const pipeRequest = {
        request_id: request.request_id,
        op: request.op,
        payload: request.payload,
      };
      // blob.prepare는 stream으로 받는다. 이 handler는 준비가 끝나기를 기다리지 않는다:
      // 기다리면 dispatch가 이어 오는 bytes·end frame을 시작하지 못한다.
      if (request.op === "blob.prepare") {
        await startPrepare(pipeRequest, request.channel!);
        return;
      }
      const submission = scheduler.submit(
        "blob",
        async () =>
          await blob.handle(pipeRequest, () => Promise.resolve(undefined)),
      );
      const result = submission.ok ? await submission.value.result : submission;
      if (!session.credentialUsable) return;
      if (!result.ok) {
        await session.send({
          type: "worker_response",
          request_id: message.request_id,
          ok: false,
          error: result.error,
        });
        return;
      }
      const handled = result.value;
      // 읽은 바이트는 JSON control frame에 넣지 않는다. 256KiB 창의 base64가
      // control frame 한도를 넘기 때문이다. 요청 channel의 byte chunk로 먼저 보낸다.
      if (handled.response.ok && handled.bytes !== undefined) {
        for (const chunk of handled.bytes.chunks) {
          await session.sendBytes(handled.bytes.channel, chunk);
        }
      }
      const response = handled.response;
      await session.send(
        response.ok
          ? {
            type: "worker_response",
            request_id: message.request_id,
            ok: true,
            payload: response.payload,
          }
          : {
            type: "worker_response",
            request_id: message.request_id,
            ok: false,
            error: response.error,
          },
      );
    },
  });
  return session;
}

// 하루 backup 만들기(R8, R9). ledger 파일 이름은 데이터 root의 lophn.db다
// (architecture 3.1). schema 판은 설치된 마지막 migration version이다.
async function runDailyBackup(root: string, clock: Clock): Promise<void> {
  const ledgerPath = `${root}/lophn.db`;
  const stamp = backupStamp(clock.now());
  if (!stamp.ok) return;
  const version = installedSchemaVersion(root);
  await createBackup(ledgerPath, {
    root,
    schemaVersion: version,
    stamp: stamp.value,
    now: () => clock.now(),
  });
}

// 설치된 마지막 schema 판. migration 이력은 schema_migrations 표다. 아직 없으면 0이다.
function installedSchemaVersion(root: string): number {
  try {
    const db = new DatabaseSync(`${root}/lophn.db`, { readOnly: true });
    try {
      const found = db.prepare(
        "select coalesce(max(version), 0) as version from schema_migrations",
      ).get() as { version: number | bigint };
      return Number(found.version);
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}

// GC 관측의 설치 blob 파일 목록(R10). hash 폴더 2자 아래 나머지 62자다.
// core는 파일을 열지 않는다(responsiveness#R1). 관측 실패는 없다고 본다.
export async function listInstalledBlobs(
  root: string,
): Promise<
  Result<
    readonly {
      hash: string;
      observedAtMs: number;
      sizeBytes: number;
      registeredAtMs: number;
    }[]
  >
> {
  const objects = `${root}/blobs/sha256`;
  const found: {
    hash: string;
    observedAtMs: number;
    sizeBytes: number;
    registeredAtMs: number;
  }[] = [];
  let prefixes: string[];
  try {
    prefixes = [...Deno.readDirSync(objects)].map((entry) => entry.name);
  } catch {
    return ok([]);
  }
  for (const prefix of prefixes) {
    let names: string[];
    try {
      names = [...Deno.readDirSync(`${objects}/${prefix}`)].map((
        entry,
      ) => entry.name);
    } catch {
      continue;
    }
    for (const suffix of names) {
      try {
        const stat = await Deno.stat(`${objects}/${prefix}/${suffix}`);
        if (!stat.isFile) continue;
        const at = stat.mtime?.getTime() ?? 0;
        found.push({
          hash: `${prefix}${suffix}`,
          observedAtMs: at,
          sizeBytes: stat.size,
          registeredAtMs: at,
        });
      } catch {
        // 관측 중 사라진 파일은 목록에서 뺀다.
      }
    }
  }
  return ok(found);
}

// backup 폴더의 pending 표시 관측(T41). GC는 이것이 남아 있으면 실행하지 않는다.
export async function listBackupPending(
  root: string,
): Promise<Result<readonly { name: string; pending: boolean }[]>> {
  const entries: { name: string; pending: boolean }[] = [];
  try {
    for await (const entry of Deno.readDir(`${root}/backups`)) {
      if (!entry.isDirectory) continue;
      let pending = false;
      try {
        await Deno.stat(`${root}/backups/${entry.name}/backup.pending`);
        pending = true;
      } catch {
        // 표시가 없으면 완료·다른 것으로 본다.
      }
      entries.push({ name: entry.name, pending });
    }
  } catch {
    return ok([]);
  }
  return ok(entries);
}

export type BackupTick = {
  // check 한 번. due면 만들기를 scheduler에 낸다. 만들기가 아직 끝나지 않으면
  // 건너뛴다: 두 snapshot이 겹치지 않는다(R9). completion이 끝나면 다시 본다(R12).
  tick(): void;
  // 만들기가 진행 중인지. 테스트가 끝남을 기다린다.
  readonly inFlight: boolean;
  // 진행 중 만들기가 끝날 때까지 기다린다(테스트용).
  settle(): Promise<void>;
  close(): void;
};

// 하루 backup의 주기 check. entry가 interval마다 tick()을 부른다. 만들기는
// scheduler에 낸다: 복사·hash가 응답을 막지 않는다(responsiveness#R1).
export function createBackupTick(
  root: string,
  clock: Clock = systemClock,
): BackupTick {
  const backupScheduler = createIoScheduler();
  let inFlight = false;
  const settled: Promise<void>[] = [];
  return {
    tick() {
      if (inFlight) return;
      // due 판정 전에 세운다. 판정을 기다리는 동안 온 다음 tick이 같이 submit하지 않는다(R9).
      inFlight = true;
      void (async () => {
        let due = false;
        try {
          due = await backupDue(
            root,
            clock.now(),
            BACKUP_INTERVAL_MS,
          );
        } catch {
          // 판정을 읽지 못하면 이번 check는 건너뛴다. 다음 tick이 다시 본다.
          inFlight = false;
          return;
        }
        if (!due) {
          inFlight = false;
          return;
        }
        const submission = backupScheduler.submit("backup", async () => {
          return await runDailyBackup(root, clock);
        });
        if (!submission.ok) {
          inFlight = false;
          return;
        }
        settled.push(
          submission.value.result.then(() => {}, () => {}).finally(() => {
            // 실패한 새 묶음 때문에 마지막 완료를 지우지 않는다(R12). 만들기
            // 자체가 manifest 전에 실패하면 pending folder만 남는다.
            inFlight = false;
          }),
        );
      })();
    },
    get inFlight() {
      return inFlight;
    },
    async settle() {
      // tick의 내부 async가 백견을 만들기 전까지 기다린다(await backupDue가
      // microtask에서 suspend한다). 그 뒤 진행 작업이 있으면 끝남을 기다린다.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      while (settled.length) {
        const wait = settled.shift();
        if (wait !== undefined) await wait;
      }
    },
    close() {
      backupScheduler.close();
    },
  };
}

export async function runPlatformIo(root: string): Promise<void> {
  // Only the entry owns console routing. Helper modules never change global console.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  const session = await createPlatformIo({
    root,
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
    catalog: { components: ["platform/core", "platform/io"], locations: {} },
    // Product authority is supplied by core/T9 composition, not inferred from hello.
    currentAuthority: () => undefined,
    // 보호 입력은 OS keychain adapter로만 간다(platform/secrets#R1, R2, R8). 준비 증거는
    // 응답으로 core에 돌려주고 core의 writer가 ledger에 남긴다: 이 worker는 ledger를 쓰지 않고
    // 값을 registry에도 두지 않는다.
    secrets: createSecretPipe({
      work: createSecretWork({
        keychain: productKeychain(SECRET_TOOL_PATHS),
        preparationId: () => `prep_${crypto.randomUUID()}`,
      }),
    }),
  });
  // 하루 backup은 I/O worker의 몫이다(platform/backup-and-migration#R9,
  // responsiveness#R1). core command 흐름 밖에서 주기 check를 돌리고, 차례면
  // backup 만들기를 scheduler에 낸다. 복사·hash가 응답을 막지 않는다.
  const backup = createBackupTick(root);
  const timer = setInterval(() => backup.tick(), BACKUP_CHECK_INTERVAL_MS);
  // blob GC 관측(R10). 실제 삭제는 정지 유지보수에서만 한다. 참조 행 관측은
  // ledger가 아니라 정지 유지보수의 몫이므로, 여기서는 참조를 모른다 — 관측은
  // 기록을 하나도 만들거나 지우지 않는다(unknown ≠ unreferenced, R9: 참조를
  // 모르는 상태의 기록은 유예기간의 근거를 흐트러뜨린다). 기록 남기기·지우기는
  // 참조를 아는 관측(collectGarbage)의 몫이다. 기록 실패·관측 실패가 session을
  // 끝내지 않는다: 다음 check가 다시 본다.
  const gcTimer = setInterval(async () => {
    await observeBlobGc({
      root,
      listInstalled: () => listInstalledBlobs(root),
      listUnreferenced: () => readUnreferencedRecords(root),
      listBackupPending: () => listBackupPending(root),
      removeBlob: () => Promise.resolve(ok(undefined)),
      listTmp: () => Promise.resolve(ok([])),
      removeTmp: () => Promise.resolve(ok(undefined)),
      nowMs: () => Date.now(),
    });
  }, GC_CHECK_INTERVAL_MS);
  try {
    await session.run();
  } finally {
    clearInterval(timer);
    clearInterval(gcTimer);
    backup.close();
  }
}
