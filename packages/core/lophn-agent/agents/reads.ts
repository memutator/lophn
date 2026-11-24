import { err, ok, type Result } from "../../../base/mod.ts";
import { isPrivate } from "../../../protocol/lophn-agent/call-policy.ts";
import {
  type AgentRow,
  type AgentValueLayer,
  agentCard,
  agentCards,
  agentList,
  agentRead,
  isLophn,
  LOPHN_AGENT_NAME,
  type ModelChoice,
  type Workspace,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  Input,
  Output,
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import { callPolicyAt } from "../../config/setting-declarations.ts";
import { loadSession, workspaceOf } from "../session/model.ts";
import { type CardCaller, cardByHandle, cardsIn } from "./card.ts";
import {
  type AgentContext,
  avatarOf,
  effectiveModel,
  handleOf,
  type Loaded,
  listAgents,
  loadAgent,
  nameOf,
  openAgentContext,
  visibleIn,
  workspaceOfAgent,
} from "./inspect.ts";
import type { AgentDeps } from "./ports.ts";
import { receivedSkills } from "./resolve.ts";

function notFound(what: string): Result<never> {
  return err({ code: "not_found", message: `${what} not found` });
}

// agent session이 읽을 때 그 session이다. 사람과 machine은 undefined다.
function callerSession(snapshot: ReadSnapshot, ctx: RequestContext) {
  return ctx.conditions.session === undefined
    ? undefined
    : loadSession(snapshot, ctx.conditions.session);
}

// archived 앱의 workspace에 묶인 agent는 agent에게 없는 agent다. 사람의 화면은 그대로 본다.
function hiddenFrom(
  context: AgentContext,
  ctx: RequestContext,
  workspace: Workspace | null,
): boolean {
  return (
    ctx.actor.startsWith("agent:") &&
    workspace !== null &&
    context.lookups.workspaceArchived(workspace)
  );
}

function rowOf(context: AgentContext, loaded: Loaded): AgentRow {
  const workspace = workspaceOfAgent(loaded);
  const model = effectiveModel(context, loaded, workspace);
  const definition = loaded.definition;
  const broken = loaded.issues.length > 0;
  const skills = context.lookups.skills(workspace);
  const mcp = context.lookups.mcp(workspace);
  const mcpOff = definition?.mcp_off ?? [];
  return {
    agent: loaded.agent,
    handle: handleOf(loaded),
    name: nameOf(loaded),
    workspace,
    avatar: avatarOf(loaded),
    runtime: definition?.runtime ?? "lophn",
    ...(definition?.description === undefined
      ? {}
      : { description: definition.description }),
    model:
      model === null
        ? null
        : {
            provider: model.value.provider,
            model_name: model.value.model_name,
            source: model.source,
          },
    browser_profile: definition?.browser_profile ?? null,
    issues: loaded.issues,
    counts: broken
      ? { skills: null, mcp: null }
      : {
          skills:
            definition?.runtime === "custom"
              ? (definition.skills?.length ?? 0)
              : receivedSkills(
                  [
                    ...skills,
                    ...context.lookups.shared(definition?.apps ?? []),
                  ],
                  definition?.skills_off ?? [],
                ).length,
          mcp: mcp.filter(
            (tool) =>
              !mcpOff.some(
                (off) =>
                  off.server_name === tool.server_name &&
                  (off.original_tool === undefined ||
                    off.original_tool === tool.original_tool),
              ),
          ).length,
        },
  };
}

export function createAgentReads(deps: AgentDeps): {
  list: ReadDefinition<typeof agentList>;
  read: ReadDefinition<typeof agentRead>;
  card: ReadDefinition<typeof agentCard>;
  cards: ReadDefinition<typeof agentCards>;
} {
  return {
    list: {
      route: agentList,
      handle(
        snapshot: ReadSnapshot,
        ctx,
        input: Input<typeof agentList>,
      ): Result<Output<typeof agentList>> {
        const context = openAgentContext(deps, snapshot.sql);
        if (!context.ok) return context;
        const listed = listAgents(context.value);
        if (!listed.ok) return listed;
        // agent 자격은 자기 session의 workspace로 좁힌다. 사람은 workspace를 줄 때만 좁힌다.
        const caller = callerSession(snapshot, ctx);
        const scope =
          caller === undefined ? input.workspace : workspaceOf(caller);
        const narrowed = caller !== undefined || input.workspace !== undefined;
        return ok({
          agents: listed.value
            .filter((loaded) => !narrowed || visibleIn(loaded, scope ?? null))
            .filter(
              (loaded) =>
                !hiddenFrom(context.value, ctx, workspaceOfAgent(loaded)),
            )
            .map((loaded) => rowOf(context.value, loaded)),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    card: {
      route: agentCard,
      handle(
        snapshot: ReadSnapshot,
        ctx,
        input: Input<typeof agentCard>,
      ): Result<Output<typeof agentCard>> {
        const context = openAgentContext(deps, snapshot.sql);
        if (!context.ok) return context;
        // agent session이 읽을 때만 그 session의 workspace에서 부를 수 있는지 싣는다.
        const session = callerSession(snapshot, ctx);
        const caller: CardCaller | null =
          session === undefined
            ? null
            : {
                from: { agent: session.agent, workspace: workspaceOf(session) },
                policy: callPolicyAt(context.value.store.root),
              };
        // workspace를 주면 그 workspace의 agent(lophn은 그 workspace의 것)를, 없으면 session의 workspace를 본다.
        const at =
          input.workspace !== undefined
            ? { workspace: input.workspace }
            : caller === null
              ? null
              : { workspace: caller.from.workspace };
        const card = cardByHandle(context.value, input.handle, at, caller);
        if (!card.ok) return card;
        if (hiddenFrom(context.value, ctx, card.value.workspace)) {
          return notFound("agent");
        }
        return ok({
          card: card.value,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    cards: {
      route: agentCards,
      handle(
        snapshot: ReadSnapshot,
        ctx,
        input: Input<typeof agentCards>,
      ): Result<Output<typeof agentCards>> {
        const context = openAgentContext(deps, snapshot.sql);
        if (!context.ok) return context;
        // agent는 자기 workspace와, 이 기계의 call 정책에서 private이 아닌 workspace의 명함만 읽는다.
        const session = callerSession(snapshot, ctx);
        const own =
          session === undefined
            ? undefined
            : (workspaceOf(session)?.id ?? null);
        if (
          ctx.actor.startsWith("agent:") &&
          own !== (input.workspace?.id ?? null) &&
          isPrivate(callPolicyAt(context.value.store.root), input.workspace)
        ) {
          return err({
            code: "forbidden",
            message: "that workspace is private on this computer",
          });
        }
        if (hiddenFrom(context.value, ctx, input.workspace)) {
          return notFound("workspace");
        }
        const cards = cardsIn(
          context.value,
          input.workspace,
          input.without_apps ?? [],
        );
        if (!cards.ok) return cards;
        return ok({
          cards: cards.value,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    read: {
      route: agentRead,
      handle(
        snapshot: ReadSnapshot,
        ctx,
        input: Input<typeof agentRead>,
      ): Result<Output<typeof agentRead>> {
        const context = openAgentContext(deps, snapshot.sql);
        if (!context.ok) return context;
        const asked = input.workspace ?? null;
        if (
          asked !== null &&
          (!context.value.lookups.workspaceExists(asked) ||
            hiddenFrom(context.value, ctx, asked))
        ) {
          return notFound("workspace");
        }
        const found = loadAgent(context.value, input.agent);
        if (!found.ok) return found;
        if (
          found.value === null ||
          hiddenFrom(context.value, ctx, workspaceOfAgent(found.value))
        ) {
          return notFound("agent");
        }
        const loaded = found.value;
        // lophn의 model은 그 workspace의 층으로 푼다.
        const model = effectiveModel(
          context.value,
          loaded,
          isLophn(loaded.agent) ? workspaceOfAgent(loaded) : asked,
        );
        const avatar = avatarOf(loaded);
        return ok({
          agent: loaded.agent,
          definition: loaded.definition,
          hash: loaded.file?.hash ?? null,
          effective: {
            name: {
              value: nameOf(loaded),
              source:
                isLophn(loaded.agent) && nameOf(loaded) === LOPHN_AGENT_NAME
                  ? "global"
                  : "agent",
            },
            avatar: {
              value: avatar,
              source:
                !isLophn(loaded.agent) &&
                loaded.definition?.avatar !== undefined
                  ? "agent"
                  : "global",
            },
            model,
          },
          issues: loaded.issues,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
