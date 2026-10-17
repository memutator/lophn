// SettingsSource를 main의 core 통로로 만든다(일반 설정·skill 폴더·도구 server). 응답은 main의
// contract client가 route output schema로 이미 검사했다. 아래 모양은 그 schema에서 이 화면이 읽는
// field만 옮긴 것이다. provider와 agent 기본값은 각자의 통로(providers/core-source,
// agents/core-source)가 맡는다. secret 값은 이 파일을 지나지 않는다: credential은 보호 입력 창이 받고
// 여기서는 창 열기만 한다.
import type { FolderPickerApi } from "../../../ipc/folder-picker.ts";
import type { OpenExternalApi } from "../../../ipc/open-external.ts";
import type { SecretInputOpenApi } from "../../../ipc/secret-input.ts";
import type { CoreSource } from "../connection/connection.ts";
import { windowFolderPicker } from "../launcher/projects/core-source.ts";
import {
  call,
  enterSecret,
  windowLinkOpener,
  windowSecretInputOpener,
} from "./core-call.ts";
import { listSettings, updateSettings } from "./declared.ts";
import {
  applySetting,
  authStates,
  type AuthStateValue,
  MCP_SERVERS,
  type McpServerValue,
  readExtensionSettings,
  secretOf,
  secretStates,
  signsIn,
  SKILL_FOLDERS,
} from "./extension-settings.ts";
import type {
  NewServer,
  ServerAuth,
  ServerRow,
  ServerSignIn,
  SettingsSource,
  SettingsView,
  SourceResult,
} from "./source.ts";

interface SettingsDeps {
  openSecret: SecretInputOpenApi["open"] | undefined;
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
  const openSecret = "openSecret" in deps
    ? deps.openSecret
    : windowSecretInputOpener();
  const picker = "picker" in deps ? deps.picker : windowFolderPicker();
  const openLink = "openLink" in deps ? deps.openLink : windowLinkOpener();
  const random = deps.random ?? (() => crypto.randomUUID().slice(0, 8));

  const apply = (key: string, value: unknown) =>
    applySetting(core, key, value, random);

  // 기다리는 로그인을 그만둔다(CancelMcpAuth). 로그인이 필요하지 않은 줄은 core를 부르지 않는다.
  const cancel = async (server: ServerRow): Promise<SourceResult<null>> => {
    if (server.signIn === null) return INVALID;
    const cancelled = await call<{ cancelled: boolean }>(
      core,
      "memory",
      "agent-mcp-auth",
      "cancel",
      { name: server.name, place: server.signIn.place },
    );
    return cancelled.ok ? { ok: true, value: null } : cancelled;
  };

  return {
    watch: (listener) => core.subscribe(listener),

    declared: () => listSettings(core),

    update: (changes) => updateSettings(core, changes),

    async settings() {
      const got = await readExtensionSettings(core);
      if (!got.ok) return got;
      const serverValues = got.value.servers;
      // bearer·API key의 credential 저장 여부는 이름만 묻는다. OAuth의 로그인 상태는 core가 읽어 준 값이다.
      const states = await secretStates(
        core,
        serverValues.flatMap((server) =>
          [secretOf(server)].filter((name) => name !== null)
        ),
      );
      const logins = await authStates(core, serverValues);
      const serverRows: ServerRow[] = serverValues.map((server) => {
        const auth: ServerAuth = server.http?.auth.kind ?? "none";
        const secret = secretOf(server);
        return {
          signIn: signInOf(server, logins),
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
        folders: [...got.value.folders],
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
      const applied = await apply(SKILL_FOLDERS, [
        ...view.folders,
        picked.path,
      ]);
      return applied.ok ? { ok: true, value: { path: picked.path } } : applied;
    },

    addServer(view, server: NewServer) {
      const common = {
        name: server.name,
        enabled: true,
        call_timeout_ms: 60_000,
      };
      // 이 목록은 전역 server뿐이다. 값은 보호 입력이 받고 설정에는 `secrets.json`의 이름만 남는다.
      const credential = { secret: `mcp.global.${server.name}` };
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
              ? { kind: "bearer", credential }
              : {
                kind: "api_key",
                credential,
                header_name: server.header ?? "",
              },
          },
        };
      return apply(MCP_SERVERS, [...view.rawServers, config]);
    },

    async enterServerCredential(server) {
      if (server.secret === null) return INVALID;
      const entered = await enterSecret(openSecret, {
        name: server.secret,
        purpose: "mcp",
        subject: server.name,
      });
      return entered.ok ? { ok: true, value: null } : entered;
    },

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
      if (opened) {
        return { ok: true, value: { callbackPort: begun.value.callback_port } };
      }
      // 주소를 열지 못한 로그인이 core에 기다리는 채로 남으면 다시 시작할 때 충돌이다. 바로 그만둔다.
      await cancel(server);
      return { ok: false, code: "not_opened" };
    },

    cancelSignIn: (server) => cancel(server),

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
 * 켜진 OAuth server는 로그인 정보를 갖는다: 시작에 쓸 client_id·scopes와 core가 읽어 준 로그인 상태. 이 목록은
 * 전역 server뿐이라 자리는 null이다. 상태를 읽지 못했으면 unknown이다.
 */
function signInOf(
  server: McpServerValue,
  logins: ReadonlyMap<string, AuthStateValue> | null,
): ServerSignIn | null {
  const auth = server.http?.auth;
  if (!signsIn(server) || auth?.kind !== "oauth2") return null;
  const found = logins?.get(server.name);
  return {
    place: null,
    clientId: auth.client_id ?? "",
    scopes: auth.scopes ?? [],
    state: found?.state ?? "unknown",
    reason: found?.reason ?? null,
  };
}
