import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import { createScreenFileDeps } from "./mod.ts";
import { readAppIcon } from "./icon.ts";

// icon은 bundle 안의 이미지 파일만 준다. bundle 밖을 가리키는 symlink, `..`, 큰 파일은 null이다.
test("app icon read only serves image files inside the bundle", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "lophn-icon-"));
  try {
    const bundle = `${tmp}/bundle`;
    await mkdir(`${bundle}/assets`, { recursive: true });
    await writeFile(`${bundle}/assets/icon.svg`, "<svg/>");
    await writeFile(`${bundle}/assets/big.png`, "x".repeat(64 * 1024 + 1));
    await writeFile(`${tmp}/secret.png`, "outside");
    await symlink(`${tmp}/secret.png`, `${bundle}/assets/out.png`);

    const read = async (path: string | null) => {
      const result = await readAppIcon(
        {
          ...createScreenFileDeps({ dir: () => ok(bundle) }),
          iconPath: () => ok(path),
        },
        "app_x",
      );
      assert.ok(result.ok);
      return result.value;
    };

    assert.deepStrictEqual(await read("/assets/icon.svg"), {
      content_type: "image/svg+xml",
      data: Buffer.from("<svg/>").toString("base64"),
    });
    for (const path of [
      null,
      "/assets/out.png",
      "/../secret.png",
      "/assets/big.png",
      "/assets/missing.png",
      "/assets/icon.txt",
    ]) {
      assert.strictEqual(await read(path), null, String(path));
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
