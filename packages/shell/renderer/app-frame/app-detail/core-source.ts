// AppDetailSource(쓰기)를 main의 core 통로로 만든다. 읽기는 reads.ts가 한다. 거두기·돌아가기·상태 바꾸기는
// 사람의 결정이지만 확인 창 없이 이 탭에서 바로 보낸다. 쓴 결과는 command의 `changes`로 화면이 다시 읽어 본다.
import {
  type App,
  appDisableExecution,
  appEditFolders,
  appEnableExecution,
  appGet,
  appOAuthNames,
  appSetIcon,
  type Rewind,
} from "../../../../protocol/apps/mod.ts";
import { iconInputOf } from "../../parts/icon-upload/icon-reader.ts";
import { windowFolderPicker } from "../../desktop/workspaces/projects/core-source.ts";
import type { FolderPickerApi } from "../../../ipc/folder-picker.ts";
import type { OpenExternalApi } from "../../../ipc/open-external.ts";
import type { SecretInputOpenApi } from "../../../ipc/secret-input.ts";
import type { z } from "zod";

import type { CommandRoute } from "../../../../protocol/base/route.ts";
import { activationActivatePrevious } from "../../../../protocol/apps/activation/activation.ts";
import { appGrantRevoke } from "../../../../protocol/apps/grants.ts";
import type { CoreCall } from "../../../ipc/core.ts";
import { commandBody, type CompareOf } from "../../command-call.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import { beginAppSignIn } from "../../desktop/settings/sign-in.ts";
import {
  enterSecret,
  windowLinkOpener,
  windowSecretInputOpener,
} from "../../desktop/settings/core-call.ts";
import type { AppDetailSource, SourceResult } from "./source.ts";

async function call<T>(
  core: CoreSource,
  kind: CoreCall["kind"],
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  const reply = await core.call({ kind, resource, method, body });
  if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
  return { ok: true, value: reply.value as T };
}

/** 사람의 결정 command. 입력만 있고 비교·확인 참조는 없다. */
const command = <R extends CommandRoute>(
  core: CoreSource,
  route: R,
  input: z.input<R["input"]>,
) =>
  call<z.output<R["output"]>>(
    core,
    "command",
    route.resource,
    route.method,
    // compare를 선언한 route는 type이 막으므로 compare가 빈 route만 이 길을 쓴다.
    commandBody(route, {
      input,
      compare: {} as CompareOf<R>,
      key: crypto.randomUUID(),
    }),
  );

/** 앱 기록을 읽는다. revision을 비교하는 command 앞에서 쓴다. */
const readApp = (core: CoreSource, app: string) =>
  call<{ app: App }>(core, "read", appGet.resource, appGet.method, { app });

interface AppDetailDeps {
  /** 보호 입력 창. */
  openSecret: SecretInputOpenApi["open"] | undefined;
  openLink: OpenExternalApi["openExternal"] | undefined;
  /** OS 폴더 선택기. 없으면 폴더를 더하지 못한다. */
  picker: FolderPickerApi | undefined;
}

const stored = async <T>(
  reply: Promise<SourceResult<T>>,
): Promise<SourceResult<true>> => {
  const result = await reply;
  return result.ok ? { ok: true, value: true } : result;
};

export function coreAppDetailSource(
  core: CoreSource,
  deps: Partial<AppDetailDeps> = {},
): AppDetailSource {
  const openSecret =
    "openSecret" in deps ? deps.openSecret : windowSecretInputOpener();
  const openLink = "openLink" in deps ? deps.openLink : windowLinkOpener();
  const picker = "picker" in deps ? deps.picker : windowFolderPicker();
  // 폴더 목록은 app.edit_folders가 통째로 받고 읽은 revision을 비교한다. change가 null이면 core를 부르지 않는다.
  async function editFolders(
    app: string,
    change: (
      folders: readonly { path: string; description: string }[],
    ) => readonly { path: string; description: string }[] | null,
  ): Promise<SourceResult<true>> {
    const found = await readApp(core, app);
    if (!found.ok) return found;
    const next = change(found.value.app.folders);
    if (next === null) return { ok: true, value: true };
    return stored(
      call<App>(
        core,
        "command",
        appEditFolders.resource,
        appEditFolders.method,
        commandBody(appEditFolders, {
          input: { app, folders: [...next] },
          compare: { base_revision: found.value.app.revision },
          key: crypto.randomUUID(),
        }),
      ),
    );
  }
  return {
    async setRun(app, enabled) {
      const found = await readApp(core, app);
      if (!found.ok) return found;
      const route = enabled ? appEnableExecution : appDisableExecution;
      return stored(
        call<App>(
          core,
          "command",
          route.resource,
          route.method,
          commandBody(route, {
            input: { app },
            compare: { base_revision: found.value.app.revision },
            key: crypto.randomUUID(),
          }),
        ),
      );
    },

    setIcon: (app, icon) =>
      stored(
        command(core, appSetIcon, {
          app,
          icon: iconInputOf(icon) as never,
        }),
      ),

    async addFolder(app) {
      if (picker === undefined) return { ok: false, code: "unavailable" };
      let picked;
      try {
        picked = await picker.pick({ purpose: "register" });
      } catch {
        return { ok: false, code: "unavailable" };
      }
      if (!picked.ok) return { ok: false, code: picked.code };
      const path = picked.path;
      if (path === null) return { ok: true, value: true };
      return editFolders(app, (folders) =>
        folders.some((folder) => folder.path === path)
          ? null
          : [...folders, { path, description: "" }],
      );
    },

    removeFolder: (app, path) =>
      editFolders(app, (folders) =>
        folders.filter((folder) => folder.path !== path),
      ),

    async rollback(release) {
      const reply = await command(core, activationActivatePrevious, {
        release,
        key: crypto.randomUUID(),
      });
      return reply.ok ? { ok: true, value: true } : reply;
    },

    async revoke(grant) {
      const reply = await command(core, appGrantRevoke, { grant });
      return reply.ok ? { ok: true, value: true } : reply;
    },

    setSecretValue: (name, subject) =>
      enterSecret(openSecret, { name, purpose: "app", subject }),

    removeSecretValue: (name) =>
      stored(call(core, "memory", "secrets", "delete", { name })),

    setOAuthClientId: (app, name, clientId) =>
      stored(
        call(core, "memory", "apps", "oauth_client_set", {
          app,
          name,
          client_id: clientId,
        }),
      ),

    setOAuthClientSecret: (name, subject) =>
      enterSecret(openSecret, {
        name: appOAuthNames(name).client,
        purpose: "app",
        subject,
      }),

    signIn: (app, name) => beginAppSignIn(core, openLink, app, name),

    cancelSignIn: (app, name) =>
      stored(call(core, "memory", "apps", "oauth_cancel", { app, name })),

    signOut: (app, name) =>
      stored(call(core, "memory", "apps", "oauth_sign_out", { app, name })),

    async rewind(app, from) {
      const result = await call<Rewind>(core, "memory", "apps", "rewind", {
        app,
        from_invocation: from,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        value: {
          status: result.value.status === "cancelled" ? "cancelled" : "applied",
          reason: result.value.reason?.message ?? null,
        },
      };
    },
  };
}
