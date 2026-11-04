import { err, ok, type Result } from "../../../base/mod.ts";
import {
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
  listAgents,
  loadAgent,
  type Loaded,
  nameOf,
  openAgentContext,
  profileOf,
} from "./inspect.ts";
import type { AgentDeps } from "./ports.ts";
import { receivedSkills } from "./resolve.ts";

function notFound(what: string): Result<never> {
  return err({ code: "not_found", message: `${what} not found` });
}

function effectiveModel(
  context: AgentContext,
  loaded: Loaded,
  place: Place | null,
): { value: ModelChoice; source: AgentValueLayer } | null {
  const own = loaded.definition?.model;
  if (own !== undefined) return { value: own, source: "agent" };
  const project = context.lookups.projectModel(place);
  if (project !== null) return { value: project, source: "project" };
  const global = context.lookups.modelDefault();
  return global === null ? null : { value: global, source: "global" };
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
