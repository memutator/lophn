// AgentsSettingsSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output schema로 이미
// 검사했다. 아래 모양은 그 schema에서 이 화면이 읽는 field만 옮긴 것이다. credential 값은 이 파일을 지나지 않고
// 보관 이름과 저장 여부만 묻는다. 화면의 읽기(기본 model, 호출 정책, skill·MCP server 목록)는 useCoreRead로 하고
// 이 file의 *ViewOf 함수로 푼다.
//
// - 전역 기본 model: model-default 바꾸기. 연결 뒤 흐름(connect-host)은 한 번 읽는다.
// - model picker: Agents 탭과 같은 AgentsSource(workspace/agents)의 model 읽기다.
// - 모든 project의 LOPHN.md: core route(`instructions/read_global`, `instructions/write_global`)로 읽고 써서
//   다른 컴퓨터의 Settings에서도 그대로 고친다.
// - [Add server]로 Tools and skills 자리로 옮기는 일도 settings 화면이 감싸 주므로 addServer는 unavailable이다.
// - 전역 skill 목록: skills/read(project·app 없이 읽으면 내장과 전역 층). 끄고 켜기는 skills_off 설정을 settings/update로 바꾼다.
import { t } from "@lophn/i18n";
import {
  CALL_POLICY_SETTING_KEY,
  type CallWorkspace,
  callPolicySchema,
} from "../../../../../protocol/lophn-agent/call-policy.ts";
import { modelDefaultChange } from "../../../../../protocol/lophn-agent/models.ts";
import {
  isLophn,
  workspaceOfLophn,
} from "../../../../../protocol/lophn-agent/workspaces.ts";
import type { FolderPickerApi } from "../../../../ipc/folder-picker.ts";
import {
  cancelMcpSignIn,
  readGlobalModel,
  signInMcpServer,
  windowFiles,
  windowInstructions,
} from "../../../workspace/agents/core-extensions.ts";
import { coreAgentsSource } from "../../../workspace/agents/core-source.ts";
import { secretsOf } from "../../../workspace/agents/mcp-secrets.ts";
import { createLink } from "../../../workspace/agents/core-link.ts";
import type { InstructionsApi } from "../../../../ipc/instructions.ts";
import type { FilesApi } from "../../../../ipc/files.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { windowFolderPicker } from "../../workspaces/projects/core-source.ts";
import { chooseSetting } from "../declared.ts";
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
  type AuthStateValue,
  MCP_SERVERS,
  type McpServerValue,
  readExtensionSettings,
  secretOf,
  SKILL_FOLDERS,
} from "../extension-settings.ts";
import type {
  AgentsSettingsSource,
  CallPolicyChange,
  CallPolicySource,
  CallPolicyView,
  CallRule,
  ExtensionsView,
  McpRow,
  SourceResult,
} from "./settings-source.ts";

interface SkillValue {
  name: string;
  description: string;
  source: string;
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

// 정책의 workspace는 목록의 option 값(`home`, `project:<id>`, `app:<id>`)으로 바꿔 화면에 건넨다.
const workspaceKey = (workspace: CallWorkspace): string =>
  workspace.kind === "home" ? "home" : `${workspace.kind}:${workspace.id}`;
const workspaceOfKey = (key: string): CallWorkspace =>
  key === "home"
    ? { kind: "home" }
    : ({
        kind: key.slice(0, key.indexOf(":")),
        id: key.slice(key.indexOf(":") + 1),
      } as CallWorkspace);

/**
 * 저장된 정책과 보관하지 않은 project·앱, agent 목록으로 화면의 고를 값과 줄을 만든다. 정책 모양이 틀리면
 * null이다.
 */
export function callPolicyViewOf(
  stored: unknown,
  projects: readonly { id: string; title: string }[],
  apps: readonly { id: string; name: string }[],
  agents: readonly { agent: string; name: string }[],
): CallPolicyView | null {
  const policy = callPolicySchema.safeParse(stored);
  if (!policy.success) return null;
  const containers = [
    ...projects.map((one) => ({
      value: `project:${one.id}`,
      label: one.title,
    })),
    ...apps.map((one) => ({ value: `app:${one.id}`, label: one.name })),
  ];
  const workspaceLabels = new Map([
    ["home", t("settings.label.call-home")],
    ...containers.map((one): [string, string] => [one.value, one.label]),
  ]);
  return {
    private: {
      options: containers,
      chosen: policy.data.private.map(workspaceKey),
    },
    workspaces: {
      options: [
        { value: "home", label: t("settings.label.call-home") },
        ...containers,
      ],
      rules: policy.data.workspaces.map((rule) => ({
        from: workspaceKey(rule.from),
        to: workspaceKey(rule.to),
        allow: rule.allow,
      })),
    },
    agents: {
      // lophn은 workspace마다 하나라 이름이 같다. 어느 workspace의 것인지 붙여 가른다.
      options: agents.map((one) => ({
        value: one.agent,
        label: isLophn(one.agent)
          ? t("agents.label.settings-lophn-in", {
              agent: one.name,
              workspace:
                workspaceLabels.get(
                  workspaceKey(workspaceOfLophn(one.agent) ?? { kind: "home" }),
                ) ?? "",
            })
          : one.name,
      })),
      rules: policy.data.agents,
    },
  };
}

function callPolicySource(core: CoreSource): CallPolicySource {
  return {
    write: (next) =>
      chooseSetting(core, CALL_POLICY_SETTING_KEY, callPolicyValueOf(next)),
  };
}

/** 화면이 고친 정책을 설정 값의 모양으로 되돌린다. */
export function callPolicyValueOf(next: CallPolicyChange): unknown {
  return {
    private: next.private.map(workspaceOfKey),
    workspaces: next.workspaces.map((rule: CallRule) => ({
      from: workspaceOfKey(rule.from),
      to: workspaceOfKey(rule.to),
      allow: rule.allow,
    })),
    agents: next.agents,
  };
}

/**
 * Tools and skills의 전역 층. skill 목록과 MCP server 설정에 credential 저장 여부(states)와 OAuth 로그인 상태(logins)를
 * 붙인다. 상태를 읽지 못했으면 null이고 그 server는 로그인했다고 말하지 않는다.
 */
export function extensionsViewOf(
  skills: readonly SkillValue[],
  servers: readonly McpServerValue[],
  states: ReadonlyMap<string, "set" | "missing"> | null,
  logins: ReadonlyMap<string, AuthStateValue> | null,
): ExtensionsView {
  return {
    skills: skills.map((skill) => ({
      name: skill.name,
      detail: skill.description,
      layer: "global" as const,
      on: skill.enabled,
      builtIn: skill.source === "builtin",
    })),
    servers: servers.map((server): McpRow => {
      const auth =
        server.transport === "http" && server.http?.auth.kind === "oauth2"
          ? server.http.auth
          : null;
      const login = logins?.get(server.name);
      const secrets = secretsOf(server, (name) => {
        const state = states?.get(name);
        return state === undefined ? null : state === "set";
      });
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
                workspace: null,
                agent: null,
                client_id: auth.client_id ?? "",
                scopes: auth.scopes ?? [],
                state: login?.state ?? ("none" as const),
                reason: login?.reason ?? null,
              },
            }),
        ...(secrets.length === 0 ? {} : { secrets }),
      };
    }),
  };
}

/** server들의 credential 이름. 저장 여부를 이 이름으로 본다. */
export function serverSecretNames(
  servers: readonly McpServerValue[],
): string[] {
  return servers.flatMap((server) =>
    secretsOf(server).map((secret) => secret.name),
  );
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
  const link = createLink(core, random);
  const editor = coreAgentsSource(core, { instructions, files, openSecret });

  return {
    editor,
    callPolicy: callPolicySource(core),

    async readDefaultModel() {
      const model = await readGlobalModel(link);
      return model.ok ? model : { ok: false, code: model.message };
    },

    async changeDefaultModel(choice) {
      const changed = await command(core, modelDefaultChange, {
        input: { default: choice },
        compare: {},
        key: `model-default-${random()}`,
      });
      return changed.ok ? { ok: true, value: null } : changed;
    },

    readInstructions: () =>
      call<{ text: string; hash: string | null }>(
        core,
        "memory",
        "instructions",
        "read_global",
        {},
      ),

    async writeInstructions(text, hash) {
      const written = await call<{ hash: string }>(
        core,
        "memory",
        "instructions",
        "write_global",
        { text, base_hash: hash },
      );
      return written.ok
        ? { ok: true, value: { text, hash: written.value.hash } }
        : written;
    },

    addServer: () => Promise.resolve(UNAVAILABLE),

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
          workspace: row.login?.workspace ?? null,
          agent: row.login?.agent ?? null,
        },
      });
      return done.ok
        ? { ok: true, value: null }
        : { ok: false, code: done.message };
    },

    async enterServerSecret(row, secret) {
      const entered = await enterSecret(openSecret, {
        name: secret.name,
        purpose: "mcp",
        subject: row.name,
      });
      return entered.ok ? { ok: true, value: null } : entered;
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
