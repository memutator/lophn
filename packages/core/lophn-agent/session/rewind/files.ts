// session 되돌리기의 문서 파일 흐름(lophn-agent/revert R17, 복원 쓰기). 파일 쓰기·hash 계산·복원 내용 준비는
// ledger transaction 안에서 할 수 없으므로 writer queue 앞의 처리기가 Rewind·UndoEdit·Redo를 가로채 순서를
// 잇는다: 관측 → 판정 → 준비 → command → 설치(→ 건너뛴 경로가 있으면 AmendRevertInstall). command는 파일을
// 쓰지 않고 준비한 관측(input.files)으로 다시 판정해 기록만 확정한다. 파일 일은 모두 async API다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  amendRevertInstall,
  closeSession,
  deleteSession,
  type PreparedFile,
  redo,
  rewind,
  serializeMessageContent,
  undoEdit,
} from "../../../../protocol/lophn-agent/mod.ts";
import { MESSAGE_CONTENT_PURPOSE } from "../../../../protocol/lophn-agent/mod.ts";
import {
  type AuthenticatedContext,
  parseActor,
} from "../../../../protocol/server/mod.ts";
import { factMessageContent } from "../mod.ts";
import {
  assertCheckpointVisible,
  eraseSessionStore,
  hasAppSteps,
  installRedo,
  installRestore,
  latestAppRevision,
  observationOf,
  observeFilesAsync,
  type PlanDeps,
  planRewind,
  prepareRestore,
  type RewindPlan,
  type RewindStore,
  type RewindTarget,
} from "./mod.ts";
import {
  type CommandEnvelope,
  type CommandSuccess,
  openConnection,
  type Writer,
} from "../../../storage/ledger/mod.ts";
import { type BodyPrepare, prepareBytes } from "../message-body.ts";

// 설치가 건너뛴 경로를 결과에 반영하는 core 내부 machine 자격이다. token이 없어 HTTP로는 이 principal이 될 수
// 없고 ledger credential 기록으로만 writer가 현재 자격을 본다. AmendRevertInstall만 낸다.
export const REWIND_INSTALL_PRINCIPAL = "machine:rewind-install";

export const REWIND_INSTALL_CONTEXT: AuthenticatedContext = {
  principal: REWIND_INSTALL_PRINCIPAL,
  actor: "machine",
  scope: { operations: ["AmendRevertInstall"], targets: {} },
  conditions: {},
  credential_ref: REWIND_INSTALL_PRINCIPAL,
};

type Lookup = Parameters<typeof observationOf>[0];

// ledger를 읽기 전용으로 짧게 열어 read를 하고 닫는다. 읽다가 던지면(project 폴더가 없는 session 등) 못
// 읽은 것이다.
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

export type RewindFilesDeps = {
  // ledger를 짧게 읽는다. 파일을 읽는 동안 열어 두지 않는다.
  snapshot<T>(read: (lookup: Lookup) => T): Result<T>;
  rootOf: PlanDeps["rootOf"];
  // 되돌려지지 않는 질문 답·승인 결정. preview와 command가 같은 목록을 만들어야 preview_hash가 맞는다.
  answeredFacts?: PlanDeps["answeredFacts"];
  store: RewindStore;
  // 사실 메시지 본문을 준비하는 통로. I/O worker가 뜨기 전에는 없다(unavailable).
  relay(): BodyPrepare | undefined;
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
  return writer.command(REWIND_INSTALL_CONTEXT, {
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

export type PreparedRewind = {
  plan: RewindPlan;
  files: PreparedFile[];
  root: string;
};

// 판정을 만들고 준비한다. 판정이 거절이면 null을 돌려주고 호출자가 입력을 그대로 보내 command가 같은
// 거절을 낸다. 앱 단계가 있는 rewind는 redo가 없고 파일은 앱 단계가 끝난 뒤 다시 준비하므로 복원 직전
// 내용을 두지 않는다(관측만 command에 실어 preview_hash 비교에 쓴다).
export async function prepareRewind(
  deps: Pick<
    RewindFilesDeps,
    "snapshot" | "rootOf" | "store" | "answeredFacts"
  >,
  target: RewindTarget,
  keepRedo: boolean,
): Promise<Result<PreparedRewind | null>> {
  const planDeps = {
    rootOf: deps.rootOf,
    appRevision: latestAppRevision,
    answeredFacts: deps.answeredFacts,
  };
  // 이미 숨긴 구간의 checkpoint는 command가 거절하므로 파일을 준비하지 않는다(재전송도 같은 길이다).
  const seen = deps.snapshot((lookup) =>
    target.kind === "rewind" &&
      !assertCheckpointVisible(lookup, target.session, target.checkpoint).ok
      ? null
      : observationOf(lookup, planDeps, target)
  );
  if (!seen.ok) return seen;
  if (seen.value === null || !seen.value.ok) return ok(null);
  const { root, paths } = seen.value.value;
  try {
    const observed = await observeFilesAsync(root, paths);
    const planned = deps.snapshot((lookup) =>
      planRewind(lookup, planDeps, target, { observed })
    );
    if (!planned.ok) return planned;
    if (!planned.value.ok) return ok(null);
    const plan = planned.value.value;
    const files = await prepareRestore({
      root,
      store: deps.store,
      session: target.session,
      judged: plan.judged,
      current: plan.current,
      keepRedo: keepRedo && !hasAppSteps(plan),
    });
    return ok({ plan, files, root });
  } catch {
    return unavailable("the files to restore could not be prepared");
  }
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

  async function installAfter(
    sent: Result<CommandSuccess>,
    install: () => Promise<
      { path: string; result: "restored" | "skipped" }[]
    >,
    amends: boolean,
  ): Promise<Result<CommandSuccess>> {
    if (!sent.ok || sent.value.replayed) return sent;
    const header = sent.value.result as Header;
    if (header.replayed || header.outcome !== "applied") return sent;
    const installed = await install();
    if (!amends) return sent;
    const amended = await amendInstalled(writer, header.id, installed);
    return amended.ok ? sent : amended;
  }

  async function rewindFiles(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<CommandSuccess>> {
    const parsed = rewind.input.safeParse(envelope.input);
    const key = keyOf(ctx, envelope);
    if (
      !parsed.success || parsed.data.choice !== "restore_all" ||
      parsed.data.files.length > 0 || remembered.has(key)
    ) return await send(ctx, envelope, envelope.input);
    const input = parsed.data;
    const prepared = await prepareRewind(deps, {
      kind: "rewind",
      session: input.session,
      checkpoint: input.checkpoint,
      choice: input.choice,
    }, true);
    if (!prepared.ok) return prepared;
    if (prepared.value === null) {
      return await send(ctx, envelope, envelope.input);
    }
    const { plan, files, root } = prepared.value;
    const sent = await send(ctx, envelope, { ...input, files });
    return await installAfter(sent, () =>
      installRestore({
        root,
        store: deps.store,
        session: input.session,
        judged: plan.judged,
        prepared: files,
      }), true);
  }

  async function undoFiles(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<CommandSuccess>> {
    const parsed = undoEdit.input.safeParse(envelope.input);
    const key = keyOf(ctx, envelope);
    if (
      !parsed.success || parsed.data.files.length > 0 || remembered.has(key)
    ) {
      return await send(ctx, envelope, envelope.input);
    }
    const input = parsed.data;
    const prepared = await prepareRewind(deps, {
      kind: "undo",
      session: input.session,
      tool_call: input.tool_call,
    }, false);
    if (!prepared.ok) return prepared;
    if (prepared.value === null) {
      return await send(ctx, envelope, envelope.input);
    }
    const { plan, files, root } = prepared.value;
    // 사실 메시지 본문은 보낸 사람의 이름으로 미리 준비해 둔다. command가 같은 값에서 같은 hash를 만든다.
    const relay = deps.relay();
    for (const unit of plan.judged) {
      if (unit.plan !== "restore") continue;
      if (relay === undefined) {
        return unavailable("blob preparation is not available");
      }
      const body = await prepareBytes(
        relay,
        ctx,
        MESSAGE_CONTENT_PURPOSE,
        serializeMessageContent(
          factMessageContent(`Undid edit to ${unit.path}`),
        ),
        "undo message",
      );
      if (!body.ok) return body;
    }
    const sent = await send(ctx, envelope, { ...input, files });
    return await installAfter(sent, () =>
      installRestore({
        root,
        store: deps.store,
        session: input.session,
        judged: plan.judged,
        prepared: files,
      }), true);
  }

  async function redoFiles(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<CommandSuccess>> {
    const parsed = redo.input.safeParse(envelope.input);
    const key = keyOf(ctx, envelope);
    if (
      !parsed.success || parsed.data.files.length > 0 || remembered.has(key)
    ) {
      return await send(ctx, envelope, envelope.input);
    }
    const input = parsed.data;
    type Entry = {
      path: string;
      restored_sha256: string | null;
      redo_ref: string | null;
    };
    const read = deps.snapshot((lookup) => {
      const owner = lookup.sql.get(
        "select session from reverts where id = ?",
        [input.revert],
      );
      if (owner === undefined) return null;
      const entries: Entry[] = lookup.sql.all(
        `select target, restored_sha256, redo_ref from revert_items
          where revert = ? and class = 'file' and result = 'restored' order by ordinal`,
        [input.revert],
      ).map((row) => ({
        path: String(row["target"]),
        restored_sha256: row["restored_sha256"] === null
          ? null
          : String(row["restored_sha256"]),
        redo_ref: row["redo_ref"] === null ? null : String(row["redo_ref"]),
      }));
      const session = String(owner["session"]);
      return {
        entries,
        session,
        root: entries.length === 0 ? "" : deps.rootOf(lookup, session),
      };
    });
    if (!read.ok) return read;
    // 없는 revert는 command가 같은 거절을 낸다.
    if (read.value === null) return await send(ctx, envelope, envelope.input);
    const { entries, session, root } = read.value;
    let observed;
    try {
      observed = await observeFilesAsync(root, entries.map((e) => e.path));
    } catch {
      return unavailable("the files to redo could not be read");
    }
    const files: PreparedFile[] = entries.map((entry) => ({
      path: entry.path,
      observed_sha256: observed.get(entry.path)?.sha256 ?? null,
      link: observed.get(entry.path)?.link ?? false,
      staged: true,
      redo_ref: entry.redo_ref,
    }));
    const sent = await send(ctx, envelope, { ...input, files });
    return await installAfter(sent, () =>
      installRedo({
        root,
        store: deps.store,
        session,
        // command와 같은 기준: 지금 hash가 복원한 내용과 같은 파일만 다시 쓴다.
        entries: entries.filter((entry) =>
          (observed.get(entry.path)?.sha256 ?? null) ===
            entry.restored_sha256 &&
          observed.get(entry.path)?.link !== true
        ),
      }), false);
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
      if (parseActor(ctx.actor)?.kind === "user") {
        switch (envelope.command) {
          case rewind.name:
            return rewindFiles(ctx, envelope);
          case undoEdit.name:
            return undoFiles(ctx, envelope);
          case redo.name:
            return redoFiles(ctx, envelope);
        }
      }
      return writer.command(ctx, envelope);
    },
  };
}
