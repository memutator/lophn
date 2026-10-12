// AgentsSource의 메모리 구현. dev mock 작업대와 화면 시험이 쓴다. project 하나에 lophn · Context Engineer ·
// Operator "Release notes"가 있는 상태에서 시작하고, 저장·삭제·model·켬·끔이 메모리에서 이어지며 쓰는 명령을 순서대로
// calls에 남긴다. 실제 core의 거절(항목별 이유·conflict)은 failNext…로 세운다.
import type {
  AgentDefinition,
  AgentIssue,
  AgentListRow,
  Profile,
  ValueSource,
} from "../../../../../packages/protocol/lophn-agent/agent-values.ts";
import type {
  CatalogEntry,
  ModelChoice,
  OptionAxis,
} from "../../../../../packages/protocol/lophn-agent/models.ts";
import type { AgentRole } from "../../../../../packages/protocol/lophn-agent/scope.ts";
import { EVAL } from "../contexts/fake-source.ts";
import type { ReadResult } from "../source.ts";
import type {
  AgentDetail,
  AgentsOverview,
  AgentsSource,
  ModelFavorite,
  ModelsView,
  SaveInput,
  SaveResult,
} from "./source.ts";
import type { PermissionRow, ToggleRow } from "./views.ts";

export const ANTHROPIC = "pvd_01arz3ndektsv4rrffq69g5fa1";
export const LOPHN_ID = "asg_01arz3ndektsv4rrffq69g5fa1";
export const ENGINEER_ID = "asg_01arz3ndektsv4rrffq69g5fa2";
export const RELEASE_ID = "asg_01arz3ndektsv4rrffq69g5fa3";

const WORKSPACE: ValueSource = { layer: "workspace", place: null };
const DEFAULT: ValueSource = { layer: "default", place: null };
const PLACE = {
  kind: "project",
  id: "prj_01arz3ndektsv4rrffq69g5fa1",
} as const;
const DEFAULT_PROFILE: Profile = { kind: "icon", icon: "default" };

const SONNET_MEDIUM: ModelChoice = {
  provider: ANTHROPIC,
  model_name: "Sonnet 5.5",
  option_values: { effort: "medium" },
};

const LOPHN_MD = [
  "# phroner",
  "Answer in short paragraphs.",
  "Ask before you delete a document.",
].join("\n");

const ROLES: readonly AgentRole[] = [
  "lophn",
  "context_engineer",
  "app_engineer",
  "operator",
];

function effortAxis(): OptionAxis {
  const value = (name: string, label: string) => ({
    value: name,
    label,
    wire: null,
  });
  return {
    id: "effort",
    label: "Effort",
    values: [
      value("low", "Low"),
      value("medium", "Medium"),
      value("high", "High"),
    ],
    default_value: "medium",
    budget: null,
  };
}

function catalogEntry(
  name: string,
  options: readonly OptionAxis[] | null,
): CatalogEntry {
  return {
    provider_definition: "anthropic",
    model_name: name,
    context_limit: null,
    input_limit: null,
    output_limit: null,
    supports_tools: null,
    input_media: null,
    output_media: null,
    options: options === null ? null : [...options],
    preview: null,
    deprecated: null,
    source: "release_snapshot",
    source_revision: "fake",
    checked_at: null,
    received_at: null,
    price_basis: null,
  };
}

export type FakeCall =
  | {
    method: "saveAgent";
    assignment: string | null;
    hash: string | null;
    definition: AgentDefinition;
  }
  | { method: "deleteAgent"; assignment: string; hash: string }
  | { method: "uploadImage"; assignment: string; name: string }
  | { method: "changeRoleModel"; role: AgentRole; choice: ModelChoice | null }
  | { method: "setSkill"; name: string; on: boolean }
  | { method: "setMcp"; name: string; on: boolean }
  | { method: "setPermission"; tool: string; on: boolean }
  | { method: "setFavorites"; items: readonly ModelFavorite[] };

export interface FakeAgentsSource extends AgentsSource {
  /** 보낸 명령을 순서대로. */
  readonly calls: readonly FakeCall[];
  /** agent 파일의 지금 hash. */
  hashOf(assignment: string): string;
  /** 다음 saveAgent를 거절한다. issues가 비면 code만 있는 실패다. */
  failNextSave(issues: readonly AgentIssue[], code?: string): void;
  /** 다음 설정 변경(model·skill·MCP·권한) 하나를 실패시킨다. */
  failNextChange(code: string): void;
  /** 다음 overview를 실패시킨다. */
  failNextOverview(code: string): void;
}

interface Stored {
  readonly role: AgentRole;
  readonly name: string;
  readonly definition: AgentDefinition;
  readonly hash: string;
}

export function createFakeAgentsSource(): FakeAgentsSource {
  const calls: FakeCall[] = [];
  let version = 0;
  const nextHash = () => String(++version).padStart(64, "0");
  let created = 0;

  const stored = new Map<string, Stored>([
    [LOPHN_ID, {
      role: "lophn",
      name: "lophn",
      definition: { body: "" },
      hash: nextHash(),
    }],
    [ENGINEER_ID, {
      role: "context_engineer",
      name: "Context Engineer",
      definition: { body: "" },
      hash: nextHash(),
    }],
    [RELEASE_ID, {
      role: "operator",
      name: "Release notes",
      definition: {
        name: "Release notes",
        profile: { kind: "icon", icon: "edit" },
        contexts: [EVAL],
        body: "Draft the next release note.",
      },
      hash: nextHash(),
    }],
  ]);

  const chosen = new Map<AgentRole, ModelChoice>();
  const skills = new Map<string, boolean>([["summarize-notes", true]]);
  const servers = new Map<string, boolean>([["github", true], [
    "linear",
    false,
  ]]);
  const permissions = new Map<string, boolean>([["documents.read", true]]);
  let favorites: readonly ModelFavorite[] = [];

  let saveFailure: { issues: readonly AgentIssue[]; code: string } | null =
    null;
  let changeFailure: string | null = null;
  let overviewFailure: string | null = null;

  const effectiveModel = (role: AgentRole) => {
    const own = chosen.get(role);
    return own === undefined
      ? { value: SONNET_MEDIUM, source: WORKSPACE }
      : { value: own, source: { layer: "place", place: PLACE } as ValueSource };
  };

  const rowOf = (assignment: string, item: Stored): AgentListRow => {
    const definition = item.definition;
    const on = (rows: ReadonlyMap<string, boolean>, off: readonly string[]) =>
      [...rows].filter(([name, enabled]) => enabled && !off.includes(name))
        .length;
    const model = definition.model ?? effectiveModel(item.role).value;
    const builtIn = item.role !== "operator";
    return {
      assignment,
      role: item.role,
      kind: builtIn ? "built_in" : "operator",
      name: item.name,
      profile: definition.profile ??
        (builtIn
          ? { kind: "icon", icon: item.role === "lophn" ? "dock" : "contexts" }
          : DEFAULT_PROFILE),
      model: {
        provider: model.provider,
        model_name: model.model_name,
        source: definition.model === undefined
          ? effectiveModel(item.role).source
          : { layer: "definition", place: PLACE },
      },
      state: "enabled",
      issues: [],
      counts: {
        contexts: builtIn ? null : (definition.contexts ?? []).length,
        skills: on(skills, definition.skills_off ?? []),
        mcp: on(servers, []),
      },
    };
  };

  const takeChangeFailure = (): ReadResult<null> | null => {
    if (changeFailure === null) return null;
    const message = changeFailure;
    changeFailure = null;
    return { ok: false, message };
  };

  const detailOf = (assignment: string): AgentDetail => {
    const item = stored.get(assignment)!;
    const row = rowOf(assignment, item);
    return {
      assignment,
      role: item.role,
      kind: row.kind,
      definition: item.definition,
      hash: item.hash,
      effective: {
        name: { value: item.name, source: DEFAULT },
        profile: { value: row.profile, source: DEFAULT },
        model: effectiveModel(item.role),
        permissions: {
          value: {
            tools: [...permissions].flatMap(([tool, on]) => on ? [tool] : []),
          },
          source: DEFAULT,
        },
      },
      issues: [],
    };
  };

  return {
    calls,
    hashOf: (assignment) => stored.get(assignment)!.hash,
    failNextSave(issues, code = "invalid_input") {
      saveFailure = { issues, code };
    },
    failNextChange(code) {
      changeFailure = code;
    },
    failNextOverview(code) {
      overviewFailure = code;
    },

    list() {
      return Promise.resolve({
        ok: true,
        value: [...stored].map(([assignment, item]) => rowOf(assignment, item)),
      });
    },

    overview(): Promise<ReadResult<AgentsOverview>> {
      if (overviewFailure !== null) {
        const message = overviewFailure;
        overviewFailure = null;
        return Promise.resolve({ ok: false, message });
      }
      const rows = [...stored].map(([assignment, item]) =>
        rowOf(assignment, item)
      );
      const toggles = (rows: ReadonlyMap<string, boolean>): ToggleRow[] =>
        [...rows].map(([name, on]) => ({ name, on }));
      const rules: PermissionRow[] = [...permissions].map(([tool, on]) => ({
        tool,
        label: tool,
        on,
      }));
      return Promise.resolve({
        ok: true,
        value: {
          agents: rows,
          instructions: { text: LOPHN_MD },
          chosenModels: Object.fromEntries(chosen),
          effectiveModels: Object.fromEntries(
            ROLES.map((role) => [role, effectiveModel(role)]),
          ),
          skills: toggles(skills),
          mcpServers: toggles(servers),
          permissions: rules,
        },
      });
    },

    models(): Promise<ReadResult<ModelsView>> {
      return Promise.resolve({
        ok: true,
        value: {
          providers: [{
            id: ANTHROPIC,
            name: "Anthropic",
            definition: "anthropic",
          }],
          catalog: [
            catalogEntry("Sonnet 5.5", [effortAxis()]),
            catalogEntry("Haiku 5.5", []),
          ],
          favorites,
        },
      });
    },

    setFavorites(items) {
      calls.push({ method: "setFavorites", items });
      favorites = items;
      return Promise.resolve({ ok: true, value: items });
    },

    readAgent(_project, assignment) {
      return Promise.resolve(
        stored.has(assignment)
          ? { ok: true, value: detailOf(assignment) }
          : { ok: false, message: "not_found" },
      );
    },

    newOperator() {
      const model = effectiveModel("operator");
      return Promise.resolve({
        ok: true,
        value: {
          assignment: null,
          role: "operator",
          kind: "operator",
          definition: { body: "" },
          hash: null,
          effective: {
            name: { value: "", source: DEFAULT },
            profile: { value: DEFAULT_PROFILE, source: DEFAULT },
            model,
            permissions: {
              value: {
                tools: [...permissions].flatMap(([tool, on]) =>
                  on ? [tool] : []
                ),
              },
              source: DEFAULT,
            },
          },
          issues: [],
        },
      });
    },

    saveAgent(_project, input: SaveInput): Promise<SaveResult> {
      calls.push({
        method: "saveAgent",
        assignment: input.assignment,
        hash: input.hash,
        definition: input.definition,
      });
      if (saveFailure !== null) {
        const { issues, code } = saveFailure;
        saveFailure = null;
        return Promise.resolve({ ok: false, message: code, issues });
      }
      const existing = input.assignment === null
        ? undefined
        : stored.get(input.assignment);
      if (input.assignment !== null) {
        if (existing === undefined) {
          return Promise.resolve({
            ok: false,
            message: "not_found",
            issues: [],
          });
        }
        if (existing.hash !== input.hash) {
          return Promise.resolve({
            ok: false,
            message: "conflict",
            issues: [],
          });
        }
      }
      created += 1;
      const assignment = input.assignment ??
        `asg_${`nw${created}`.padStart(26, "0")}`;
      const role: AgentRole = existing?.role ?? "operator";
      const hash = nextHash();
      stored.set(assignment, {
        role,
        name: input.definition.name ?? existing?.name ?? "",
        definition: input.definition,
        hash,
      });
      return Promise.resolve({ ok: true, value: { assignment, role, hash } });
    },

    deleteAgent(_project, assignment, hash) {
      calls.push({ method: "deleteAgent", assignment, hash });
      const existing = stored.get(assignment);
      if (existing === undefined) {
        return Promise.resolve({ ok: false, message: "not_found" });
      }
      if (existing.hash !== hash) {
        return Promise.resolve({ ok: false, message: "conflict" });
      }
      stored.delete(assignment);
      return Promise.resolve({ ok: true, value: null });
    },

    uploadImage(_project, assignment, file) {
      calls.push({ method: "uploadImage", assignment, name: file.name });
      return Promise.resolve({ ok: true, value: { image: "avatar.png" } });
    },

    imageSrc: (_project, assignment, image) =>
      `lophn-agent://profiles/${assignment}/${image}`,

    changeRoleModel(_project, role, choice) {
      calls.push({ method: "changeRoleModel", role, choice });
      const failed = takeChangeFailure();
      if (failed !== null) return Promise.resolve(failed);
      if (choice === null) chosen.delete(role);
      else chosen.set(role, choice);
      return Promise.resolve({ ok: true, value: null });
    },

    setSkill(_project, name, on) {
      calls.push({ method: "setSkill", name, on });
      const failed = takeChangeFailure();
      if (failed !== null) return Promise.resolve(failed);
      skills.set(name, on);
      return Promise.resolve({ ok: true, value: null });
    },

    setMcp(_project, name, on) {
      calls.push({ method: "setMcp", name, on });
      const failed = takeChangeFailure();
      if (failed !== null) return Promise.resolve(failed);
      servers.set(name, on);
      return Promise.resolve({ ok: true, value: null });
    },

    setPermission(_project, tool, on) {
      calls.push({ method: "setPermission", tool, on });
      const failed = takeChangeFailure();
      if (failed !== null) return Promise.resolve(failed);
      permissions.set(tool, on);
      return Promise.resolve({ ok: true, value: null });
    },
  };
}
