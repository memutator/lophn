// `worktrees/*`·`source_control/*` route 호출기. 로컬 core와 다른 컴퓨터(`machines/call` proxy CoreSource)가 같은 모양을 쓴다.
// 실패는 core의 `details`(reason, stderr, command)를 그대로 싣는다. 화면이 reason마다 복구 안내를 보인다.
import type { z } from "zod";
import {
  type SourceControlTarget,
  sourceControlAbort,
  sourceControlBranchCreate,
  sourceControlBranchDelete,
  sourceControlBranches,
  sourceControlBranchRename,
  sourceControlCommit,
  sourceControlDiff,
  sourceControlDiscard,
  sourceControlFetch,
  sourceControlFileAt,
  sourceControlIgnored,
  sourceControlLog,
  sourceControlMarkResolved,
  sourceControlPull,
  sourceControlPush,
  sourceControlShow,
  sourceControlStage,
  sourceControlStatus,
  sourceControlSuggestCancel,
  sourceControlSuggestMessage,
  sourceControlSwitch,
  sourceControlUnstage,
} from "../../../../protocol/projects/source-control.ts";
import {
  worktreesCreate,
  worktreesDetectInclude,
  worktreesGet,
  worktreesList,
  worktreesRemove,
  worktreesRemovePreflight,
  worktreesRename,
  worktreesSettingsGet,
  worktreesSettingsSet,
} from "../../../../protocol/projects/worktrees.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";

export type GitErrorCode =
  | "invalid_input"
  | "not_found"
  | "forbidden"
  | "unauthorized"
  | "conflict"
  | "unavailable"
  | "internal";

export interface GitFailure {
  readonly code: GitErrorCode;
  readonly message: string;
  /** core `details.reason`(SOURCE_CONTROL_FAILURES, worktree 가드 이름 등). */
  readonly reason?: string;
  /** 자격증명을 가린 git stderr. 접어 보인다. */
  readonly stderr?: string;
  /** 인증 실패 때 사람이 터미널에 칠 명령 한 줄. */
  readonly command?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export type GitResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: GitFailure };

const CODES = new Set<string>([
  "invalid_input",
  "not_found",
  "forbidden",
  "unauthorized",
  "conflict",
  "unavailable",
  "internal",
]);

interface RouteDef<I extends z.ZodType, O extends z.ZodType> {
  readonly kind: "read" | "memory" | "command";
  readonly resource: string;
  readonly method: string;
  readonly input: I;
  readonly output: O;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

async function call<I extends z.ZodType, O extends z.ZodType>(
  core: CoreSource,
  route: RouteDef<I, O>,
  input: z.input<I>,
): Promise<GitResult<z.output<O>>> {
  let reply: Awaited<ReturnType<CoreSource["call"]>>;
  try {
    reply = await core.call({
      kind: route.kind === "command" ? "command" : route.kind,
      resource: route.resource,
      method: route.method,
      body: input,
    } as Parameters<CoreSource["call"]>[0]);
  } catch {
    return {
      ok: false,
      error: { code: "unavailable", message: "core call failed" },
    };
  }
  if (!reply.ok) {
    const raw = reply.error;
    const details = raw?.details;
    return {
      ok: false,
      error: {
        code: (CODES.has(raw?.code ?? "")
          ? raw?.code
          : "internal") as GitErrorCode,
        message: raw?.message ?? "core call failed",
        ...(text(details?.reason) === undefined
          ? {}
          : { reason: text(details?.reason) }),
        ...(text(details?.stderr) === undefined
          ? {}
          : { stderr: text(details?.stderr) }),
        ...(text(details?.command) === undefined
          ? {}
          : { command: text(details?.command) }),
        ...(details === undefined ? {} : { details }),
      },
    };
  }
  const parsed = route.output.safeParse(reply.value);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "internal", message: "unexpected core response" },
    };
  }
  return { ok: true, value: parsed.data };
}

type Out<R> = R extends RouteDef<z.ZodType, infer O> ? z.output<O> : never;
type In<R> = R extends RouteDef<infer I, z.ZodType> ? z.input<I> : never;

/** 대상 칸(project, worktree?, folder?)을 뺀 route 입력. */
type Rest<R> = Omit<In<R>, keyof SourceControlTarget>;

export type WorktreesListValue = Out<typeof worktreesList>;
export type WorktreeGetValue = Out<typeof worktreesGet>;
export type SourceControlStatusValue = Out<typeof sourceControlStatus>;
export type SourceControlDiffValue = Out<typeof sourceControlDiff>;
export type SourceControlShowValue = Out<typeof sourceControlShow>;
export type SourceControlBranchesValue = Out<typeof sourceControlBranches>;

export interface WorktreesSource {
  list(
    project: string,
    options?: { readonly includeExternal?: boolean },
  ): Promise<GitResult<WorktreesListValue>>;
  get(
    worktree: string,
    options?: { readonly preflight?: boolean },
  ): Promise<GitResult<WorktreeGetValue>>;
  create(
    input: In<typeof worktreesCreate>,
  ): Promise<GitResult<Out<typeof worktreesCreate>>>;
  rename(
    input: In<typeof worktreesRename>,
  ): Promise<GitResult<Out<typeof worktreesRename>>>;
  preflight(
    worktree: string,
  ): Promise<GitResult<Out<typeof worktreesRemovePreflight>>>;
  remove(
    input: In<typeof worktreesRemove>,
  ): Promise<GitResult<Out<typeof worktreesRemove>>>;
  settings(
    project: string,
  ): Promise<GitResult<Out<typeof worktreesSettingsGet>>>;
  setSettings(
    input: In<typeof worktreesSettingsSet>,
  ): Promise<GitResult<Out<typeof worktreesSettingsSet>>>;
  detectInclude(
    project: string,
  ): Promise<GitResult<Out<typeof worktreesDetectInclude>>>;
}

export function createWorktreesSource(core: CoreSource): WorktreesSource {
  return {
    list: (project, options) =>
      call(core, worktreesList, {
        project,
        ...(options?.includeExternal === true
          ? { include_external: true }
          : {}),
      }),
    get: (worktree, options) =>
      call(core, worktreesGet, {
        worktree,
        ...(options?.preflight === true ? { include_preflight: true } : {}),
      }),
    create: (input) => call(core, worktreesCreate, input),
    rename: (input) => call(core, worktreesRename, input),
    preflight: (worktree) => call(core, worktreesRemovePreflight, { worktree }),
    remove: (input) => call(core, worktreesRemove, input),
    settings: (project) => call(core, worktreesSettingsGet, { project }),
    setSettings: (input) => call(core, worktreesSettingsSet, input),
    detectInclude: (project) => call(core, worktreesDetectInclude, { project }),
  };
}

/** 소스 컨트롤 route. 첫 인자는 대상 체크아웃이다(`targetOf`). */
export interface SourceControlSource {
  status(
    target: SourceControlTarget,
  ): Promise<GitResult<SourceControlStatusValue>>;
  diff(
    target: SourceControlTarget,
    rest: Rest<typeof sourceControlDiff>,
  ): Promise<GitResult<SourceControlDiffValue>>;
  stage(
    target: SourceControlTarget,
    rest: Rest<typeof sourceControlStage>,
  ): Promise<GitResult<Out<typeof sourceControlStage>>>;
  unstage(
    target: SourceControlTarget,
    rest: Rest<typeof sourceControlUnstage>,
  ): Promise<GitResult<Out<typeof sourceControlUnstage>>>;
  discard(
    target: SourceControlTarget,
    rest: Rest<typeof sourceControlDiscard>,
  ): Promise<GitResult<Out<typeof sourceControlDiscard>>>;
  commit(
    target: SourceControlTarget,
    message: string,
  ): Promise<GitResult<Out<typeof sourceControlCommit>>>;
  log(
    target: SourceControlTarget,
    rest: Rest<typeof sourceControlLog>,
  ): Promise<GitResult<Out<typeof sourceControlLog>>>;
  show(
    target: SourceControlTarget,
    sha: string,
  ): Promise<GitResult<SourceControlShowValue>>;
  branches(
    target: SourceControlTarget,
    options?: { readonly includeRemote?: boolean },
  ): Promise<GitResult<SourceControlBranchesValue>>;
  branchCreate(
    target: SourceControlTarget,
    rest: Rest<typeof sourceControlBranchCreate>,
  ): Promise<GitResult<Out<typeof sourceControlBranchCreate>>>;
  switchBranch(
    target: SourceControlTarget,
    branch: string,
  ): Promise<GitResult<Out<typeof sourceControlSwitch>>>;
  push(
    target: SourceControlTarget,
    rest: Rest<typeof sourceControlPush>,
  ): Promise<GitResult<Out<typeof sourceControlPush>>>;
  pull(
    target: SourceControlTarget,
  ): Promise<GitResult<Out<typeof sourceControlPull>>>;
  fetch(
    target: SourceControlTarget,
  ): Promise<GitResult<Out<typeof sourceControlFetch>>>;
  abort(
    target: SourceControlTarget,
  ): Promise<GitResult<Out<typeof sourceControlAbort>>>;
  markResolved(
    target: SourceControlTarget,
    rest: Rest<typeof sourceControlMarkResolved>,
  ): Promise<GitResult<Out<typeof sourceControlMarkResolved>>>;
  branchRename(
    target: SourceControlTarget,
    from: string,
    to: string,
  ): Promise<GitResult<Out<typeof sourceControlBranchRename>>>;
  branchDelete(
    target: SourceControlTarget,
    name: string,
  ): Promise<GitResult<Out<typeof sourceControlBranchDelete>>>;
  /** 끝날 때까지 기다린다. 같은 `request`로 `cancelSuggest`를 부르면 conflict(`cancelled`)로 끝난다. */
  suggestMessage(
    target: SourceControlTarget,
    request: string,
  ): Promise<GitResult<Out<typeof sourceControlSuggestMessage>>>;
  cancelSuggest(
    request: string,
  ): Promise<GitResult<Out<typeof sourceControlSuggestCancel>>>;
  ignored(
    target: SourceControlTarget,
    paths: readonly string[],
  ): Promise<GitResult<Out<typeof sourceControlIgnored>>>;
  fileAt(
    target: SourceControlTarget,
    path: string,
    rev: string,
  ): Promise<GitResult<Out<typeof sourceControlFileAt>>>;
}

export function createSourceControlSource(
  core: CoreSource,
): SourceControlSource {
  return {
    status: (target) => call(core, sourceControlStatus, target),
    diff: (target, rest) =>
      call(core, sourceControlDiff, { ...target, ...rest }),
    stage: (target, rest) =>
      call(core, sourceControlStage, { ...target, ...rest }),
    unstage: (target, rest) =>
      call(core, sourceControlUnstage, { ...target, ...rest }),
    discard: (target, rest) =>
      call(core, sourceControlDiscard, { ...target, ...rest }),
    commit: (target, message) =>
      call(core, sourceControlCommit, { ...target, message }),
    log: (target, rest) => call(core, sourceControlLog, { ...target, ...rest }),
    show: (target, sha) => call(core, sourceControlShow, { ...target, sha }),
    branches: (target, options) =>
      call(core, sourceControlBranches, {
        ...target,
        ...(options?.includeRemote === true ? { include_remote: true } : {}),
      }),
    branchCreate: (target, rest) =>
      call(core, sourceControlBranchCreate, { ...target, ...rest }),
    switchBranch: (target, branch) =>
      call(core, sourceControlSwitch, { ...target, branch }),
    push: (target, rest) =>
      call(core, sourceControlPush, { ...target, ...rest }),
    pull: (target) => call(core, sourceControlPull, target),
    fetch: (target) => call(core, sourceControlFetch, target),
    abort: (target) => call(core, sourceControlAbort, target),
    markResolved: (target, rest) =>
      call(core, sourceControlMarkResolved, { ...target, ...rest }),
    branchRename: (target, from, to) =>
      call(core, sourceControlBranchRename, { ...target, from, to }),
    branchDelete: (target, name) =>
      call(core, sourceControlBranchDelete, { ...target, name }),
    suggestMessage: (target, request) =>
      call(core, sourceControlSuggestMessage, { ...target, request }),
    cancelSuggest: (request) =>
      call(core, sourceControlSuggestCancel, { request }),
    ignored: (target, paths) =>
      call(core, sourceControlIgnored, { ...target, paths: [...paths] }),
    fileAt: (target, path, rev) =>
      call(core, sourceControlFileAt, { ...target, path, rev }),
  };
}

/** 화면이 고르는 체크아웃: project의 등록 폴더(원래 폴더) 또는 worktree. */
export type CheckoutRef =
  | { readonly kind: "folder"; readonly path: string }
  | { readonly kind: "worktree"; readonly id: string };

export function targetOf(
  project: string,
  checkout: CheckoutRef,
): SourceControlTarget {
  return checkout.kind === "worktree"
    ? { project, worktree: checkout.id }
    : { project, folder: checkout.path };
}

/** 체크아웃별 상태(초안·접힘)를 담는 key. */
export function checkoutKey(checkout: CheckoutRef): string {
  return checkout.kind === "worktree"
    ? `wkt:${checkout.id}`
    : `dir:${checkout.path}`;
}

export function sameCheckout(a: CheckoutRef | null, b: CheckoutRef | null) {
  if (a === null || b === null) return a === b;
  return checkoutKey(a) === checkoutKey(b);
}
