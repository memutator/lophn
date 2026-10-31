// core 안 activation 조립. 세 일을 한다.
//   1. 운영 DesiredApp: 활성 release의 봉인 bundle 사본에서 앱 자식의 entry·화면·data schema를 읽어
//      supervisor에 알린다. 앱은 권한 flag 없이 뜬다(사람이 2026-10-27에 정했다).
//   2. activation: 앱 place session의 `release.activate`(판정은 handler.ts)가 앱마다 하나만(queue.ts)
//      시작한 release를 `activation.start`로 열고 `runActivation`이 순서대로 진행한다. core가 다시 뜨거나
//      supervisor가 끊긴 뒤의 진행 중 시도는 `recoverActivation`이 ledger와 실제 관측에서 이어받는다.
//      단계의 실제 일은 `ActivationPorts`로 끼운다: 자식 종료·후보 준비·열기는 supervisor, 앱 DB 작업은
//      supervisor가 띄우는 data worker, ledger 확정은 core 내부 machine 자격의 command다. core는 앱 DB를
//      열지 않고 backup 파일의 byte를 blob 준비 통로로 흘리기만 한다.
//   3. 이전 release로 돌아가기 요청(`activation_requests`)과 사람이 허락한 동의 줄(`activation_consents`)을 sweep이 읽어 시작한다.
// Bus·호출 접수(drain)·changeset은 다른 module의 port라 조립이 `attach`로 늦게 끼운다.
import { type FileHandle, mkdir, open } from "node:fs/promises";

import {
  type Clock,
  canonicalize,
  err,
  type IdSource,
  ok,
  type Result,
} from "../../../../base/mod.ts";
import {
  type ActivationComparison,
  type ActivationDataResult,
  type ActivationQueueEntry,
  type App,
  type AppGrant,
  activationAskConsent,
  activationComplete,
  activationFail,
  activationRecordBackup,
  activationRecordDataChange,
  activationRecordDataRestore,
  activationReport,
  activationStart,
  appBundleCopy,
  appDataFolder,
  appRecordUnavailable,
  decodeActivationDataJobOutput,
  encodeActivationDataJobInput,
  type ReleaseActivateOutput,
  type ReleaseRecord,
  rolledBackStepText,
} from "../../../../protocol/apps/mod.ts";
import type { RequestContext, Sql } from "../../../../protocol/server/mod.ts";
import type { PreparedBlob } from "../../../../protocol/storage/mod.ts";
import type { Bus } from "../../../events/ports.ts";
import type {
  BlobPrepareCall,
  PreparedRelayResult,
} from "../../../storage/blobs/prepare-relay.ts";

import { openConnection } from "../../../storage/ledger/mod.ts";
import { BACKUP_BLOB_PURPOSE } from "../../data/blobs.ts";
import { loadApps } from "../../registration/mod.ts";
import type { ConnectFacts } from "../../runtime/connect.ts";
import type { DesiredApp } from "../../runtime/supervisor/mod.ts";
import type { SupervisorClient } from "../../runtime/supervisor-link.ts";
import { asksFor, compareForActivation } from "../compare.ts";
import {
  loadActiveRelease,
  loadRelease,
  loadStoredDeclaration,
} from "../store.ts";
import { allowedConsents, waitingConsents } from "./consents.ts";
import {
  type DomainNamesOf,
  desiredFromBundle,
  readBundleCopy,
} from "./desired.ts";
import { createActivationHandlers } from "./handler.ts";
import { runActivation } from "./orchestrator.ts";
import { createActivationQueue, type QueueEntry } from "./queue.ts";
import { recoverActivation } from "./recovery.ts";
import type { ActivationIntake, ActivationPorts, Attempt } from "./steps.ts";

type Envelope = {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
  prepared: string[];
};

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
  domainNamesOf: DomainNamesOf;
  // 원하는 앱 상태를 supervisor에 알린다(마지막 상태를 기억한다).
  reconcile(desired: DesiredApp): Promise<Result<void>>;
};

// 다른 module의 port다. 조립이 늦게 끼운다(`attach`). 끼우기 전에는 activation을 진행하지 않는다.
type ActivationLate = {
  bus: Pick<Bus, "publish">;
  intake: ActivationIntake;
  // 새 호출 접수를 닫은 동안 붙잡은 호출 수.
  heldCalls: (app: string) => number;
  invocations: {
    pruneChangesets(app: string, keepRelease: string): Promise<Result<number>>;
  };
};

export type ActivationDriver = {
  // activation 진행과 운영 DesiredApp 맞춤을 한 번 돈다. 시도마다 오래 걸리는 일은 기다리지 않는다.
  sweep(): Promise<void>;
  // 도는 시도 수. 시험이 끝을 기다린다.
  readonly running: number;
  settled(): Promise<void>;
  // Bus·접수·changeset port를 끼운다.
  attach(late: ActivationLate): void;
  // release 하나를 판정하고 시도가 끝나기를 기다린다(`release.activate`). 상한을 넘으면 running이다.
  activate(release: string): Promise<Result<ReleaseActivateOutput>>;
  // `activations.queue` read의 원천이다. 도는 것(메모리)과 사람을 기다리는 동의 줄(ledger)을 합친다.
  queueEntries(
    app: string | undefined,
  ): Promise<Result<{ entries: ActivationQueueEntry[]; as_of_seq: string }>>;
  // 후보나 운영 release의 앱 자식 입력을 만든다. 봉인 사본이 없거나 읽지 못하면 err다.
  desiredFor(
    app: string,
    release: string,
    state: { runEnabled: boolean; archived: boolean },
  ): Promise<Result<DesiredApp>>;
};

// 시작한 시도를 기다리는 상한. `shell.run`의 기본 timeout과 앱 tool 호출 상한(CALL_TIMEOUT_MS)과 같아 tool 하나가
// turn을 이보다 오래 붙들지 않는다. drain 유예(30초)와 후보 준비(90초)가 드는 보통의 activation은 들어가고,
// 큰 migration(data job 상한 300초)은 넘을 수 있어 running이다.
const ACTIVATE_WAIT_MS = 120_000;

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

export function createActivationDriver(deps: ActivationDeps): ActivationDriver {
  const queue = createActivationQueue();
  let late: ActivationLate | undefined;
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

  // 그 release의 봉인 사본과 ledger가 정한 실행 상태로 supervisor에 알릴 원하는 상태를 만든다.
  async function desiredFor(
    app: string,
    release: string,
    state: { runEnabled: boolean; archived: boolean },
  ): Promise<Result<DesiredApp>> {
    const row = withLedger((sql) =>
      sql.get(
        "SELECT bundle_hash, data_schema FROM releases WHERE id = ? AND app = ?",
        [release, app],
      ),
    );
    if (!row.ok) return row;
    if (row.value === undefined) return unavailable("release is unavailable");
    const bundleHash = String(row.value.bundle_hash);
    const copy = await readBundleCopy(
      deps.dataRoot,
      app,
      bundleHash,
      deps.domainNamesOf,
    );
    if (!copy.ok) return copy;
    if (copy.value === undefined) return unavailable("bundle copy is missing");
    const dataPath = appDataFolder(deps.dataRoot, app);
    try {
      await mkdir(dataPath, { recursive: true });
    } catch {
      return unavailable("app data area cannot be made");
    }
    return ok(
      desiredFromBundle(copy.value, {
        app,
        release,
        bundleHash,
        runEnabled: state.runEnabled,
        archived: state.archived,
        dataSchema: Number(row.value.data_schema),
        dataPath,
      }),
    );
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
      ),
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
      const stored = loadStoredDeclaration(sql, release.id);
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
    return ok(
      compareForActivation({
        previous:
          active === null || active.id === release.id
            ? null
            : { id: active.id, data_schema: active.data_schema },
        grants: grants.value,
        facts: read.value.stored.facts,
        next: { data_changes: release.data_changes },
      }),
    );
  }

  // ---- ledger command ----

  function machine(): Result<RequestContext> {
    const ctx = deps.machine();
    return ctx === undefined
      ? unavailable("machine credential is unavailable")
      : ok(ctx);
  }

  // once이면 key를 그대로 써서 같은 호출이 같은 결과를 돌려받는다.
  async function sendValue(
    command: string,
    input: unknown,
    key: string,
    once = false,
  ): Promise<Result<unknown>> {
    const ctx = machine();
    if (!ctx.ok) return ctx;
    const sent = deps.command(ctx.value, {
      command,
      input,
      idempotency_key: once ? key : `${key}-${crypto.randomUUID()}`,
      compare: {},
      prepared: [],
    });
    if (sent === undefined) return unavailable("tool are unavailable");
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
    Result<{
      result: ActivationDataResult;
      backup_hash?: string;
      failed?: { step: string; message: string };
    }>
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
            tools: attestation.tools,
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
        let file: FileHandle;
        try {
          file = await open(
            `${appDataFolder(
              deps.dataRoot,
              attempt.app,
            )}/backups/backup-${attempt.attempt}`,
          );
        } catch {
          return unavailable("backup file cannot be read");
        }
        const prepared = await deps
          .prepareBlob({
            principal: ctx.value.principal,
            purpose: BACKUP_BLOB_PURPOSE,
            bytes: file.readableWebStream() as ReadableStream<Uint8Array>,
          })
          .finally(() => file.close().catch(() => {}));
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
          bundle_path: appBundleCopy(
            deps.dataRoot,
            attempt.app,
            attempt.bundleHash,
          ),
          data_changes: attempt.dataChanges,
          invocation,
        });
        if (!done.ok) return done;
        // 되돌아간 단계는 err로 낸다. 그 글이 migration_failed summary까지 간다.
        if (done.value.failed !== undefined) {
          return unavailable(rolledBackStepText(done.value.failed));
        }
        return ok(done.value.result);
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

  // `release.activate`가 지금 결과를 기다리는 release. 기다리는 쪽이 없는 끝(동의 뒤, 기다림 상한 뒤,
  // 재시작 뒤 이어받음)만 release를 만든 session에 따로 알린다.
  const awaited = new Set<string>();

  // ---- 앱 하나의 한 차례 ----

  // 시작한 release 하나를 끝까지 진행한다. 진행 중으로 남은 시도(끊긴 것)면 이어받는다.
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
          await handlers.reconsider(release);
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
      outcome = await runActivation(ports, release);
    }
    // 복원이나 종료를 확인하지 못했으면 앱은 붙든 채로 둔다(이전 코드를 시작하지 않는다). 다음 sweep이 이어받는다.
    if (outcome.status !== "unavailable") {
      // 시도가 끝났다. 이전 release가 없어 다시 띄울 것이 없어도 붙들기는 푼다.
      await deps.client.activationResume(release.app).catch(() => undefined);
    }
    if (
      (outcome.status === "active" || outcome.status === "failed") &&
      !awaited.has(release.id)
    ) {
      await sendValue(
        activationReport.name,
        { release: release.id },
        "activation-report",
      );
    }
  }

  function enqueue(
    app: string,
    release: string,
    approved: string | null,
  ): Result<void> {
    if (!queue.enqueue(app, release, approved, runOne)) {
      return err({
        code: "conflict",
        message: "an activation is already running for the app",
      });
    }
    return ok(undefined);
  }

  const handlers = createActivationHandlers({
    releases: {
      get: currentRelease,
      comparison: comparisonOf,
    },
    consents: {
      async ask(release, comparison) {
        const done = await sendValue(
          activationAskConsent.name,
          { release: release.id, comparison },
          "activation-ask-consent",
        );
        return done.ok ? ok(undefined) : done;
      },
    },
    enqueue,
  });

  async function activate(id: string): Promise<Result<ReleaseActivateOutput>> {
    // supervisor 통로 없이 시작하면 종료를 확인하지 못해 시도가 activating으로 남는다(sweep이 bound를 보는 것과 같은 이유).
    if (late === undefined || !deps.bound()) {
      return unavailable("activation is unavailable");
    }
    const found = currentRelease(id);
    if (!found.ok) return found;
    const release = found.value;
    if (release === null) {
      return err({ code: "not_found", message: "release is not found" });
    }
    if (release.status !== "prepared") {
      return err({ code: "conflict", message: "release is not prepared" });
    }
    if (queue.running(release.app) !== undefined) {
      return err({
        code: "conflict",
        message: "an activation is already running for the app",
      });
    }
    awaited.add(id);
    try {
      const judged = await handlers.activate(release);
      if (!judged.ok) return judged;
      if (judged.value === "waiting_consent") {
        return ok({ status: "waiting_consent", release: id });
      }
      const job = queue.running(release.app);
      if (job !== undefined) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            job,
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, ACTIVATE_WAIT_MS);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
    } finally {
      awaited.delete(id);
    }
    const after = currentRelease(id);
    if (!after.ok) return after;
    const now = after.value;
    if (now === null) {
      return unavailable("release is unavailable");
    }
    if (now.status === "active") {
      return ok({
        status: "active",
        release: id,
        previous_release: now.activation?.previous_release ?? null,
      });
    }
    if (now.status === "failed" && now.failure !== null) {
      return ok({ status: "failed", release: id, failure: now.failure });
    }
    if (now.status === "activating") {
      return ok({ status: "running", release: id });
    }
    if (now.status === "prepared") {
      // 기다리는 사이 비교가 달라져 reconsider가 다시 물었으면 동의를 기다린다.
      const waiting = ledgerRead((sql) => ok(waitingConsents(sql, now.app)));
      if (waiting.ok && waiting.value.some((row) => row.release === id)) {
        return ok({ status: "waiting_consent", release: id });
      }
    }
    return err({
      code: "conflict",
      message: "the activation did not start",
    });
  }

  function activatingRows(): Result<{ id: string; app: string }[]> {
    return withLedger((sql) =>
      sql
        .all(
          "SELECT id, app FROM releases WHERE status = 'activating' ORDER BY id",
          [],
        )
        .map((row) => ({ id: String(row.id), app: String(row.app) })),
    );
  }

  function requestedRows(): Result<{ release: string; app: string }[]> {
    return withLedger((sql) =>
      sql
        .all(
          `SELECT q.release AS release, r.app AS app
           FROM activation_requests q JOIN releases r ON r.id = q.release
          ORDER BY q.requested_at, q.release`,
          [],
        )
        .map((row) => ({
          release: String(row.release),
          app: String(row.app),
        })),
    );
  }

  // 앱 하나의 운영 desired를 맞춘다. 근거(App 행)가 그대로면 다시 만들지 않는다. 맞췄으면 true다.
  async function reconcileOne(app: App): Promise<boolean> {
    if (app.active_release === null) return false;
    const key = JSON.stringify([
      app.revision,
      app.active_release,
      app.run_enabled,
      app.status,
    ]);
    if (lastKeys.get(app.id) === key) return true;
    const desired = await desiredFor(app.id, app.active_release, {
      runEnabled: app.run_enabled,
      archived: app.status === "archived",
    });
    // 봉인 사본을 읽지 못하면 알리지 않는다. 다음 sweep이 다시 본다.
    if (!desired.ok) return false;
    const told = await deps.reconcile(desired.value);
    if (!told.ok) return false;
    lastKeys.set(app.id, key);
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
      await reconcileOne(app);
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
    activate,
    queueEntries(app) {
      const entries = queue.list(app, (one) => late?.heldCalls(one) ?? 0);
      const waiting = ledgerRead((sql) => ok(waitingConsents(sql, app)));
      if (!waiting.ok) return Promise.resolve(waiting);
      for (const consent of waiting.value) {
        if (entries.some((entry) => entry.release === consent.release)) {
          continue;
        }
        entries.push({
          app: consent.app,
          release: consent.release,
          phase: "waiting_consent",
          step: null,
          held_calls: 0,
          migration_steps: 0,
        });
      }
      return Promise.resolve(ok({ entries, as_of_seq: headSeq() }));
    },
    desiredFor,
    async sweep() {
      if (!deps.bound()) return;
      if (late !== undefined) {
        // 이 process가 돌리지 않는 진행 중 시도는 끊긴 것이다. 이어받는다. 앱이 바쁘면 건너뛴다.
        const rows = activatingRows();
        if (rows.ok) {
          for (const row of rows.value) enqueue(row.app, row.id, null);
        }
        // 이전 release로 돌아가기 요청을 시작한다. 앱이 바쁘면 요청 행이 남아 다음 sweep이 다시 본다.
        // `activation.start`가 요청을 지운다.
        const requested = requestedRows();
        if (requested.ok) {
          for (const row of requested.value) {
            enqueue(row.app, row.release, null);
          }
        }
        // 사람이 허락한 동의 줄을 시작한다. 앱이 바쁘면 줄이 남아 다음 sweep이 다시 본다.
        // `activation.start`가 줄을 지운다.
        const allowed = withLedger((sql) => allowedConsents(sql));
        if (allowed.ok) {
          for (const row of allowed.value) await handlers.consented(row);
        }
      }
      const attempting = new Set(
        queue.list(undefined, () => 0).map((entry) => entry.app),
      );
      await reconcileProduct(attempting);
    },
  };
}
