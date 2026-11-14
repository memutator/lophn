import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { remoteUiFiles } from "./remote.ts";

// 기기가 부르는 `remote_ui/file`은 화면 bundle 폴더 안의 file만 내준다. 밖의 file 내용은 답에 들지 않는다.
test("remote ui file never serves a file outside the bundle folder", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "lophn-remote-ui-"));
  try {
    const bundle = `${tmp}/remote`;
    await mkdir(`${bundle}/chunks`, { recursive: true });
    await writeFile(`${bundle}/remote.js`, "export {};");
    await writeFile(`${tmp}/secret.txt`, "SECRET");
    // file symlink는 Windows에서 개발자 모드나 관리자 권한이 있어야 만들어진다. 없으면 건너뛴다.
    try {
      await symlink(`${tmp}/secret.txt`, `${bundle}/out.txt`);
    } catch (thrown) {
      if (process.platform !== "win32") throw thrown;
      return t.skip("Windows에서 symlink 권한이 없다(개발자 모드 꺼짐)");
    }
    await symlink(tmp, `${bundle}/outdir`, "junction");

    const files = remoteUiFiles(bundle);
    const ctx = {} as never;
    const fetch = async (path: string) => {
      const answer = await files(ctx, { path });
      if (!answer.ok) return { code: answer.error.code };
      const text = await new Response(answer.value.body).text();
      return { text, contentType: answer.value.contentType };
    };

    assert.deepStrictEqual(await fetch("remote.js"), {
      text: "export {};",
      contentType: "text/javascript",
    });
    const cases: [string, string, string][] = [
      ["dotdot", "../secret.txt", "invalid_input"],
      ["absolute", `${tmp}/secret.txt`, "invalid_input"],
      ["percent encoded dotdot", "%2e%2e/secret.txt", "not_found"],
      ["symlink file out", "out.txt", "not_found"],
      ["symlink dir out", "outdir/secret.txt", "not_found"],
      ["the folder itself", ".", "invalid_input"],
      ["a folder inside", "chunks", "not_found"],
      ["missing file", "nope.js", "not_found"],
    ];
    for (const [name, path, code] of cases) {
      assert.deepStrictEqual(await fetch(path), { code }, name);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
