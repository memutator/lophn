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
  Route,
} from "../../packages/protocol/server/mod.ts";
import { authenticatedContextSchema } from "../../packages/protocol/server/mod.ts";
import type {
  MemoryHandler,
  ReadHandler,
} from "../../packages/core/server/mod.ts";
import {
  createWorkspaceRelay,
  type WorkspaceRelay,
} from "../../packages/core/server/mod.ts";
import {
  type DiagnosticListSource,
  diagnosticsCheckRead,
  diagnosticsListRead,
  type DoctorSource,
  platformStatusReads,
  type StatusSource,
} from "../../packages/core/diagnostics/mod.ts";
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
} from "../../packages/core/storage/ledger/mod.ts";
import type {
  WriterRequest,
  WriterResponse,
} from "../../packages/core/storage/ledger/writer-message.ts";
import type {
  BlobFieldDefinition,
  BlobReadInput,
  PreparedBlob,
  SecretPreparation,
} from "../../packages/protocol/server/mod.ts";
import {
  finishBlobRead,
  planBlobRead,
} from "../../packages/core/storage/blobs/mod.ts";
import {
  findBackup,
  listBackups,
} from "../../packages/core/storage/migration/mod.ts";
import {
  authorize,
  CONDITION_TARGET_KEYS,
} from "../../packages/core/server/identity/mod.ts";
import { packagesGuideBody } from "../../packages/protocol/apps/mod.ts";
import { getReport, reportBody } from "../../packages/protocol/problems/mod.ts";
import {
  PACKAGE_GUIDE_BLOB_FIELD_NAME,
  PACKAGE_GUIDE_BLOB_OWNER_KIND,
  packageGuideOwnerKey,
} from "../../packages/core/apps/packages/blobs.ts";
import {
  interruptedFinish,
  INVOCATION_RECOVERY_CONTEXT,
} from "../../packages/core/apps/invocations/restart.ts";
import { createNotificationDelivery } from "./notification-delivery.ts";
import { createProductRedactor } from "./documents-redactor.ts";
import { APPROVAL_EXPIRY_CONTEXT } from "./platform.ts";
import type { Assembled } from "./registration.ts";
import { PROVIDER_SECRET_OWNER } from "../../packages/core/lophn-agent/providers/mod.ts";
import { openSecretStore, withSecretSync } from "./secret-store.ts";
import type { KeychainAdapter } from "../../packages/core/secrets/mod.ts";

export type CoreRuntime = {
  writer: Writer;
  confirmation(body: {
    action: "issue" | "close-window" | "clear" | "consume";
    request?: unknown;
    windowId?: string;
  }): Promise<Result<unknown>>;
  record(context: AuthenticatedContext): Promise<Result<void>>;
  // 값 없는 secret 준비 증거를 writer가 ledger에 남긴다(platform/secrets#R1).
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
  // 만료·회수된 ticket claim을 정리한다. 60초 timer와 재시작이 부른다(R13).
  sweepTicketClaims(): Promise<void>;
  // 기한에 도달한 대기 approval request를 만료로 확정한다. 60초 timer와 재시작이 부른다(platform Q25).
  sweepApprovalExpiry(): Promise<void>;
  // 재시작 뒤 접수·실행 중으로 남은 invocation을 미확인으로 확정한다. 기동 때 한 번 돈다
  // (apps/invocations#R10, platform/backup-and-migration#R16).
  sweepInterruptedInvocations(): Promise<void>;
  readers: ReaderPool;
  // credential_ref의 현재 context. 폐기·만료·없는 자격은 err다. worker route 서빙이
  // 요청 자격을 다시 읽는 데 쓴다.
  current(credentialRef: string): Result<RequestContext>;
  reads: Map<string, ReadHandler>;
  memory: WorkspaceRelay;
  // core 시작마다 하나인 OS 표시 전달 관측의 memory route(notifications/delivery).
  deliveryMemory: ReadonlyMap<string, MemoryHandler>;
  events: ReturnType<typeof createReaderEventBackend>;
  subscriptions: SubscriptionStore;
  wake(): void;
  // core 안의 구독 session을 dispatcher에 올려 새 event가 올 때 따라잡게 한다. 돌려받은 함수로 뺀다.
  track(session: EventSession): () => void;
  // dispatcher에 올라 있는 session 수(core 안 구독자와 WebSocket 연결). 관측용이다.
  trackedSessions(): number;
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
  // secret store의 주기 쓸기 간격(ms). 없으면 10분.
  secretSweepMs?: number;
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
  // 격리됐다 다시 뜬 reader는 알려진 secret 값을 모른다. secret store가 현재 값을 다시 넣는다.
  const resync: { run?: () => Promise<unknown> } = {};
  const readers = await createReaderPool(input.ledgerPath, [
    new URL("./reader-registration.ts", import.meta.url),
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
    ...(input.secretSweepMs === undefined
      ? {}
      : { sweepMs: input.secretSweepMs }),
    // provider credential은 Disconnect로 참조가 사라지면 OS 값도 지운다(platform/secrets#R7).
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
  // 안내 원문만 읽는 좁은 route다. apps 등록이 route를 선언하고(handler 없음) blob 바이트 통로를 가진 이
  // 조립이 handler를 붙인다. coding credential에 일반 blobs/read를 열지 않는다(coding-agent#T36).
  reads.set(
    `${packagesGuideBody.resource}/${packagesGuideBody.method}`,
    (ctx, body) =>
      packageGuideBodyHandler(input.ledgerPath, input.blob, ctx, body),
  );
  // 보고의 사람 글·log·화면 상태만 읽는 좁은 route. 일반 `blobs/read`는 coding 연결에 열지 않는다.
  reads.set(
    `${reportBody.resource}/${reportBody.method}`,
    (ctx, body) =>
      reportBodyHandler(
        {
          ledgerPath: input.ledgerPath,
          blob: input.blob,
          known: secretStore.known,
          read: (route, context, value) =>
            readers.value.read(route, context, value),
        },
        ctx,
        body,
      ),
  );
  // OS 표시 전달 상태(R9, R10). get·list·display 응답을 꾸미고 shell의 실패 보고를 받는다.
  const delivery = createNotificationDelivery({
    clock: input.clock,
    read: (route, ctx, body) => readers.value.read(route, ctx, body),
  });
  for (
    const key of [
      "notifications/get",
      "notifications/list",
      "notifications/display",
    ]
  ) {
    const inner = reads.get(key);
    if (inner !== undefined) reads.set(key, delivery.decorate(key, inner));
  }
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
  // approval 만료 정리. ticket claim 정리와 같다: 기한에 도달한 대기를 후보 read로 읽고 machine이
  // expire_approval_request를 제출한다. 이미 끝난 request는 후보에 없고, 그 사이 허락·취소된 것은
  // command가 conflict로 거절해 그대로 둔다. 여러 번 불러도 같은 결과다.
  const approvalExpiry = APPROVAL_EXPIRY_CONTEXT as AuthenticatedContext;
  function sweepApprovalExpiry(): Promise<void> {
    if (!readers.ok) return Promise.resolve();
    const nowMs = input.clock.nowMs();
    const noted = isManualClock(input.clock)
      ? openedWriter.noteTime(nowMs)
      : Promise.resolve(ok(undefined));
    const now = new Date(nowMs).toISOString();
    return noted.then(() =>
      readers.value.read(
        { resource: "approvals", method: "expiry_sweep" },
        approvalExpiry,
        { now },
      )
    ).then(async (found) => {
      if (!found.ok) return;
      const approvals = (found.value as {
        approvals?: { approval: string; created_seq: string }[];
      }).approvals ?? [];
      for (const candidate of approvals) {
        await openedWriter.writer.command(approvalExpiry as never, {
          command: "expire_approval_request",
          input: candidate,
          compare: { created_seq: candidate.created_seq },
          idempotency_key:
            `expire-approval:${candidate.approval}:${candidate.created_seq}`,
          prepared: [],
        });
      }
    });
  }
  // 재시작 점검이 unknown으로 본 접수·실행 중 invocation을 미확인으로 확정한다. 이전 core의 앱 프로세스는
  // 이미 없고 새 프로세스는 새 nonce라 옛 접수·시작은 이어지지 않는다. 읽기 목록으로 후보를 읽고
  // 기존 machine command `invocation.record_finished`로 확정하며, 같은 key라 여러 번 돌아도 같은 결과다.
  // apps를 조립하지 않은 core에는 read가 없어 아무것도 하지 않는다.
  const invocationRecovery =
    INVOCATION_RECOVERY_CONTEXT as unknown as RequestContext;
  async function sweepInterruptedInvocations(): Promise<void> {
    if (!readers.ok) return;
    const finishedAt = input.clock.now();
    for (const status of ["accepted", "running"] as const) {
      let cursor: string | undefined;
      do {
        const found = await readers.value.read(
          { resource: "invocations", method: "list" },
          invocationRecovery,
          { status, limit: 200, ...(cursor ? { cursor } : {}) },
        );
        if (!found.ok) return;
        const page = found.value as {
          invocations?: {
            id: string;
            status: "accepted" | "running";
            started_at: string | null;
          }[];
          next_cursor?: string | null;
        };
        for (const row of page.invocations ?? []) {
          await openedWriter.writer.command(invocationRecovery as never, {
            command: "invocation.record_finished",
            input: interruptedFinish(row, finishedAt),
            compare: {},
            idempotency_key: `interrupted:${row.id}`,
            prepared: [],
          });
        }
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
    }
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
    recordSecretPreparation: openedWriter.recordSecretPreparation,
    knownSecrets: secretStore.known,
    syncSecrets: () => secretStore.sync(),
    notePrepared: openedWriter.notePrepared,
    prunePrepared: openedWriter.prunePrepared,
    readers: readers.value,
    current: (ref) => currentCredential(input.ledgerPath, ref),
    reads,
    memory,
    deliveryMemory: delivery.memory,
    events,
    subscriptions: subscriptions.value,
    wake: () => dispatcher.wake(),
    track: (session) => dispatcher.add(session),
    trackedSessions: () => dispatcher.size,
    sweepTicketClaims,
    sweepApprovalExpiry,
    sweepInterruptedInvocations,
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
  recordSecretPreparation(
    preparation: SecretPreparation,
  ): Promise<Result<void>>;
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
// scope는 시작과 바이트 반환 직전에 다시 검사한다(platform/blob-store#R5).
function blobReadHandler(
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

// /v1/packages/guide_body. owner_kind·field가 `package_version`·`guide`로 고정이라 입력으로 다른 blob을
// 가리킬 수 없다. 자격은 이 route의 operation(`packages.guide_body`)이고 일반 `blobs/read`는 필요 없다.
// 앱 범위 연결의 고정 조건 target만 함께 검사한다(packages는 공개 catalog라 앱 안의 대상이 아니다).
function packageGuideBodyHandler(
  ledgerPath: string,
  blob: BlobReadSource | undefined,
  ctx: RequestContext,
  body: unknown,
): Promise<Result<unknown>> {
  const parsed = packagesGuideBody.input.safeParse(body);
  if (!parsed.success) {
    return Promise.resolve(
      err({ code: "invalid_input", message: "안내 읽기 입력이 올바르지 않다" }),
    );
  }
  const input: BlobReadInput = {
    owner_kind: PACKAGE_GUIDE_BLOB_OWNER_KIND,
    owner_key: packageGuideOwnerKey(parsed.data.name, parsed.data.version),
    field: PACKAGE_GUIDE_BLOB_FIELD_NAME,
    offset_bytes: parsed.data.offset_bytes,
    length_bytes: parsed.data.length_bytes,
  };
  return blobReadHandler(ledgerPath, blob, ctx, input, (current) => {
    const target: NonNullable<Parameters<typeof authorize>[2]> = {};
    for (const key of CONDITION_TARGET_KEYS) {
      const value = current.conditions[key];
      if (value !== undefined && Object.hasOwn(current.scope.targets, key)) {
        target[key] = value;
      }
    }
    return authorize(current, packagesGuideBody.name, target, {
      domain: "skip",
    });
  });
}

// /v1/problems/report_body. owner_kind가 `report`로 고정이고 field는 사람 글·log·화면 상태뿐이다.
// 보고는 이 자격으로 GetReport가 읽을 수 있어야 하고(없는 대상과 범위 밖은 같은 not_found), 바이트를
// 읽기 시작할 때와 반환 직전에 보고의 앱·문제 target을 현재 credential로 다시 검사한다. 글은 core
// 알려진 값 pipe를 지난 것만 내보낸다(끝내지 못하면 unavailable).
async function reportBodyHandler(
  environment: {
    ledgerPath: string;
    blob: BlobReadSource | undefined;
    known: KnownSecretMatch;
    read(
      route: Route,
      ctx: RequestContext,
      body: unknown,
    ): Promise<Result<unknown>>;
  },
  ctx: RequestContext,
  body: unknown,
): Promise<Result<unknown>> {
  const parsed = reportBody.input.safeParse(body);
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "본문 읽기 입력이 올바르지 않다",
    });
  }
  const notFound: Result<never> = err({
    code: "not_found",
    message: "대상을 찾을 수 없다",
  });
  const found = await environment.read(getReport, ctx, {
    report: parsed.data.report,
  });
  if (!found.ok) {
    return found.error.code === "unavailable" ? found : notFound;
  }
  const report =
    (found.value as { report: { app: string; problem: string | null } })
      .report;
  if (report.problem === null) return notFound;
  const target = { app: report.app, problem: report.problem };
  const source = environment.blob === undefined ? undefined : {
    ...environment.blob,
    // 이 route만 이 field들을 읽는다. 일반 읽기의 field 정의는 그대로다.
    fields: environment.blob.fields.map((field) =>
      field.owner_kind === "report" && field.field === parsed.data.field
        ? { ...field, general_read: true }
        : field
    ),
  };
  const read = await blobReadHandler(
    environment.ledgerPath,
    source,
    ctx,
    {
      owner_kind: "report",
      owner_key: parsed.data.report,
      field: parsed.data.field,
      offset_bytes: parsed.data.offset_bytes,
      length_bytes: parsed.data.length_bytes,
    },
    (current) => {
      const live = currentCredential(
        environment.ledgerPath,
        current.credential_ref,
      );
      return live.ok ? authorize(live.value, reportBody.name, target) : live;
    },
  );
  if (!read.ok) return read.error.code === "unavailable" ? read : notFound;
  const value = read.value as {
    status: string;
    reason?: string;
    bytes?: string;
    truncated?: boolean;
  };
  if (value.status !== "available" || value.bytes === undefined) {
    return ok({ status: "unavailable", reason: value.reason ?? value.status });
  }
  const raw = new TextDecoder().decode(
    Uint8Array.from(atob(value.bytes), (char) => char.charCodeAt(0)),
  );
  const safe = createProductRedactor(environment.known)(
    {
      concern: "coding-agent/repair-context",
      revision: "1",
      scope: "report-body",
    },
    "text/plain",
    raw,
  );
  if (safe === null) {
    return err({ code: "unavailable", message: "redaction을 끝내지 못했다" });
  }
  return ok({
    status: "available",
    text: safe,
    truncated: value.truncated === true,
  });
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
