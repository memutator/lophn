import type { Clock, Result } from "../../packages/base/mod.ts";
import {
  err,
  internalError,
  isManualClock,
  ok,
} from "../../packages/base/mod.ts";
import type {
  AuthenticatedContext,
  RequestContext,
} from "../../packages/contracts/platform/mod.ts";
import { authenticatedContextSchema } from "../../packages/contracts/platform/mod.ts";
import type { ReadHandler } from "../../packages/platform/api/mod.ts";
import {
  createWorkspaceRelay,
  type WorkspaceRelay,
} from "../../packages/platform/api/mod.ts";
import {
  type DiagnosticListSource,
  diagnosticsCheckRead,
  diagnosticsListRead,
  type DoctorSource,
  platformStatusReads,
  type StatusSource,
} from "../../packages/platform/diagnostics/mod.ts";
import {
  createEventDispatcher,
  createReaderEventBackend,
  createReaderPool,
  createSubscriptionStore,
  type EventSession,
  openConnection,
  type ReaderPool,
  type SubscriptionStore,
  type Writer,
} from "../../packages/platform/ledger/mod.ts";
import type {
  WriterRequest,
  WriterResponse,
} from "../../packages/platform/ledger/writer-message.ts";
import type {
  BlobFieldDefinition,
  BlobReadInput,
  PreparedBlob,
} from "../../packages/contracts/platform/mod.ts";
import {
  finishBlobRead,
  planBlobRead,
} from "../../packages/platform/blob-store/mod.ts";
import {
  findBackup,
  listBackups,
} from "../../packages/platform/backup-and-migration/mod.ts";
import { authorize } from "../../packages/platform/identity/mod.ts";
import type { Assembled } from "./registration.ts";
import { openSecretStore, withSecretSync } from "./secret-store.ts";
import type { KeychainAdapter } from "../../packages/platform/secrets/mod.ts";

export type CoreRuntime = {
  writer: Writer;
  confirmation(body: {
    action: "issue" | "close-window" | "clear" | "consume";
    request?: unknown;
    windowId?: string;
  }): Promise<Result<unknown>>;
  record(context: AuthenticatedContext): Promise<Result<void>>;
  notePrepared(prepared: PreparedBlob, nowMs: number): Promise<Result<void>>;
  prunePrepared(nowMs: number): Promise<Result<void>>;
  // 만료·회수된 ticket claim을 정리한다. 60초 timer와 재시작이 부른다(R13).
  sweepTicketClaims(): Promise<void>;
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
  // dispatcher에 올라 있는 session 수(core 안 구독자와 WebSocket 연결). 관측용이다.
  trackedSessions(): number;
  close(): Promise<void>;
};

const WRITER_DEAD = {
  code: "unavailable" as const,
  message: "writer가 끝났다",
};

// lock과 schema step 다음이다. writer·reader Worker, event 배포, API read를 연다.
export async function openRuntime(input: {
  ledgerPath: string;
  clock: Clock;
  nowMs: number;
  // "system"이면 writer가 자기 system clock을 쓴다. "fixed"면 nowMs에 고정한다.
  writerClock: "system" | "fixed";
  seed: number;
  modules: readonly string[];
  assembled: Assembled;
  source: StatusSource;
  // doctor 관측. 없으면 diagnostics/check는 등록하지 않는다(R9, R10).
  doctor?: DoctorSource;
  // secret store가 값을 읽는 OS keychain. 참조가 있을 때 처음 한 번 만든다. 제품 기동은
  // 실제 adapter, 테스트는 fake를 준다.
  keychain: () => KeychainAdapter;
  // 기록된 안전 진단. 없으면 diagnostics/list는 등록하지 않는다(R5).
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
    // 제품 clock은 writer가 자기 system clock으로 따라간다. 테스트는 기동 시각에
    // 고정한 clock으로 결정적인 시각을 유지한다.
    clock: input.writerClock === "system" ? "system" : input.nowMs,
    seed: input.seed,
    // settings 등록 파일. writer가 apply·reload command를 다시 모은다.
    settings: settingsModule(),
  });
  // reader Worker는 건넨 module마다 createReaderRegistration을 부른다. export가 있는 팀 모듈만 건넨다.
  // settings 등록 파일도 같은 풀로 붙는다. settings read는 ledger snapshot을 읽는다.
  const readerModules: URL[] = [
    new URL("./settings.ts", import.meta.url),
  ];
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
  const readers = await createReaderPool(input.ledgerPath, [
    new URL("./reader-registration.ts", import.meta.url),
    // createReaderRegistration을 내보내는 팀 read도 같은 풀로 붙는다.
    ...readerModules,
  ]);
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
  });
  await secretStore.sync();
  const writer = withSecretSync(openedWriter.writer, secretStore.sync);
  const root = input.ledgerPath.slice(0, input.ledgerPath.lastIndexOf("/"));
  const directory = `${root}/derived/api-subscriptions`;
  await Deno.mkdir(directory, { recursive: true });
  const subscriptions = await createSubscriptionStore(directory);
  if (!subscriptions.ok) {
    secretStore.stop();
    readers.value.close();
    await openedWriter.writer.close();
    return subscriptions;
  }
  const status = platformStatusReads(input.source, input.clock);
  // doctor의 무거운 검사는 worker가 한다. core는 그 관측만 읽는다(R9, R10).
  const doctor = input.doctor
    ? diagnosticsCheckRead(input.doctor, input.clock)
    : undefined;
  const diagnosticList = input.diagnostics
    ? diagnosticsListRead(input.diagnostics)
    : undefined;
  const dataRoot = input.ledgerPath.slice(
    0,
    input.ledgerPath.lastIndexOf("/"),
  );
  const backups = backupReads(dataRoot);
  const reads = new Map<string, ReadHandler>([
    ["platform/status", status.status],
    ["platform/health", status.health],
    ...(doctor ? [["diagnostics/check", doctor] as [string, ReadHandler]] : []),
    ...(diagnosticList
      ? [["diagnostics/list", diagnosticList] as [string, ReadHandler]]
      : []),
    ...backups.map(([key, handler]): [string, ReadHandler] => [key, handler]),
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
  // ticket claim 정리. 후보 read 뒤 expire_claim을 제출한다. timer는 표를 쓰지 않는다.
  const machine: RequestContext = {
    principal: "machine:ticket-claims",
    actor: "machine",
    scope: {
      operations: ["ExpireTicketClaim", "TicketClaimSweep"],
      targets: {},
    },
    conditions: {},
    credential_ref: "machine:ticket-claims",
  };
  function sweepTicketClaims(): Promise<void> {
    if (!readers.ok) return Promise.resolve();
    // 테스트의 manual clock은 writer가 객체를 공유하지 못한다. 민 시각을 알린 뒤
    // 후보를 읽어야 같은 시각으로 만료를 판단한다.
    const nowMs = input.clock.nowMs();
    const noted = isManualClock(input.clock)
      ? openedWriter.noteTime(nowMs)
      : Promise.resolve(ok(undefined));
    const now = new Date(nowMs).toISOString();
    return noted.then(() => openedWriter.prunePrepared(nowMs)).then(() =>
      readers.value.read(
        { resource: "tickets", method: "claim_sweep" },
        machine,
        { now, revoked: [] },
      )
    ).then(async (found) => {
      if (!found.ok) return;
      const claims = (found.value as {
        claims?: { ticket: string; claim_seq: string }[];
      }).claims ?? [];
      for (const claim of claims) {
        await openedWriter.writer.command(machine as never, {
          command: "ExpireTicketClaim",
          input: claim,
          compare: {},
          idempotency_key: `expire:${claim.ticket}:${claim.claim_seq}`,
          prepared: [],
        });
      }
    });
  }
  const events = createReaderEventBackend(
    readers.value,
    (ref) => Promise.resolve(currentCredential(input.ledgerPath, ref)),
  );
  const dispatcher = createEventDispatcher((catchUp) => {
    const timer = setInterval(catchUp, 200);
    return () => clearInterval(timer);
  });
  // 현재 보기 relay는 ledger 밖 core 메모리다(T57). run→session 확인은 reader가
  // 등록한 runs/read handler로 한다. 아직 없으면 fail-closed다(identity R3).
  const runRead = reads.get("runs/read");
  const memory = createWorkspaceRelay({
    runSession: runRead && ((ctx, run) => runSessionOf(runRead, ctx, run)),
  });
  return ok({
    writer,
    confirmation: openedWriter.confirmation,
    record: openedWriter.record,
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
    trackedSessions: () => dispatcher.size,
    sweepTicketClaims,
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
// 다른 session은 부재와 같다(identity R3, R8).
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
  return "./settings.ts";
}

// worker가 확인한 backup manifest 읽기(T41). 인증은 API 입구가 이미 끝냈고
// dispatcher가 schema·output 검사를 한다. 여기서는 data root의 backup folder만
// 읽는다. 복사·hash 같은 무거운 준비는 I/O worker의 몫이다(responsiveness#R1).
function backupReads(
  dataRoot: string,
): [string, ReadHandler][] {
  return [
    [
      "backups/list",
      async (_ctx, _input) =>
        ok({ backups: (await listBackups(dataRoot)).backups }),
    ],
    [
      "backups/get",
      async (_ctx, input) => {
        // dispatcher가 route.input을 이미 검사해 parsed.data를 넘긴다.
        // 여기서 safeParse를 반복하지 않는다.
        const created = (input as { created_at?: string }).created_at;
        if (typeof created !== "string") {
          return err({
            code: "invalid_input",
            message: "created_at이 없다",
          });
        }
        const found = await findBackup(dataRoot, created);
        if (found === undefined) {
          return err({ code: "not_found", message: "backup이 없다" });
        }
        return ok({ manifest: found });
      },
    ],
  ];
}

// openWriter는 path만 worker name에 넣는다. 팀 모듈은 core가 name에 더한다.
function openProductWriter(
  path: string,
  extra: {
    modules: string[];
    clock: "system" | number;
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
  noteTime(nowMs: number): Promise<Result<void>>;
  notePrepared(prepared: PreparedBlob, nowMs: number): Promise<Result<void>>;
  prunePrepared(nowMs: number): Promise<Result<void>>;
} {
  const worker = new Worker(new URL("./writer-worker.ts", import.meta.url), {
    type: "module",
    name: JSON.stringify({ path, ...extra }),
  });
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
        await send({ id: nextId++, op: "close" });
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
    noteTime(nowMs) {
      return send({
        id: nextId++,
        op: "note-time",
        nowMs,
      } as unknown as WriterRequest).then((message) => {
        if ((message.op as string) === "time-noted") return ok(undefined);
        if (message.op === "failed") return err(message.body);
        return err({
          code: "unavailable",
          message: "시각을 전달하지 못했다",
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

// /v1/blobs/read. 참조 행은 ledger snapshot에서, 바이트는 그 뒤 I/O worker에서 읽는다.
// scope는 시작과 바이트 반환 직전에 다시 검사한다(platform/blob-store#R5).
function blobReadHandler(
  ledgerPath: string,
  blob: {
    fields: readonly BlobFieldDefinition[];
    read(
      hash: string,
      offset: number,
      length: number,
    ): Promise<
      Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>
    >;
  } | undefined,
  ctx: RequestContext,
  body: unknown,
): Promise<Result<unknown>> {
  if (!blob) {
    return Promise.resolve(
      err({ code: "unavailable", message: "blob 읽기가 없다" }),
    );
  }
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return Promise.resolve(opened);
  const judging = {
    fields: blob.fields,
    authorize: (
      current: RequestContext,
      reference: { owner_kind: string; owner_key: string },
    ) =>
      authorize(current, "blobs/read", {
        owner_kind: reference.owner_kind,
        owner_key: reference.owner_key,
      }),
  };
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

function currentCredential(
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
