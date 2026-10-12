// SettingsSource를 main의 core 통로로 만든다(일반 설정·skill 폴더·도구 server). 응답은 main의
// contract client가 route output schema로 이미 검사했다. 아래 모양은 그 schema에서 이 화면이 읽는
// field만 옮긴 것이다. provider와 agent 기본값은 각자의 통로(providers/core-source,
// agents/core-source)가 맡는다. secret 값은 이 파일을 지나지 않는다: credential은 보호 창이 받고
// 여기서는 창 열기만 한다.
import type { FolderPickerApi } from "../../../../ipc/folder-picker.ts";
import type { OpenExternalApi } from "../../../../ipc/open-external.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { windowFolderPicker } from "../../launcher/core-source.ts";
import {
  call,
  openProtected,
  type OpenSecretWindow,
  windowLinkOpener,
  windowSecretOpener,
} from "./core-call.ts";
import {
  applySetting,
  type EffectiveValue,
  MCP_SERVERS,
  type McpServerValue,
  secretOf,
  secretStates,
  SKILL_FOLDERS,
  tokenOf,
} from "./extension-settings.ts";
import type {
  NewServer,
  ServerAuth,
  ServerRow,
  ServerSignIn,
  SettingRow,
  SettingsSource,
  SettingsView,
} from "./source.ts";

interface DefinitionValue {
  key: string;
  description: string;
  default_present: boolean;
  default?: unknown;
}

export interface SettingsDeps {
  openWindow: OpenSecretWindow | undefined;
  picker: FolderPickerApi | undefined;
  /** 인증 주소를 OS browser로 여는 shell 통로. 없는 창에서는 undefined다. */
  openLink: OpenExternalApi["openExternal"] | undefined;
  /** 새 command key를 만든다. 테스트가 고정한다. */
  random: () => string;
}

export function coreSettingsSource(
  core: CoreSource,
  deps: Partial<SettingsDeps> = {},
): SettingsSource {
  const openWindow = "openWindow" in deps
    ? deps.openWindow
    : windowSecretOpener();
  const picker = "picker" in deps ? deps.picker : windowFolderPicker();
  const openLink = "openLink" in deps ? deps.openLink : windowLinkOpener();
  const random = deps.random ?? (() => crypto.randomUUID().slice(0, 8));

  const apply = (view: SettingsView, key: string, value: unknown) =>
    applySetting(core, view, key, value, random);

  return {
    watch: (listener) => core.subscribe(listener),

    async settings() {
      const defined = await call<
        { definitions: DefinitionValue[]; defaults_revision: string }
      >(core, "read", "settings", "definitions", {});
      if (!defined.ok) return defined;
      const got = await call<{
        settings: EffectiveValue[];
        revision: number;
        defaults_revision: string;
      }>(core, "read", "settings", "get", {});
      if (!got.ok) return got;
      const effective = new Map(got.value.settings.map((s) => [s.key, s]));
      const rows: SettingRow[] = defined.value.definitions.flatMap(
        (definition) => {
          const current = effective.get(definition.key);
          if (current === undefined) return [];
          return [{
            key: definition.key,
            title: definition.description,
            value: current.value,
            resolved: current.resolved,
            changed: current.source_layer === "common",
            defaultValue: definition.default,
            hasDefault: definition.default_present,
            applyAt: current.apply_at,
          }];
        },
      );
      const folders = effective.get(SKILL_FOLDERS);
      const servers = effective.get(MCP_SERVERS);
      const serverValues = Array.isArray(servers?.value)
        ? servers.value as McpServerValue[]
        : [];
      const states = await secretStates(
        core,
        serverValues.flatMap((server) =>
          [secretOf(server), tokenOf(server)].filter((name) => name !== null)
        ),
      );
      const serverRows: ServerRow[] = serverValues.map((server) => {
        const auth: ServerAuth = server.http?.auth.kind ?? "none";
        const secret = secretOf(server);
        return {
          signIn: signInOf(server, states),
          name: server.name,
          transport: server.transport,
          enabled: server.enabled,
          auth,
          secret,
          credential: secret === null
            ? null
            : states === null
            ? "unknown"
            : states.get(secret) ?? "missing",
        };
      });
      const view: SettingsView = {
        rows,
        revision: got.value.revision,
        defaultsRevision: got.value.defaults_revision,
        folders: Array.isArray(folders?.value) ? folders.value as string[] : [],
        servers: serverRows,
        rawServers: serverValues,
      };
      return { ok: true, value: view };
    },

    async addSkillFolder(view) {
      if (picker === undefined) return { ok: false, code: "unavailable" };
      const picked = await picker.pick();
      if (!picked.ok) return { ok: false, code: picked.code };
      if (picked.path === null) return { ok: true, value: null };
      if (view.folders.includes(picked.path)) {
        return { ok: true, value: { path: picked.path } };
      }
      const applied = await apply(view, SKILL_FOLDERS, [
        ...view.folders,
        picked.path,
      ]);
      return applied.ok ? { ok: true, value: { path: picked.path } } : applied;
    },

    addServer(view, server: NewServer) {
      const common = {
        name: server.name,
        revision: 1,
        enabled: true,
        call_timeout_ms: 60_000,
        classifications: {},
      };
      const secret = `sec:${secretNameOf(server.name)}`;
      const config = server.transport === "stdio"
        ? {
          ...common,
          transport: "stdio",
          stdio: {
            executable: server.executable,
            args: [...server.args],
            cwd: null,
            env: {},
          },
        }
        : {
          ...common,
          transport: "http",
          http: {
            url: server.url,
            headers: {},
            auth: server.auth === "none"
              ? { kind: "none" }
              : server.auth === "bearer"
              ? { kind: "bearer", secret_ref: secret }
              : {
                kind: "api_key",
                secret_ref: secret,
                header_name: server.header ?? "",
              },
          },
        };
      return apply(view, MCP_SERVERS, [...view.rawServers, config]);
    },

    enterServerCredential: (secret) =>
      openProtected(openWindow, {
        kind: "secret_input",
        owner: secret,
        purpose: "app_secret",
      }),

    async beginSignIn(server) {
      if (server.signIn === null) return INVALID;
      const begun = await call<{ url: string; callback_port: number }>(
        core,
        "memory",
        "agent-mcp-auth",
        "begin",
        {
          name: server.name,
          place: server.signIn.place,
          client_id: server.signIn.clientId,
          scopes: server.signIn.scopes,
        },
      );
      if (!begun.ok) return begun;
      let opened = false;
      if (openLink !== undefined) {
        try {
          opened = (await openLink(begun.value.url)).ok;
        } catch {
          opened = false;
        }
      }
      return opened
        ? { ok: true, value: { callbackPort: begun.value.callback_port } }
        : { ok: false, code: "not_opened" };
    },

    async finishSignIn(server, callbackPort) {
      if (server.signIn === null) return INVALID;
      const done = await call<{ completed: boolean }>(
        core,
        "memory",
        "agent-mcp-auth",
        "complete",
        {
          name: server.name,
          place: server.signIn.place,
          callback_port: callbackPort,
        },
      );
      if (!done.ok) return done;
      return done.value.completed
        ? { ok: true, value: null }
        : { ok: false, code: "rejected" };
    },
  };
}

const INVALID = { ok: false, code: "invalid_input" } as const;

/**
 * 로그인이 필요한 server만 로그인 정보를 갖는다: 켜진 http OAuth server이고 token 이름이 없거나 그 이름의
 * token이 저장돼 있지 않은 것. 이 목록은 전역 server뿐이라 자리는 null이다.
 */
function signInOf(
  server: McpServerValue,
  states: ReadonlyMap<string, "set" | "missing"> | null,
): ServerSignIn | null {
  const auth = server.http?.auth;
  if (!server.enabled || auth?.kind !== "oauth2") return null;
  const token = tokenOf(server);
  if (token !== null && states?.get(token) !== "missing") return null;
  return {
    place: null,
    clientId: auth.client_id ?? "",
    scopes: auth.scopes ?? [],
  };
}

/** MCP credential을 담는 보관 이름. 설정의 `sec:` 참조가 같은 이름을 가리킨다. */
export function secretNameOf(server: string): string {
  return `mcp-${server}`;
}
