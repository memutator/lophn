import {
  type ChildSession,
  type ChildStreams,
  createIoScheduler,
  startChild,
} from "../../../packages/platform/responsiveness/mod.ts";
import {
  createDiagnosticIngress,
  createLogFiles,
  createSafeLog,
  type DiagnosticAuthority,
  type DiagnosticCatalog,
} from "../../../packages/platform/diagnostics/mod.ts";
import {
  createBlobStoreWork,
  systemQuota,
} from "../../../packages/platform/blob-store/mod.ts";
import { type BlobPipe, type BlobPipeRequest, createBlobPipe } from "./blob.ts";

export type PlatformIoOptions = {
  root: string;
  streams: ChildStreams;
  catalog: DiagnosticCatalog;
  currentAuthority(): DiagnosticAuthority | undefined;
  // blob 준비 통로. 없으면 blob.prepare는 거절한다.
  blob?: BlobPipe;
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
  const blob = options.blob ?? createBlobPipe({
    work: createBlobStoreWork({
      root: options.root,
      suffix: options.suffix ?? (() => crypto.randomUUID()),
      // 제품 여유는 실제 관측이다. 테스트가 fake quota를 넣는다.
      quota: systemQuota(),
    }),
    suffix: options.suffix ?? (() => crypto.randomUUID()),
  });
  // blob 준비는 요청 json에 앞서(뒤에) 오는 byte chunk를 channel별로 모은다(Q6).
  // core는 해석·hash 없이 넘기고, 이 worker만 모아 내용을 만든다.
  const pending = new Map<
    number,
    { chunks: Uint8Array[]; request?: BlobPipeRequest }
  >();
  const ingress = createDiagnosticIngress({
    log,
    currentAuthority: () =>
      session.credentialUsable ? options.currentAuthority() : undefined,
  });
  const session = startChild(options.streams, {
    onHello(hello) {
      if (hello.kind !== "platform/io") throw new Error("invalid worker kind");
      return session.send({ type: "ready" });
    },
    onStop() {
      scheduler.close();
      log.close();
      return session.send({ type: "stopped" });
    },
    // bytes frame은 요청의 channel에 묶인다. 내용을 해석하지 않는다.
    onFrame(frame) {
      if (frame.kind !== "bytes") return;
      // 빈 chunk는 내용이 아니다. 준비는 요청 json 앞에 온 chunk만 쓴다.
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
      const channel = request.channel;
      const pipeRequest = {
        request_id: request.request_id,
        op: request.op,
        payload: request.payload,
      };
      // byte chunk는 요청 json보다 먼저 도착해 있다. 여기서 기다리면 dispatch가
      // 뒤 frame을 시작하지 못한다.
      const entry = channel === undefined
        ? { chunks: [] as Uint8Array[] }
        : pending.get(channel) ?? { chunks: [] };
      if (channel !== undefined) pending.delete(channel);
      const submission = scheduler.submit(
        "blob",
        async () => {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of entry.chunks) {
                if (chunk.length > 0) controller.enqueue(chunk);
              }
              controller.close();
            },
          });
          return await blob.handle(pipeRequest, () => Promise.resolve(stream));
        },
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
    },
  });
  return session;
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
  });
  await session.run();
}
