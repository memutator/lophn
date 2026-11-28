import type { LophnBrowserApi } from "../../../../ipc/browser.ts";
import { loginSecretName } from "../../../../../protocol/secrets/logins.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { thisComputerCoreSource } from "../../connection/connection.ts";
import {
  call as coreCall,
  enterSecret,
  windowSecretInputOpener,
} from "../core-call.ts";
import type { z } from "zod";

import type { loginsList } from "../../../../../protocol/secrets/logins.ts";
import type { secretStatus } from "../../../../../protocol/secrets/secret-file.ts";
import { BROWSER_SHARE_SETTING } from "../../../../../protocol/secrets/browser-vault.ts";
import {
  BROWSER_SEARCH_ENGINE_CUSTOM_SETTING,
  BROWSER_SEARCH_ENGINE_SETTING,
  DEFAULT_SEARCH_ENGINE,
  SEARCH_ENGINE_IDS,
  type SearchEngineId,
} from "../../../../../protocol/shell/browser-search.ts";
import { chooseSetting } from "../declared.ts";
import { DEVICES_KEY, LINK_DEFAULT, LINK_ROWS } from "./model.ts";
import type {
  BrowserSettingsSource,
  Device,
  LinkValues,
  LoginRow,
  SearchEngineValues,
} from "./source.ts";

/** key마다의 지금 값에서 link 열 곳. 선택지 밖이면 기본값이다. */
export function linkValuesOf(read: ReadonlyMap<string, unknown>): LinkValues {
  const values = {} as Record<string, string>;
  for (const row of LINK_ROWS) {
    const stored = read.get(row.settingKey);
    values[row.id] = row.options.some((o) => o.value === stored)
      ? (stored as string)
      : LINK_DEFAULT;
  }
  return values as LinkValues;
}

/** key마다의 지금 값에서 검색 엔진 설정. 선택지 밖이면 기본값이다. */
export function searchEngineValuesOf(
  read: ReadonlyMap<string, unknown>,
): SearchEngineValues {
  const storedEngine = read.get(BROWSER_SEARCH_ENGINE_SETTING);
  const engine: SearchEngineId = SEARCH_ENGINE_IDS.includes(
    storedEngine as SearchEngineId,
  )
    ? (storedEngine as SearchEngineId)
    : DEFAULT_SEARCH_ENGINE;
  const storedCustom = read.get(BROWSER_SEARCH_ENGINE_CUSTOM_SETTING);
  return {
    engine,
    custom: typeof storedCustom === "string" ? storedCustom : "",
  };
}

/** key마다의 지금 값에서 기기 목록. core가 설정 schema로 검사한 값이다. */
export function devicesOf(read: ReadonlyMap<string, unknown>): Device[] {
  return (read.get(DEVICES_KEY) ?? []) as Device[];
}

/** `logins/list`는 TOTP 유무만 알려 준다. password는 `secrets/status`로 본다. */
export function loginRowsOf(
  logins: z.output<typeof loginsList.output>,
  secrets: z.output<typeof secretStatus.output>,
): LoginRow[] {
  const set = new Set(
    secrets.secrets.filter((one) => one.configured).map((one) => one.name),
  );
  return logins.map((l) => ({
    ...l,
    password: set.has(loginSecretName(l.id, "password")),
  }));
}

/**
 * desktop 창 preload의 `window.lophnBrowser`를 잇는다. 없거나 거절되면 unavailable이다.
 * link 열 곳은 선언 설정이라 core를 부른다. entry가 core를 넘기지 않아도 되게 기본 인자로 얻는다.
 */
export function windowBrowserSettings(
  core: CoreSource = thisComputerCoreSource(),
): BrowserSettingsSource {
  const api = (globalThis as { lophnBrowser?: LophnBrowserApi }).lophnBrowser;
  const openSecret = windowSecretInputOpener();
  // bookmark 거절은 Error.message가 BookmarkReason이다.
  async function call<T>(run: (api: LophnBrowserApi) => Promise<T>) {
    if (api === undefined) return { ok: false, code: "unavailable" } as const;
    try {
      return { ok: true, value: await run(api) } as const;
    } catch (error) {
      const code = error instanceof Error ? error.message : "unavailable";
      return { ok: false, code } as const;
    }
  }
  return {
    clearData: (profile) =>
      call((api) => api.clearData(profile).then(() => null)),
    bookmarks: () => call((api) => api.bookmarks.list()),
    updateBookmark: (input) =>
      call((api) => api.bookmarks.update(input).then(() => null)),
    removeBookmark: (id) =>
      call((api) => api.bookmarks.remove({ id }).then(() => null)),
    chooseLink: (id, value) => {
      const row = LINK_ROWS.find((r) => r.id === id)!;
      return chooseSetting(core, row.settingKey, value);
    },
    chooseSearchEngine: (engine) =>
      chooseSetting(core, BROWSER_SEARCH_ENGINE_SETTING, engine),
    saveCustomSearchEngine: async (url) => {
      const savedUrl = await chooseSetting(
        core,
        BROWSER_SEARCH_ENGINE_CUSTOM_SETTING,
        url.trim(),
      );
      if (!savedUrl.ok) return savedUrl;
      return chooseSetting(core, BROWSER_SEARCH_ENGINE_SETTING, "custom");
    },
    saveDevices: (list) => chooseSetting(core, DEVICES_KEY, list),
    chooseShare: (on) => chooseSetting(core, BROWSER_SHARE_SETTING, on),
    saveProfile: async (input) => {
      const saved = await coreCall<{ id: string }>(
        core,
        "memory",
        "browser_profiles",
        "save",
        input,
      );
      return saved.ok ? { ok: true, value: saved.value.id } : saved;
    },
    deleteProfile: async (id) => {
      const deleted = await coreCall(
        core,
        "memory",
        "browser_profiles",
        "delete",
        { id },
      );
      return deleted.ok ? { ok: true, value: null } : deleted;
    },
    saveLogin: async (input) => {
      const saved = await coreCall(core, "memory", "logins", "save", input);
      return saved.ok ? { ok: true, value: null } : saved;
    },
    deleteLogin: async (id) => {
      const deleted = await coreCall(core, "memory", "logins", "delete", {
        id,
      });
      return deleted.ok ? { ok: true, value: null } : deleted;
    },
    enterLoginSecret: (login, field) =>
      // enterSecret은 subject를 80자로 자른다. 잘린 origin을 보이면 사람이 속으므로 열지 않는다.
      login.origin.length > 80
        ? Promise.resolve({ ok: false, code: "invalid_input" })
        : enterSecret(openSecret, {
            name: loginSecretName(login.id, field),
            purpose: "login",
            // 창이 이 origin을 크게 보인다. 값을 어디에 쓰는지 사람이 거르는 자리다.
            subject: login.origin,
          }),
    watchBookmarks: (listener) =>
      api === undefined ? () => {} : api.bookmarks.subscribe(listener),
  };
}
