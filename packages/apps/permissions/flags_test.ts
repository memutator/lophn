import { assert, assertEquals } from "@std/assert";
import {
  appFlags,
  type AppPaths,
  LIMIT_KEYS,
  migrationFlags,
  type PlatformPorts,
  type ResolvedRequirement,
  socketFlags,
} from "./mod.ts";

const app: AppPaths = {
  bundle: "/apps/self/bundle",
  data: "/apps/self/data",
  brokerSocket: "/run/b.sock",
  directSocket: "/run/a.sock",
};
const platform: PlatformPorts = { ports: [4517, 4600] };
const denies = ["/home/owner/.ssh", "/home/owner/.lophn"];

const FORBIDDEN = [
  "--allow-all",
  "-A",
  "--allow-run",
  "--allow-ffi",
  "--allow-sys",
  "--allow-env",
  "--prompt",
];
const REQUIRED = [
  "--no-prompt",
  "--no-remote",
  "--no-npm",
  "--cached-only",
  "--no-config",
];

function read(path: string, recursive = false): ResolvedRequirement {
  return {
    kind: "fs.read",
    scope: { path, recursive, outsideLinks: [] },
    reason: "read",
  };
}

function has(args: readonly string[], name: string): boolean {
  return args.some((arg) =>
    arg === name || arg.startsWith(`${name}=`) || arg.startsWith(`${name},`)
  );
}

Deno.test("apps/permissions#R18: generated flags ban broad grants and keep the fixed boundary", () => {
  const flags = appFlags([read("/data/notes.txt")], app, platform, denies);
  assert(flags.ok);
  if (!flags.ok) return;
  for (const flag of FORBIDDEN) assert(!has(flags.value.args, flag));
  for (const flag of REQUIRED) assert(flags.value.args.includes(flag));
  assert(flags.value.args.some((arg) => arg.startsWith("--allow-read=")));
  // 앱 두 socket과 가상 host 말고는 net 허락이 없다(runtime#R8).
  assertEquals(
    flags.value.args.filter((arg) => arg.startsWith("--allow-net")),
    ["--allow-net=lophn.invalid,unix:/run/a.sock,unix:/run/b.sock"],
  );
});

Deno.test("apps/permissions#R18: migration flags allow only the bundle read and the app data area", () => {
  const flags = migrationFlags(app, denies);
  assert(flags.ok);
  if (!flags.ok) return;
  const read = flags.value.args.find((arg) => arg.startsWith("--allow-read="));
  const write = flags.value.args.find((arg) =>
    arg.startsWith("--allow-write=")
  );
  assertEquals(read, "--allow-read=/apps/self/bundle,/apps/self/data");
  assertEquals(write, "--allow-write=/apps/self/data");
  for (const flag of FORBIDDEN) assert(!has(flags.value.args, flag));
  assert(!flags.value.args.some((arg) => arg.startsWith("--allow-net=")));
});

Deno.test("apps/permissions#R11: platform ports are denied on every loopback spelling", () => {
  const flags = appFlags([], app, platform, denies);
  assert(flags.ok);
  if (!flags.ok) return;
  const denied = flags.value.args.find((arg) => arg.startsWith("--deny-net="));
  assertEquals(
    denied,
    "--deny-net=127.0.0.1:4517,127.0.0.1:4600,::1:4517,::1:4600,localhost:4517,localhost:4600",
  );
});

Deno.test("apps/permissions#R11: net.listen is rejected instead of a broad net flag", () => {
  const listen: ResolvedRequirement = {
    kind: "net.listen",
    scope: { host: "127.0.0.1", port: 1455 },
    reason: "callback",
  };
  const flags = appFlags([listen], app, platform, denies);
  assert(!flags.ok);
  if (!flags.ok) assertEquals(flags.error.code, "forbidden");
});

Deno.test("apps/permissions#R19: net.fetch and secret add no net or env flag", () => {
  const fetch: ResolvedRequirement = {
    kind: "net.fetch",
    scope: { host: "example.com", port: 443 },
    reason: "fetch",
  };
  const secret: ResolvedRequirement = {
    kind: "secret.use",
    scope: { name: "calendar.token" },
    reason: "secret",
  };
  const flags = appFlags([fetch, secret], app, platform, denies);
  assert(flags.ok);
  if (!flags.ok) return;
  // 외부 host는 flag에 없다. 두 socket과 가상 host뿐이다.
  assertEquals(
    flags.value.args.filter((arg) => arg.startsWith("--allow-net")),
    ["--allow-net=lophn.invalid,unix:/run/a.sock,unix:/run/b.sock"],
  );
  assert(!flags.value.args.some((arg) => arg.includes("example.com")));
  assert(!flags.value.args.some((arg) => arg.startsWith("--allow-env")));
});

Deno.test("apps/blueprint#R9: effect does not change the flags of the same app", () => {
  const first = appFlags([read("/data/notes.txt")], app, platform, denies);
  const second = appFlags([read("/data/notes.txt")], app, platform, denies);
  assert(first.ok && second.ok);
  if (first.ok && second.ok) assertEquals(first.value.args, second.value.args);
});

Deno.test("apps/permissions#R6: an outside link becomes a deny of the granted kind", () => {
  const granted: ResolvedRequirement = {
    kind: "fs.read",
    scope: {
      path: "/data/box",
      recursive: true,
      outsideLinks: ["/data/box/escape"],
    },
    reason: "box",
  };
  const flags = appFlags([granted], app, platform, denies);
  assert(flags.ok);
  if (!flags.ok) return;
  const denied = flags.value.args.find((arg) => arg.startsWith("--deny-read="));
  assert(denied?.includes("/data/box/escape"));
  assert(denied?.includes("/home/owner/.ssh"));
});

Deno.test("apps/permissions#R25: the six limit keys are the grant display material", () => {
  assertEquals(LIMIT_KEYS, [
    "permissions.limit.not-isolated",
    "permissions.limit.granted-path-secrets",
    "permissions.limit.symlink-changes",
    "permissions.limit.cpu",
    "permissions.limit.rss",
    "permissions.limit.disk",
  ]);
  const flags = appFlags([], app, platform, denies);
  assert(flags.ok);
  if (flags.ok) assertEquals(flags.value.limits, LIMIT_KEYS);
});

Deno.test("apps/permissions#R18: a recursive directory grant and an unscoped read are separate flags", () => {
  const directory: ResolvedRequirement = {
    kind: "fs.write",
    scope: { path: "/data/box", recursive: true, outsideLinks: [] },
    reason: "write box",
  };
  const flags = appFlags(
    [read("/data/notes.txt"), directory],
    app,
    platform,
    denies,
  );
  assert(flags.ok);
  if (!flags.ok) return;
  const write = flags.value.args.find((arg) =>
    arg.startsWith("--allow-write=")
  );
  assert(write?.includes("/data/box"));
  assert(!flags.value.args.some((arg) => arg.startsWith("--allow-run")));
  assert(!flags.value.args.some((arg) => arg.startsWith("--allow-ffi")));
});

Deno.test("apps/runtime#R8: socket은 시작마다 정해지므로 flag 계산은 socket 없이도 되고 socketFlags가 더한다", () => {
  const flags = appFlags([], { bundle: "/b", data: "/d" }, platform, denies);
  assert(flags.ok);
  if (!flags.ok) return;
  // socket 경로를 모르면 net 허락도 socket 읽기·쓰기도 넣지 않는다.
  assert(!flags.value.args.some((arg) => arg.startsWith("--allow-net")));
  assertEquals(
    flags.value.args.find((arg) => arg.startsWith("--allow-read=")),
    "--allow-read=/b,/d",
  );
  const sockets = socketFlags({
    brokerSocket: "/run/lophn/b-1.sock",
    directSocket: "/run/lophn/a-1.sock",
  });
  assert(sockets.ok);
  if (!sockets.ok) return;
  assertEquals(sockets.value, [
    "--allow-read=/run/lophn/a-1.sock,/run/lophn/b-1.sock",
    "--allow-write=/run/lophn/a-1.sock,/run/lophn/b-1.sock",
    "--allow-net=lophn.invalid,unix:/run/lophn/a-1.sock,unix:/run/lophn/b-1.sock",
  ]);
  // 외부 host와 와일드카드는 이 flag에 없다.
  assert(!sockets.value.some((arg) => arg.includes("*")));
  // 쉼표가 든 경로는 한 항목이 아니라 거절한다.
  const bad = socketFlags({ brokerSocket: "/a,/b", directSocket: "/c" });
  assert(!bad.ok);
});
