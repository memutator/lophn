import { assert, assertEquals } from "@std/assert";
import { err, ok, sha256Hex } from "../../../../base/mod.ts";
import { bundleCopyPath } from "../bundle/seal.ts";
import { readBundleCopy } from "./desired.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzz";

// 실행하려고 여는 사본 읽기는 앱의 domain 목록에 없는 domain의 tool을 거절한다. 목록을 못 읽으면 unavailable이다.
Deno.test("bundle 사본 읽기는 앱의 domain에 없는 tool을 거절한다", async () => {
  const root = await Deno.makeTempDir();
  try {
    const manifest = JSON.stringify({
      entrypoint: "main.ts",
      files: [],
      dependencies: [],
    });
    const hash = await sha256Hex(manifest);
    const copy = bundleCopyPath(root, APP, hash);
    assert(copy.ok);
    await Deno.mkdir(copy.value, { recursive: true });
    await Deno.writeTextFile(`${copy.value}/manifest.json`, manifest);
    await Deno.writeTextFile(`${copy.value}/import-map.json`, "{}");
    await Deno.writeTextFile(
      `${copy.value}/blueprint.json`,
      JSON.stringify({
        name: "Items",
        description: "Keeps items.",
        screens: [],
        tools: [{
          name: "list_items",
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
    assert(accepted.ok && accepted.value !== undefined);
    const outside = await read(["other"]);
    assert(!outside.ok);
    assertEquals(outside.error.code, "unavailable");
    const empty = await read([]);
    assert(!empty.ok);
    const unreadable = await readBundleCopy(
      root,
      APP,
      hash,
      () => Promise.resolve(err({ code: "unavailable", message: "no ledger" })),
    );
    assert(!unreadable.ok);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
