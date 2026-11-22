// logins/list·save·delete·release handler. 값은 release 응답에만 있고 오류·log·다른 결과에는 없다.
// login은 browser profile 하나에 속한다(null은 기본 profile). agent는 자기 탭이나 자기 정의의 profile에 든 login만 보고,
// 값은 page의 profile이 login의 profile과 같을 때만 나간다.
import {
  err,
  ok,
  type Clock,
  type IdSource,
  type Result,
} from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import {
  LOGIN_ID_PREFIX,
  loginsDelete,
  loginsList,
  loginsRelease,
  loginsSave,
  loginSecretName,
  LOGIN_FIELDS,
  LOGIN_META_FIELDS,
  type LoginField,
  type VaultFile,
} from "../../protocol/secrets/mod.ts";
import type { ShellCapabilities } from "../server/control/capability.ts";
import type { MemoryHandler } from "../server/mod.ts";
import { type BrowserVault, loginsOf } from "./browser-vault.ts";
import type { SecretStore } from "./secret-store.ts";
import { totpCode } from "./totp.ts";

const INVALID = (message: string) =>
  err({ code: "invalid_input" as const, message });
const NOT_FOUND = err({ code: "not_found" as const, message: "login이 없다" });

type Deps = {
  vault: BrowserVault;
  secrets: Pick<SecretStore, "names" | "get" | "delete">;
};

function listLogins(vault: BrowserVault) {
  const read = vault.read();
  return read.ok ? ok(loginsOf(read.value)) : read;
}

// 탭의 profile. "not_browser"는 profile이 없는 preview·artifact·phone 탭이다(host-queue의 NOT_BROWSER_TAB).
type TabProfile = string | null | "not_browser";
// 다룰 login이 없다. profile id(`bpf_…`)와 겹치지 않는다.
export const NO_LOGINS = "none";

// 탭에서 다룰 login의 profile. browser 탭은 그 탭의 profile이다. browser 탭이 아닌 탭의 login은 기본 profile의 것이고,
// 자기 profile(`own`)이 기본인 쪽(사람, 기본 profile의 agent)만 다룬다. 다른 profile의 agent에게는 NO_LOGINS다.
export function loginProfileOn(
  tab: TabProfile,
  own: () => Result<string | null>,
): Result<string | null | typeof NO_LOGINS> {
  if (tab !== "not_browser") return ok(tab);
  const mine = own();
  if (!mine.ok) return mine;
  return ok(mine.value === null ? null : NO_LOGINS);
}

// 탭 주인은 session id이거나 사람 token의 "person"이다(host-queue의 TabOwner).
export type ProfileDeps = {
  // 부른 쪽 자기 탭의 profile. 없는 탭·남의 탭은 not_found다.
  tabProfile(tab: string, caller: string): Result<TabProfile>;
  // session의 agent 정의가 고른 profile. 없거나 지운 profile이면 null(기본)이고, 정의를 읽지 못하면 오류다.
  agentBrowserProfile(session: string): Result<string | null>;
};

// 볼 login의 profile이다. undefined는 전부(사람이 탭 없이 부를 때)다.
function listedProfile(
  who: AuthenticatedContext,
  tab: string | undefined,
  deps: ProfileDeps,
): Result<string | null | undefined> {
  if (who.actor === "user") {
    if (tab === undefined) return ok(undefined);
    const on = deps.tabProfile(tab, "person");
    return on.ok ? loginProfileOn(on.value, () => ok(null)) : on;
  }
  const session = who.conditions.session;
  if (!who.actor.startsWith("agent:") || session === undefined) {
    return err({ code: "forbidden", message: "only an agent session" });
  }
  if (tab === undefined) return deps.agentBrowserProfile(session);
  const on = deps.tabProfile(tab, session);
  return on.ok
    ? loginProfileOn(on.value, () => deps.agentBrowserProfile(session))
    : on;
}

export function loginsListHandler(deps: Deps & ProfileDeps) {
  const handler: MemoryHandler = async (who, rawInput) => {
    const input = loginsList.input.safeParse(rawInput);
    if (!input.success) return INVALID("login 조회 입력이 올바르지 않다");
    const profile = listedProfile(who, input.data.tab, deps);
    if (!profile.ok) return profile;
    const logins = listLogins(deps.vault);
    if (!logins.ok) return logins;
    const names = deps.secrets.names();
    if (!names.ok) return names;
    const configured = new Set(names.value);
    return ok(
      logins.value
        .filter(
          (l) =>
            (input.data.origin === undefined ||
              l.origin === input.data.origin) &&
            (profile.value === undefined || l.profile === profile.value),
        )
        .map((l) => ({
          ...l,
          totp: configured.has(loginSecretName(l.id, "totp")),
        })),
    );
  };
  return handler;
}

export function loginsSaveHandler(deps: {
  vault: BrowserVault;
  ids: IdSource;
}) {
  const handler: MemoryHandler = async (_ctx, rawInput) => {
    const input = loginsSave.input.safeParse(rawInput);
    if (!input.success) return INVALID("login 입력이 올바르지 않다");
    const { id: given, note, profile, ...fields } = input.data;
    const id = given ?? deps.ids.newId(LOGIN_ID_PREFIX);
    const entry = { ...fields, note: note ?? "" };
    return deps.vault.update((vault, stamp) => {
      if (given === undefined) {
        const revs = {
          label: stamp,
          origin: stamp,
          username: stamp,
          note: stamp,
          password: stamp,
          totp: stamp,
        };
        return ok({
          vault: {
            ...vault,
            logins: [
              ...vault.logins,
              { id, ...entry, ...(profile ? { profile } : {}), revs },
            ],
          },
          value: { id },
        });
      }
      const login = vault.logins.find((l) => l.id === id);
      if (login === undefined) return NOT_FOUND;
      // 고칠 때 profile은 그 login의 것을 그대로 두고, 바뀐 칸만 stamp를 올린다.
      const revs = { ...login.revs };
      for (const field of LOGIN_META_FIELDS) {
        if (login[field] !== entry[field]) revs[field] = stamp;
      }
      return ok({
        vault: {
          ...vault,
          logins: vault.logins.map((l) =>
            l.id === id ? { ...l, ...entry, revs } : l,
          ),
        },
        value: { id },
      });
    });
  };
  return handler;
}

/** login의 값(`login.<id>.<field>`)을 넣거나 지웠다. 그 칸의 stamp를 올린다. 없는 login이면 아무것도 하지 않는다. */
export function touchLoginValue(
  vault: BrowserVault,
  id: string,
  field: LoginField,
): Result<boolean> {
  return vault.update((current, stamp) => {
    const login = current.logins.find((l) => l.id === id);
    if (login === undefined) return ok({ vault: current, value: false });
    return ok({
      vault: {
        ...current,
        logins: current.logins.map((l) =>
          l.id === id ? { ...l, revs: { ...l.revs, [field]: stamp } } : l,
        ),
      },
      value: true,
    });
  });
}

/** login들을 vault에서 빼고 흔적을 남긴다. 흔적의 `seen`은 지울 때 본 칸 stamp다(그보다 새 고침이 오면 되살아난다). */
export function removeLogins(
  vault: VaultFile,
  ids: readonly string[],
  stamp: number,
): VaultFile {
  const gone = new Set(ids);
  return {
    ...vault,
    logins: vault.logins.filter((l) => !gone.has(l.id)),
    removed: [
      ...vault.removed.filter((r) => !gone.has(r.id)),
      ...vault.logins
        .filter((l) => gone.has(l.id))
        .map((l) => ({ id: l.id, at: stamp, seen: { ...l.revs } })),
    ],
  };
}

// 값을 먼저 지우고 metadata를 지운다. 중간에 실패하면 metadata가 남아 다시 지울 수 있다.
export function loginsDeleteHandler(deps: Deps) {
  const handler: MemoryHandler = async (_ctx, rawInput) => {
    const input = loginsDelete.input.safeParse(rawInput);
    if (!input.success) return INVALID("login id가 올바르지 않다");
    const { id } = input.data;
    const logins = listLogins(deps.vault);
    if (!logins.ok) return logins;
    if (!logins.value.some((l) => l.id === id)) return NOT_FOUND;
    for (const field of LOGIN_FIELDS) {
      const deleted = await deps.secrets.delete(loginSecretName(id, field));
      if (!deleted.ok) return deleted;
    }
    return deps.vault.update((current, stamp) =>
      ok({ vault: removeLogins(current, [id], stamp), value: { id } }),
    );
  };
  return handler;
}

export function loginsReleaseHandler(
  deps: Pick<Deps, "vault"> & {
    secrets: Pick<SecretStore, "get">;
    // shell main이 `connect {client: shell}`로 받은 capability만 통과한다.
    capabilities: Pick<ShellCapabilities, "has">;
    clock: Clock;
  },
) {
  const handler: MemoryHandler = async (_ctx, rawInput) => {
    const input = loginsRelease.input.safeParse(rawInput);
    if (!input.success) return INVALID("login release 입력이 올바르지 않다");
    const { id, field, origin, profile, shell_capability } = input.data;
    if (!deps.capabilities.has(shell_capability)) {
      return err({ code: "forbidden", message: "shell capability가 아니다" });
    }
    const logins = listLogins(deps.vault);
    if (!logins.ok) return logins;
    const login = logins.value.find((l) => l.id === id);
    if (login === undefined) return NOT_FOUND;
    // scheme·host·port가 글자 그대로 같을 때만이다. 와일드카드도 상위 도메인도 없다.
    if (login.origin !== origin) {
      return err({
        code: "forbidden",
        message: "저장된 origin과 다른 곳이다",
      });
    }
    // 다른 profile의 탭에는 그 profile의 cookie로 들어간 site가 있다. login은 자기 profile의 탭에만 쳐진다.
    if (login.profile !== profile) {
      return err({
        code: "forbidden",
        message: "저장된 login과 다른 browser profile의 탭이다",
      });
    }
    const value = deps.secrets.get(loginSecretName(id, field));
    if (!value.ok) return value;
    if (field === "password") return ok({ value: value.value });
    const code = totpCode(value.value, deps.clock.nowMs());
    return code === undefined
      ? INVALID("TOTP seed가 올바르지 않다")
      : ok({ value: code });
  };
  return handler;
}
