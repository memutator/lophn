import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  agentChange,
  agentCreate,
  type AgentId,
  agentDelete,
  LOPHN_AGENT_ID,
  LOPHN_AGENT_NAME,
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
import { type AgentContext, loadAgent, openAgentContext } from "./inspect.ts";
import type { AgentDeps } from "./ports.ts";
import { LOPHN_PROFILE } from "./resolve.ts";
import { staleImagePaths } from "./profile-asset.ts";
import { agentSlotOf } from "./store.ts";
import { checkAgent } from "./validate.ts";

// 정의 저장과 삭제는 사람과 agent가 할 수 있다. lophn의 이름·profile은 고정이고 lophn은 지울 수 없다.
// agent 자격은 `mcp_servers`와 `skip`을 바꾸지 못한다: 그 두 칸은 사람의 승인 경계다.

function notFound(what: string): Result<never> {
  return err({ code: "not_found", message: `${what} not found` });
}

function conflict(what: string): Result<never> {
  return err({ code: "conflict", message: `${what} hash changed` });
}

function same(left: unknown, right: unknown): boolean {
  return canonicalize(left ?? null) === canonicalize(right ?? null);
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
            input.definition.skip !== undefined)
        ) {
          return err({
            code: "forbidden",
            message: "an agent cannot set MCP servers or skip",
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
        const checked = checkAgent({
          context: context.value,
          agent: id,
          definition: input.definition,
        });
        if (!checked.ok) return checked;
        const slot = agentSlotOf(context.value.store.root, id);
        const written = context.value.store.write(slot, checked.value);
        if (!written.ok) return written;
        removeStaleImages(deps, context.value, id, input.definition.profile);
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
            !same(input.definition.skip, loaded.definition?.skip))
        ) {
          return err({
            code: "forbidden",
            message: "an agent cannot set MCP servers or skip",
          });
        }
        if (input.agent === LOPHN_AGENT_ID) {
          const profile = input.definition.profile;
          if (
            input.definition.name !== LOPHN_AGENT_NAME ||
            (profile !== undefined && !same(profile, LOPHN_PROFILE))
          ) {
            return err({
              code: "forbidden",
              message: "lophn's name and profile are fixed",
            });
          }
        }
        const checked = checkAgent({
          context: context.value,
          agent: input.agent,
          definition: input.definition,
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
      handle(
        tx: Tx,
        _ctx: RequestContext,
        input: Input<typeof agentDelete>,
        compare: Compare<typeof agentDelete>,
      ): Result<Output<typeof agentDelete>> {
        if (input.agent === LOPHN_AGENT_ID) {
          return err({ code: "forbidden", message: "lophn cannot be deleted" });
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
        return ok({ agent: input.agent, hash: loaded.file.hash });
      },
    },
  };
}
