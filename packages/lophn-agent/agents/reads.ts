import { err, ok, type Result } from "../../base/mod.ts";
import {
  AGENT_ROLES,
  agentKindOf,
  type AgentListRow,
  type AgentPlace,
  agentsList,
  agentsRead,
  BUILTIN_AGENT_NAMES,
  placeAgentSettingsRead,
  type ValueSource,
} from "../../contracts/lophn-agent/mod.ts";
import type {
  Input,
  Output,
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../contracts/platform/mod.ts";
import {
  callableIn,
  DEFAULT_PROFILES,
  inspectAgent,
  type Inspected,
  loadPlaceSettings,
  openAgentContext,
  openPlaceView,
  type PlaceView,
} from "./inspect.ts";
import type { AgentDeps } from "./ports.ts";

// 읽기는 동기 handler다. 목록의 정본은 assignment이고(R7) 정의 파일은 읽을 때마다 같은 검사를 한다(R24).

// 목록은 lophn, Context Engineer 또는 App Engineer, Operator 순서다(shell/workspace R36).
const LIST_ORDER = ["lophn", "context_engineer", "app_engineer", "operator"];

const DEFAULT_SOURCE: ValueSource = { layer: "default", place: null };

function notFound(what: string): Result<never> {
  return err({ code: "not_found", message: `${what} not found` });
}

function fallbackName(inspected: Inspected): string {
  const { ref, definition } = inspected;
  if (ref.role !== "operator") return BUILTIN_AGENT_NAMES[ref.role];
  return definition?.name ?? ref.id;
}

function modelOf(inspected: Inspected) {
  const effective = inspected.effective;
  return effective?.model == null || effective.sources.model === null
    ? null
    : effective.model;
}

function rowOf(inspected: Inspected): AgentListRow {
  const { ref, effective } = inspected;
  const kind = agentKindOf(ref.role);
  const model = modelOf(inspected);
  return {
    assignment: ref.id,
    role: ref.role,
    kind,
    name: effective?.name ?? fallbackName(inspected),
    profile: effective?.profile ?? inspected.definition?.profile ??
      DEFAULT_PROFILES[ref.role],
    model: model === null ? null : {
      provider: model.provider,
      model_name: model.model_name,
      source: effective!.sources.model!,
    },
    state: ref.state === "paused" ? "paused" : "enabled",
    issues: inspected.issues,
    counts: effective === null ? { contexts: null, skills: null, mcp: null } : {
      contexts: kind === "built_in" ? null : effective.contexts.length,
      skills: effective.skills.length,
      mcp: effective.mcp.length,
    },
  };
}

function placeView(
  deps: AgentDeps,
  snapshot: ReadSnapshot,
  place: AgentPlace,
): Result<PlaceView> {
  const context = openAgentContext(deps, snapshot.sql);
  if (!context.ok) return context;
  if (!context.value.lookups.placeExists(place)) return notFound("place");
  return openPlaceView(deps, snapshot.sql, place);
}

export function createAgentReads(deps: AgentDeps): {
  list: ReadDefinition<typeof agentsList>;
  read: ReadDefinition<typeof agentsRead>;
  settings: ReadDefinition<typeof placeAgentSettingsRead>;
} {
  return {
    list: {
      route: agentsList,
      handle(
        snapshot: ReadSnapshot,
        _ctx: RequestContext,
        input: Input<typeof agentsList>,
      ): Result<Output<typeof agentsList>> {
        const view = placeView(deps, snapshot, input.place);
        if (!view.ok) return view;
        const refs = view.value.context.lookups.assignments(input.place)
          .filter((ref) => callableIn(ref, input.place))
          .sort((a, b) =>
            LIST_ORDER.indexOf(a.role) - LIST_ORDER.indexOf(b.role) ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
          );
        const agents: AgentListRow[] = [];
        for (const ref of refs) {
          const inspected = inspectAgent(view.value, ref);
          if (!inspected.ok) return inspected;
          if (inspected.value !== null) agents.push(rowOf(inspected.value));
        }
        return ok({
          agents,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    read: {
      route: agentsRead,
      handle(
        snapshot: ReadSnapshot,
        _ctx: RequestContext,
        input: Input<typeof agentsRead>,
      ): Result<Output<typeof agentsRead>> {
        const view = placeView(deps, snapshot, input.place);
        if (!view.ok) return view;
        const ref = view.value.context.lookups.assignment(input.assignment);
        if (ref === null) return notFound("agent");
        const found = inspectAgent(view.value, ref);
        if (!found.ok) return found;
        const inspected = found.value;
        if (inspected === null) return notFound("agent");
        const effective = inspected.effective;
        const model = modelOf(inspected);
        return ok({
          assignment: ref.id,
          role: ref.role,
          kind: agentKindOf(ref.role),
          place: input.place,
          definition: inspected.definition,
          hash: inspected.file?.hash ?? null,
          effective: {
            name: {
              value: effective?.name ?? fallbackName(inspected),
              source: effective?.sources.name ?? DEFAULT_SOURCE,
            },
            profile: {
              value: effective?.profile ?? inspected.definition?.profile ??
                DEFAULT_PROFILES[ref.role],
              source: effective?.sources.profile ?? DEFAULT_SOURCE,
            },
            model: model === null
              ? null
              : { value: model, source: effective!.sources.model! },
            permissions: {
              value: {
                tools: effective?.tools ?? [...deps.roleCaps(ref.role)],
              },
              source: effective?.sources.tools ?? DEFAULT_SOURCE,
            },
          },
          issues: inspected.issues,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    settings: {
      route: placeAgentSettingsRead,
      handle(
        snapshot: ReadSnapshot,
        _ctx: RequestContext,
        input: Input<typeof placeAgentSettingsRead>,
      ): Result<Output<typeof placeAgentSettingsRead>> {
        const context = openAgentContext(deps, snapshot.sql);
        if (!context.ok) return context;
        if (!context.value.lookups.placeExists(input.place)) {
          return notFound("place");
        }
        const loaded = loadPlaceSettings(context.value.store, input.place);
        if (!loaded.ok) return loaded;
        if (loaded.value.issues.length > 0) {
          return err({
            code: "invalid_input",
            message: "place settings file is invalid",
            details: { issues: loaded.value.issues },
          });
        }
        const workspace = context.value.lookups.workspace();
        const effective: Output<
          typeof placeAgentSettingsRead
        >["effective_models"] = {};
        // 칸을 비운 role은 Workspace의 역할별 기본을 따른다. 그 기본도 없으면 model이 없다.
        for (const role of AGENT_ROLES) {
          if (loaded.value.settings.models?.[role] !== undefined) continue;
          const model = workspace.models?.[role];
          if (model !== undefined) {
            effective[role] = {
              value: model,
              source: { layer: "workspace", place: null },
            };
          }
        }
        return ok({
          place: input.place,
          settings: loaded.value.settings,
          hash: loaded.value.hash,
          effective_models: effective,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
