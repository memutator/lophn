// AgentsSettingsSource를 main의 core 통로로 만든다(shell/desktop#R50). 응답은 main의 contract
// client가 route output schema로 이미 검사했다. 아래 모양은 그 schema(models·providers·settings)에서
// 이 화면이 읽는 field만 옮긴 것이다. model 이름·option 이름과 값은 화면 코드에 없고 모두 catalog가
// 준다. credential 값은 이 파일을 지나지 않고 보관 이름과 저장 여부만 묻는다.
//
// 칸마다 읽는 route가 다르고 하나를 못 읽으면 그 칸만 비운다.
// - 모든 project의 LOPHN.md 미리보기: 사람이 읽는 instructions/preview다(instructions/read는 machine 전용).
//   [Edit]이 여는 전역 지침 편집기는 shell(settings 화면)이 연결하므로 openInstructions는 unavailable이다.
// - 전역 skill 목록: global-skills/read. 끄고 켜기는 skills_off 설정을 settings apply로 바꾼다.
// - [Add server]: 새 server를 받는 form은 Tools and skills 자리가 갖고 있다. settings 화면이 그 자리로
//   옮기므로 이 통로의 addServer는 unavailable이다.
import type { FolderPickerApi } from "../../../../../ipc/folder-picker.ts";
import type { CoreSource } from "../../../connection/connection.ts";
import { windowFolderPicker } from "../../../launcher/core-source.ts";
import { call, command } from "../core-call.ts";
import {
  applySetting,
  MCP_SERVERS,
  type McpServerValue,
  readExtensionSettings,
  secretOf,
  secretStates,
  SKILL_FOLDERS,
  tokenOf,
} from "../extension-settings.ts";
import { listProviders } from "../providers/core-source.ts";
import type {
  AgentsSettingsSource,
  AgentsSettingsView,
  CatalogModel,
  DefaultSlot,
  ModelChoice,
  OptionAxisRow,
  ServerRow,
  ServerStatus,
  SourceResult,
} from "./settings-source.ts";

interface ChoiceValue {
  provider: string;
  model_name: string;
  option_values: Record<string, string>;
}

interface DefaultsValue extends Record<DefaultSlot, ChoiceValue | null> {
  settings_seq: string;
}

interface CatalogValue {
  provider_definition: string;
  model_name: string;
  options:
    | {
      id: string;
      label: string;
      values: { value: string; label: string }[];
      default_value: string | null;
    }[]
    | null;
}

const SLOTS: readonly DefaultSlot[] = [
  "lophn",
  "context_engineer",
  "app_engineer",
  "operator",
  "summaries",
];

interface SkillValue {
  name: string;
  description: string;
  enabled: boolean;
}

interface PreviewValue {
  text: string;
  truncated: boolean;
}

const SKILLS_OFF = "lophn-agent.extensions.skills_off";

const UNAVAILABLE = { ok: false, code: "unavailable" } as const;

/** 미리보기 본문. 빈 파일은 보일 것이 없고, 잘렸으면 말줄임으로 알린다. */
function previewOf(value: PreviewValue | null): string | null {
  if (value === null || value.text === "") return null;
  return value.truncated ? `${value.text}…` : value.text;
}

function choiceOf(value: ChoiceValue | null): ModelChoice | null {
  return value === null ? null : {
    provider: value.provider,
    modelName: value.model_name,
    optionValues: value.option_values,
  };
}

function axisOf(
  axis: NonNullable<CatalogValue["options"]>[number],
): OptionAxisRow {
  return {
    id: axis.id,
    label: axis.label,
    values: axis.values.map((entry) => ({
      value: entry.value,
      label: entry.label,
    })),
    defaultValue: axis.default_value,
  };
}

function catalogOf(value: CatalogValue): CatalogModel {
  return {
    providerDefinition: value.provider_definition,
    modelName: value.model_name,
    options: value.options === null ? null : value.options.map(axisOf),
  };
}

/** 줄 밑에 보이는 한 줄: 주소 또는 실행 파일. credential은 싣지 않는다. */
function detailOf(server: McpServerValue): string {
  return server.transport === "http"
    ? server.http?.url ?? ""
    : server.stdio?.executable ?? "";
}

/**
 * 연결 상태. 끈 server는 off, credential이 필요한데 없는 것으로 확인된 server는 needs-sign-in이다.
 * 그 밖은 쓸 수 있다고 본다(실제 연결 시도 결과를 읽는 route는 없다).
 */
function statusOf(
  server: McpServerValue,
  states: ReadonlyMap<string, "set" | "missing"> | null,
): ServerStatus {
  if (!server.enabled) return "off";
  const kind = server.http?.auth.kind;
  if (kind === "oauth2") {
    const token = tokenOf(server);
    return token === null || states?.get(token) === "missing"
      ? "needs-sign-in"
      : "connected";
  }
  const secret = secretOf(server);
  return secret !== null && states?.get(secret) === "missing"
    ? "needs-sign-in"
    : "connected";
}

export interface AgentsDeps {
  picker: FolderPickerApi | undefined;
  /** 새 command key를 만든다. 테스트가 고정한다. */
  random: () => string;
}

export function coreAgentsSettingsSource(
  core: CoreSource,
  deps: Partial<AgentsDeps> = {},
): AgentsSettingsSource {
  const picker = "picker" in deps ? deps.picker : windowFolderPicker();
  const random = deps.random ?? (() => crypto.randomUUID().slice(0, 8));

  return {
    async read() {
      // core reader는 한 사람의 동시 읽기 수를 제한하므로 하나씩 읽는다.
      const defaults = await call<{ defaults: DefaultsValue }>(
        core,
        "read",
        "agent-model-defaults",
        "read",
        {},
      );
      if (!defaults.ok) return defaults;
      const providers = await listProviders(core);
      if (!providers.ok) return providers;
      const catalog = await call<{ entries: CatalogValue[] }>(
        core,
        "read",
        "agent-model-catalog",
        "read",
        {},
      );
      if (!catalog.ok) return catalog;
      // 미리보기와 skill 목록은 못 읽으면 그 칸만 비운다.
      const preview = await call<{ preview: PreviewValue | null }>(
        core,
        "read",
        "instructions",
        "preview",
        {},
      );
      const skills = await call<{ skills: SkillValue[] }>(
        core,
        "read",
        "global-skills",
        "read",
        {},
      );
      // 설정을 못 읽으면 server 칸만 비운다.
      const extensions = await readExtensionSettings(core);
      const serverValues = extensions.ok ? extensions.value.servers : [];
      const states = await secretStates(
        core,
        serverValues.flatMap((server) =>
          [secretOf(server), tokenOf(server)].filter((name) => name !== null)
        ),
      );
      const servers: ServerRow[] = serverValues.map((server) => ({
        name: server.name,
        detail: detailOf(server),
        enabled: server.enabled,
        status: statusOf(server, states),
      }));
      const view: AgentsSettingsView = {
        defaults: Object.fromEntries(
          SLOTS.map((slot) => [slot, choiceOf(defaults.value.defaults[slot])]),
        ) as AgentsSettingsView["defaults"],
        settingsSeq: defaults.value.defaults.settings_seq,
        providers: providers.value.map((row) => ({
          id: row.id,
          name: row.name,
          definition: row.definition.key,
        })),
        catalog: catalog.value.entries.map(catalogOf),
        instructionsPreview: preview.ok
          ? previewOf(preview.value.preview)
          : null,
        skills: skills.ok
          ? skills.value.skills.map((skill) => ({
            name: skill.name,
            detail: skill.description,
            enabled: skill.enabled,
          }))
          : [],
        servers,
      };
      return { ok: true, value: view };
    },

    async changeDefault(slot, choice, settingsSeq) {
      const changed = await command(core, "agent-model-defaults", "change", {
        input: {
          [slot]: {
            provider: choice.provider,
            model_name: choice.modelName,
            option_values: choice.optionValues,
          },
        },
        compare: { settings_seq: settingsSeq },
        key: `model-defaults-${slot}-${random()}`,
      });
      return changed.ok ? { ok: true, value: null } : changed;
    },

    openInstructions: () => Promise.resolve(UNAVAILABLE),

    async addSkill() {
      if (picker === undefined) return UNAVAILABLE;
      const picked = await picker.pick();
      if (!picked.ok) return { ok: false, code: picked.code };
      if (picked.path === null) return { ok: true, value: null };
      const current = await readExtensionSettings(core);
      if (!current.ok) return current;
      if (current.value.folders.includes(picked.path)) {
        return { ok: true, value: null };
      }
      return applySetting(core, current.value, SKILL_FOLDERS, [
        ...current.value.folders,
        picked.path,
      ], random);
    },

    async setSkillEnabled(name, enabled) {
      const listed = await call<{ skills: SkillValue[]; skills_off: string[] }>(
        core,
        "read",
        "global-skills",
        "read",
        {},
      );
      if (!listed.ok) return listed;
      const skill = listed.value.skills.find((row) => row.name === name);
      if (skill === undefined) {
        return { ok: false, code: "not_found" } satisfies SourceResult<null>;
      }
      if (skill.enabled === enabled) return { ok: true, value: null };
      // 끈 이름은 지금 발견되지 않는 것까지 그대로 둔다: 그 skill이 다시 나타나도 끈 채다.
      const off = enabled
        ? listed.value.skills_off.filter((each) => each !== name)
        : [...listed.value.skills_off, name];
      const current = await readExtensionSettings(core);
      if (!current.ok) return current;
      return applySetting(core, current.value, SKILLS_OFF, off, random);
    },

    addServer: () => Promise.resolve(UNAVAILABLE),

    async setServerEnabled(name, enabled) {
      const current = await readExtensionSettings(core);
      if (!current.ok) return current;
      if (!current.value.servers.some((server) => server.name === name)) {
        return { ok: false, code: "not_found" } satisfies SourceResult<null>;
      }
      return applySetting(
        core,
        current.value,
        MCP_SERVERS,
        current.value.servers.map((server) =>
          server.name === name ? { ...server, enabled } : server
        ),
        random,
      );
    },
  };
}
