// AgentsSettingsSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output schema로 이미
// 검사했다. 아래 모양은 그 schema에서 이 화면이 읽는 field만 옮긴 것이다. credential 값은 이 파일을 지나지 않고
// 보관 이름과 저장 여부만 묻는다.
//
// - 전역 기본 model: model-default 읽기와 바꾸기.
// - lophn 카드와 둘째 화면: Agents 탭과 같은 AgentsSource(workspace/agents)의 project 없는 읽기·저장이다.
// - 모든 project의 LOPHN.md: 경로는 shell main(`instructions.open`)이 알려 주고 읽기·쓰기는 main file 통로다.
//   Agents 화면이 그 자리에서 고친다.
// - [Add server]로 Tools and skills 자리로 옮기는 일도 settings 화면이 감싸 주므로 addServer는 unavailable이다.
// - 전역 skill 목록: skills/read(project·app 없이 읽으면 내장과 전역 층). 끄고 켜기는 skills_off 설정을 settings apply로 바꾼다.
import { modelDefaultChange } from "../../../../../protocol/lophn-agent/models.ts";
import type { FolderPickerApi } from "../../../../ipc/folder-picker.ts";
import {
  cancelMcpSignIn,
  readGlobalModel,
  readInstructions,
  signInMcpServer,
  windowFiles,
  windowInstructions,
  writeInstructions,
} from "../../../workspace/agents/core-extensions.ts";
import { coreAgentsSource } from "../../../workspace/agents/core-source.ts";
import { createLink } from "../../../workspace/agents/core-link.ts";
import type { InstructionsApi } from "../../../../ipc/instructions.ts";
import type { FilesApi } from "../../../../ipc/files.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { windowFolderPicker } from "../../places/projects/core-source.ts";
import type { OpenExternalApi } from "../../../../ipc/open-external.ts";
import type { SecretInputOpenApi } from "../../../../ipc/secret-input.ts";
import {
  call,
  command,
  enterSecret,
  windowLinkOpener,
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
  source: "builtin" | "global";
  enabled: boolean;
}

const SKILLS_OFF = "lophn-agent.extensions.skills_off";

const UNAVAILABLE = { ok: false, code: "unavailable" } as const;

/** 줄 밑에 보이는 한 줄: 주소 또는 실행 파일. credential은 싣지 않는다. */
function detailOf(server: McpServerValue): string {
  return server.transport === "http"
    ? (server.http?.url ?? "")
    : (server.stdio?.executable ?? "");
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
  /** OAuth 로그인의 authorize 주소를 OS browser로 여는 통로. */
  openLink: OpenExternalApi["openExternal"] | undefined;
  /** 지침 파일의 경로를 알려 주는 main 통로. 없으면 지침은 읽지도 쓰지도 못한다. */
  instructions: InstructionsApi | undefined;
  /** 지침 파일을 읽고 쓰는 main file 통로. 없으면 지침은 읽지도 쓰지도 못한다. */
  files: Pick<FilesApi, "read" | "write"> | undefined;
  /** 새 command key를 만든다. 테스트가 고정한다. */
  random: () => string;
}

export function coreAgentsSettingsSource(
  core: CoreSource,
  deps: Partial<AgentsDeps> = {},
): AgentsSettingsSource {
  const picker = "picker" in deps ? deps.picker : windowFolderPicker();
  const openSecret =
    "openSecret" in deps ? deps.openSecret : windowSecretInputOpener();
  const openLink = "openLink" in deps ? deps.openLink : windowLinkOpener();
  const random = deps.random ?? (() => crypto.randomUUID().slice(0, 8));
  const instructions =
    "instructions" in deps ? deps.instructions : windowInstructions();
  const files = "files" in deps ? deps.files : windowFiles();
  const global = { layer: "global" } as const;
  // workspace/agents 쪽 결과(message)를 settings 화면의 결과(code)로 옮긴다.
  const asSource = <T>(
    result: { ok: true; value: T } | { ok: false; message: string },
  ): SourceResult<T> =>
    result.ok ? result : { ok: false, code: result.message };
  const link = createLink(core, random);
  const editor = coreAgentsSource(core);

  /** lophn 카드. 못 읽는 칸은 비워 두고 카드는 그대로 보인다. */
  async function lophnSummary(): Promise<LophnSummary> {
    const detail = await editor.readAgent(null, "lophn");
    const grants = await editor.grants(null, "lophn");
    const entries = grants.ok ? grants.value.entries : [];
    return {
      name: detail.ok ? (detail.value.definition.name ?? "lophn") : "lophn",
      model: detail.ok ? (detail.value.definition.model ?? null) : null,
      apps: entries.length,
    };
  }

  return {
    editor,

    async read() {
      // core reader는 한 사람의 동시 읽기 수를 제한하므로 하나씩 읽는다.
      const model = await readGlobalModel(link);
      if (!model.ok) return { ok: false, code: model.message };
      const lophn = await lophnSummary();
      // 지침은 못 읽으면 빈 칸으로 보인다. 고쳐 저장하면 hash가 맞지 않아 conflict로 막힌다.
      const file = await readInstructions(instructions, files, global);
      return {
        ok: true,
        value: {
          defaultModel: model.value,
          lophn,
          instructions: file.ok ? file.value : { text: "", hash: null },
        },
      };
    },

    async changeDefaultModel(choice) {
      const changed = await command(core, modelDefaultChange, {
        input: { default: choice },
        compare: {},
        key: `model-default-${random()}`,
      });
      return changed.ok ? { ok: true, value: null } : changed;
    },

    readInstructions: async () =>
      asSource(await readInstructions(instructions, files, global)),

    writeInstructions: async (text, hash) =>
      asSource(
        await writeInstructions(instructions, files, global, text, hash),
      ),

    addServer: () => Promise.resolve(UNAVAILABLE),

    async readExtensions() {
      const skills = await call<{ skills: SkillValue[] }>(
        core,
        "read",
        "skills",
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
          [secretOf(server)].filter((name) => name !== null),
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
            builtIn: skill.source === "builtin",
          })),
          servers: serverValues.map((server): McpRow => {
            const auth =
              server.transport === "http" && server.http?.auth.kind === "oauth2"
                ? server.http.auth
                : null;
            const login = logins?.get(server.name);
            return {
              name: server.name,
              detail: detailOf(server),
              layer: "global" as const,
              on: server.enabled,
              status: statusOf(server, states, logins),
              ...(auth === null
                ? {}
                : {
                    login: {
                      place: null,
                      agent: null,
                      client_id: auth.client_id ?? "",
                      scopes: auth.scopes ?? [],
                      state: login?.state ?? ("none" as const),
                      reason: login?.reason ?? null,
                    },
                  }),
            };
          }),
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
      return applySetting(
        core,
        SKILL_FOLDERS,
        [...current.value.folders, picked.path],
        random,
      );
    },

    async setSkillEnabled(name, enabled) {
      const listed = await call<{ skills: SkillValue[]; skills_off: string[] }>(
        core,
        "read",
        "skills",
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
      const added = await applySetting(
        core,
        MCP_SERVERS,
        [...current.value.servers, server],
        random,
      );
      if (!added.ok) return added;
      // key·token·client secret이 필요한 server는 값을 보호 입력으로 받는다. 값은 이 화면을 지나지 않는다.
      const auth = server.transport === "http" ? server.http.auth : null;
      const secret =
        auth?.kind === "bearer" || auth?.kind === "api_key"
          ? auth.credential.secret
          : auth?.kind === "oauth2"
            ? auth.client_credential?.secret
            : undefined;
      if (secret !== undefined) {
        // server는 이미 더해졌다. 창을 열지 못하거나 취소해도 더한 일은 되돌리지 않고 상태로 보인다.
        await enterSecret(openSecret, {
          name: secret,
          purpose: "mcp",
          subject: server.name,
        });
      }
      return added;
    },

    async signInServer(row) {
      if (row.login === undefined) {
        return { ok: false, code: "invalid_input" };
      }
      const done = await signInMcpServer(link, openLink, {
        name: row.name,
        login: row.login,
      });
      return done.ok
        ? { ok: true, value: null }
        : { ok: false, code: done.message };
    },

    async cancelServerSignIn(row) {
      const done = await cancelMcpSignIn(link, {
        name: row.name,
        login: {
          place: row.login?.place ?? null,
          agent: row.login?.agent ?? null,
        },
      });
      return done.ok
        ? { ok: true, value: null }
        : { ok: false, code: done.message };
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
          server.name === name ? { ...server, enabled } : server,
        ),
        random,
      );
    },
  };
}
