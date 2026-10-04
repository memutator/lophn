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
import {
  type SettingsPipe,
  type SettingsPipeRequest,
  createSettingsPipe,
} from "./settings.ts";
import { SETTINGS_EXPORT_OP, SETTINGS_IMPORT_OP } from "../../../packages/contracts/platform/mod.ts";

export type PlatformIoOptions = {
  root: string;
  streams: ChildStreams;
  catalog: DiagnosticCatalog;
  currentAuthority(): DiagnosticAuthority | undefined;
  // blob 준비 통로. 없으면 blob.prepare는 거절한다.
  blob?: BlobPipe;
  // settings 교환 통로. 없으면 settings.import·export는 거절한다.
  settings?: SettingsPipe;
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
  const settings = options.settings ?? createSettingsPipe();
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
      // settings 교환은 channel에 묶인 byte chunk로 온다. import는 문서를 모아
      // parse하고, export는 JSON payload의 mutations를 stringify한다(R3, R26).
      if (request.op === SETTINGS_IMPORT_OP || request.op === SETTINGS_EXPORT_OP) {
        const settingsRequest = message as unknown as SettingsPipeRequest & {
          channel?: number;
        };
        const channel = settingsRequest.channel;
        const entry = channel === undefined
          ? { chunks: [] as Uint8Array[] }
          : pending.get(channel) ?? { chunks: [] as Uint8Array[] };
        if (channel !== undefined) pending.delete(channel);
        const collected: Uint8Array[] = [];
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
        return;
      }
      if (request.op !== "blob.prepare" || request.channel === undefined) {
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
      const entry = pending.get(channel) ?? { chunks: [] };
      pending.delete(channel);
      const pipeRequest = {
        request_id: request.request_id,
        op: request.op,
        payload: request.payload,
      };
      const submission = scheduler.submit(
        "blob",
        async () => {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of entry.chunks) controller.enqueue(chunk);
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
