import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import { createScreenFileDeps, serveScreenFile } from "./mod.ts";

// 화면 byte 요청은 그 screen 폴더 안의 파일만 내주고, `..`·절대 경로·밖을 가리키는 symlink·
// 다른 screen·폴더는 모두 거절한다.
test("screen file requests only serve files inside that screen folder", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "lophn-screens-"));
  try {
    const bundle = `${tmp}/bundle`;
    await mkdir(`${bundle}/screens/main/assets`, { recursive: true });
    await mkdir(`${bundle}/screens/other`, { recursive: true });
    await writeFile(`${bundle}/screens/main/index.html`, "<p>hi</p>");
    await writeFile(`${bundle}/screens/main/assets/a.js`, "1");
    await writeFile(`${bundle}/screens/main/big.png`, "x".repeat(20));
    await writeFile(`${bundle}/screens/other/secret.html`, "other");
    await writeFile(`${bundle}/manifest.json`, "{}");
    await writeFile(`${tmp}/outside.txt`, "outside");
    await symlink(`${tmp}/outside.txt`, `${bundle}/screens/main/out.txt`);
    await symlink(`${tmp}/`, `${bundle}/screens/main/outdir`);
    await symlink(
      `${bundle}/screens/other/secret.html`,
      `${bundle}/screens/main/other.html`,
    );
    await symlink(
      `${bundle}/screens/main/index.html`,
      `${bundle}/screens/main/inside.html`,
    );

    const target = { mode: "live", release: null, app: "app_x" } as never;
    const deps = {
      ...createScreenFileDeps({ dir: () => ok(bundle) }, 10),
    };
    const serve = (screen: string, path: string) =>
      serveScreenFile(deps, { target, screen, path });

    const index = await serve("main", "index.html");
    assert.deepStrictEqual(
      index.ok && new TextDecoder().decode(index.value.bytes),
      "<p>hi</p>",
    );
    assert.deepStrictEqual(
      index.ok && index.value.contentType,
      "text/html; charset=utf-8",
    );
    assert.deepStrictEqual((await serve("main", "assets/a.js")).ok, true);
    assert.deepStrictEqual((await serve("main", "inside.html")).ok, true);

    const code = async (screen: string, path: string) => {
      const r = await serve(screen, path);
      return r.ok ? "ok" : r.error.code;
    };
    const rows: [string, string, string, string][] = [
      ["dotdot path", "main", "../other/secret.html", "invalid_input"],
      ["dotdot to manifest", "main", "../../manifest.json", "invalid_input"],
      ["absolute", "main", `${tmp}/outside.txt`, "invalid_input"],
      ["backslash", "main", "assets\\a.js", "invalid_input"],
      ["colon", "main", "c:/x", "invalid_input"],
      ["empty screen", "", "index.html", "invalid_input"],
      ["dotdot screen", "..", "manifest.json", "invalid_input"],
      ["dot screen", ".", "other/secret.html", "invalid_input"],
      ["slash screen", "main/assets", "a.js", "invalid_input"],
      ["symlink file out", "main", "out.txt", "not_found"],
      ["symlink dir out", "main", "outdir/outside.txt", "not_found"],
      ["symlink to other screen", "main", "other.html", "not_found"],
      ["directory", "main", "assets", "not_found"],
      ["over size limit", "main", "big.png", "not_found"],
      ["missing file", "main", "nope.html", "not_found"],
      ["missing screen", "ghost", "index.html", "not_found"],
    ];
    for (const [name, screen, path, want] of rows) {
      assert.deepStrictEqual(await code(screen, path), want, name);
    }
  } finally {
    await rm(tmp, { recursive: true });
  }
});
