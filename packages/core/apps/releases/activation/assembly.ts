// core 안 activation 조립(apps/releases#R8, R12–R16, apps/data#R4, R11). 두 일을 한다.
//   1. 운영 DesiredApp: 활성 release의 봉인 bundle 사본과 현재 grant에서 푼 permission으로 앱 자식의 flag를
//      만들어 supervisor에 알린다(`bundleFlags`). 앱 코드는 신뢰하지 않으므로 선언 ∩ active grant 밖의 접근은
//      flag에 없다.
//   2. activation 진행: 사람 approval을 적용해 시작된 시도(`ReleaseActivationStarted`)를 `runActivation`이
//      순서대로 진행하고, core가 다시 뜨거나 supervisor가 끊긴 뒤의 진행 중 시도는 `recoverActivation`이
//      ledger와 실제 관측에서 이어받는다. 단계의 실제 일은 `ActivationPorts`로 끼운다: 자식 종료·후보 준비·
//      열기는 supervisor, 앱 DB 작업은 supervisor가 띄우는 data worker, ledger 확정은 core 내부 machine 자격의
//      command다. core는 앱 DB를 열지 않고 backup 파일의 byte를 blob 준비 통로로 흘리기만 한다.
import {
  type Clock,
  err,
  type IdSource,
  ok,
  type Result,
} from "../../../../base/mod.ts";
import {
  type App,
  appRecordUnavailable,
  type DataResult,
  encodeDataJobInput,
  type Grant,
  type Release,
  releaseCompleteActivation,
  releaseFailActivation,
  releaseRecordBackup,
  releaseRecordDataChange,
  releaseRecordDataRestore,
  releasesGet,
} from "../../../../protocol/apps/mod.ts";
import { decodeDataJobOutput } from "../../../../protocol/apps/mod.ts";
import type {
  PreparedBlob,
  RequestContext,
  Sql,
} from "../../../../protocol/server/mod.ts";
import { type BlobPrepareCall } from "../../../main/daemon/core.ts";
import type { PreparedRelayResult } from "../../../storage/blobs/prepare-relay.ts";
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
import { loadStoredBlueprint } from "../store.ts";
import { bundleFlags, desiredFromBundle, readBundleCopy } from "./desired.ts";
import { runActivation } from "./orchestrator.ts";
import { recoverActivation } from "./recovery.ts";
import type { ActivationPorts, Attempt } from "./steps.ts";
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

// 진행하지 못한 시도를 다시 이어받는 최소 간격이다. 같은 실패를 매 sweep 문제로 쏟아내지 않는다.
export const ACTIVATION_RETRY_MS = 30_000;

export type ActivationDeps = {
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

export type ActivationDriver = {
  // activation 진행과 운영 DesiredApp 맞춤을 한 번 돈다. 시도마다 오래 걸리는 일은 기다리지 않는다.
  sweep(): Promise<void>;
  // 지금 진행 중인(이 process의 메모리) 시도 수. 시험이 끝을 기다린다.
  readonly running: number;
  settled(): Promise<void>;
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

type ActivatingRow = { id: string; app: string; started_seq: string };

export function createActivationDriver(deps: ActivationDeps): ActivationDriver {
  const running = new Map<string, Promise<void>>();
  // 이 process가 이미 한 번 진행했거나 이어받았지만 끝내지 못한 시도와 다음 재시도 시각이다.
  const unsettled = new Map<string, number>();
  // 시작 시점의 마지막 event seq다. 그 이전에 시작한 진행 중 시도는 이 process가 진행한 것이 아니다.
  let startupSeq = 0;
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
  async function grantsOf(app: string): Promise<Result<readonly Grant[]>> {
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

  // ---- ActivationPorts ----

  function machine(): Result<RequestContext> {
    const ctx = deps.machine();
    return ctx === undefined
      ? unavailable("machine credential is unavailable")
      : ok(ctx);
  }

  async function send(
    command: string,
    input: unknown,
    key: string,
  ): Promise<Result<void>> {
    const ctx = machine();
    if (!ctx.ok) return ctx;
    const sent = deps.command(ctx.value, {
      command,
      input,
      idempotency_key: `${key}-${crypto.randomUUID()}`,
      compare: {},
      prepared: [],
    });
    if (sent === undefined) return unavailable("commands are unavailable");
    const done = await sent;
    return done.ok ? ok(undefined) : done;
  }

  async function job(
    attempt: Attempt,
    kind: "inspect" | "backup" | "migrate" | "restore",
    extra: Record<string, unknown> = {},
  ): Promise<Result<{ result: DataResult; backup_hash?: string }>> {
    const line = encodeDataJobInput({
      kind,
      app: attempt.app,
      release: attempt.release,
      activation_seq: attempt.startedSeq,
      data_path: "app.sqlite",
      data_schema: kind === "migrate"
        ? attempt.targetSchema
        : attempt.expectedSchema,
      ...extra,
    } as never);
    const ran = await deps.client.dataJob(attempt.app, line);
    if (!ran.ok) return ran;
    try {
      return ok(decodeDataJobOutput(ran.value));
    } catch {
      return unavailable("data job answered badly");
    }
  }

  async function currentRelease(id: string): Promise<Result<Release | null>> {
    const ctx = machine();
    if (!ctx.ok) return ctx;
    const read = await deps.readers.read(releasesGet, ctx.value, {
      release: id,
    });
    if (!read.ok) return read;
    return ok((read.value as { release: Release | null }).release);
  }

  async function ledgerApp(app: string) {
    return await deps.facts.app(app);
  }

  const ports: ActivationPorts = {
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
            commands: attestation.commands,
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
      async inspect(app) {
        const attempt = inspectAttempt(app);
        if (attempt === undefined) {
          return unavailable("no activation to inspect");
        }
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
            `${deps.dataRoot}/apps/${attempt.app}/data/backups/backup-${attempt.startedSeq}`,
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
          `${attempt.release}:${attempt.startedSeq}`,
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
      release: currentRelease,
      async recordBackup(input) {
        const blob = preparedBackups.get(
          `${input.release}:${input.activation_seq}`,
        );
        if (blob === undefined) return unavailable("no preserved backup");
        return await send(
          releaseRecordBackup.name,
          { ...input, blob },
          "activation-backup",
        );
      },
      recordDataChange: (result) =>
        send(releaseRecordDataChange.name, { result }, "activation-change"),
      recordDataRestore: (result, backupHash) =>
        send(
          releaseRecordDataRestore.name,
          { result, backup_hash: backupHash },
          "activation-restore",
        ),
      completeActivation: (input) =>
        send(releaseCompleteActivation.name, input, "activation-complete"),
      failActivation: (input) =>
        send(releaseFailActivation.name, input, "activation-fail"),
    },
    async report(problem) {
      // 복원 실패·확인 불가는 앱을 사용할 수 없는 상태로 남기고 이유를 runtime 상태에 둔다.
      const code = problem.code;
      await send(
        appRecordUnavailable.name,
        {
          app: problem.app,
          release: problem.release,
          reason: { code, summary: problem.summary },
        },
        "activation-unavailable",
      );
    },
    newInvocation: () => deps.ids.newId("inv"),
  };

  // inspect·report는 시도 하나의 문맥이 아니라 앱 하나의 질의다. 진행 중인 시도의 문맥을 빌린다.
  const inspecting = new Map<string, Attempt>();
  function inspectAttempt(app: string): Attempt | undefined {
    return inspecting.get(app);
  }

  async function startedRelease(row: ActivatingRow): Promise<Release | null> {
    const read = await currentRelease(row.id);
    return read.ok ? read.value : null;
  }

  function activatingRows(): Result<ActivatingRow[]> {
    return withLedger((sql) =>
      sql.all(
        `SELECT id, app, json_extract(activation, '$.started_seq') AS started_seq
           FROM releases WHERE status = 'activating' ORDER BY id`,
        [],
      ).map((row) => ({
        id: String(row.id),
        app: String(row.app),
        started_seq: String(row.started_seq),
      }))
    );
  }

  function headSeq(): number {
    const read = withLedger((sql) =>
      Number(
        sql.get("SELECT COALESCE(MAX(seq), 0) AS n FROM events", [])?.n ?? 0,
      )
    );
    return read.ok ? read.value : 0;
  }

  function start(row: ActivatingRow, interrupted: boolean): void {
    const key = `${row.id}:${row.started_seq}`;
    const work = (async () => {
      const release = await startedRelease(row);
      if (release === null || release.activation === null) return;
      inspecting.set(row.app, {
        app: row.app,
        release: row.id,
        startedSeq: row.started_seq,
        previousRelease: release.activation.previous_release,
        expectedSchema: release.activation.expected_schema,
        targetSchema: release.data_schema,
        bundleHash: release.bundle_hash,
        dataChanges: release.data_changes,
      });
      const outcome = interrupted
        ? await recoverActivation(ports, row.id)
        : await runActivation(ports, release);
      if (outcome.status === "unavailable") {
        // 복원이나 종료를 확인하지 못했다. 앱은 붙든 채로 두고(이전 코드를 시작하지 않는다) 나중에 이어받는다.
        unsettled.set(key, deps.clock.nowMs() + ACTIVATION_RETRY_MS);
      } else {
        unsettled.delete(key);
        // 시도가 끝났다. 이전 release가 없어 다시 띄울 것이 없어도 붙들기는 푼다.
        await deps.client.activationResume(row.app).catch(() => undefined);
      }
    })().catch(() => {
      unsettled.set(key, deps.clock.nowMs() + ACTIVATION_RETRY_MS);
    }).finally(() => {
      running.delete(key);
      inspecting.delete(row.app);
    });
    running.set(key, work);
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
      grants.value.filter((grant) => grant.kind !== "automation.run").map((
        grant,
      ) => grant.id).sort(),
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

  startupSeq = headSeq();

  return {
    get running() {
      return running.size;
    },
    async settled() {
      await Promise.all([...running.values()]);
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
      const rows = activatingRows();
      const attempting = new Set<string>();
      if (rows.ok) {
        for (const row of rows.value) {
          attempting.add(row.app);
          const key = `${row.id}:${row.started_seq}`;
          if (running.has(key)) continue;
          const retryAt = unsettled.get(key);
          if (retryAt !== undefined && deps.clock.nowMs() < retryAt) continue;
          // 이 process가 시작을 보지 못했거나 한 번 끝내지 못한 시도는 이어받는다.
          const interrupted = Number(row.started_seq) <= startupSeq ||
            retryAt !== undefined;
          start(row, interrupted);
        }
      }
      await reconcileProduct(attempting);
    },
  };
}
