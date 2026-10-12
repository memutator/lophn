import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { assert } from "@std/assert";
import { ok, type Result } from "../../../base/mod.ts";
import type {
  AppRevertBinding,
  rewind,
  RewindChoice,
} from "../../../contracts/lophn-agent/mod.ts";
import type { Output } from "../../../contracts/platform/mod.ts";
import type { PreparedFile } from "../../../contracts/lophn-agent/mod.ts";
import { type AppStepCall, runAppSteps } from "../app-steps.ts";
import { createRevertCommands } from "../commands.ts";
import {
  installRedo,
  installRestore,
  observeFiles,
  prepareRestore,
} from "../prepare.ts";
import { planRewind, type RewindPlan } from "../preview.ts";
import { recordBeforeWrite } from "../record.ts";
import { createRewindStore, type RewindStore } from "../store.ts";
import {
  agentCtx,
  type FakeEffects,
  machineCtx,
  makeDeps,
  must,
  openWorld,
  readProjectFile,
  SES,
  tempDir,
  userCtx,
  type World,
} from "./mod.ts";

// 문서 파일 rewind의 한 걸음씩(관측 → 판정 → 준비 → command → 설치)을 core 대신 이어 주는 시험용
// driver다. 순서와 인자는 core 조립이 따를 약속이다. 제품 코드는 이 파일을 import하지 않는다.

export type Env = {
  world: World;
  root: string;
  dataRoot: string;
  store: RewindStore;
  commands: ReturnType<typeof createRevertCommands>;
  effects: FakeEffects;
  facts: string[];
  deps: ReturnType<typeof makeDeps>["deps"];
};

export function openEnv(
  options: { revisions?: Record<string, string | null> } = {},
): Env {
  const world = openWorld();
  const root = tempDir("project");
  const dataRoot = tempDir("data");
  const made = makeDeps(root, observeFiles, options);
  world.addSession(SES);
  return {
    world,
    root,
    dataRoot,
    store: createRewindStore(dataRoot),
    commands: createRevertCommands(made.deps),
    effects: made.effects,
    facts: made.facts,
    deps: made.deps,
  };
}

// agent가 문서 tool로 파일을 쓴다. 쓰기 직전 pre-image 기록까지 실제 배선(recordBeforeWrite)으로 한다.
// content가 null이면 파일을 지운다. movedFrom이 있으면 그 파일을 path로 옮긴다.
export function agentWrite(
  env: Env,
  input: {
    session?: string;
    tool_call: string;
    run: string;
    path: string;
    content: string | null;
    moved_from?: string;
  },
): Promise<Result<unknown>> {
  const full = (path: string) => join(env.root, path);
  return recordBeforeWrite(
    {
      store: env.store,
      read: (path) => {
        const file = full(path);
        return Promise.resolve(
          existsSync(file) ? new Uint8Array(Deno.readFileSync(file)) : null,
        );
      },
      record: (recorded) =>
        Promise.resolve(
          env.world.call(env.commands.record, agentCtx(input.run), recorded),
        ),
    },
    {
      session: input.session ?? SES,
      tool_call: input.tool_call,
      path: input.path,
      moved_from: input.moved_from ?? null,
      run: () => {
        if (input.moved_from !== undefined) {
          mkdirSync(dirname(full(input.path)), { recursive: true });
          renameSync(full(input.moved_from), full(input.path));
        } else if (input.content === null) {
          rmSync(full(input.path));
        } else {
          mkdirSync(dirname(full(input.path)), { recursive: true });
          writeFileSync(full(input.path), input.content);
        }
        return Promise.resolve(ok(undefined));
      },
    },
  );
}

export function planOf(
  env: Env,
  target:
    | { kind: "rewind"; checkpoint: string; choice: RewindChoice }
    | { kind: "undo"; tool_call: string },
): RewindPlan {
  return must(
    planRewind(env.world.lookup, env.deps, { ...target, session: SES }),
  );
}

export type Header = Output<typeof rewind>;

// 설치가 hash 재비교에서 건너뛴 경로를 machine이 결과에 반영한다(AmendRevertInstall).
export function amendSkipped(
  env: Env,
  revert: string,
  results: readonly { path: string; result: "restored" | "skipped" }[],
): Result<Header> | null {
  const paths = results.filter((entry) => entry.result === "skipped").map((
    entry,
  ) => entry.path);
  if (paths.length === 0) return null;
  return env.world.call(env.commands.amend, machineCtx, { revert, paths });
}

// Rewind를 사람이 한 번 요청한다. 앱 단계가 없는 경우의 전체 흐름이다.
export async function doRewind(
  env: Env,
  input: {
    id: string;
    checkpoint: string;
    choice: RewindChoice;
    accept?: boolean;
    summary_call?: string | null;
    preview_hash?: string;
    // command가 확정된 뒤 설치 전에 일어나는 일(사람이 그 사이 파일을 고침).
    beforeInstall?: () => void;
  },
): Promise<Result<Header>> {
  const plan = planOf(env, {
    kind: "rewind",
    checkpoint: input.checkpoint,
    choice: input.choice,
  });
  const files = input.choice === "restore_all"
    ? await prepareRestore({
      root: env.root,
      store: env.store,
      session: SES,
      judged: plan.judged,
      current: plan.current,
      keepRedo: true,
    })
    : [];
  const result = env.world.call(env.commands.rewind, userCtx, {
    id: input.id,
    session: SES,
    checkpoint: input.checkpoint,
    choice: input.choice,
    accept_remaining: input.accept ?? true,
    preview_hash: input.preview_hash ?? plan.preview.preview_hash,
    summary_call: input.summary_call ?? null,
    files,
  });
  if (
    result.ok && result.value.outcome === "applied" &&
    input.choice === "restore_all" && !result.value.replayed
  ) {
    input.beforeInstall?.();
    const installed = await installRestore({
      root: env.root,
      store: env.store,
      session: SES,
      judged: plan.judged,
      prepared: files,
    });
    amendSkipped(env, input.id, installed);
  }
  return result;
}

export async function doUndo(
  env: Env,
  input: { id: string; tool_call: string; preview_hash?: string },
): Promise<Result<Header>> {
  const plan = planOf(env, { kind: "undo", tool_call: input.tool_call });
  const files = await prepareRestore({
    root: env.root,
    store: env.store,
    session: SES,
    judged: plan.judged,
    current: plan.current,
    keepRedo: false,
  });
  const result = env.world.call(env.commands.undo, userCtx, {
    id: input.id,
    session: SES,
    tool_call: input.tool_call,
    preview_hash: input.preview_hash ?? plan.preview.preview_hash,
    files,
  });
  if (
    result.ok && result.value.outcome === "applied" && !result.value.replayed
  ) {
    const installed = await installRestore({
      root: env.root,
      store: env.store,
      session: SES,
      judged: plan.judged,
      prepared: files,
    });
    amendSkipped(env, input.id, installed);
  }
  return result;
}

export type RedoEntry = {
  path: string;
  restored_sha256: string | null;
  redo_ref: string | null;
};

export async function doRedo(
  env: Env,
  revert: string,
): Promise<Result<Header>> {
  const head = env.world.query(
    "select result_seq from reverts where id = ?",
    [revert],
  )[0];
  assert(head !== undefined, "no such revert");
  const entries: RedoEntry[] = env.world.query(
    `select target, restored_sha256, redo_ref from revert_items
     where revert = ? and class = 'file' and result = 'restored' order by ordinal`,
    [revert],
  ).map((row) => ({
    path: String(row["target"]),
    restored_sha256: row["restored_sha256"] === null
      ? null
      : String(row["restored_sha256"]),
    redo_ref: row["redo_ref"] === null ? null : String(row["redo_ref"]),
  }));
  const observed = observeFiles(env.root, entries.map((entry) => entry.path));
  const files = entries.map((entry) => ({
    path: entry.path,
    observed_sha256: observed.get(entry.path)?.sha256 ?? null,
    link: observed.get(entry.path)?.link ?? false,
    staged: true,
    redo_ref: entry.redo_ref,
  }));
  const result = env.world.call(env.commands.redo, userCtx, {
    revert,
    result_seq: String(head["result_seq"]),
    files,
  }, { redo: "available" });
  if (result.ok && !result.value.replayed) {
    await installRedo({
      root: env.root,
      store: env.store,
      session: SES,
      entries: entries.filter((entry) =>
        (observed.get(entry.path)?.sha256 ?? null) === entry.restored_sha256
      ),
    });
  }
  return result;
}

export function fileText(env: Env, path: string): string | null {
  return existsSync(join(env.root, path))
    ? readProjectFile(env.root, path)
    : null;
}

export function humanEdit(env: Env, path: string, content: string): void {
  writeFileSync(join(env.root, path), content);
}

export type RevertRow = {
  id: string;
  kind: string;
  choice: string | null;
  checkpoint: string | null;
  tool_call: string | null;
  boundary_seq: string | null;
  outcome: string;
  redo: string;
  result_seq: string | null;
};

export function revertRow(env: Env, id: string): RevertRow | undefined {
  const row = env.world.query(
    `select id, kind, choice, checkpoint, tool_call, cast(boundary_seq as text) as boundary_seq,
            outcome, redo, cast(result_seq as text) as result_seq
     from reverts where id = ?`,
    [id],
  )[0];
  if (row === undefined) return undefined;
  const text = (value: unknown) => value === null ? null : String(value);
  return {
    id: String(row["id"]),
    kind: String(row["kind"]),
    choice: text(row["choice"]),
    checkpoint: text(row["checkpoint"]),
    tool_call: text(row["tool_call"]),
    boundary_seq: text(row["boundary_seq"]),
    outcome: String(row["outcome"]),
    redo: String(row["redo"]),
    result_seq: text(row["result_seq"]),
  };
}

export function itemsOf(env: Env, revert: string) {
  return env.world.query(
    `select ordinal, class, target, plan, result, reason from revert_items
     where revert = ? order by ordinal`,
    [revert],
  ).map((row) => ({
    ordinal: Number(row["ordinal"]),
    class: String(row["class"]),
    target: String(row["target"]),
    plan: String(row["plan"]),
    result: String(row["result"]),
    reason: row["reason"] === null ? null : String(row["reason"]),
  }));
}

// 앱 단계가 있는 Rewind(applying)를 이어 실행한다. 앱은 answers[tool_call]로 답하고(없으면 restored)
// 단계 기록과 끝내기는 machine 자격이다. 끝낸 revert가 applied이면 문서 파일을 설치한다.
export async function runApps(
  env: Env,
  revert: string,
  answers: Record<string, AppStepCall> = {},
): Promise<{ calls: string[]; finished: Result<Header> | null }> {
  const calls: string[] = [];
  let finished: Result<Header> | null = null;
  let held: { plan: RewindPlan; files: PreparedFile[] } | null = null;
  const row = revertRow(env, revert);
  assert(row !== undefined && row.checkpoint !== null && row.choice !== null);
  const ran = await runAppSteps(
    {
      stored: () =>
        Promise.resolve(
          ok({
            outcome: row.outcome,
            // ordinal은 실행 순서라 호출 순서는 그 역순이다.
            steps: env.world.query(
              `select app_revert, result from revert_items
               where revert = ? and class = 'app' and plan = 'restore' order by ordinal desc`,
              [revert],
            ).map((item) => ({
              binding: JSON.parse(
                String(item["app_revert"]),
              ) as AppRevertBinding,
              result: String(item["result"]) as
                | "restored"
                | "failure"
                | "uncertain"
                | "unchanged",
            })),
          }),
        ),
      call: (binding) => {
        calls.push(binding.tool_call);
        const result = answers[binding.tool_call] ?? "restored";
        return Promise.resolve({
          result,
          invocation: result === "uncertain" ? null : binding.invocation,
        });
      },
      checkpoint: (input) =>
        Promise.resolve(
          env.world.call(env.commands.checkpoint, machineCtx, {
            revert: input.revert,
            step_key: input.step_key,
            invocation: input.invocation,
            result: input.result,
          }),
        ),
      prepareFiles: async () => {
        const plan = planOf(env, {
          kind: "rewind",
          checkpoint: row.checkpoint!,
          choice: row.choice as RewindChoice,
        });
        const files = await prepareRestore({
          root: env.root,
          store: env.store,
          session: SES,
          judged: plan.judged,
          current: plan.current,
          keepRedo: false,
        });
        held = { plan, files };
        return ok(files);
      },
      finish: async (input) => {
        finished = env.world.call(env.commands.finish, machineCtx, input);
        if (
          finished.ok && finished.value.outcome === "applied" && held !== null
        ) {
          const done: { plan: RewindPlan; files: PreparedFile[] } = held;
          const installed = await installRestore({
            root: env.root,
            store: env.store,
            session: SES,
            judged: done.plan.judged,
            prepared: done.files,
          });
          amendSkipped(env, revert, installed);
        }
        return finished;
      },
    },
    revert,
  );
  must(ran);
  return { calls, finished };
}
