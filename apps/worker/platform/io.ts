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
import {
  BACKUP_INTERVAL_MS,
  backupDue,
  backupStamp,
  createBackup,
} from "../../../packages/platform/backup-and-migration/mod.ts";
import { type Clock, systemClock } from "../../../packages/base/mod.ts";
import { DatabaseSync } from "node:sqlite";
import { type BlobPipe, type BlobPipeRequest, createBlobPipe } from "./blob.ts";
import {
  createSettingsPipe,
  type SettingsPipe,
  type SettingsPipeRequest,
} from "./settings.ts";
import {
  SETTINGS_EXPORT_OP,
  SETTINGS_IMPORT_OP,
} from "../../../packages/contracts/platform/mod.ts";

// 하루 backup check 주기. 차례가 지나면 만든다. 만들기가 늦어도 다음 check가 본다.
export const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;

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
  });
  // 하루 backup은 I/O worker의 몫이다(platform/backup-and-migration#R9,
  // responsiveness#R1). core command 흐름 밖에서 주기 check를 돌리고, 차례면
  // backup 만들기를 scheduler에 낸다. 복사·hash가 응답을 막지 않는다.
  const backup = createBackupTick(root);
  const timer = setInterval(() => backup.tick(), BACKUP_CHECK_INTERVAL_MS);
  try {
    await session.run();
  } finally {
    clearInterval(timer);
    backup.close();
  }
}
