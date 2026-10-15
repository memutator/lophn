import type { Clock, Result } from "../../../base/mod.ts";
import { err, internalError, ok } from "../../../base/mod.ts";
import {
  type AuthenticatedContext,
  authenticatedContextSchema,
  type RequestContext,
} from "../../../protocol/server/mod.ts";
import type {
  BlobFieldDefinition,
  BlobReadInput,
  PreparedBlob,
} from "../../../protocol/storage/mod.ts";
import type { SecretPreparation } from "../../../protocol/secrets/mod.ts";
import type { ReadHandler } from "../../server/mod.ts";
import { createWorkspaceRelay, type WorkspaceRelay } from "../../server/mod.ts";
import {
  type DiagnosticListSource,
  diagnosticsCheckRead,
  diagnosticsListRead,
  type DoctorSource,
  platformStatusReads,
  type StatusSource,
} from "../../diagnostics/mod.ts";
import {
  createEventDispatcher,
  createReaderEventBackend,
  createReaderPool,
  createSubscriptionStore,
  type EventSession,
  type KnownSecretMatch,
  openConnection,
  type ReaderPool,
  type SubscriptionStore,
  type Writer,
} from "../../storage/ledger/mod.ts";
import type {
  WriterRequest,
  WriterResponse,
} from "../../storage/ledger/writer-message.ts";
import { finishBlobRead, planBlobRead } from "../../storage/blobs/mod.ts";
import { authorize } from "../../server/identity/mod.ts";
import type { Assembled } from "./registration.ts";
import { PROVIDER_SECRET_OWNER } from "../../lophn-agent/providers/mod.ts";
import { openSecretStore, withSecretSync } from "../../secrets/store.ts";
import type { KeychainAdapter } from "../../secrets/mod.ts";

export type CoreRuntime = {
  writer: Writer;
  confirmation(body: {
    action: "issue" | "close-window" | "clear" | "consume";
    request?: unknown;
    windowId?: string;
  }): Promise<Result<unknown>>;
  record(context: AuthenticatedContext): Promise<Result<void>>;
  // 값 없는 secret 준비 증거를 writer가 ledger에 남긴다.
  recordSecretPreparation(
    preparation: SecretPreparation,
  ): Promise<Result<void>>;
  // 알려진 secret 값과 일치하는 부분을 찾는 얼굴. 값 목록은 내보내지 않는다. core 프로세스 안의
  // 안전화(메시지 본문)가 쓴다.
  knownSecrets: KnownSecretMatch;
  // ledger 밖에서 바뀐 secret 보관(MCP OAuth token의 교환·갱신)을 알려진 값 registry에 맞춘다. 새 값이 안전화에
  // 들고 옛 값이 회수된 뒤에 끝난다.
  syncSecrets(): Promise<Result<void>>;
  notePrepared(prepared: PreparedBlob, nowMs: number): Promise<Result<void>>;
  prunePrepared(nowMs: number): Promise<Result<void>>;
  readers: ReaderPool;
  // credential_ref의 현재 context. 폐기·만료·없는 자격은 err다. worker route 서빙이
  // 요청 자격을 다시 읽는 데 쓴다.
  current(credentialRef: string): Result<RequestContext>;
  reads: Map<string, ReadHandler>;
  memory: WorkspaceRelay;
  events: ReturnType<typeof createReaderEventBackend>;
  subscriptions: SubscriptionStore;
  wake(): void;
  // core 안의 구독 session을 dispatcher에 올려 새 event가 올 때 따라잡게 한다. 돌려받은 함수로 뺀다.
  track(session: EventSession): () => void;
  close(): Promise<void>;
};

// writer Worker가 close에 답하는 기한. 부하로 기동이 느린 writer가 닫기 요청을 못 읽어도
// 기동 실패·종료가 멈추지 않게 한다.
const WRITER_CLOSE_MS = 15_000;

// 닫기 요청이 기한 안에 답하지 않으면 expire를 부른다. 답이 오면 부르지 않는다.
export async function closeWithin(
  close: () => Promise<unknown>,
  ms: number,
  expire: () => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"expired">((resolve) => {
    timer = setTimeout(() => resolve("expired"), ms);
  });
  try {
    const outcome = await Promise.race([close(), expired]);
    if (outcome === "expired") expire();
  } finally {
    clearTimeout(timer);
  }
}

const WRITER_DEAD = {
  code: "unavailable" as const,
  message: "writer가 끝났다",
};

// lock과 schema step 다음이다. writer·reader Worker, event 배포, API read를 연다.
export async function openRuntime(input: {
  ledgerPath: string;
  clock: Clock;
  seed: number;
  modules: readonly string[];
  assembled: Assembled;
  source: StatusSource;
  // doctor 관측. 없으면 diagnostics/check는 등록하지 않는다.
  doctor?: DoctorSource;
  // secret store가 값을 읽는 OS keychain. 참조가 있을 때 부른다.
  keychain: () => KeychainAdapter;
  // 기록된 안전 진단. 없으면 diagnostics/list는 등록하지 않는다.
  diagnostics?: DiagnosticListSource;
  // blob 읽기. field 등록과 바이트 관측은 core가 넣는다. 없으면 읽기는 unavailable이다.
  blob?: {
    fields: readonly BlobFieldDefinition[];
    read(
      hash: string,
      offset: number,
      length: number,
    ): Promise<
      Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>
    >;
  };
}): Promise<Result<CoreRuntime>> {
  const openedWriter = openProductWriter(input.ledgerPath, {
    modules: [...input.modules],
    // writer는 자기 system clock으로 커밋 시각을 따라간다.
    clock: "system",
    seed: input.seed,
    // settings 등록 파일. writer가 apply·reload command를 다시 모은다.
    settings: settingsModule(),
  });
  // reader Worker는 건넨 module마다 createReaderRegistration을 부른다. export가 있는 팀 모듈만 건넨다.
  // settings 등록 파일도 같은 풀로 붙는다. settings read는 ledger snapshot을 읽는다.
  const readerModules: URL[] = [new URL(settingsModule())];
  for (const url of input.modules) {
    const module = (await import(url)) as {
      createReaderRegistration?: unknown;
      createEventRegistration?: unknown;
    };
    // event 정의·공개 정책만 내는 module도 reader에 건넨다. events/list registry가 모은다.
    if (
      typeof module.createReaderRegistration === "function" ||
      typeof module.createEventRegistration === "function"
    ) {
      readerModules.push(new URL(url));
    }
  }
  // 격리됐다 다시 뜬 reader는 알려진 secret 값을 모른다. secret store가 현재 값을 다시 넣는다.
  const resync: { run?: () => Promise<unknown> } = {};
  const readers = await createReaderPool(input.ledgerPath, [
    new URL("../../storage/ledger/reader-registration.ts", import.meta.url),
    // createReaderRegistration을 내보내는 팀 read도 같은 풀로 붙는다.
    ...readerModules,
  ], { onRespawn: () => resync.run?.() });
  if (!readers.ok) {
    await openedWriter.writer.close();
    return readers;
  }
  // secret store: ledger의 현재 secret 참조의 값을 keychain에서 읽어 reader의 알려진 값
  // registry에 넣는다. 기동 때 한 번 맞춘다(못 읽으면 reader가 준비되지 않음이라 알려진 값을
  // 모른 채 원문을 내보내지 않고, 재시도가 이어서 맞춘다).
  const secretStore = openSecretStore({
    ledgerPath: input.ledgerPath,
    channel: readers.value.known,
    keychain: input.keychain,
    sources: input.assembled.secretRefs,
    // provider credential은 Disconnect로 참조가 사라지면 OS 값도 지운다.
    reclaim: {
      purpose: "provider_credential",
      owners: [PROVIDER_SECRET_OWNER],
    },
  });
  resync.run = () => secretStore.sync();
  await secretStore.sync();
  // 이전 실행이 지우지 못하고 남긴 provider 값을 쓸어 낸다. 참조 때문에 keychain이 이미 열렸을 때만 쓴다
  // (참조 없는 core는 keychain을 열지 않는다). 기동 중에는 보호 입력이 아직 없어 바로 지운다. 지우지 못해도
  // 기동은 막지 않고 주기 쓸기가 이어서 지운다.
  await secretStore.sweep({ immediate: true });
  const writer = withSecretSync(
    openedWriter.writer,
    secretStore.sync,
    input.assembled.secretRefs,
  );
  const root = input.ledgerPath.slice(0, input.ledgerPath.lastIndexOf("/"));
  const directory = `${root}/derived/api-subscriptions`;
  await Deno.mkdir(directory, { recursive: true });
  const subscriptions = await createSubscriptionStore(
    directory,
    input.source.ledgerId,
  );
  if (!subscriptions.ok) {
    secretStore.stop();
    readers.value.close();
    await openedWriter.writer.close();
    return subscriptions;
  }
  const status = platformStatusReads(input.source, input.clock);
  // doctor의 무거운 검사는 worker가 한다. core는 그 관측만 읽는다.
  const doctor = input.doctor
    ? diagnosticsCheckRead(input.doctor, input.clock)
    : undefined;
  const diagnosticList = input.diagnostics
    ? diagnosticsListRead(input.diagnostics)
    : undefined;
  const reads = new Map<string, ReadHandler>([
    ["platform/status", status.status],
    ["platform/health", status.health],
    ...(doctor ? [["diagnostics/check", doctor] as [string, ReadHandler]] : []),
    ...(diagnosticList
      ? [["diagnostics/list", diagnosticList] as [string, ReadHandler]]
      : []),
    [
      "blobs/read",
      (ctx, body) => blobReadHandler(input.ledgerPath, input.blob, ctx, body),
    ],
    // reader Worker가 등록한 ledger read. 팀 read는 그 뒤에 같은 풀로 붙는다.
    // settings read도 같은 풀이다. contract ROUTES가 이미 고정한 route 경로다.
    ...[
      "commands/result",
      "events/list",
      "settings/definitions",
      "settings/get",
      "settings/history",
    ].map((
      key,
    ): [string, ReadHandler] => [
      key,
      (ctx, body) =>
        readers.value.read(
          {
            resource: key.slice(0, key.indexOf("/")),
            method: key.slice(key.indexOf("/") + 1),
          },
          ctx,
          body,
        ),
    ]),
    ...input.assembled.reads.map((read): [string, ReadHandler] => [
      `${read.route.resource}/${read.route.method}`,
      (ctx, body) => readers.value.read(read.route, ctx, body),
    ]),
    // pool 밖에서 바로 여는 read(format read). ledger snapshot 없이 handler가
    // 자기 결과를 내놓고, dispatcher가 기다리므로 Promise Result도 받는다.
    ...input.assembled.apiReads.map((read): [string, ReadHandler] => [
      `${read.route.resource}/${read.route.method}`,
      (ctx, body) => Promise.resolve(read.handle(ctx, body)),
    ]),
  ]);
  const events = createReaderEventBackend(
    readers.value,
    (ref) => Promise.resolve(currentCredential(input.ledgerPath, ref)),
  );
  const dispatcher = createEventDispatcher((catchUp) => {
    const timer = setInterval(catchUp, 200);
    return () => clearInterval(timer);
  });
  // 현재 보기 relay는 ledger 밖 core 메모리다. run→session 확인은 reader가
  // 등록한 runs/read handler로 한다. 아직 없으면 fail-closed다.
  const runRead = reads.get("runs/read");
  const memory = createWorkspaceRelay({
    runSession: runRead && ((ctx, run) => runSessionOf(runRead, ctx, run)),
  });
  return ok({
    writer,
    confirmation: openedWriter.confirmation,
    record: openedWriter.record,
    recordSecretPreparation: openedWriter.recordSecretPreparation,
    knownSecrets: secretStore.known,
    syncSecrets: () => secretStore.sync(),
    notePrepared: openedWriter.notePrepared,
    prunePrepared: openedWriter.prunePrepared,
    readers: readers.value,
    current: (ref) => currentCredential(input.ledgerPath, ref),
    reads,
    memory,
    events,
    subscriptions: subscriptions.value,
    wake: () => dispatcher.wake(),
    track: (session) => dispatcher.add(session),
    async close() {
      dispatcher.close();
      secretStore.stop();
      readers.value.close();
      subscriptions.value.close();
      await openedWriter.writer.close();
    },
  });
}

// run → session 확인. 등록된 runs/read handler를 그대로 부른다.
// 다른 session은 부재와 같다.
async function runSessionOf(
  handler: ReadHandler,
  ctx: AuthenticatedContext,
  run: string,
): Promise<Result<string | null>> {
  const result = await handler(ctx, { run });
  if (!result.ok) return result;
  const output = result.value as { run?: { session?: string | null } };
  return ok(output.run?.session ?? null);
}

// settings 등록 파일. settingsRoutes에 붙는 registry·command·read는
// settings.ts가 만든다.
function settingsModule(): string {
  return new URL("../../config/settings.ts", import.meta.url).href;
}

// openWriter는 path만 worker name에 넣는다. 팀 모듈은 core가 name에 더한다.
function openProductWriter(
  path: string,
  extra: {
    modules: string[];
    clock: "system";
    seed: number;
    settings?: string;
  },
): {
  writer: Writer;
  confirmation(body: {
    action: "issue" | "close-window" | "clear" | "consume";
    request?: unknown;
    windowId?: string;
  }): Promise<Result<unknown>>;
  record(context: AuthenticatedContext): Promise<Result<void>>;
  recordSecretPreparation(
    preparation: SecretPreparation,
  ): Promise<Result<void>>;
  notePrepared(prepared: PreparedBlob, nowMs: number): Promise<Result<void>>;
  prunePrepared(nowMs: number): Promise<Result<void>>;
} {
  const worker = new Worker(
    new URL("../../storage/ledger/writer-worker.ts", import.meta.url),
    {
      type: "module",
      name: JSON.stringify({ path, ...extra }),
    },
  );
  let nextId = 1;
  const pending = new Map<number, {
    resolve: (message: WriterResponse) => void;
  }>();
  let dead: Result<never> | undefined;
  const fail = () => {
    if (dead !== undefined) return;
    dead = err(WRITER_DEAD);
    for (const waiting of pending.values()) {
      waiting.resolve({ id: 0, op: "failed", body: WRITER_DEAD });
    }
    pending.clear();
  };
  worker.onmessage = (event: MessageEvent<WriterResponse>) => {
    const message = event.data;
    if (message.op === "failed" && message.id === 0) return fail();
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    waiting.resolve(message);
    if (message.op === "closed") fail();
  };
  worker.onerror = (event) => {
    event.preventDefault();
    fail();
  };
  const send = (request: WriterRequest): Promise<WriterResponse> => {
    if (dead !== undefined && !dead.ok) {
      return Promise.resolve({
        id: request.id,
        op: "failed",
        body: dead.error,
      });
    }
    return new Promise((resolve) => {
      pending.set(request.id, { resolve });
      try {
        worker.postMessage(request);
      } catch {
        pending.delete(request.id);
        fail();
        resolve({ id: request.id, op: "failed", body: WRITER_DEAD });
      }
    });
  };
  return {
    writer: {
      command(ctx, envelope) {
        return send({ id: nextId++, op: "command", ctx, envelope }).then(
          (message) => {
            if (message.op === "command") return message.body;
            if (message.op === "failed") return err(message.body);
            return err(internalError());
          },
        );
      },
      readResult(ctx, key) {
        return send({ id: nextId++, op: "read-result", ctx, key }).then(
          (message) => {
            if (message.op === "read-result") return message.body;
            if (message.op === "failed") return err(message.body);
            return err(internalError());
          },
        );
      },
      async close() {
        if (dead !== undefined) return;
        // writer가 아직 module을 올리는 중이거나 멈춰 있어도 닫기가 영원히 기다리지 않는다.
        // SQLite commit은 원자적이라 기한이 지나면 Worker를 끝내고 죽은 것으로 친다.
        await closeWithin(
          () => send({ id: nextId++, op: "close" }),
          WRITER_CLOSE_MS,
          () => {
            worker.terminate();
            fail();
          },
        );
      },
    },
    // main↔core 비공개 통로의 확인 등록을 writer 프로세스의 registry로 넘긴다.
    confirmation(body: {
      action: "issue" | "close-window" | "clear" | "consume";
      request?: unknown;
      windowId?: string;
    }) {
      return send({
        id: nextId++,
        op: "confirmation",
        ...body,
      } as unknown as WriterRequest).then((message) => {
        const reply = message as unknown as {
          op: string;
          body: Result<unknown>;
        };
        if (reply.op === "confirmation") return reply.body;
        if (message.op === "failed") return err(message.body);
        return err({
          code: "unavailable",
          message: "확인 등록을 전달하지 못했다",
        });
      });
    },
    notePrepared(prepared, nowMs) {
      return send({
        id: nextId++,
        op: "blob-prepared",
        prepared,
        nowMs,
      } as unknown as WriterRequest).then(blobNoted);
    },
    prunePrepared(nowMs) {
      return send({
        id: nextId++,
        op: "blob-prune",
        nowMs,
      } as unknown as WriterRequest).then(blobNoted);
    },

    recordSecretPreparation(preparation) {
      return send({
        id: nextId++,
        op: "record-secret-preparation",
        preparation,
      } as unknown as WriterRequest).then((message) => {
        if ((message.op as string) === "recorded") return ok(undefined);
        if (message.op === "failed") return err(message.body);
        return err({
          code: "unavailable",
          message: "준비 증거를 남기지 못했다",
        });
      });
    },

    record(context) {
      return send({
        id: nextId++,
        op: "record-credential",
        context,
      } as unknown as WriterRequest).then((message) => {
        if ((message.op as string) === "recorded") return ok(undefined);
        if (message.op === "failed") return err(message.body);
        return err({
          code: "unavailable",
          message: "credential 기록을 남기지 못했다",
        });
      });
    },
  };
}

function blobNoted(message: WriterResponse): Result<void> {
  if ((message.op as string) === "blob-noted") return ok(undefined);
  if (message.op === "failed") return err(message.body);
  return err({
    code: "unavailable",
    message: "준비 참조를 writer에 알리지 못했다",
  });
}

type BlobReadSource = {
  fields: readonly BlobFieldDefinition[];
  read(
    hash: string,
    offset: number,
    length: number,
  ): Promise<
    Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>
  >;
};

type BlobRefAuthorizer = (
  current: RequestContext,
  reference: { owner_kind: string; owner_key: string },
) => Result<void>;

// /v1/blobs/read. 참조 행은 ledger snapshot에서, 바이트는 그 뒤 I/O worker에서 읽는다.
// scope는 시작과 바이트 반환 직전에 다시 검사한다.
export function blobReadHandler(
  ledgerPath: string,
  blob: BlobReadSource | undefined,
  ctx: RequestContext,
  body: unknown,
  // 참조 하나를 이 자격으로 읽을 수 있는지다. 기본은 일반 `blobs/read` operation이다.
  authorizeRef: BlobRefAuthorizer = (current, reference) =>
    authorize(current, "blobs/read", {
      owner_kind: reference.owner_kind,
      owner_key: reference.owner_key,
    }),
): Promise<Result<unknown>> {
  if (!blob) {
    return Promise.resolve(
      err({ code: "unavailable", message: "blob 읽기가 없다" }),
    );
  }
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return Promise.resolve(opened);
  const judging = { fields: blob.fields, authorize: authorizeRef };
  // 참조 판정만 snapshot에서 하고 바로 닫는다. 바이트는 그 뒤에 읽는다.
  const plan = planBlobRead(
    opened.value.sql,
    judging,
    ctx,
    body as BlobReadInput,
  );
  opened.value.close();
  if (!plan.ok) return Promise.resolve(plan);
  if (plan.value.kind === "answer") {
    return Promise.resolve(ok(plan.value.result));
  }
  return finishBlobRead({ ...judging, bytes: blob }, ctx, plan.value);
}

export function currentCredential(
  ledgerPath: string,
  credentialRef: string,
): Result<RequestContext> {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return opened;
  try {
    const row = opened.value.sql.get(
      `select context, state from credentials where credential_ref = ?`,
      [credentialRef],
    );
    if (
      !row || row["state"] !== "active" || typeof row["context"] !== "string"
    ) {
      return err({ code: "unauthorized", message: "현재 credential이 없다" });
    }
    const context = authenticatedContextSchema.safeParse(
      JSON.parse(row["context"]),
    );
    if (!context.success || context.data.credential_ref !== credentialRef) {
      return err({ code: "unauthorized", message: "현재 credential이 없다" });
    }
    return ok(context.data);
  } catch {
    return err({
      code: "unavailable",
      message: "credential 기록을 읽지 못했다",
    });
  } finally {
    opened.value.close();
  }
}
