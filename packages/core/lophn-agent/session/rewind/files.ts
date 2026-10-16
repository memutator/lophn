// session rewind의 파일 흐름(복원 쓰기)과 앱 rewind 요청. 파일 쓰기·hash 계산·복원 내용 준비는
// ledger transaction 안에서 할 수 없으므로 writer queue 앞의 처리기가 Rewind를 가로채 순서를 잇는다:
// 관측 → 판정 → 준비 → command → 설치(→ 건너뛴 경로가 있으면 AmendRevertInstall) → 사람이 고른 앱의 rewind
// 요청. command는 파일을 쓰지 않고 준비한 관측(input.files)으로 다시 판정해 기록만 확정한다. 파일 일은
// 모두 async API다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  amendRevertInstall,
  closeSession,
  deleteSession,
  type PreparedFile,
  recordRewindApps,
  recordRewindFile,
  type RewindAppRequest,
  sessionRewind,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { parseActor } from "../../../../protocol/base/mod.ts";
import {
  assertCheckpointVisible,
  eraseSessionStore,
  type FileRef,
  installRestore,
  observationOf,
  observeFilesAsync,
  planRewind,
  prepareRestore,
  type RewindPlan,
  type RewindStore,
  type RewindTarget,
} from "./mod.ts";
import type { FileStat } from "./judge.ts";
import {
  type CommandEnvelope,
  type CommandSuccess,
  openConnection,
  type Writer,
} from "../../../storage/ledger/mod.ts";
import type { AppWrites } from "../../ports.ts";

// core 내부 machine 자격이다. token이 없어 HTTP로는 이 principal이 될 수 없고 ledger credential 기록으로만
// writer가 현재 자격을 본다. 설치가 건너뛴 경로의 정정(AmendRevertInstall), file tool의 쓰기 기록
// (RecordRewindFile), 앱 rewind 요청 결과(RecordRewindApps)만 낸다.
export const REWIND_MACHINE_PRINCIPAL = "machine:rewind";

export const REWIND_MACHINE_CONTEXT: AuthenticatedContext = {
  principal: REWIND_MACHINE_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      amendRevertInstall.name,
      recordRewindFile.name,
      recordRewindApps.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: REWIND_MACHINE_PRINCIPAL,
};

type Lookup = Parameters<typeof observationOf>[0];

// ledger를 읽기 전용으로 짧게 열어 read를 하고 닫는다. 읽다가 던지면 못 읽은 것이다.
export function ledgerSnapshot<T>(
  ledgerPath: string,
  read: (lookup: Lookup) => T,
): Result<T> {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return opened;
  try {
    return ok(read({ sql: opened.value.sql }));
  } catch {
    return unavailable("the ledger could not be read");
  } finally {
    opened.value.close();
  }
}

// 사람이 고른 앱을 앱 rewind에 잇는 길이다. 구현은 core 조립이 끼운다(S5의 AppWrites와 앱 rewind).
export type RewindAppPorts = {
  // 고른 시점 뒤에 이 session이 앱에 한 write invocation.
  writes: AppWrites;
  // 그 앱을 `from` invocation 직전으로 되돌리라고 요청한다. 앱 쪽 순서(drain, 충돌 시 통째로 취소)를 따라
  // 끝나기까지 오래 걸릴 수 있다.
  requestRewind(app: string, from: string): Promise<
    Result<
      { status: "applying" | "applied" | "cancelled"; reason: string | null }
    >
  >;
};

export type RewindFilesDeps = {
  // ledger를 짧게 읽는다. 파일을 읽는 동안 열어 두지 않는다.
  snapshot<T>(read: (lookup: Lookup) => T): Result<T>;
  store: RewindStore;
  apps: RewindAppPorts;
};

// 같은 key의 재전송은 처음 준비한 입력을 그대로 다시 보낸다. 준비는 그때의 파일에서 나오므로 다시 만들면
// 입력이 달라져 ledger가 같은 key의 다른 요청으로 거절한다. process 안의 짧은 기억이다(없으면 거절이고
// 두 번 적용되지는 않는다).
const REMEMBERED = 64;

type Header = { id: string; outcome: string; replayed: boolean };

const keyOf = (ctx: AuthenticatedContext, envelope: CommandEnvelope): string =>
  `${ctx.principal}\n${envelope.idempotency_key}`;

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

// 설치가 쓰지 못한 경로를 사람 결정에 묶인 machine 자격으로 결과에 반영한다(AmendRevertInstall). 설치 직후의
// 정정과 시작 때 맞추기가 key로 가른다.
export function amendInstall(
  writer: Writer,
  revert: string,
  paths: readonly string[],
  key: string,
): Promise<Result<CommandSuccess>> {
  return writer.command(REWIND_MACHINE_CONTEXT, {
    command: amendRevertInstall.name,
    input: { revert, paths: [...paths] },
    idempotency_key: key,
    compare: {},
    prepared: [],
  });
}

export async function amendInstalled(
  writer: Writer,
  revert: string,
  installed: readonly { path: string; result: "restored" | "skipped" }[],
): Promise<Result<void>> {
  const paths = installed.filter((file) => file.result === "skipped")
    .map((file) => file.path);
  if (paths.length === 0) return ok(undefined);
  const amended = await amendInstall(
    writer,
    revert,
    paths,
    `rewind-install:${revert}`,
  );
  return amended.ok ? ok(undefined) : amended;
}

// 허용 폴더마다 모아 읽는다. 결과의 key는 path다(한 session에서 같은 경로가 두 폴더에 있으면 판정이 복원하지
// 않는다).
export async function observeAll(
  files: readonly FileRef[],
): Promise<Map<string, FileStat>> {
  const byRoot = new Map<string, string[]>();
  for (const file of files) {
    byRoot.set(file.root, [...byRoot.get(file.root) ?? [], file.path]);
  }
  const seen = new Map<string, FileStat>();
  for (const [root, paths] of byRoot) {
    for (const [path, stat] of await observeFilesAsync(root, paths)) {
      seen.set(path, stat);
    }
  }
  return seen;
}

export type PreparedRewind = {
  plan: RewindPlan;
  files: PreparedFile[];
};

// 판정을 만들고 준비한다. 판정이 거절이면 null을 돌려주고 호출자가 입력을 그대로 보내 command가 같은
// 거절을 낸다.
export async function prepareRewind(
  deps: Pick<RewindFilesDeps, "snapshot" | "store">,
  target: RewindTarget,
): Promise<Result<PreparedRewind | null>> {
  // 이미 숨긴 구간의 checkpoint는 command가 거절하므로 파일을 준비하지 않는다(재전송도 같은 길이다).
  const seen = deps.snapshot((lookup) =>
    !assertCheckpointVisible(lookup, target.session, target.checkpoint).ok
      ? null
      : observationOf(lookup, target)
  );
  if (!seen.ok) return seen;
  if (seen.value === null || !seen.value.ok) return ok(null);
  try {
    const observed = await observeAll(seen.value.value);
    const planned = deps.snapshot((lookup) =>
      planRewind(lookup, {}, target, { observed })
    );
    if (!planned.ok) return planned;
    if (!planned.value.ok) return ok(null);
    const plan = planned.value.value;
    const files = await prepareRestore({
      store: deps.store,
      session: target.session,
      judged: plan.judged,
      current: plan.current,
    });
    return ok({ plan, files });
  } catch {
    return unavailable("the files to restore could not be prepared");
  }
}

// 사람이 고른 앱마다 그 앱을 "이 session의 첫 write invocation 직전"으로 되돌리라고 앱 rewind에 요청한다.
// 앱 rewind는 앱 쪽 순서를 따르므로 결과를 기다리되 session rewind를 되돌리지는 않는다: 거절되거나
// 취소돼도 대화와 파일은 이미 끝났다. 요청한 결과(접수, 적용, 거절)를 RecordRewindApps로 남긴다. 고른
// 시점 뒤 이 session의 write가 없는 앱은 요청하지 않는다.
export async function requestApps(
  deps: Pick<RewindFilesDeps, "snapshot" | "apps">,
  writer: Writer,
  input: {
    revert: string;
    session: string;
    checkpoint: string;
    apps: readonly string[];
  },
): Promise<void> {
  if (input.apps.length === 0) return;
  const boundary = deps.snapshot((lookup) =>
    lookup.sql.get("select created_seq from messages where id = ?", [
      input.checkpoint,
    ])
  );
  if (!boundary.ok || boundary.value === undefined) return;
  const writes = deps.apps.writes.writesAfter(
    input.session as never,
    String(boundary.value["created_seq"]) as never,
  );
  const results = await Promise.all(input.apps.map(async (app) => {
    // invocation id는 시간 순서다.
    const first = [
      ...(writes.find((entry) => entry.app === app)?.invocations ?? []),
    ].sort()[0];
    if (first === undefined) return undefined;
    const asked = await deps.apps.requestRewind(app, first)
      .catch((): Result<never> => unavailable("app rewind is not available"));
    const request: RewindAppRequest = {
      app: app as never,
      from_invocation: first as never,
      result: "rejected",
      reason: null,
    };
    if (!asked.ok) return { ...request, reason: asked.error.code };
    const { status, reason } = asked.value;
    return status === "applied"
      ? { ...request, result: "applied" as const }
      : status === "applying"
      ? { ...request, result: "accepted" as const }
      : { ...request, reason: reason ?? "cancelled" };
  }));
  const asked = results.filter((result) => result !== undefined);
  if (asked.length === 0) return;
  await writer.command(REWIND_MACHINE_CONTEXT, {
    command: recordRewindApps.name,
    input: { revert: input.revert, apps: asked },
    idempotency_key: `rewind-apps:${input.revert}`,
    compare: {},
    prepared: [],
  });
}

export function withRewindFiles(
  writer: Writer,
  deps: RewindFilesDeps,
): Writer {
  const remembered = new Map<string, unknown>();
  const remember = (key: string, input: unknown): void => {
    remembered.set(key, input);
    if (remembered.size > REMEMBERED) {
      remembered.delete(remembered.keys().next().value as string);
    }
  };

  // 준비한 입력을 writer에 보낸다. 같은 key로 이미 보낸 입력이 있으면 그것을 다시 보낸다.
  async function send(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
    input: unknown,
  ): Promise<Result<CommandSuccess>> {
    const key = keyOf(ctx, envelope);
    const first = remembered.has(key) ? remembered.get(key) : input;
    const sent = await writer.command(ctx, { ...envelope, input: first });
    if (sent.ok && first !== envelope.input) remember(key, first);
    return sent;
  }

  async function rewindFiles(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<CommandSuccess>> {
    const parsed = sessionRewind.input.safeParse(envelope.input);
    const key = keyOf(ctx, envelope);
    if (
      !parsed.success || parsed.data.choice !== "restore_all" ||
      parsed.data.files.length > 0 || remembered.has(key)
    ) return await send(ctx, envelope, envelope.input);
    const input = parsed.data;
    const prepared = await prepareRewind(deps, {
      session: input.session,
      checkpoint: input.checkpoint,
      choice: input.choice,
    });
    if (!prepared.ok) return prepared;
    if (prepared.value === null) {
      return await send(ctx, envelope, envelope.input);
    }
    const { plan, files } = prepared.value;
    const sent = await send(ctx, envelope, { ...input, files });
    if (!sent.ok || sent.value.replayed) return sent;
    const header = sent.value.result as Header;
    if (header.replayed || header.outcome !== "applied") return sent;
    const installed = await installRestore({
      store: deps.store,
      session: input.session,
      judged: plan.judged,
      prepared: files,
    });
    const amended = await amendInstalled(writer, header.id, installed);
    return amended.ok ? sent : amended;
  }

  // Rewind: 대화와 파일이 끝난 뒤에 고른 앱의 rewind를 따로 요청한다.
  async function rewind(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<CommandSuccess>> {
    const sent = await rewindFiles(ctx, envelope);
    const parsed = sessionRewind.input.safeParse(envelope.input);
    if (!sent.ok || sent.value.replayed || !parsed.success) return sent;
    const header = sent.value.result as Header;
    if (header.replayed || header.outcome !== "applied") return sent;
    // 앱 rewind의 drain을 기다리지 않는다. 결과는 따로 남는다.
    void requestApps(deps, writer, {
      revert: header.id,
      session: parsed.data.session,
      checkpoint: parsed.data.checkpoint,
      apps: parsed.data.apps,
    }).catch(() => undefined);
    return sent;
  }

  // session을 지우거나 닫으면 그 session의 저장소 디렉터리를 commit 뒤에 지운다. 지우지 못해도 command의
  // 결과는 그대로이고 시작 때와 주기의 쓸기(sweep)가 다시 쓸어낸다.
  async function erasedAfter(
    envelope: CommandEnvelope,
    sent: Promise<Result<CommandSuccess>>,
  ): Promise<Result<CommandSuccess>> {
    const result = await sent;
    const session = (envelope.input as { session?: unknown } | undefined)
      ?.session;
    if (result.ok && typeof session === "string") {
      await eraseSessionStore(deps.store, session);
    }
    return result;
  }

  return {
    ...writer,
    command(ctx, envelope) {
      if (
        envelope.command === deleteSession.name ||
        envelope.command === closeSession.name
      ) {
        return erasedAfter(envelope, writer.command(ctx, envelope));
      }
      if (
        parseActor(ctx.actor)?.kind === "user" &&
        envelope.command === sessionRewind.name
      ) return rewind(ctx, envelope);
      return writer.command(ctx, envelope);
    },
  };
}
