import { ok, type Result } from "../../../base/mod.ts";
import {
  type AgentDefinition,
  type AgentIssue,
  type AgentPlace,
  agentPlaceAllowsRole,
  type AgentSettings,
} from "../../../protocol/lophn-agent/mod.ts";
import { DEFAULT_PROFILES } from "./builtin.ts";
import { parseAgentFile, parseSettingsFile } from "./definition-file.ts";
import { type Effective, effectiveAgent } from "./effective.ts";
import type {
  AgentDeps,
  AgentLookups,
  AssignmentRef,
  ReadSql,
} from "./ports.ts";
import {
  type AgentFile,
  agentFileName,
  type AgentStore,
  createAgentStore,
  dataRootOf,
  SETTINGS_FILE,
} from "./store.ts";

// 읽기가 함께 쓰는 것: 한 자리의 정의 파일과 자리 설정을 읽어 검사하고 층을 합친다.
// 읽을 때의 검사는 파일 모양 전체(R24)다. 권한 상한은 저장 때 보고, 읽을 때는 resolve가
// 상한과 자리·Workspace 권한의 교집합으로 줄이므로 지금의 상한 밖 동작은 run에 제공되지 않는다(R20, R21).

export type AgentContext = { lookups: AgentLookups; store: AgentStore };

export function openAgentContext(
  deps: AgentDeps,
  sql: ReadSql,
): Result<AgentContext> {
  const root = dataRootOf(sql, deps.dataRoot);
  if (!root.ok) return root;
  return ok({
    lookups: deps.lookups(sql),
    store: createAgentStore(deps.files, root.value),
  });
}

export function issuesOfError(error: unknown): AgentIssue[] {
  const details = (error as { details?: { issues?: AgentIssue[] } }).details;
  return details?.issues ?? [];
}

// 이 assignment가 이 자리에서 부를 수 있는 agent인가(R7). 전역 lophn·Context Engineer는 어느 자리에서나
// (Context Engineer는 project만), App Engineer와 Operator는 자기 범위의 자리에서만이다.
export function callableIn(ref: AssignmentRef, place: AgentPlace): boolean {
  if (ref.state === "withdrawn") return false;
  if (!agentPlaceAllowsRole(ref.role, place)) return false;
  if (ref.scope.kind === "all") {
    return ref.role === "lophn" || ref.role === "context_engineer";
  }
  return ref.role !== "lophn" && ref.role !== "context_engineer" &&
    ref.scope.kind === place.kind && ref.scope.id === place.id;
}

export type LoadedSettings = {
  settings: AgentSettings;
  hash: string | null;
  // 파일이 틀렸으면 이유(없으면 빈 목록). 틀린 파일의 settings는 비어 있다.
  issues: AgentIssue[];
};

export function loadPlaceSettings(
  store: AgentStore,
  place: AgentPlace,
): Result<LoadedSettings> {
  const file = store.read(place, SETTINGS_FILE);
  if (!file.ok) return file;
  if (file.value === null) return ok({ settings: {}, hash: null, issues: [] });
  const parsed = parseSettingsFile(file.value.text);
  return ok(
    parsed.ok
      ? { settings: parsed.value, hash: file.value.hash, issues: [] }
      : {
        settings: {},
        hash: file.value.hash,
        issues: issuesOfError(parsed.error),
      },
  );
}

export type PlaceView = {
  place: AgentPlace;
  deps: AgentDeps;
  context: AgentContext;
  settings: LoadedSettings;
  workspace: AgentSettings;
};

export function openPlaceView(
  deps: AgentDeps,
  sql: ReadSql,
  place: AgentPlace,
): Result<PlaceView> {
  const context = openAgentContext(deps, sql);
  if (!context.ok) return context;
  const settings = loadPlaceSettings(context.value.store, place);
  if (!settings.ok) return settings;
  return ok({
    place,
    deps,
    context: context.value,
    settings: settings.value,
    workspace: context.value.lookups.workspace(),
  });
}

export type Inspected = {
  ref: AssignmentRef;
  file: AgentFile | null;
  definition: AgentDefinition | null;
  issues: AgentIssue[];
  // 파일과 자리 설정이 모두 맞을 때만 있다. 아니면 그 agent는 시작하지 않는다(R24).
  effective: Effective | null;
};

// 이 자리의 agent 하나를 읽는다. 이 자리에서 부를 수 없거나 정의 파일이 없는 Operator는 agent가 아니라 null이다.
export function inspectAgent(
  view: PlaceView,
  ref: AssignmentRef,
): Result<Inspected | null> {
  const { place, deps, context } = view;
  if (!callableIn(ref, place)) return ok(null);
  const file = context.store.read(place, agentFileName(ref.role, ref.id));
  if (!file.ok) return file;
  if (ref.role === "operator" && file.value === null) return ok(null);

  let definition: AgentDefinition | null = null;
  const issues: AgentIssue[] = [];
  if (file.value !== null) {
    const parsed = parseAgentFile(file.value.text, {
      role: ref.role,
      place: place.kind,
    });
    if (parsed.ok) definition = parsed.value;
    else issues.push(...issuesOfError(parsed.error));
  }
  // 자리 설정이 틀리면 그 층을 쓰는 모든 agent가 시작하지 않는다.
  for (const issue of view.settings.issues) {
    issues.push({ field: `settings.${issue.field}`, code: issue.code });
  }
  if (issues.length > 0) {
    return ok({ ref, file: file.value, definition, issues, effective: null });
  }

  const effective = effectiveAgent({
    assignment: ref.id,
    role: ref.role,
    place,
    definition,
    workspace: view.workspace,
    place_settings: view.settings.settings,
    session_model: null,
    environment: {
      role_caps: deps.roleCaps(ref.role),
      default_profile: DEFAULT_PROFILES[ref.role],
      skills: context.lookups.skills(place),
      mcp: context.lookups.mcp(place),
      active_contexts: context.lookups.activeContexts(place, ref.role),
    },
  });
  if (!effective.ok) return effective;
  return ok({
    ref,
    file: file.value,
    definition,
    issues,
    effective: effective.value,
  });
}
