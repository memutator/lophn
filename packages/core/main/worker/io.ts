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
import { type ErrorCode, ok, type Result } from "../../../base/mod.ts";
import {
  type BlobPipe,
  type BlobPipeRequest,
  createBlobPipe,
} from "../../storage/blobs/worker/pipe.ts";
import {
  type Frame,
  STREAM_CHUNK_MAX_BYTES,
} from "../../../protocol/base/mod.ts";

// blob GC check 주기(기동 시와 매일). 관측은 삭제가 아니다.
const GC_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// worker가 받아 두기로 한 blob 바이트 전체의 상한(credit budget). 모든 blob.prepare
// channel이 이 하나를 나눠 쓴다: 준 credit 중 아직 blob store가 읽어 가지 않은 합이 이
// 값을 넘지 않는다. dispatch가 느린 요청에 묶여 있어도 pipe에서 미리 읽은 frame이
// child.ts의 read-ahead 한도(두 chunk)에서 제어 frame 몫을 남기도록 chunk 하나로 잡는다.
const BLOB_PREPARE_WORKER_BUDGET = STREAM_CHUNK_MAX_BYTES;
// 한 channel이 쥘 수 있는 credit. 아직 시작하지 못한(scheduler 대기) 준비는 한 조각만
// 쥐게 해서, 돌고 있는 준비가 budget을 다 쓰지 못하는 일이 없게 한다.
const BLOB_PREPARE_WORKER_WINDOW = BLOB_PREPARE_WORKER_BUDGET;
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

type PlatformIoOptions = {
  root: string;
  streams: ChildStreams;
  catalog: DiagnosticCatalog;
  currentAuthority(): DiagnosticAuthority | undefined;
  // blob 준비 통로. 없으면 blob.prepare는 거절한다.
  blob?: BlobPipe;
  // 준비 파일 접미사. 내용에서 파생하지 않는다.
  suffix?: () => string;
};

// byte chunk는 제어 메시지가 아니다. 요청의 channel에 묶인다.
async function createPlatformIo(
  options: PlatformIoOptions,
): Promise<ChildSession> {
  const files = await createLogFiles(options.root);
  const log = createSafeLog({ catalog: options.catalog, sink: files.write });
  const scheduler = createIoScheduler();
  // blob.prepare 준비는 chunk가 오는 내내 자리를 쥔다. 일반 scheduler를 나눠 쓰면 준비가
  // 자리를 다 쥔 채 chunk를 기다리고, diagnostics 요청이 자리를 기다리며 dispatch를
  // 막아 그 chunk를 못 읽는 교착이 된다. 준비는 자기 scheduler를 쓴다.
  const prepareScheduler = createIoScheduler();
  const blob = options.blob ?? createBlobPipe({
    work: createBlobStoreWork({
      root: options.root,
      suffix: options.suffix ?? (() => crypto.randomUUID()),
      // 제품 여유는 실제 관측이다.
      quota: systemQuota(),
    }),
    suffix: options.suffix ?? (() => crypto.randomUUID()),
  });
  // blob.prepare는 요청 json이 먼저 오고 chunk가 이어 온다. 준비는 chunk가 오는 동안
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
  // 읽어 간 만큼만 credit을 다시 준다. 응답은 준비가 끝난 뒤에 따로 보낸다.
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

  const session = startChild(options.streams, {
    onHello(hello) {
      if (hello.kind !== "platform/io") throw new Error("invalid worker kind");
      return session.send({ type: "ready" });
    },
    onStop() {
      for (const stream of prepares.values()) failPrepare(stream);
      scheduler.close();
      prepareScheduler.close();
      log.close();
      return session.send({ type: "stopped" });
    },
    // bytes frame은 요청의 channel에 묶인다. 내용을 해석하지 않는다.
    onFrame(frame) {
      const stream = prepares.get(frame.channel);
      if (stream !== undefined) feedPrepare(frame, stream);
    },
    async onParent(message) {
      if (message.type !== "worker_request") return;
      // blob.prepare는 worker_request의 channel에 묶인 byte chunk로 온다.
      // core는 해석·hash 없이 backpressure를 지키며 넘기고, 설치는 이 worker만 한다.
      const request = message as unknown as BlobPipeRequest & {
        channel?: number;
      };
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

// GC 관측의 설치 blob 파일 목록. hash 폴더 2자 아래 나머지 62자다.
// core는 파일을 열지 않는다. 관측 실패는 없다고 본다.
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

export async function runPlatformIo(root: string): Promise<void> {
  // Only the entry owns console routing. Helper modules never change global console.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  const session = await createPlatformIo({
    root,
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
    catalog: { components: ["platform/core", "platform/io"], locations: {} },
    // Product authority is supplied by the core entry composition, not inferred from hello.
    currentAuthority: () => undefined,
  });
  // blob GC 관측. 실제 삭제는 정지 유지보수에서만 한다. 참조 행 관측은
  // ledger가 아니라 정지 유지보수의 몫이므로, 여기서는 참조를 모른다 — 관측은
  // 기록을 하나도 만들거나 지우지 않는다(unknown ≠ unreferenced: 참조를
  // 모르는 상태의 기록은 유예기간의 근거를 흐트러뜨린다). 기록 남기기·지우기는
  // 참조를 아는 관측(collectGarbage)의 몫이다. 기록 실패·관측 실패가 session을
  // 끝내지 않는다: 다음 check가 다시 본다.
  const gcTimer = setInterval(async () => {
    await observeBlobGc({
      root,
      listInstalled: () => listInstalledBlobs(root),
      listUnreferenced: () => readUnreferencedRecords(root),
      removeBlob: () => Promise.resolve(ok(undefined)),
      listTmp: () => Promise.resolve(ok([])),
      removeTmp: () => Promise.resolve(ok(undefined)),
      nowMs: () => Date.now(),
    });
  }, GC_CHECK_INTERVAL_MS);
  try {
    await session.run();
  } finally {
    clearInterval(gcTimer);
  }
}
