// Linux Secret Service adapter(계획 Q7).
// secret-tool만 쓰고 값은 stdin으로만 보낸다. argv·환경 변수·파일에는 두지 않는다.
// macOS·Windows adapter는 범위 밖이다.

import { err, ok, type Result } from "../../../base/mod.ts";
import type { SecretPurpose } from "../../../protocol/secrets/mod.ts";
import {
  KEYCHAIN_NOT_FOUND,
  KEYCHAIN_UNAVAILABLE,
  type KeychainAdapter,
  type KeychainItem,
  type KeychainStatus,
} from "./keychain.ts";

// 실행 권한을 절대 경로로만 받는 child(I/O worker)가 secret-tool을 부르는 후보. 그 child의
// launch spec allow_run과 같은 목록이다.
export const SECRET_TOOL_PATHS: readonly string[] = [
  "/usr/bin/secret-tool",
  "/usr/local/bin/secret-tool",
];

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
      const ref = item.ref ?? options.randomRef();
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
    async listRefs(purpose, prefix): Promise<Result<readonly string[]>> {
      // search는 항목의 secret도 stdout에 낸다. 참조 줄만 읽고 bytes는 바로 지운다.
      const found = await runner.run([
        "search",
        "--all",
        "lophn_purpose",
        purpose,
      ]);
      if (!found.ok) return err(KEYCHAIN_UNAVAILABLE);
      const text = new TextDecoder().decode(found.value.stdout);
      found.value.stdout.fill(0);
      const refs: string[] = [];
      for (const match of text.matchAll(/^attribute\.lophn_ref = (.+)$/gm)) {
        if (match[1].startsWith(prefix)) refs.push(match[1]);
      }
      return ok(refs);
    },
    async remove(sealedRef: string): Promise<Result<void>> {
      const removed = await runner.run(["clear", ATTR_REF, sealedRef]);
      if (!removed.ok) return err(KEYCHAIN_UNAVAILABLE);
      if (removed.value.code !== 0) return err(KEYCHAIN_NOT_FOUND);
      // clear가 성공해도 실제 부재를 다시 확인한다.
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
// commands는 secret-tool 실행 파일 후보다. 처음 실행되는 것을 쓴다. 실행 권한을 절대 경로로만
// 받는 child(I/O worker)는 절대 경로 후보를 넘긴다.
export function secretToolRunner(
  commands: readonly string[] = ["secret-tool"],
): SecretToolRunner {
  return {
    async run(args, stdin) {
      for (const executable of commands) {
        let child: Deno.ChildProcess;
        try {
          child = new Deno.Command(executable, {
            args: [...args],
            stdin: stdin === undefined ? "null" : "piped",
            stdout: "piped",
            stderr: "null",
            clearEnv: true,
            env: sessionEnv((name) => Deno.env.get(name)),
          }).spawn();
        } catch {
          // 이 후보는 실행되지 않는다. 다음 후보를 본다.
          continue;
        }
        try {
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
      }
      return err(KEYCHAIN_UNAVAILABLE);
    },
  };
}

export function randomSealedRef(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
