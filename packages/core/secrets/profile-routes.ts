// browser_profiles/list·save·delete·cleared handler. profile 정의는 vault에 있고 사람만 바꾼다.
import { err, type IdSource, ok } from "../../base/mod.ts";
import {
  BROWSER_PROFILE_ID_PREFIX,
  BROWSER_PROFILES_MAX,
  browserProfilesCleared,
  browserProfilesDelete,
  browserProfilesSave,
  LOGIN_FIELDS,
  loginSecretName,
  PROFILE_FIELDS,
} from "../../protocol/secrets/mod.ts";
import type { MemoryHandler } from "../server/mod.ts";
import { type BrowserVault, profilesOf } from "./browser-vault.ts";
import { removeLogins } from "./login-routes.ts";
import type { SecretStore } from "./secret-store.ts";

const INVALID = (message: string) =>
  err({ code: "invalid_input" as const, message });
const NOT_FOUND = err({
  code: "not_found" as const,
  message: "no browser profile with that id",
});

export function browserProfilesListHandler(deps: { vault: BrowserVault }) {
  const handler: MemoryHandler = (_ctx) => {
    const read = deps.vault.read();
    return read.ok
      ? ok({ profiles: profilesOf(read.value), clear: read.value.clear })
      : read;
  };
  return handler;
}

export function browserProfilesSaveHandler(deps: {
  vault: BrowserVault;
  ids: IdSource;
}) {
  const handler: MemoryHandler = (_ctx, rawInput) => {
    const input = browserProfilesSave.input.safeParse(rawInput);
    if (!input.success) return INVALID("browser profile 입력이 올바르지 않다");
    const { id: given, name, color } = input.data;
    const id = given ?? deps.ids.newId(BROWSER_PROFILE_ID_PREFIX);
    return deps.vault.update((vault, stamp) => {
      // 이름 겹침과 수는 이 컴퓨터에서 만들고 고칠 때만 본다. 다른 컴퓨터와 합친 목록에는 같은 이름이 둘 있을 수 있다.
      if (
        vault.profiles.some(
          (one) =>
            one.id !== id && one.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        return err({
          code: "conflict" as const,
          message: "another browser profile has that name",
        });
      }
      if (given === undefined) {
        if (vault.profiles.length >= BROWSER_PROFILES_MAX) {
          return err({
            code: "conflict" as const,
            message: `at most ${BROWSER_PROFILES_MAX} browser profiles`,
          });
        }
        return ok({
          vault: {
            ...vault,
            profiles: [
              ...vault.profiles,
              { id, name, color, revs: { name: stamp, color: stamp } },
            ],
          },
          value: { id },
        });
      }
      const profile = vault.profiles.find((one) => one.id === id);
      if (profile === undefined) return NOT_FOUND;
      const next = { name, color };
      const revs = { ...profile.revs };
      for (const field of PROFILE_FIELDS) {
        if (profile[field] !== next[field]) revs[field] = stamp;
      }
      return ok({
        vault: {
          ...vault,
          profiles: vault.profiles.map((one) =>
            one.id === id ? { ...one, ...next, revs } : one,
          ),
        },
        value: { id },
      });
    });
  };
  return handler;
}

// 그 profile의 login 값, login과 profile(흔적을 남긴다) 순서로 지운다. 값 지우기가 실패하면 멈추고 profile이 남아 다시 할 수 있다.
// partition data는 부른 쪽(Settings)이 이 route 앞에 지운다.
export function browserProfilesDeleteHandler(deps: {
  vault: BrowserVault;
  secrets: Pick<SecretStore, "delete">;
}) {
  const handler: MemoryHandler = async (_ctx, rawInput) => {
    const input = browserProfilesDelete.input.safeParse(rawInput);
    if (!input.success) return INVALID("browser profile id가 올바르지 않다");
    const { id } = input.data;
    const read = deps.vault.read();
    if (!read.ok) return read;
    if (!read.value.profiles.some((one) => one.id === id)) return NOT_FOUND;
    const logins = read.value.logins
      .filter((login) => login.profile === id)
      .map((login) => login.id);
    for (const login of logins) {
      for (const field of LOGIN_FIELDS) {
        const deleted = await deps.secrets.delete(
          loginSecretName(login, field),
        );
        if (!deleted.ok) return deleted;
      }
    }
    return deps.vault.update((vault, stamp) => {
      const profile = vault.profiles.find((one) => one.id === id);
      if (profile === undefined) return NOT_FOUND;
      const without = removeLogins(
        vault,
        vault.logins
          .filter((login) => login.profile === id)
          .map((login) => login.id),
        stamp,
      );
      return ok({
        vault: {
          ...without,
          profiles: without.profiles.filter((one) => one.id !== id),
          removed: [
            ...without.removed.filter((one) => one.id !== id),
            { id, at: stamp, seen: { ...profile.revs } },
          ],
          clear: without.clear.filter((one) => one !== id),
        },
        value: { id },
      });
    });
  };
  return handler;
}

export function browserProfilesClearedHandler(deps: { vault: BrowserVault }) {
  const handler: MemoryHandler = (_ctx, rawInput) => {
    const input = browserProfilesCleared.input.safeParse(rawInput);
    if (!input.success) return INVALID("browser profile id가 올바르지 않다");
    const done = new Set<string>(input.data.ids);
    return deps.vault.update((vault) =>
      ok({
        vault: { ...vault, clear: vault.clear.filter((id) => !done.has(id)) },
        value: {},
      }),
    );
  };
  return handler;
}
