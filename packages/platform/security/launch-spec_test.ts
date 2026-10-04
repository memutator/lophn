import { assert, assertEquals } from "@std/assert";
import { checkLaunchSpec, launchArgv } from "./launch-spec.ts";

const entry = "/opt/lophn/platform/worker.ts";

function spec(over: Record<string, unknown> = {}) {
  return {
    kind: "platform/io",
    entry,
    allow_read: ["/opt/lophn"],
    allow_write: ["/home/user/.lophn/blobs"],
    allow_net: ["127.0.0.1:7431"],
    allow_run: ["/opt/lophn/deno"],
    allow_env: ["LOPHN_HOME"],
    policy: "always",
    memory_limit_bytes: 512 * 1024 * 1024,
    ...over,
  };
}

Deno.test("platform/security#R1: 좁힌 절대 경로 spec만 통과하고 argv에 credential이 없다", () => {
  const checked = checkLaunchSpec(spec());
  assert(checked.ok);
  const argv = launchArgv(checked.value);
  assertEquals(argv.slice(0, 4), [
    "run",
    "--cached-only",
    "--frozen",
    "--no-prompt",
  ]);
  assert(argv.includes("--allow-read=/opt/lophn"));
  assert(argv.includes("--allow-env=LOPHN_HOME"));
  assertEquals(argv.at(-1), entry);
  const joined = argv.join(" ");
  assert(!joined.includes("credential"));
  assert(!joined.includes("token"));
});

Deno.test("platform/security#R3: 전체 허용·ffi·와일드카드·상대 경로 entry를 거절한다", () => {
  const rejected = [
    spec({ allow_read: ["*"] }),
    spec({ allow_write: ["*"] }),
    spec({ allow_net: ["*"] }),
    spec({ allow_run: ["/opt/*"] }),
    spec({ entry: "worker.ts" }),
    spec({ entry: "/opt/lophn/worker.ts --allow-all" }),
    spec({ allow_read: ["blobs"] }),
    spec({ allow_net: ["*"] }),
    spec({ allow_env: [""] }),
    spec({ allow_env: ["PATH=secret"] }),
    spec({ allow_read: ["/opt/lophn --allow-all"] }),
    spec({ allow_net: ["127.0.0.1 --allow-ffi"] }),
  ];
  for (const input of rejected) assert(!checkLaunchSpec(input).ok);

  const empty = checkLaunchSpec(
    spec({ allow_read: [], allow_write: [], allow_net: [], allow_run: [] }),
  );
  assert(empty.ok);
  const argv = launchArgv(empty.value);
  assert(!argv.some((arg) => arg.startsWith("--allow-read")));
  assert(!argv.some((arg) => arg.startsWith("--allow-write")));
  assert(!argv.some((arg) => arg.startsWith("--allow-net")));
  assert(!argv.some((arg) => arg.includes("--allow-all")));
  assert(!argv.some((arg) => arg.includes("--allow-ffi")));
});

Deno.test("platform/security#R2: spec은 kind의 선언 범위를 검사할 뿐 격리를 끌 수 없다", () => {
  const turned = checkLaunchSpec(spec({ policy: "unrestricted" }));
  assert(!turned.ok);
  const ffi = checkLaunchSpec({ ...spec(), allow_ffi: true });
  assert(!ffi.ok);
});
