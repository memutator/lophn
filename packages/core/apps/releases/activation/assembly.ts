// core 안 activation 조립. 세 일을 한다.
//   1. 운영 DesiredApp: 활성 release의 봉인 bundle 사본과 현재 grant에서 푼 permission으로 앱 자식의 flag를
//      만들어 supervisor에 알린다(`bundleFlags`). 앱 코드는 신뢰하지 않으므로 선언 ∩ active grant 밖의 접근은
//      flag에 없다.
//   2. activation 줄: `TicketVerified`·`ApprovalDecided` Reactor handler(handler.ts)가 앱마다 줄(queue.ts)에
//      세운 release를 차례로 `activation.start`로 열고 `runActivation`이 순서대로 진행한다. core가 다시 뜨거나
//      supervisor가 끊긴 뒤의 진행 중 시도는 `recoverActivation`이 ledger와 실제 관측에서 이어받는다.
//      단계의 실제 일은 `ActivationPorts`로 끼운다: 자식 종료·후보 준비·열기는 supervisor, 앱 DB 작업은
//      supervisor가 띄우는 data worker, ledger 확정은 core 내부 machine 자격의 command다. core는 앱 DB를
//      열지 않고 backup 파일의 byte를 blob 준비 통로로 흘리기만 한다.
//   3. 이전 release로 돌아가기 요청(`activation_requests`)을 sweep이 읽어 줄에 세운다.
// Approvals·Bus·호출 접수(drain)·changeset은 다른 module의 port라 조립이 `attach`로 늦게 끼운다.
import {
  canonicalize,
  type Clock,
  err,
  type IdSource,
  ok,
  type Result,
} from "../../../../base/mod.ts";
import type {
  Intent,
  PendingApproval,
} from "../../../../protocol/approvals/mod.ts";
import {
  type ActivationComparison,
  activationComplete,
  type ActivationDataResult,
  activationFail,
  type ActivationQueueEntry,
  activationRecordBackup,
  activationRecordDataChange,
  activationRecordDataRestore,
  activationStart,
  type App,
  type AppGrant,
  appRecordUnavailable,
  decodeActivationDataJobOutput,
  encodeActivationDataJobInput,
  type ReleaseRecord,
} from "../../../../protocol/apps/mod.ts";
import type { RequestContext, Sql } from "../../../../protocol/server/mod.ts";
import type { PreparedBlob } from "../../../../protocol/storage/mod.ts";
import type {
  BlobPrepareCall,
  PreparedRelayResult,
} from "../../../storage/blobs/prepare-relay.ts";
import type { Bus } from "../../../events/ports.ts";

import { openConnection } from "../../../storage/ledger/mod.ts";
import { loadApps } from "../../registration/mod.ts";
import {
  credentialRoots,
  effectiveScope,
  keychainRoots,
  protectedRoots,
  realPathResolver,
  type ResolvedRequirement,
  resolveRequirement,
} from "../../permissions/mod.ts";
import { asksFor, compareForActivation } from "../compare.ts";
import {
  findReleaseForTicket,
  loadActiveRelease,
  loadRelease,
  loadStoredBlueprint,
} from "../store.ts";
import { bundleFlags, desiredFromBundle, readBundleCopy } from "./desired.ts";
import { createActivationHandlers } from "./handler.ts";
import { runActivation } from "./orchestrator.ts";
import { createActivationQueue, type QueueEntry } from "./queue.ts";
import { recoverActivation } from "./recovery.ts";
import type { ActivationIntake, ActivationPorts, Attempt } from "./steps.ts";
import { BACKUP_BLOB_PURPOSE } from "../../data/blobs.ts";
import type { ConnectFacts } from "../../runtime/connect.ts";
import type { SupervisorClient } from "../../runtime/supervisor-link.ts";
import type { DesiredApp } from "../../runtime/supervisor/mod.ts";

type Envelope = {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
  prepared: string[];
};

// 진행하지 못한 시도를 다시 이어받는 최소 간격이다. 같은 실패를 매 sweep 쏟아내지 않는다.
const ACTIVATION_RETRY_MS = 30_000;

type ActivationDeps = {
  clock: Clock;
  ids: IdSource;
  ledgerPath: string;
  dataRoot: string;
  client: SupervisorClient;
  // supervisor 통로가 열려 있는지.
  bound: () => boolean;
  facts: ConnectFacts;
  readers: {
    read(
      route: { resource: string; method: string },
      ctx: RequestContext,
      input: unknown,
    ): Promise<Result<unknown>>;
  };
  // ledger command를 core 내부 machine 자격으로 낸다. core 조립이 늦게 채우므로 호출 때 읽는다.
  command(
    ctx: RequestContext,
    envelope: Envelope,
  ): Promise<Result<unknown>> | undefined;
  machine(): RequestContext | undefined;
  // blob 준비(I/O worker 중계). 바이트는 해석하지 않고 흘린다.
  prepareBlob(call: BlobPrepareCall): Promise<Result<PreparedRelayResult>>;
  // loopback으로 core API에 닿지 못하게 막을 port. API를 연 뒤에 정해진다.
  platformPorts: () => readonly number[];
  // 원하는 앱 상태를 supervisor에 알린다(마지막 상태를 기억한다).
  reconcile(desired: DesiredApp): Promise<Result<void>>;
};

// 다른 module의 port다. 조립이 늦게 끼운다(`attach`). 끼우기 전에는 activation을 진행하지 않는다.
type ActivationLate = {
  approvals: {
    createPending(intent: Intent): Promise<Result<PendingApproval>>;
    cancelPendingFor(app: string, release?: string): Promise<Result<number>>;
    // 결정된 request를 읽는다. `Approvals` port에 아직 없어 조립이 approvals 읽기로 끼운다.
    request(id: string): Promise<Result<PendingApproval | null>>;
    pending(): Promise<Result<PendingApproval[]>>;
  };
  bus: Pick<Bus, "publish">;
  intake: ActivationIntake;
  // 새 호출 접수를 닫은 동안 붙잡은 호출 수. 모르면 생략한다.
  heldCalls?: (app: string) => number;
  invocations: {
    pruneChangesets(app: string, keepRelease: string): Promise<Result<number>>;
  };
};

export type ActivationDriver = {
  // activation 진행과 운영 DesiredApp 맞춤을 한 번 돈다. 시도마다 오래 걸리는 일은 기다리지 않는다.
  sweep(): Promise<void>;
  // 줄에 있거나 도는 시도 수. 시험이 끝을 기다린다.
  readonly running: number;
  settled(): Promise<void>;
  // Approvals·Bus·접수·changeset port를 끼운다.
  attach(late: ActivationLate): void;
  // Reactor에 등록하는 handler 둘과 Approvals에 등록하는 applier(`registerApplier("activation", ...)`).
  readonly handlers: ReturnType<typeof createActivationHandlers>;
  // `activations.queue` read의 원천이다. 줄(메모리)과 기다리는 보류 request를 합친다.
  queueEntries(
    app: string | undefined,
  ): Promise<Result<{ entries: ActivationQueueEntry[]; as_of_seq: string }>>;
  // 후보나 운영 release의 앱 자식 입력을 만든다. 봉인 사본이 없거나 읽지 못하면 err다.
  desiredFor(
    app: string,
    release: string,
    state: { runEnabled: boolean; archived: boolean },
  ): Promise<Result<DesiredApp>>;
  // grant 변경을 적용한 앱의 새 desired를 바로 알린다. 호출한 쪽이 앞서 붙들었으면 풀지 않는다.
  // 알리지 못하면 false이고 다음 sweep이 이어서 맞춘다.
  applyGrants(app: string): Promise<boolean>;
};

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

export function createActivationDriver(deps: ActivationDeps): ActivationDriver {
  const queue = createActivationQueue();
  let late: ActivationLate | undefined;
  // 끝내지 못한 시도와 다음 재시도 시각이다.
  const unsettled = new Map<string, number>();
  // record_backup이 싣는 보호 blob 준비 결과. 준비한 시도 안에서만 쓴다.
  const preparedBackups = new Map<string, PreparedBlob>();
  // 운영 desired를 마지막으로 알린 근거. 같으면 다시 만들지 않는다.
  const lastKeys = new Map<string, string>();
  function withLedger<T>(read: (sql: Sql) => T): Result<T> {
    const opened = openConnection(deps.ledgerPath);
    if (!opened.ok) return unavailable("ledger is unavailable");
    try {
      return ok(read(opened.value.sql));
    } catch {
      return unavailable("ledger is unavailable");
    } finally {
      opened.value.close();
    }
  }
  async function grantsOf(app: string): Promise<Result<readonly AppGrant[]>> {
    return await deps.facts.grants(app);
  }

  // 선언 ∩ active grant에서 푼 permission이다. 실제 경로를 풀지 못한 요구는 허락하지 않은 것과 같다.
  async function requirementsOf(
    app: string,
    release: string,
  ): Promise<Result<ResolvedRequirement[]>> {
    const stored = withLedger((sql) => ({
      blueprint: loadStoredBlueprint(sql, release),
      sources: loadApps(sql, undefined),
    }));
    if (!stored.ok) return stored;
    if (!stored.value.blueprint.ok || stored.value.blueprint.value === null) {
      return unavailable("release is unavailable");
    }
    if (!stored.value.sources.ok) return unavailable("apps are unavailable");
    const grants = await grantsOf(app);
    if (!grants.ok) return grants;
    const declarations = stored.value.blueprint.value.declarations;
    const effective = effectiveScope({
      app,
      declarations,
      grants: grants.value,
      targetCommands: () => undefined,
    });
    const home = Deno.env.get("HOME") ?? "";
    const roots = protectedRoots(
      home,
      deps.dataRoot,
      [`${deps.dataRoot}/apps`],
      stored.value.sources.value.flatMap((entry) =>
        entry.source_path === null ? [] : [entry.source_path]
      ),
    );
    const resolved: ResolvedRequirement[] = [];
    for (const entry of effective.access) {
      // 앱이 듣는 socket은 Deno flag로 한정할 수 없어 허락하지 않는다.
      if (entry.kind === "net.listen") continue;
      const declared = declarations.permissions.find((requirement) =>
        requirement.kind === entry.kind &&
        JSON.stringify(requirement.scope) === JSON.stringify(entry.scope)
      );
      const made = await resolveRequirement(
        {
          kind: entry.kind,
          scope: entry.scope as never,
          reason: (declared as { reason?: string } | undefined)?.reason ??
            "granted",
        },
        roots,
        realPathResolver(home, deps.dataRoot),
      );
      if (made.ok) resolved.push(made.value);
    }
    return ok(resolved);
  }

  async function desiredFor(
    app: string,
    release: string,
    state: { runEnabled: boolean; archived: boolean },
  ): Promise<Result<DesiredApp>> {
    const row = withLedger((sql) =>
      sql.get(
        "SELECT bundle_hash, data_schema FROM releases WHERE id = ? AND app = ?",
        [
          release,
          app,
        ],
      )
    );
    if (!row.ok) return row;
    if (row.value === undefined) return unavailable("release is unavailable");
    const bundleHash = String(row.value.bundle_hash);
    const copy = await readBundleCopy(deps.dataRoot, app, bundleHash);
    if (!copy.ok) return copy;
    if (copy.value === undefined) return unavailable("bundle copy is missing");
    const requirements = await requirementsOf(app, release);
    if (!requirements.ok) return requirements;
    const dataPath = `${deps.dataRoot}/apps/${app}/data`;
    try {
      await Deno.mkdir(dataPath, { recursive: true });
    } catch {
      return unavailable("app data area cannot be made");
    }
    const home = Deno.env.get("HOME") ?? "";
    const flags = bundleFlags(copy.value, {
      requirements: requirements.value,
      dataPath,
      platform: { ports: [...deps.platformPorts()] },
      // credential 폴더와 keychain은 어떤 grant로도 읽지 못한다.
      protectedDenies: [...credentialRoots(home), ...keychainRoots(home)],
    });
    if (!flags.ok) return flags;
    return ok(desiredFromBundle(copy.value, {
      app,
      release,
      bundleHash,
      runEnabled: state.runEnabled,
      archived: state.archived,
      dataSchema: Number(row.value.data_schema),
      dataPath,
      flags: flags.value,
    }));
  }

  // ---- ledger 읽기 ----

  function ledgerRead<T>(read: (sql: Sql) => Result<T>): Result<T> {
    const done = withLedger(read);
    return done.ok ? done.value : done;
  }

  function headSeq(): string {
    const read = withLedger((sql) =>
      String(
        Number(
          sql.get("SELECT COALESCE(MAX(seq), 0) AS n FROM events", [])?.n ?? 0,
        ),
      )
    );
    return read.ok ? read.value : "0";
  }

  function currentRelease(id: string): Result<ReleaseRecord | null> {
    return ledgerRead((sql) => loadRelease(sql, id));
  }

  // 지금 active grant·active release와 견준 비교다.
  async function comparisonOf(
    release: ReleaseRecord,
  ): Promise<Result<ActivationComparison>> {
    const read = ledgerRead((sql) => {
      const stored = loadStoredBlueprint(sql, release.id);
      if (!stored.ok) return stored;
      const active = loadActiveRelease(sql, release.app);
      if (!active.ok) return active;
      return ok({ stored: stored.value, active: active.value });
    });
    if (!read.ok) return read;
    if (read.value.stored === null) {
      return unavailable("release is unavailable");
    }
    const grants = await grantsOf(release.app);
    if (!grants.ok) return grants;
    const { active } = read.value;
    return ok(compareForActivation({
      previous: active === null || active.id === release.id
        ? null
        : { id: active.id, data_schema: active.data_schema },
      grants: grants.value,
      declarations: read.value.stored.declarations,
      next: { data_changes: release.data_changes },
    }));
  }

  // ---- ledger command ----

  function machine(): Result<RequestContext> {
    const ctx = deps.machine();
    return ctx === undefined
      ? unavailable("machine credential is unavailable")
      : ok(ctx);
  }

  async function sendValue(
    command: string,
    input: unknown,
    key: string,
  ): Promise<Result<unknown>> {
    const ctx = machine();
    if (!ctx.ok) return ctx;
    const sent = deps.command(ctx.value, {
      command,
      input,
      idempotency_key: `${key}-${crypto.randomUUID()}`,
      compare: {},
      prepared: [],
    });
    if (sent === undefined) return unavailable("app-api are unavailable");
    return await sent;
  }

  async function send(
    command: string,
    input: unknown,
    key: string,
  ): Promise<Result<void>> {
    const done = await sendValue(command, input, key);
    return done.ok ? ok(undefined) : done;
  }

  async function job(
    attempt: Attempt,
    kind: "inspect" | "backup" | "migrate" | "restore",
    extra: Record<string, unknown> = {},
  ): Promise<
    Result<{ result: ActivationDataResult; backup_hash?: string }>
  > {
    const line = encodeActivationDataJobInput({
      kind,
      app: attempt.app,
      release: attempt.release,
      attempt: attempt.attempt,
      data_path: "app.sqlite",
      // 목표 schema다. migrate만 쓰고 나머지 job은 실제 DB를 본다.
      data_schema: attempt.targetSchema,
      ...extra,
    } as never);
    const ran = await deps.client.dataJob(attempt.app, line);
    if (!ran.ok) return ran;
    try {
      return ok(decodeActivationDataJobOutput(ran.value));
    } catch {
      return unavailable("data job answered badly");
    }
  }

  async function ledgerApp(app: string) {
    return await deps.facts.app(app);
  }

  const ports: ActivationPorts = {
    intake: {
      close: (app) => late?.intake.close(app),
      whenIdle: (app, graceMs) =>
        late === undefined
          ? Promise.resolve({ idle: true })
          : late.intake.whenIdle(app, graceMs),
      abandon: async (app) => await late?.intake.abandon(app),
      open: (app) => late?.intake.open(app),
    },
    supervisor: {
      async stopCurrent(app) {
        const paused = await deps.client.activationPause(app);
        return paused.ok && paused.value;
      },
      async stopCandidate(app) {
        const paused = await deps.client.activationPause(app);
        return paused.ok && paused.value;
      },
      async startCandidate(attempt) {
        const desired = await desiredFor(attempt.app, attempt.release, {
          runEnabled: true,
          archived: false,
        });
        if (!desired.ok) return desired;
        const started = await deps.client.activationPrepare(desired.value);
        if (!started.ok) return started;
        if (!started.value.ok) {
          return unavailable(started.value.reason);
        }
        const { attestation, processNonce } = started.value;
        return ok({
          nonce: processNonce,
          attestation: {
            release: attestation.release,
            bundle_hash: attestation.bundleHash,
            app_api: attestation.app_api,
            data_schema: attestation.dataSchema,
            process_nonce: processNonce,
            connection_ok: true as const,
          },
        });
      },
      async openCandidate(attempt) {
        const opened = await deps.client.activationOpen(attempt.app);
        if (!opened.ok) return opened;
        if (!opened.value) return unavailable("the candidate was not opened");
        // 채택한 release가 열렸다. 붙들기를 풀면 core가 알리는 상태와 같아 아무것도 다시 띄우지 않는다.
        return await deps.client.activationResume(attempt.app);
      },
      async run(app, release) {
        const found = await ledgerApp(app);
        if (!found.ok) return found;
        if (found.value === null) return unavailable("app is unavailable");
        const desired = await desiredFor(app, release, {
          runEnabled: found.value.run_enabled,
          archived: found.value.status === "archived",
        });
        if (!desired.ok) return desired;
        const told = await deps.reconcile(desired.value);
        if (!told.ok) return told;
        return await deps.client.activationResume(app);
      },
    },
    data: {
      async inspect(attempt) {
        const done = await job(attempt, "inspect");
        return done.ok
          ? ok({
            data_schema: done.value.result.data_schema,
            integrity_ok: done.value.result.integrity_ok,
          })
          : done;
      },
      async backup(attempt) {
        const done = await job(attempt, "backup");
        if (!done.ok) return done;
        if (done.value.backup_hash === undefined) {
          return unavailable("backup has no hash");
        }
        // backup byte를 보호 blob으로 보존한다. 준비 주체는 record_backup을 내는 자격과 같다.
        const ctx = machine();
        if (!ctx.ok) return ctx;
        let file: Deno.FsFile;
        try {
          file = await Deno.open(
            `${deps.dataRoot}/apps/${attempt.app}/data/backups/backup-${attempt.attempt}`,
          );
        } catch {
          return unavailable("backup file cannot be read");
        }
        const prepared = await deps.prepareBlob({
          principal: ctx.value.principal,
          purpose: BACKUP_BLOB_PURPOSE,
          bytes: file.readable,
        });
        if (!prepared.ok) return prepared;
        if (prepared.value.hash !== done.value.backup_hash) {
          return unavailable("preserved backup differs from the backup file");
        }
        preparedBackups.set(
          `${attempt.release}:${attempt.attempt}`,
          prepared.value as PreparedBlob,
        );
        return ok({
          result: done.value.result,
          backup_hash: prepared.value.hash,
        });
      },
      async migrate(attempt, invocation) {
        const done = await job(attempt, "migrate", {
          bundle_path:
            `${deps.dataRoot}/apps/${attempt.app}/bundles/${attempt.bundleHash}`,
          data_changes: attempt.dataChanges,
          invocation,
        });
        return done.ok ? ok(done.value.result) : done;
      },
      async restore(attempt, backupHash) {
        const done = await job(attempt, "restore", { backup_hash: backupHash });
        return done.ok ? ok(done.value.result) : done;
      },
    },
    core: {
      release: (id) => Promise.resolve(currentRelease(id)),
      async recordBackup(input) {
        const blob = preparedBackups.get(`${input.release}:${input.attempt}`);
        if (blob === undefined) return unavailable("no preserved backup");
        return await send(
          activationRecordBackup.name,
          { ...input, blob },
          "activation-backup",
        );
      },
      recordDataChange: (result) =>
        send(activationRecordDataChange.name, { result }, "activation-change"),
      recordDataRestore: (result, backupHash) =>
        send(
          activationRecordDataRestore.name,
          { result, backup_hash: backupHash },
          "activation-restore",
        ),
      completeActivation: (input) =>
        send(activationComplete.name, input, "activation-complete"),
      failActivation: (input) =>
        send(activationFail.name, input, "activation-fail"),
      async markUnavailable(app, release, reason) {
        // 복원 실패·확인 불가는 앱을 사용할 수 없는 상태로 남기고 이유를 runtime 상태에 둔다.
        await send(
          appRecordUnavailable.name,
          { app, release, reason },
          "activation-unavailable",
        );
      },
    },
    after: {
      async pruneChangesets(app, keepRelease) {
        await late?.invocations.pruneChangesets(app, keepRelease);
      },
      viewChanged(app) {
        late?.bus.publish({
          type: "AppViewChanged",
          subject: app,
          at: deps.clock.now(),
          payload: { reason: "activation" },
        } as never);
      },
    },
    progress: (app, step, migrationSteps) =>
      queue.update(app, { step, migrationSteps }),
    newInvocation: () => deps.ids.newId("inv"),
  };

  // ---- 줄에서 한 차례 ----

  // 줄에서 차례가 온 release 하나를 끝까지 진행한다. 진행 중으로 남은 시도(끊긴 것)면 이어받는다.
  async function runOne(entry: QueueEntry): Promise<void> {
    if (late === undefined) return;
    const found = currentRelease(entry.release);
    if (!found.ok || found.value === null) return;
    let release = found.value;
    let outcome;
    if (release.status === "activating") {
      outcome = await recoverActivation(ports, release.id);
    } else {
      if (release.status !== "prepared" && release.status !== "superseded") {
        return;
      }
      // 기다리는 사이 선언 비교가 달라졌으면 허락한 판정이 아니다. 새로 판정한다.
      if (release.status === "prepared") {
        const compared = await comparisonOf(release);
        if (!compared.ok) return;
        if (
          asksFor(compared.value) &&
          (entry.approved === null ||
            canonicalize(compared.value) !== entry.approved)
        ) {
          await handlers.reconsider(release, headSeq());
          return;
        }
      }
      const started = await sendValue(
        activationStart.name,
        { release: release.id, key: crypto.randomUUID() },
        "activation-start",
      );
      const reread = currentRelease(release.id);
      // 응답을 잃었어도 ledger가 시작했다고 말하면 그 시도를 이어 간다.
      if (!reread.ok || reread.value === null) return;
      if (!started.ok && reread.value.status !== "activating") return;
      release = reread.value;
      // 더 새 release의 activation이 시작됐으니 이전 release를 기다리던 보류 request는 취소한다.
      await late.approvals.cancelPendingFor(release.app, release.id);
      queue.dropWaiting(release.app, release.id);
      outcome = await runActivation(ports, release);
    }
    if (outcome.status === "unavailable") {
      // 복원이나 종료를 확인하지 못했다. 앱은 붙든 채로 두고(이전 코드를 시작하지 않는다) 나중에 이어받는다.
      unsettled.set(release.id, deps.clock.nowMs() + ACTIVATION_RETRY_MS);
    } else {
      unsettled.delete(release.id);
      // 시도가 끝났다. 이전 release가 없어 다시 띄울 것이 없어도 붙들기는 푼다.
      await deps.client.activationResume(release.app).catch(() => undefined);
    }
  }

  function enqueue(app: string, release: string, approved: string | null) {
    queue.enqueue(app, release, approved, runOne);
  }

  const handlers = createActivationHandlers({
    releases: {
      forTicket: (ticket) =>
        ledgerRead((sql) => findReleaseForTicket(sql, ticket)),
      get: currentRelease,
      comparison: comparisonOf,
    },
    approvals: {
      createPending: (intent) =>
        late === undefined
          ? Promise.resolve(unavailable("approvals are not attached"))
          : late.approvals.createPending(intent),
      request: (id) =>
        late === undefined
          ? Promise.resolve(unavailable("approvals are not attached"))
          : late.approvals.request(id),
    },
    waitApproval: (app, release, approval) =>
      queue.waitApproval(app, release, approval),
    enqueue,
  });

  function activatingRows(): Result<{ id: string; app: string }[]> {
    return withLedger((sql) =>
      sql.all(
        "SELECT id, app FROM releases WHERE status = 'activating' ORDER BY id",
        [],
      ).map((row) => ({ id: String(row.id), app: String(row.app) }))
    );
  }

  function requestedRows(): Result<{ release: string; app: string }[]> {
    return withLedger((sql) =>
      sql.all(
        `SELECT q.release AS release, r.app AS app
           FROM activation_requests q JOIN releases r ON r.id = q.release
          ORDER BY q.requested_at, q.release`,
        [],
      ).map((row) => ({
        release: String(row.release),
        app: String(row.app),
      }))
    );
  }

  // 앱 하나의 운영 desired를 맞춘다. 근거(App 행·grant)가 그대로면 다시 만들지 않는다. 맞췄으면 true다.
  async function reconcileOne(app: App, resume: boolean): Promise<boolean> {
    if (app.active_release === null) return false;
    const grants = await grantsOf(app.id);
    if (!grants.ok) return false;
    const key = JSON.stringify([
      app.revision,
      app.active_release,
      app.run_enabled,
      app.status,
      grants.value.map((grant) => grant.id).sort(),
    ]);
    if (lastKeys.get(app.id) === key) return true;
    const desired = await desiredFor(app.id, app.active_release, {
      runEnabled: app.run_enabled,
      archived: app.status === "archived",
    });
    // 봉인 사본을 읽지 못하면 알리지 않는다. 다음 sweep이 다시 본다.
    if (!desired.ok) return false;
    // grant 집합이 달라지면 같은 release·bundle이어도 옛 OS flag를 가진 자식을 끝낸다.
    const replacing = lastKeys.has(app.id);
    if (replacing) {
      const paused = await deps.client.activationPause(app.id);
      if (!paused.ok || !paused.value) return false;
    }
    const told = await deps.reconcile(desired.value);
    if (!told.ok) return false;
    lastKeys.set(app.id, key);
    if (replacing && resume) await deps.client.activationResume(app.id);
    return true;
  }

  // 활성 release가 있는 앱의 원하는 상태를 맞춘다.
  async function reconcileProduct(
    attempting: ReadonlySet<string>,
  ): Promise<void> {
    const apps = withLedger((sql) => loadApps(sql, undefined));
    if (!apps.ok || !apps.value.ok) return;
    for (const app of apps.value.value) {
      if (attempting.has(app.id)) continue;
      await reconcileOne(app, true);
    }
  }

  return {
    get running() {
      return queue.size;
    },
    settled: () => queue.settled(),
    attach(next) {
      late = next;
    },
    handlers,
    async queueEntries(app) {
      const entries = queue.list(app, (one) => late?.heldCalls?.(one) ?? 0);
      if (late !== undefined) {
        const pending = await late.approvals.pending();
        if (!pending.ok) return pending;
        for (const request of pending.value) {
          const target = request.intent.target;
          if (target.kind !== "activation") continue;
          if (app !== undefined && target.app !== app) continue;
          if (entries.some((entry) => entry.release === target.release)) {
            continue;
          }
          entries.push({
            app: target.app,
            release: target.release,
            phase: "waiting_approval",
            approval: request.id,
            step: null,
            held_calls: 0,
            migration_steps: 0,
          } as ActivationQueueEntry);
        }
      }
      return ok({ entries, as_of_seq: headSeq() });
    },
    desiredFor,
    async applyGrants(app) {
      const apps = withLedger((sql) => loadApps(sql, undefined));
      if (!apps.ok || !apps.value.ok) return false;
      const row = apps.value.value.find((entry) => entry.id === app);
      return row === undefined ? false : await reconcileOne(row, false);
    },
    async sweep() {
      if (!deps.bound()) return;
      if (late !== undefined) {
        // 이 process가 줄에 세우지 않은 진행 중 시도는 끊긴 것이다. 이어받는다.
        const rows = activatingRows();
        if (rows.ok) {
          for (const row of rows.value) {
            const retryAt = unsettled.get(row.id);
            if (queue.has(row.id)) continue;
            if (retryAt !== undefined && deps.clock.nowMs() < retryAt) continue;
            enqueue(row.app, row.id, null);
          }
        }
        // 이전 release로 돌아가기 요청을 줄에 세운다. `activation.start`가 요청을 지운다.
        const requested = requestedRows();
        if (requested.ok) {
          for (const row of requested.value) {
            if (!queue.has(row.release)) enqueue(row.app, row.release, null);
          }
        }
      }
      const attempting = new Set(
        queue.list(undefined, () => 0).filter((entry) =>
          entry.phase === "running"
        ).map((entry) => entry.app),
      );
      await reconcileProduct(attempting);
    },
  };
}
