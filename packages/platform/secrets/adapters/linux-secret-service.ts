// Linux Secret Service adapter(platform/secrets#R1, R8, 계획 Q7).
// secret-tool만 쓰고 값은 stdin으로만 보낸다. argv·환경 변수·파일에는 두지 않는다.
// macOS·Windows adapter는 범위 밖이다.

import { err, ok, type Result } from "../../../base/mod.ts";
import type { SecretPurpose } from "../../../contracts/platform/mod.ts";
import {
  KEYCHAIN_NOT_FOUND,
  KEYCHAIN_UNAVAILABLE,
  type KeychainAdapter,
  type KeychainItem,
  type KeychainStatus,
} from "./keychain.ts";

const LABEL_PREFIX = "lophn secret";
const ATTR_REF = "lophn_ref";

export type SecretToolRunner = {
  // 값은 argv·env에 없고 stdin으로만 간다. stdout bytes만 돌려준다.
  run(
    args: readonly string[],
    stdin?: Uint8Array,
  ): Promise<Result<{ code: number; stdout: Uint8Array }>>;
};

export function createLinuxSecretServiceAdapter(options: {
  runner: SecretToolRunner;
  // 참조는 값과 무관한 무작위 hex다.
  randomRef: () => string;
}): KeychainAdapter {
  const { runner } = options;

  const attributes = (ref: string, purpose: SecretPurpose, owner: string) => [
    `${ATTR_REF}`,
    ref,
    "lophn_purpose",
    purpose,
    "lophn_owner",
    owner,
  ];

  return {
    async status(): Promise<KeychainStatus> {
      const probed = await runner.run(["search", ATTR_REF, "lophn-probe"]);
      if (!probed.ok) return "unavailable";
      // secret-tool은 항목이 없어도 0이 아닌 코드로 끝난다. 실행 자체가 되면 쓸 수 있다.
      return "available";
    },
    async store(item: KeychainItem): Promise<Result<string>> {
      const ref = options.randomRef();
      const stored = await runner.run([
        "store",
        "--label",
        `${LABEL_PREFIX} ${item.name}`,
        ...attributes(ref, item.purpose, item.owner),
      ], item.value);
      return stored.ok && stored.value.code === 0
        ? ok(ref)
        : err(KEYCHAIN_UNAVAILABLE);
    },
    async load(sealedRef: string): Promise<Result<Uint8Array>> {
      const loaded = await runner.run(["lookup", ATTR_REF, sealedRef]);
      if (!loaded.ok || loaded.value.code !== 0) return err(KEYCHAIN_NOT_FOUND);
      return ok(loaded.value.stdout);
    },
    async remove(sealedRef: string): Promise<Result<void>> {
      const removed = await runner.run(["clear", ATTR_REF, sealedRef]);
      if (!removed.ok) return err(KEYCHAIN_UNAVAILABLE);
      if (removed.value.code !== 0) return err(KEYCHAIN_NOT_FOUND);
      // clear가 성공해도 실제 부재를 다시 확인한다(R7).
      const still = await runner.run(["lookup", ATTR_REF, sealedRef]);
      if (!still.ok) return err(KEYCHAIN_UNAVAILABLE);
      return still.value.code === 0 ? err(KEYCHAIN_UNAVAILABLE) : ok(undefined);
    },
  };
}

// session bus를 찾는 데 필요한 값만 넘긴다. secret 값은 env에 없다.
const SESSION_ENV = ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "PATH"];

export function sessionEnv(
  read: (name: string) => string | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of SESSION_ENV) {
    const value = read(name);
    if (value !== undefined) env[name] = value;
  }
  return env;
}

// 제품 실행. 값은 secret-tool stdin으로만 보내고 자식 env는 session bus 주소만 남긴다.
export function secretToolRunner(): SecretToolRunner {
  return {
    async run(args, stdin) {
      try {
        const command = new Deno.Command("secret-tool", {
          args: [...args],
          stdin: stdin === undefined ? "null" : "piped",
          stdout: "piped",
          stderr: "null",
          clearEnv: true,
          env: sessionEnv((name) => Deno.env.get(name)),
        });
        const child = command.spawn();
        if (stdin !== undefined) {
          const writer = child.stdin.getWriter();
          try {
            await writer.write(stdin);
          } finally {
            await writer.close();
          }
        }
        const [status, stdout] = await Promise.all([
          child.status,
          child.stdout.bytes(),
        ]);
        return ok({ code: status.code, stdout });
      } catch {
        return err(KEYCHAIN_UNAVAILABLE);
      }
    },
  };
}

export function randomSealedRef(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
