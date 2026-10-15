import { assertEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import { createScreenFileDeps, serveScreenFile } from "./mod.ts";

// 화면 byte 요청은 그 screen 폴더 안의 파일만 내주고, `..`·절대 경로·밖을 가리키는 symlink·
// 다른 screen·폴더는 모두 거절한다.
Deno.test("screen file requests only serve files inside that screen folder", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const bundle = `${tmp}/bundle`;
    await Deno.mkdir(`${bundle}/screens/main/assets`, { recursive: true });
    await Deno.mkdir(`${bundle}/screens/other`, { recursive: true });
    await Deno.writeTextFile(`${bundle}/screens/main/index.html`, "<p>hi</p>");
    await Deno.writeTextFile(`${bundle}/screens/main/assets/a.js`, "1");
    await Deno.writeTextFile(`${bundle}/screens/main/big.png`, "x".repeat(20));
    await Deno.writeTextFile(`${bundle}/screens/other/secret.html`, "other");
    await Deno.writeTextFile(`${bundle}/manifest.json`, "{}");
    await Deno.writeTextFile(`${tmp}/outside.txt`, "outside");
    await Deno.symlink(`${tmp}/outside.txt`, `${bundle}/screens/main/out.txt`);
    await Deno.symlink(`${tmp}/`, `${bundle}/screens/main/outdir`);
    await Deno.symlink(
      `${bundle}/screens/other/secret.html`,
      `${bundle}/screens/main/other.html`,
    );
    await Deno.symlink(
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
    assertEquals(
      index.ok && new TextDecoder().decode(index.value.bytes),
      "<p>hi</p>",
    );
    assertEquals(
      index.ok && index.value.contentType,
      "text/html; charset=utf-8",
    );
    assertEquals((await serve("main", "assets/a.js")).ok, true);
    assertEquals((await serve("main", "inside.html")).ok, true);

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
      assertEquals(await code(screen, path), want, name);
    }
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
