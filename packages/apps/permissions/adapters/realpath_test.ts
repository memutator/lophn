import { assert, assertEquals } from "@std/assert";
import { realPathResolver, resolveRequirement } from "../mod.ts";
import type { ProtectedRoots } from "../mod.ts";

// Deno 2.9.7에서 --allow-read/--allow-write만 준 하위 프로세스는
// Deno.symlink, Deno.link, node:fs symlink/link를 모두 NotCapable로 거절한다.
// 여기서는 그 flag로 실제 프로세스를 띄워 확인한다.

Deno.test("apps/permissions#R6: the realpath adapter resolves a tilde and reports an outside link", async () => {
  const root = await Deno.makeTempDir({ prefix: "apps-permissions-" });
  try {
    const home = `${root}/home`;
    const base = `${root}/work`;
    const box = `${home}/box`;
    const outside = `${root}/outside`;
    await Deno.mkdir(box, { recursive: true });
    await Deno.mkdir(base, { recursive: true });
    await Deno.mkdir(outside);
    await Deno.writeTextFile(`${outside}/secret.txt`, "x");
    await Deno.symlink(`${outside}/secret.txt`, `${box}/escape`);
    const paths = realPathResolver(home, base);
    const resolved = await paths.realPath("~/box");
    assertEquals(resolved, box);
    const links = await paths.linksIn(box);
    assertEquals(links, [{
      link: `${box}/escape`,
      target: `${outside}/secret.txt`,
    }]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("apps/permissions#R7: a directory whose link points at a protected root is rejected", async () => {
  const root = await Deno.makeTempDir({ prefix: "apps-permissions-" });
  try {
    const box = `${root}/box`;
    const ssh = `${root}/ssh`;
    await Deno.mkdir(box);
    await Deno.mkdir(ssh);
    await Deno.writeTextFile(`${ssh}/id`, "key");
    await Deno.symlink(`${ssh}/id`, `${box}/key`);
    const roots: ProtectedRoots = {
      credentialRoots: [ssh],
      dataRoot: `${root}/data`,
      appRoots: [],
      sourceRoots: [],
    };
    await Deno.mkdir(roots.dataRoot);
    const result = await resolveRequirement(
      { kind: "fs.read", scope: { path: box, recursive: true }, reason: "box" },
      roots,
      realPathResolver(root, root),
    );
    assert(!result.ok);
    if (!result.ok) assertEquals(result.error.code, "forbidden");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("apps/permissions#R18: the app cannot create a symlink or a hard link", async () => {
  const root = await Deno.makeTempDir({ prefix: "apps-permissions-" });
  const scratch = await Deno.makeTempDir({ prefix: "apps-permissions-child-" });
  try {
    const allowed = `${root}/allowed`;
    const target = `${root}/target`;
    await Deno.mkdir(allowed);
    await Deno.mkdir(target);
    await Deno.writeTextFile(`${target}/file.txt`, "x");
    const child = `${scratch}/link-child.ts`;
    await Deno.writeTextFile(
      child,
      `
import { link, symlink } from "node:fs/promises";
import { linkSync, symlinkSync } from "node:fs";
const [allowed, target] = Deno.args;
const attempts: [string, () => unknown | Promise<unknown>][] = [
  ["Deno.symlink", () => Deno.symlink(target, allowed + "/deno-symlink")],
  ["node:fs/promises.symlink", () => symlink(target, allowed + "/node-async-symlink")],
  ["node:fs.symlinkSync", () => symlinkSync(target, allowed + "/node-sync-symlink")],
  ["Deno.link", () => Deno.link(target + "/file.txt", allowed + "/deno-link")],
  ["node:fs/promises.link", () => link(target + "/file.txt", allowed + "/node-async-link")],
  ["node:fs.linkSync", () => linkSync(target + "/file.txt", allowed + "/node-sync-link")],
];
for (const [name, call] of attempts) {
  try {
    await call();
    console.log(JSON.stringify({ name, accepted: true }));
  } catch (error) {
    console.log(JSON.stringify({ name, accepted: false, error: (error as Error).name }));
  }
}
`,
    );
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-config",
        "--no-prompt",
        "--no-npm",
        "--no-remote",
        "--cached-only",
        `--allow-read=${allowed}`,
        `--allow-write=${allowed}`,
        child,
        allowed,
        target,
      ],
      clearEnv: true,
      stdout: "piped",
      stderr: "piped",
      stdin: "null",
    }).output();
    assert(output.success, new TextDecoder().decode(output.stderr));
    const lines = new TextDecoder().decode(output.stdout).trim().split("\n");
    assertEquals(lines.length, 6);
    for (const line of lines) {
      const result = JSON.parse(line) as { accepted: boolean; error: string };
      assertEquals(result.accepted, false);
      assertEquals(result.error, "NotCapable");
    }
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(scratch, { recursive: true });
  }
});
