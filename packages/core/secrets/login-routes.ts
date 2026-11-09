// logins/list·save·delete·release handler. 값은 release 응답에만 있고 오류·log·다른 결과에는 없다.
import { err, ok, type Clock, type IdSource } from "../../base/mod.ts";
import {
  LOGIN_ID_PREFIX,
  loginsDelete,
  loginsList,
  loginsRelease,
  loginsSave,
  loginSecretName,
  LOGIN_FIELDS,
} from "../../protocol/secrets/mod.ts";
import type { ShellCapabilities } from "../server/control/capability.ts";
import type { MemoryHandler } from "../server/mod.ts";
import type { LoginStore } from "./logins.ts";
import type { SecretStore } from "./secret-store.ts";
import { totpCode } from "./totp.ts";

const INVALID = (message: string) =>
  err({ code: "invalid_input" as const, message });
const NOT_FOUND = err({ code: "not_found" as const, message: "login이 없다" });

type Deps = {
  logins: LoginStore;
  secrets: Pick<SecretStore, "names" | "get" | "delete">;
};

export function loginsListHandler(deps: Deps) {
  const handler: MemoryHandler = async (_ctx, rawInput) => {
    const input = loginsList.input.safeParse(rawInput);
    if (!input.success) return INVALID("login 조회 입력이 올바르지 않다");
    const logins = await deps.logins.list();
    if (!logins.ok) return logins;
    const names = deps.secrets.names();
    if (!names.ok) return names;
    const configured = new Set(names.value);
    return ok(
      logins.value
        .filter(
          (l) =>
            input.data.origin === undefined || l.origin === input.data.origin,
        )
        .map((l) => ({
          ...l,
          totp: configured.has(loginSecretName(l.id, "totp")),
        })),
    );
  };
  return handler;
}

export function loginsSaveHandler(deps: { logins: LoginStore; ids: IdSource }) {
  const handler: MemoryHandler = async (_ctx, rawInput) => {
    const input = loginsSave.input.safeParse(rawInput);
    if (!input.success) return INVALID("login 입력이 올바르지 않다");
    const { id: given, note, ...fields } = input.data;
    const id = given ?? deps.ids.newId(LOGIN_ID_PREFIX);
    return await deps.logins.update((logins) => {
      const entry = { id, ...fields, note: note ?? "" };
      if (given === undefined) {
        return ok({ logins: [...logins, entry], value: { id } });
      }
      if (!logins.some((l) => l.id === id)) return NOT_FOUND;
      return ok({
        logins: logins.map((l) => (l.id === id ? entry : l)),
        value: { id },
      });
    });
  };
  return handler;
}

// 값을 먼저 지우고 metadata를 지운다. 중간에 실패하면 metadata가 남아 다시 지울 수 있다.
export function loginsDeleteHandler(deps: Deps) {
  const handler: MemoryHandler = async (_ctx, rawInput) => {
    const input = loginsDelete.input.safeParse(rawInput);
    if (!input.success) return INVALID("login id가 올바르지 않다");
    const { id } = input.data;
    const logins = await deps.logins.list();
    if (!logins.ok) return logins;
    if (!logins.value.some((l) => l.id === id)) return NOT_FOUND;
    for (const field of LOGIN_FIELDS) {
      const deleted = await deps.secrets.delete(loginSecretName(id, field));
      if (!deleted.ok) return deleted;
    }
    return await deps.logins.update((current) =>
      ok({ logins: current.filter((l) => l.id !== id), value: { id } }),
    );
  };
  return handler;
}

export function loginsReleaseHandler(
  deps: Pick<Deps, "logins"> & {
    secrets: Pick<SecretStore, "get">;
    // shell main이 `connect {client: shell}`로 받은 capability만 통과한다.
    capabilities: Pick<ShellCapabilities, "has">;
    clock: Clock;
  },
) {
  const handler: MemoryHandler = async (_ctx, rawInput) => {
    const input = loginsRelease.input.safeParse(rawInput);
    if (!input.success) return INVALID("login release 입력이 올바르지 않다");
    const { id, field, origin, shell_capability } = input.data;
    if (!deps.capabilities.has(shell_capability)) {
      return err({ code: "forbidden", message: "shell capability가 아니다" });
    }
    const logins = await deps.logins.list();
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
