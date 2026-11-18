import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  agentChange,
  agentCreate,
  agentHandleKey,
  type AgentId,
  agentDelete,
  codingBuiltinOf,
  isLophn,
  type Profile,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  Compare,
  Input,
  Output,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import {
  type AgentContext,
  handleOf,
  loadAgent,
  openAgentContext,
  workspaceOfAgent,
} from "./inspect.ts";
import { loadSession, workspaceOf } from "../session/model.ts";
import type { AgentDeps } from "./ports.ts";
import { LOPHN_PROFILE } from "./resolve.ts";
import { staleImagePaths } from "./profile-asset.ts";
import { agentMemoryFile, agentSlotOf } from "./store.ts";
import { checkAgent } from "./validate.ts";

// 정의 저장과 삭제는 사람과 agent가 할 수 있다. lophn은 workspace마다 하나이고 handle·profile은 고정이며 지울 수 없다(workspace를 지울 때만 정의 file이 지워진다).
// 내장 coding agent는 handle·runtime·범위가 고정이고 지울 수 없다.
// handle과 범위 workspace는 만들 때만 정한다. agent가 만들면 범위는 그 session의 workspace다(home이면 전역).
// agent 자격은 `mcp_servers`, `skip`, `apps`, `remote_apps`, `extensions`, `permissions`를 바꾸지 못한다: 그 칸들은 사람의 승인 경계다.

const HUMAN_ONLY_MESSAGE =
  "an agent cannot set MCP servers, skip, apps, remote apps, extensions or permissions";

function notFound(what: string): Result<never> {
  return err({ code: "not_found", message: `${what} not found` });
}

function conflict(what: string): Result<never> {
  return err({ code: "conflict", message: `${what} hash changed` });
}

function removeStaleImages(
  deps: AgentDeps,
  context: AgentContext,
  agent: string,
  profile: Profile | undefined,
): void {
  for (const path of staleImagePaths(
    `${context.store.root}/agents`,
    agent,
    profile,
  )) {
    try {
      deps.files.remove(path);
    } catch {
      // 다음 저장이 다시 지운다.
    }
  }
}

function open(deps: AgentDeps, tx: Tx): Result<AgentContext> {
  return openAgentContext(deps, tx.sql);
}

function agentActor(ctx: RequestContext): boolean {
  return parseActor(ctx.actor)?.kind === "agent";
}

// agent가 만든 agent의 범위: 부른 session의 workspace다. home session이면 전역이다.
function callerWorkspace(tx: Tx, ctx: RequestContext) {
  const actor = parseActor(ctx.actor);
  if (actor?.kind !== "agent") return undefined;
  const session = loadSession(tx, actor.id);
  return session === undefined
    ? undefined
    : (workspaceOf(session) ?? undefined);
}

function same(left: unknown, right: unknown): boolean {
  return canonicalize(left ?? null) === canonicalize(right ?? null);
}

function notAllowed(field: string): Result<never> {
  return err({
    code: "invalid_input",
    message: "agent is invalid",
    details: { issues: [{ field, code: "not_allowed" }] },
  });
}

export function createAgentCommands(deps: AgentDeps): {
  create: CommandDefinition<typeof agentCreate>;
  change: CommandDefinition<typeof agentChange>;
  delete: CommandDefinition<typeof agentDelete>;
} {
  return {
    create: {
      route: agentCreate,
      handle(
        tx: Tx,
        ctx: RequestContext,
        input: Input<typeof agentCreate>,
      ): Result<Output<typeof agentCreate>> {
        if (
          agentActor(ctx) &&
          (input.definition.mcp_servers !== undefined ||
            input.definition.skip !== undefined ||
            input.definition.apps !== undefined ||
            input.definition.remote_apps !== undefined ||
            input.definition.extensions !== undefined ||
            input.definition.permissions !== undefined)
        ) {
          return err({
            code: "forbidden",
            message: HUMAN_ONLY_MESSAGE,
          });
        }
        const context = open(deps, tx);
        if (!context.ok) return context;
        const id = input.id ?? (tx.newId("agt") as AgentId);
        const existing = loadAgent(context.value, id);
        if (!existing.ok) return existing;
        if (existing.value !== null) {
          return err({ code: "conflict", message: "agent already exists" });
        }
        // agent 자격은 범위를 고르지 못하고 부른 session의 workspace를 받는다.
        const { workspace: _asked, ...unscoped } = input.definition;
        const scope = agentActor(ctx)
          ? callerWorkspace(tx, ctx)
          : input.definition.workspace;
        const definition =
          scope === undefined ? unscoped : { ...unscoped, workspace: scope };
        const checked = checkAgent({
          context: context.value,
          agent: id,
          definition,
          creating: true,
        });
        if (!checked.ok) return checked;
        const slot = agentSlotOf(context.value.store.root, id);
        const written = context.value.store.write(slot, checked.value);
        if (!written.ok) return written;
        removeStaleImages(deps, context.value, id, definition.profile);
        return ok({ agent: id, hash: written.value });
      },
    },
    change: {
      route: agentChange,
      handle(
        tx: Tx,
        ctx: RequestContext,
        input: Input<typeof agentChange>,
        compare: Compare<typeof agentChange>,
      ): Result<Output<typeof agentChange>> {
        const context = open(deps, tx);
        if (!context.ok) return context;
        const found = loadAgent(context.value, input.agent);
        if (!found.ok) return found;
        if (found.value === null) return notFound("agent");
        const loaded = found.value;
        if (compare.hash !== (loaded.file?.hash ?? null)) {
          return conflict("agent file");
        }
        if (
          agentActor(ctx) &&
          (!same(
            input.definition.mcp_servers,
            loaded.definition?.mcp_servers,
          ) ||
            !same(input.definition.skip, loaded.definition?.skip) ||
            !same(input.definition.apps, loaded.definition?.apps) ||
            !same(
              input.definition.remote_apps,
              loaded.definition?.remote_apps,
            ) ||
            !same(input.definition.extensions, loaded.definition?.extensions) ||
            !same(input.definition.permissions, loaded.definition?.permissions))
        ) {
          return err({
            code: "forbidden",
            message: HUMAN_ONLY_MESSAGE,
          });
        }
        if (isLophn(input.agent)) {
          const profile = input.definition.profile;
          if (profile !== undefined && !same(profile, LOPHN_PROFILE)) {
            return err({
              code: "forbidden",
              message: "lophn's profile is fixed",
            });
          }
        }
        const coding = codingBuiltinOf(input.agent);
        // handle과 범위는 만들 때 정한 채로 둔다. 틀린 file은 정한 값을 알 수 없어 고쳐 쓸 수 있게 둔다.
        if (loaded.definition !== null) {
          if (
            agentHandleKey(input.definition.handle) !==
            agentHandleKey(handleOf(loaded))
          ) {
            return notAllowed("handle");
          }
          if (
            !isLophn(input.agent) &&
            !same(input.definition.workspace, workspaceOfAgent(loaded))
          ) {
            return notAllowed("workspace");
          }
          if (coding !== null && input.definition.runtime !== coding.runtime) {
            return notAllowed("runtime");
          }
        }
        const checked = checkAgent({
          context: context.value,
          agent: input.agent,
          definition: input.definition,
          creating: false,
        });
        if (!checked.ok) return checked;
        const written = context.value.store.write(loaded.slot, checked.value);
        if (!written.ok) return written;
        removeStaleImages(
          deps,
          context.value,
          input.agent,
          input.definition.profile,
        );
        return ok({ agent: input.agent, hash: written.value });
      },
    },
    delete: {
      route: agentDelete,
      // app.delete가 같은 Tx에서 그 앱에 범위가 있는 agent 정의를 지운다.
      dispatchable: true,
      handle(
        tx: Tx,
        _ctx: RequestContext,
        input: Input<typeof agentDelete>,
        compare: Compare<typeof agentDelete>,
      ): Result<Output<typeof agentDelete>> {
        if (isLophn(input.agent)) {
          return err({ code: "forbidden", message: "lophn cannot be deleted" });
        }
        if (codingBuiltinOf(input.agent) !== null) {
          return err({
            code: "forbidden",
            message: "a built-in coding agent cannot be deleted",
          });
        }
        const context = open(deps, tx);
        if (!context.ok) return context;
        const found = loadAgent(context.value, input.agent);
        if (!found.ok) return found;
        if (found.value === null) return notFound("agent");
        const loaded = found.value;
        if (loaded.file === null) return notFound("agent");
        if (compare.hash !== loaded.file.hash) {
          return conflict("agent file");
        }
        const removed = context.value.store.remove(loaded.slot);
        if (!removed.ok) return removed;
        removeStaleImages(deps, context.value, input.agent, undefined);
        // memory는 정의에 딸린 사람의 글이다. 남기면 사람이 지운 줄 아는 글이 디스크에 남는다.
        try {
          deps.files.remove(
            agentMemoryFile(context.value.store.root, input.agent),
          );
        } catch {
          // 이름 없는 고아로 남을 뿐이다. id는 다시 쓰이지 않는다.
        }
        return ok({ agent: input.agent, hash: loaded.file.hash });
      },
    },
  };
}
