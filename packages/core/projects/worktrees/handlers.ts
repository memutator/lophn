// `worktrees/*` route handler 모음.
// 사람·agent 권한 경계(정한 것 12), agent 제거 승인 카드(`worktree_remove` GateCall),
// 원격 기기 터미널 입력 허락(기술 결정 8), 설정 쓰기(사람 전용)와 `.worktreeinclude` 감지를 맡는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  ToolGateInput,
  ToolGateResult,
} from "../../../protocol/approvals/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  type WorktreeSettings,
  worktreesAdopt,
  worktreesCreate,
  worktreesDetectInclude,
  worktreesGet,
  worktreesList,
  worktreesRemove,
  worktreesRemovePreflight,
  worktreesRename,
  worktreesSettingsGet,
  worktreesSettingsSet,
} from "../../../protocol/projects/worktrees.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { MemoryHandler, ReadHandler } from "../../server/mod.ts";
import { detectWorktreeInclude, type IncludeDetectFs } from "./copy.ts";
import type { WorktreeService } from "./service.ts";

export type AskPersonGate = (
  who: AuthenticatedContext,
  input: ToolGateInput,
) => Promise<Result<ToolGateResult>>;

export type WorktreeHandlersDeps = {
  service: WorktreeService;
  projectFolders(project: string): Result<readonly string[]>;
  loadSettings(project: string): Result<WorktreeSettings>;
  saveSettings(
    project: Id<"prj">,
    settings: WorktreeSettings,
  ): Promise<Result<void>>;
  detectFs: IncludeDetectFs;
  isDevice(principal: string): boolean;
  granted(principal: string): boolean;
  // agent session의 소속 project id. Home/App session이면 null.
  sessionProject(session: string): Promise<Result<Id<"prj"> | null>>;
  askPerson?: AskPersonGate;
  onSettingsChanged(project: Id<"prj">): void;
};

function isAgent(who: AuthenticatedContext): boolean {
  return who.actor.startsWith("agent:");
}

function forbidden(message: string, reason?: string): Result<never> {
  return err({
    code: "forbidden",
    message,
    ...(reason === undefined ? {} : { details: { reason } }),
  });
}

export function createWorktreeHandlers(deps: WorktreeHandlersDeps) {
  const canMutateFor = (who: AuthenticatedContext): boolean =>
    deps.isDevice(who.principal) ? deps.granted(who.principal) : true;

  function requireRemoteGrant(who: AuthenticatedContext): Result<void> {
    return canMutateFor(who)
      ? ok(undefined)
      : forbidden(
          "this device does not have terminal input grant on this computer",
        );
  }

  function requireUser(who: AuthenticatedContext): Result<void> {
    if (who.actor !== "user") {
      return forbidden("only the person may perform this action");
    }
    return ok(undefined);
  }

  // agent는 자기 project의 worktree만 보고 다룰 수 있다.
  async function checkAgentProjectScope(
    who: AuthenticatedContext,
    project: Id<"prj">,
  ): Promise<Result<void>> {
    if (!isAgent(who)) return ok(undefined);
    const session = who.conditions.session;
    if (session === undefined) {
      return forbidden("agent session is missing");
    }
    const owned = await deps.sessionProject(session);
    if (!owned.ok) return owned;
    if (owned.value !== project) {
      return forbidden(
        "agent may only access worktrees in its own project workspace",
        "cross_project",
      );
    }
    return ok(undefined);
  }

  const list: ReadHandler = async (who, raw) => {
    const parsed = worktreesList.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid list input" });
    }
    const project = parsed.data.project as Id<"prj">;
    const scope = await checkAgentProjectScope(who, project);
    if (!scope.ok) return scope;
    const listed = await deps.service.list({
      project,
      includeExternal: parsed.data.include_external,
      includeRemoved: parsed.data.include_removed,
    });
    if (!listed.ok) return listed;
    return ok({
      worktrees: listed.value.entries,
      ...(listed.value.external === undefined
        ? {}
        : { external: listed.value.external }),
      settings: listed.value.settings,
      can_mutate: canMutateFor(who),
    });
  };

  const get: ReadHandler = async (who, raw) => {
    const parsed = worktreesGet.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid get input" });
    }
    const found = await deps.service.get({
      worktree: parsed.data.worktree as Id<"wkt">,
      includePreflight: parsed.data.include_preflight,
    });
    if (!found.ok) return found;
    const scope = await checkAgentProjectScope(
      who,
      found.value.record.project_id as Id<"prj">,
    );
    if (!scope.ok) return scope;
    return ok(found.value);
  };

  const create: MemoryHandler = async (who, raw) => {
    const parsed = worktreesCreate.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: parsed.error.issues[0]?.message ?? "invalid create input",
      });
    }
    const grant = requireRemoteGrant(who);
    if (!grant.ok) return grant;
    const project = parsed.data.project as Id<"prj">;
    const scope = await checkAgentProjectScope(who, project);
    if (!scope.ok) return scope;
    return await deps.service.create({
      project,
      mode: parsed.data.mode,
      folder: parsed.data.folder,
      branch: parsed.data.branch,
      baseRef: parsed.data.base_ref,
      label: parsed.data.label,
      fetchBase: parsed.data.fetch_base,
      idempotencyKey: parsed.data.idempotency_key,
      runSetup: parsed.data.run_setup,
    });
  };

  const adopt: MemoryHandler = async (who, raw) => {
    const user = requireUser(who);
    if (!user.ok) return user;
    const grant = requireRemoteGrant(who);
    if (!grant.ok) return grant;
    const parsed = worktreesAdopt.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: parsed.error.issues[0]?.message ?? "invalid adopt input",
      });
    }
    return await deps.service.adopt({
      project: parsed.data.project as Id<"prj">,
      path: parsed.data.path,
      label: parsed.data.label,
    });
  };

  const rename: MemoryHandler = async (who, raw) => {
    const parsed = worktreesRename.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: parsed.error.issues[0]?.message ?? "invalid rename input",
      });
    }
    const grant = requireRemoteGrant(who);
    if (!grant.ok) return grant;
    const found = await deps.service.get({
      worktree: parsed.data.worktree as Id<"wkt">,
    });
    if (!found.ok) return found;
    const scope = await checkAgentProjectScope(
      who,
      found.value.record.project_id as Id<"prj">,
    );
    if (!scope.ok) return scope;
    return await deps.service.rename({
      worktree: parsed.data.worktree as Id<"wkt">,
      label: parsed.data.label,
      branch: parsed.data.branch,
      renameBranch: parsed.data.rename_branch,
    });
  };

  const removePreflight: ReadHandler = async (who, raw) => {
    const parsed = worktreesRemovePreflight.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "invalid remove_preflight input",
      });
    }
    const found = await deps.service.get({
      worktree: parsed.data.worktree as Id<"wkt">,
    });
    if (!found.ok) return found;
    const scope = await checkAgentProjectScope(
      who,
      found.value.record.project_id as Id<"prj">,
    );
    if (!scope.ok) return scope;
    const preflight = await deps.service.removePreflight(
      parsed.data.worktree as Id<"wkt">,
    );
    if (!preflight.ok) return preflight;
    return ok({ preflight: preflight.value });
  };

  const remove: MemoryHandler = async (who, raw) => {
    const parsed = worktreesRemove.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: parsed.error.issues[0]?.message ?? "invalid remove input",
      });
    }
    const grant = requireRemoteGrant(who);
    if (!grant.ok) return grant;
    const worktreeId = parsed.data.worktree as Id<"wkt">;
    const found = await deps.service.get({ worktree: worktreeId });
    if (!found.ok) return found;
    const project = found.value.record.project_id as Id<"prj">;
    const scope = await checkAgentProjectScope(who, project);
    if (!scope.ok) return scope;

    // 정한 것 12: agent가 remove를 부르면 사람 승인 카드(worktree_remove GateCall)를 거친다.
    if (isAgent(who)) {
      const preflight = await deps.service.removePreflight(worktreeId);
      if (!preflight.ok) return preflight;
      const pf = preflight.value;
      const session = who.conditions.session;
      const turn = who.conditions.turn;
      if (
        deps.askPerson === undefined ||
        parsed.data.tool_call === undefined ||
        session === undefined ||
        turn === undefined
      ) {
        return forbidden(
          "removing a worktree requires approval; only an attended agent turn can ask",
          "needs_approval",
        );
      }
      const asked = await deps.askPerson(who, {
        session,
        turn,
        tool_call: parsed.data.tool_call,
        tool: "lophn",
        call: {
          kind: "worktree_remove",
          project,
          worktree: worktreeId,
          path: pf.path,
          branch: pf.branch,
          provenance: pf.provenance,
          dirty_count:
            pf.staged_count + pf.unstaged_count + pf.conflicted_count,
          untracked_count: pf.untracked_count,
          ahead: pf.ahead,
          has_submodules: pf.has_submodules,
          force: parsed.data.force === true,
          stop_sessions: parsed.data.stop_sessions === true,
          delete_branch: parsed.data.delete_branch === true,
        },
      });
      if (!asked.ok) return asked;
      const outcome = asked.value;
      if (outcome.kind === "rejected") {
        const whoRejected =
          outcome.by === "parent" ? "the parent" : "the person";
        return forbidden(
          outcome.reason === null
            ? `${whoRejected} rejected removing worktree "${found.value.record.label}"`
            : `${whoRejected} rejected removing worktree "${found.value.record.label}": ${outcome.reason}`,
          "needs_approval",
        );
      }
      if (outcome.kind === "denied") {
        return forbidden(
          outcome.denial.message,
          outcome.denial.reason_kind === "no_person"
            ? "no_person"
            : "needs_approval",
        );
      }
      if (outcome.kind !== "run") {
        return forbidden(
          "the approval request ended before it was decided",
          "needs_approval",
        );
      }
    }

    return await deps.service.remove({
      worktree: worktreeId,
      force: parsed.data.force,
      stopSessions: parsed.data.stop_sessions,
      deleteBranch: parsed.data.delete_branch,
      forceDeleteBranch: parsed.data.force_delete_branch,
      allowFailedTeardown: parsed.data.allow_failed_teardown,
    });
  };

  const settingsGet: ReadHandler = async (who, raw) => {
    const parsed = worktreesSettingsGet.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "invalid settings_get input",
      });
    }
    const project = parsed.data.project as Id<"prj">;
    const scope = await checkAgentProjectScope(who, project);
    if (!scope.ok) return scope;
    const loaded = deps.loadSettings(project);
    if (!loaded.ok) return loaded;
    return ok({ settings: loaded.value });
  };

  const settingsSet: MemoryHandler = async (who, raw) => {
    const user = requireUser(who);
    if (!user.ok) return user;
    const grant = requireRemoteGrant(who);
    if (!grant.ok) return grant;
    const parsed = worktreesSettingsSet.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message:
          parsed.error.issues[0]?.message ?? "invalid settings_set input",
      });
    }
    const project = parsed.data.project as Id<"prj">;
    const saved = await deps.saveSettings(project, parsed.data.settings);
    if (!saved.ok) return saved;
    deps.onSettingsChanged(project);
    return ok({ settings: parsed.data.settings });
  };

  const detectInclude: ReadHandler = async (who, raw) => {
    const parsed = worktreesDetectInclude.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "invalid detect_include input",
      });
    }
    const project = parsed.data.project as Id<"prj">;
    const scope = await checkAgentProjectScope(who, project);
    if (!scope.ok) return scope;
    const folders = deps.projectFolders(project);
    if (!folders.ok) return folders;
    const patterns = await detectWorktreeInclude({
      folders: folders.value,
      fs: deps.detectFs,
    });
    return ok({ patterns });
  };

  return {
    list,
    get,
    create,
    adopt,
    rename,
    removePreflight,
    remove,
    settingsGet,
    settingsSet,
    detectInclude,
  };
}
