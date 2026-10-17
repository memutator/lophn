// AgentsSettingsSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output schema로 이미
// 검사했다. 아래 모양은 그 schema에서 이 화면이 읽는 field만 옮긴 것이다. credential 값은 이 파일을 지나지 않고
// 보관 이름과 저장 여부만 묻는다.
//
// - 전역 기본 model: model-default 읽기와 바꾸기.
// - lophn 카드와 둘째 화면: Agents 탭과 같은 AgentsSource(workspace/agents)의 project 없는 읽기·저장이다.
// - 모든 project의 LOPHN.md 미리보기: 사람이 읽는 instructions/preview다. [Edit]이 여는 전역 지침 편집기는 shell
//   (settings 화면)이 연결하므로 openInstructions는 unavailable이다.
// - [Add server]로 Tools and skills 자리로 옮기는 일도 settings 화면이 감싸 주므로 addServer는 unavailable이다.
// - 전역 skill 목록: global-skills/read. 끄고 켜기는 skills_off 설정을 settings apply로 바꾼다.
import type { FolderPickerApi } from "../../../../../ipc/folder-picker.ts";
import { coreAgentsSource } from "../../../../workspace/agents/core-source.ts";
import { createLink } from "../../../../workspace/agents/core-link.ts";
import { readGlobalModel } from "../../../../workspace/agents/core-extensions.ts";
import type { CoreSource } from "../../../connection/connection.ts";
import { windowFolderPicker } from "../../../launcher/core-source.ts";
import type { SecretInputOpenApi } from "../../../../../ipc/secret-input.ts";
import {
  call,
  command,
  enterSecret,
  windowSecretInputOpener,
} from "../core-call.ts";
import {
  applySetting,
  authStates,
  type AuthStateValue,
  MCP_SERVERS,
  type McpServerValue,
  readExtensionSettings,
  secretOf,
  secretStates,
  SKILL_FOLDERS,
} from "../extension-settings.ts";
import type {
  AgentsSettingsSource,
  LophnSummary,
  McpRow,
  SourceResult,
} from "./settings-source.ts";

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

/** 줄 밑에 보이는 한 줄: 주소 또는 실행 파일. credential은 싣지 않는다. */
function detailOf(server: McpServerValue): string {
  return server.transport === "http"
    ? server.http?.url ?? ""
    : server.stdio?.executable ?? "";
}

/**
 * 연결 상태. OAuth server는 core가 signed_in이라고 읽어 준 것만 쓸 수 있고(상태를 읽지 못했으면 로그인했다고
 * 말하지 않는다), credential이 필요한데 없는 것으로 확인된 server는 needs-sign-in이다. 그 밖은 쓸 수 있다고
 * 본다(실제 연결 시도 결과를 읽는 route는 없다). 끈 server는 상태를 말하지 않는다.
 */
function statusOf(
  server: McpServerValue,
  states: ReadonlyMap<string, "set" | "missing"> | null,
  logins: ReadonlyMap<string, AuthStateValue> | null,
): McpRow["status"] {
  if (!server.enabled) return null;
  if (server.http?.auth.kind === "oauth2") {
    return logins?.get(server.name)?.state === "signed_in"
      ? "connected"
      : "needs-sign-in";
  }
  const secret = secretOf(server);
  return secret !== null && states?.get(secret) === "missing"
    ? "needs-sign-in"
    : "connected";
}

interface AgentsDeps {
  picker: FolderPickerApi | undefined;
  openSecret: SecretInputOpenApi["open"] | undefined;
  /** 새 command key를 만든다. 테스트가 고정한다. */
  random: () => string;
}

export function coreAgentsSettingsSource(
  core: CoreSource,
  deps: Partial<AgentsDeps> = {},
): AgentsSettingsSource {
  const picker = "picker" in deps ? deps.picker : windowFolderPicker();
  const openSecret = "openSecret" in deps
    ? deps.openSecret
    : windowSecretInputOpener();
  const random = deps.random ?? (() => crypto.randomUUID().slice(0, 8));
  const link = createLink(core, random);
  const editor = coreAgentsSource(core);

  /** lophn 카드. 못 읽는 칸은 비워 두고 카드는 그대로 보인다. */
  async function lophnSummary(): Promise<LophnSummary> {
    const detail = await editor.readAgent(null, "lophn");
    const grants = await editor.grants(null, "lophn");
    const entries = grants.ok ? grants.value.entries : [];
    return {
      name: detail.ok ? detail.value.definition.name ?? "lophn" : "lophn",
      model: detail.ok ? detail.value.definition.model ?? null : null,
      apps: entries.filter((entry) => entry.kind === "app").length,
      agents: entries.filter((entry) => entry.kind === "agent").length,
      mayChangeSettings: entries.some((entry) => entry.kind === "settings"),
    };
  }

  return {
    editor,

    async read() {
      // core reader는 한 사람의 동시 읽기 수를 제한하므로 하나씩 읽는다.
      const model = await readGlobalModel(link);
      if (!model.ok) return { ok: false, code: model.message };
      const lophn = await lophnSummary();
      // 미리보기는 못 읽으면 그 칸만 비운다.
      const preview = await call<{ preview: PreviewValue | null }>(
        core,
        "read",
        "instructions",
        "preview",
        {},
      );
      return {
        ok: true,
        value: {
          defaultModel: model.value,
          lophn,
          instructionsPreview: preview.ok
            ? previewOf(preview.value.preview)
            : null,
        },
      };
    },

    async changeDefaultModel(choice) {
      const changed = await command(core, "model-default", "change", {
        input: { default: choice },
        key: `model-default-${random()}`,
      });
      return changed.ok ? { ok: true, value: null } : changed;
    },

    openInstructions: () => Promise.resolve(UNAVAILABLE),

    addServer: () => Promise.resolve(UNAVAILABLE),

    async readExtensions() {
      const skills = await call<{ skills: SkillValue[] }>(
        core,
        "read",
        "global-skills",
        "read",
        {},
      );
      if (!skills.ok) return skills;
      // 설정을 못 읽으면 server 칸만 비운다.
      const extensions = await readExtensionSettings(core);
      const serverValues = extensions.ok ? extensions.value.servers : [];
      const states = await secretStates(
        core,
        serverValues.flatMap((server) =>
          [secretOf(server)].filter((name) => name !== null)
        ),
      );
      const logins = await authStates(core, serverValues);
      return {
        ok: true,
        value: {
          skills: skills.value.skills.map((skill) => ({
            name: skill.name,
            detail: skill.description,
            layer: "global" as const,
            on: skill.enabled,
            builtIn: false,
          })),
          servers: serverValues.map((server) => ({
            name: server.name,
            detail: detailOf(server),
            layer: "global" as const,
            on: server.enabled,
            status: statusOf(server, states, logins),
          })),
        },
      };
    },

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
      return applySetting(core, SKILL_FOLDERS, [
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
      return applySetting(core, SKILLS_OFF, off, random);
    },

    async createServer(server) {
      const current = await readExtensionSettings(core);
      if (!current.ok) return current;
      const added = await applySetting(core, MCP_SERVERS, [
        ...current.value.servers,
        server,
      ], random);
      if (!added.ok) return added;
      // key나 token이 필요한 server는 값을 보호 입력으로 받는다. 값은 이 화면을 지나지 않는다.
      const auth = server.transport === "http" ? server.http.auth : null;
      if (auth?.kind === "bearer" || auth?.kind === "api_key") {
        // server는 이미 더해졌다. 창을 열지 못하거나 취소해도 더한 일은 되돌리지 않고 상태로 보인다.
        await enterSecret(openSecret, {
          name: auth.credential.secret,
          purpose: "mcp",
          subject: server.name,
        });
      }
      return added;
    },

    async setServerEnabled(name, enabled) {
      const current = await readExtensionSettings(core);
      if (!current.ok) return current;
      if (!current.value.servers.some((server) => server.name === name)) {
        return { ok: false, code: "not_found" } satisfies SourceResult<null>;
      }
      return applySetting(
        core,
        MCP_SERVERS,
        current.value.servers.map((server) =>
          server.name === name ? { ...server, enabled } : server
        ),
        random,
      );
    },
  };
}
