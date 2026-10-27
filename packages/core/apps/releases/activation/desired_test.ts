import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { err, ok, sha256Hex } from "../../../../base/mod.ts";
import { bundleCopyPath } from "../bundle/seal.ts";
import { readBundleCopy } from "./desired.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzz";

// 실행하려고 여는 사본 읽기는 앱의 domain 목록에 없는 domain의 tool을 거절한다. 목록을 못 읽으면 unavailable이다.
test("bundle 사본 읽기는 앱의 domain에 없는 tool을 거절한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-desired-"));
  try {
    const manifest = JSON.stringify({
      entrypoint: "main.ts",
      files: [],
      dependencies: [],
    });
    const hash = await sha256Hex(manifest);
    const copy = bundleCopyPath(root, APP, hash);
    assert.ok(copy.ok);
    await mkdir(copy.value, { recursive: true });
    await writeFile(`${copy.value}/manifest.json`, manifest);
    await writeFile(`${copy.value}/import-map.json`, "{}");
    await writeFile(
      `${copy.value}/declaration.json`,
      JSON.stringify({
        name: "Items",
        description: "Keeps items.",
        screens: [],
        tools: [{
          name: "list_notes",
          title: "List items",
          description: "Lists the items.",
          inputSchema: null,
          effect: "read",
          domain: "items",
          public: false,
        }],
        permissions: [],
        app_connections: [],
        sdk_dependencies: [],
      }),
    );
    const read = (names: string[]) =>
      readBundleCopy(root, APP, hash, () => Promise.resolve(ok(names)));

    const accepted = await read(["items"]);
    assert.ok(accepted.ok && accepted.value !== undefined);
    const outside = await read(["other"]);
    assert.ok(!outside.ok);
    assert.deepStrictEqual(outside.error.code, "unavailable");
    const empty = await read([]);
    assert.ok(!empty.ok);
    const unreadable = await readBundleCopy(
      root,
      APP,
      hash,
      () => Promise.resolve(err({ code: "unavailable", message: "no ledger" })),
    );
    assert.ok(!unreadable.ok);
  } finally {
    await rm(root, { recursive: true });
  }
});
