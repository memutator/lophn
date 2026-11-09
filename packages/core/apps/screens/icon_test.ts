import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import { appIconRead } from "../routes.ts";
import { readAppIcon } from "./icon.ts";
import { createScreenFileDeps } from "./mod.ts";

// icon은 bundle 안의 이미지 파일이나 선언한 lucide 이름만 준다. bundle 밖을 가리키는 symlink, `..`, 큰 파일은 null이다.
test("app icon read only serves image files inside the bundle", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "lophn-icon-"));
  try {
    const bundle = `${tmp}/bundle`;
    await mkdir(`${bundle}/assets`, { recursive: true });
    await writeFile(`${bundle}/assets/icon.svg`, "<svg/>");
    await writeFile(`${bundle}/assets/big.png`, "x".repeat(64 * 1024 + 1));
    await writeFile(`${tmp}/secret.png`, "outside");
    // symlink는 Windows에서 개발자 모드나 관리자 권한이 있어야 만들어진다. 없으면 건너뛴다.
    try {
      await symlink(`${tmp}/secret.png`, `${bundle}/assets/out.png`);
    } catch (thrown) {
      if (process.platform !== "win32") throw thrown;
      return t.skip("Windows에서 symlink 권한이 없다(개발자 모드 꺼짐)");
    }

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
    // lucide 이름은 파일을 읽지 않고 이름 그대로 준다.
    assert.deepStrictEqual(await read("lucide:folder-kanban"), {
      lucide: "folder-kanban",
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

const APP_A = "app_01h455vb4pex5v6nkc6gd5fd01";
const APP_B = "app_01h455vb4pex5v6nkc6gd5fd02";

// 사람이 올린 icon이 있으면 선언한 icon을 읽지도 않고 그것을 준다.
test("app icon read prefers the uploaded icon over the declared one", async () => {
  const uploaded = { content_type: "image/png" as const, data: "AAAA" };
  const read = appIconRead({
    ...createScreenFileDeps({ dir: () => ok("/nowhere") }),
    iconPath: () => ok("/assets/icon.svg"),
    uploaded: (app) => ok(app === APP_A ? uploaded : null),
  });
  const ctx = {} as never;
  assert.deepStrictEqual(await read(ctx, { app: APP_A }), {
    ok: true,
    value: { icon: uploaded, uploaded: true },
  });
  assert.deepStrictEqual(await read(ctx, { app: APP_B }), {
    ok: true,
    value: { icon: null, uploaded: false },
  });
});
