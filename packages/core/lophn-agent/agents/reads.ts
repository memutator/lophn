import { err, ok, type Result } from "../../../base/mod.ts";
import {
  agentCard,
  agentList,
  agentRead,
  type AgentRow,
  type AgentValueLayer,
  LOPHN_AGENT_ID,
  type ModelChoice,
  type Place,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  Input,
  Output,
  ReadDefinition,
  ReadSnapshot,
} from "../../../protocol/server/mod.ts";
import {
  type AgentContext,
  effectiveModel,
  listAgents,
  loadAgent,
  type Loaded,
  nameOf,
  openAgentContext,
  profileOf,
} from "./inspect.ts";
import { callPolicyAt } from "../../config/setting-declarations.ts";
import { loadSession, placeOf } from "../session/model.ts";
import { type CardCaller, cardByName } from "./card.ts";
import type { AgentDeps } from "./ports.ts";
import { receivedSkills } from "./resolve.ts";

function notFound(what: string): Result<never> {
  return err({ code: "not_found", message: `${what} not found` });
}

function rowOf(context: AgentContext, loaded: Loaded): AgentRow {
  const model = effectiveModel(context, loaded, null);
  const definition = loaded.definition;
  const broken = loaded.issues.length > 0;
  const skills = context.lookups.skills(null);
  const mcp = context.lookups.mcp(null);
  const mcpOff = definition?.mcp_off ?? [];
  return {
    agent: loaded.agent,
    name: nameOf(loaded),
    profile: profileOf(loaded),
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
    issues: loaded.issues,
    counts: broken
      ? { skills: null, mcp: null }
      : {
          skills:
            definition?.runtime === "bare"
              ? 0
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
} {
  return {
    list: {
      route: agentList,
      handle(
        snapshot: ReadSnapshot,
        _ctx,
        _input: Input<typeof agentList>,
      ): Result<Output<typeof agentList>> {
        const context = openAgentContext(deps, snapshot.sql);
        if (!context.ok) return context;
        const listed = listAgents(context.value);
        if (!listed.ok) return listed;
        return ok({
          agents: listed.value.map((loaded) => rowOf(context.value, loaded)),
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
        // agent session이 읽을 때만 그 session의 place에서 부를 수 있는지 싣는다.
        const session =
          ctx.conditions.session === undefined
            ? undefined
            : loadSession(snapshot, ctx.conditions.session);
        const caller: CardCaller | null =
          session === undefined
            ? null
            : {
                from: { agent: session.agent, place: placeOf(session) },
                policy: callPolicyAt(context.value.store.root),
              };
        const card = cardByName(context.value, input.name, caller);
        if (!card.ok) return card;
        return ok({
          card: card.value,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    read: {
      route: agentRead,
      handle(
        snapshot: ReadSnapshot,
        _ctx,
        input: Input<typeof agentRead>,
      ): Result<Output<typeof agentRead>> {
        const context = openAgentContext(deps, snapshot.sql);
        if (!context.ok) return context;
        const place = input.place ?? null;
        if (place !== null && !context.value.lookups.placeExists(place)) {
          return notFound("place");
        }
        const found = loadAgent(context.value, input.agent);
        if (!found.ok) return found;
        if (found.value === null) return notFound("agent");
        const loaded = found.value;
        const model = effectiveModel(context.value, loaded, place);
        const profile = profileOf(loaded);
        return ok({
          agent: loaded.agent,
          definition: loaded.definition,
          hash: loaded.file?.hash ?? null,
          effective: {
            name: {
              value: nameOf(loaded),
              source: loaded.agent === LOPHN_AGENT_ID ? "global" : "agent",
            },
            profile: {
              value: profile,
              source:
                loaded.agent !== LOPHN_AGENT_ID &&
                loaded.definition?.profile !== undefined
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
