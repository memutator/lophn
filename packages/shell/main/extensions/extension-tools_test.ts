import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { manualClock } from "../../../base/clock.ts";
import { createIdSource } from "../../../base/id.ts";
import { seededRandom } from "../../../base/random.ts";
import { extensionToolModelName } from "../../../protocol/extensions/mod.ts";
import {
  createExtensionRegistry,
  type ExtensionFiles,
  type PublishedTools,
} from "./registry.ts";

// test 전용 fixture 폴더다. 제품 roots(bundled, 설치 root)에 두지 않고 설정 선언도 없어서 여기서만 켠다.
const ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../tests/support/extensions",
);

const nodeFiles: ExtensionFiles = {
  read: (path) => readFile(path, "utf8").catch(() => null),
  write: async (path, text) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  },
  list: (dir) => readdir(dir).catch(() => null),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  remove: (path) => rm(path, { recursive: true, force: true }),
};

// agent가 부르는 길의 shell 쪽 반: fixture를 load해 catalog에 이름이 서고 handler의 content가 돌아온다.
test("the echo-tool fixture is published as ext__echo-tool__echo and its handler answers", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "echo-tool-"));
  try {
    const version = (
      JSON.parse(await readFile(`${ROOT}/echo-tool/manifest.json`, "utf8")) as {
        version: string;
      }
    ).version;
    const published: PublishedTools[][] = [];
    const clock = manualClock(0);
    const registry = createExtensionRegistry({
      roots: [ROOT],
      dataRoot,
      productVersion: version,
      files: nodeFiles,
      load: (path) => import(path),
      settings: {
        get: (key) =>
          Promise.resolve({
            ok: true as const,
            value: key === "extensions.echo-tool.enabled" ? true : undefined,
          }),
      },
      core: {
        call: () => Promise.resolve({ ok: true as const, value: undefined }),
      },
      spawn: () => {
        throw new Error("not used");
      },
      acp: {
        open: () => {
          throw new Error("not used");
        },
        onTab: () => () => {},
      },
      clock,
      ids: createIdSource({ clock, random: seededRandom(1) }),
      publishTools: (tools) => {
        published.push(tools);
        return Promise.resolve();
      },
      log: () => {},
    });

    await registry.sync();
    const names = published
      .at(-1)
      ?.flatMap((one) =>
        one.tools.map((tool) => extensionToolModelName(one.id, tool.name)),
      );
    assert.deepEqual(names, ["ext__echo-tool__echo"]);

    const called = await registry.callTool(
      "echo-tool",
      "echo",
      { text: "hi" },
      { session: "ses_1", workspace: { kind: "home" } } as never,
    );
    assert.deepEqual(called, {
      ok: true,
      value: [{ type: "text", text: '{"text":"hi"}' }],
    });
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
