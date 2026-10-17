import { err, ok, type Result } from "../../../base/mod.ts";
import {
  agentDefinitionList,
  agentDefinitionRead,
  type AgentDefinitionRow,
  type AgentValueLayer,
  type ModelChoice,
  type Place,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  Input,
  Output,
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import {
  type AgentContext,
  listOperators,
  loadAgent,
  type Loaded,
  nameOf,
  openAgentContext,
  profileOf,
} from "./inspect.ts";
import { agentCallerRule } from "./caller.ts";
import type { AgentDeps } from "./ports.ts";

// 읽기는 동기 handler다. 목록의 정본은 place(project, 앱)와 Operator 정의 파일이고 정의 파일은 읽을 때마다
// 같은 검사를 한다.

function notFound(what: string): Result<never> {
  return err({ code: "not_found", message: `${what} not found` });
}

// model은 agent 정의가 먼저이고 비면 전역 기본이다. 어느 층에도 없으면 null이다.
function effectiveModel(
  context: AgentContext,
  loaded: Loaded,
): { value: ModelChoice; source: AgentValueLayer } | null {
  const own = loaded.definition?.model;
  if (own !== undefined) return { value: own, source: "agent" };
  const global = context.lookups.modelDefault();
  return global === null ? null : { value: global, source: "global" };
}

function rowOf(context: AgentContext, loaded: Loaded): AgentDefinitionRow {
  const model = effectiveModel(context, loaded);
  const { lookups, roles } = context;
  const definition = loaded.definition;
  const operator = roles.isOperator(loaded.role);
  const broken = loaded.issues.length > 0;
  const skills = lookups.skills(loaded.place);
  const mcp = lookups.mcp(loaded.place);
  const skillsOff = definition?.skills_off ?? [];
  const mcpOff = definition?.mcp_off ?? [];
  const contexts = definition !== null && "contexts" in definition
    ? definition.contexts ?? []
    : [];
  const active = new Set(lookups.activeContexts(loaded.place));
  return {
    agent: loaded.ref,
    kind: roles.kindOf(loaded.role),
    place: loaded.place,
    name: nameOf(roles, loaded),
    profile: profileOf(roles, loaded),
    model: model === null ? null : {
      provider: model.value.provider,
      model_name: model.value.model_name,
      source: model.source,
    },
    issues: loaded.issues,
    counts: broken ? { contexts: null, skills: null, mcp: null } : {
      contexts: operator
        ? contexts.filter((id) => active.has(id)).length
        : null,
      skills: skills.filter((name) => !skillsOff.includes(name)).length,
      mcp:
        mcp.filter((tool) =>
          !mcpOff.some((off) =>
            off.server_name === tool.server_name &&
            (off.original_tool === undefined ||
              off.original_tool === tool.original_tool)
          )
        ).length,
    },
  };
}

export function createAgentReads(deps: AgentDeps): {
  list: ReadDefinition<typeof agentDefinitionList>;
  read: ReadDefinition<typeof agentDefinitionRead>;
} {
  return {
    list: {
      route: agentDefinitionList,
      handle(
        snapshot: ReadSnapshot,
        ctx: RequestContext,
        input: Input<typeof agentDefinitionList>,
      ): Result<Output<typeof agentDefinitionList>> {
        const rule = agentCallerRule(
          snapshot.sql,
          ctx,
          deps.operatorPlaceAllowed,
        );
        if (!rule.ok) return rule;
        if (rule.value !== null) {
          const allowed = rule.value(input.place ?? null);
          if (!allowed.ok) return allowed;
        }
        const context = openAgentContext(deps, snapshot.sql);
        if (!context.ok) return context;
        const { lookups } = context.value;
        const within = input.place;
        if (within !== undefined && !lookups.placeExists(within)) {
          return notFound("place");
        }
        // built-in 다음에 Operator 순서다.
        const refs = context.value.roles.builtinRefs(
          within === undefined ? lookups.places() : [within],
        );
        const agents: AgentDefinitionRow[] = [];
        for (const ref of refs) {
          const loaded = loadAgent(context.value, ref);
          if (!loaded.ok) return loaded;
          if (loaded.value !== null) {
            agents.push(rowOf(context.value, loaded.value));
          }
        }
        const operators = listOperators(context.value, within);
        if (!operators.ok) return operators;
        for (const operator of operators.value) {
          agents.push(rowOf(context.value, operator));
        }
        return ok({
          agents,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    read: {
      route: agentDefinitionRead,
      handle(
        snapshot: ReadSnapshot,
        ctx: RequestContext,
        input: Input<typeof agentDefinitionRead>,
      ): Result<Output<typeof agentDefinitionRead>> {
        const rule = agentCallerRule(
          snapshot.sql,
          ctx,
          deps.operatorPlaceAllowed,
        );
        if (!rule.ok) return rule;
        const context = openAgentContext(deps, snapshot.sql);
        if (!context.ok) return context;
        const found = loadAgent(context.value, input.agent);
        if (!found.ok) return found;
        const loaded = found.value;
        if (loaded === null) return notFound("agent");
        if (rule.value !== null) {
          const allowed = rule.value(loaded.place as Place | null);
          if (!allowed.ok) return allowed;
        }
        const model = effectiveModel(context.value, loaded);
        const { roles } = context.value;
        const operator = roles.isOperator(loaded.role);
        const profile = profileOf(roles, loaded);
        return ok({
          agent: loaded.ref,
          role: loaded.role,
          place: loaded.place as Place | null,
          definition: loaded.definition,
          hash: loaded.file?.hash ?? null,
          effective: {
            name: {
              value: nameOf(roles, loaded),
              source: operator ? "agent" : "global",
            },
            profile: {
              value: profile,
              source: loaded.definition !== null &&
                  "profile" in loaded.definition &&
                  loaded.definition.profile !== undefined
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
