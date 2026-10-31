import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ok, type Result } from "../../../base/mod.ts";
import type { ToolResult } from "../../../protocol/lophn-agent/tool-values.ts";
import { toolResultSchema } from "../../../protocol/lophn-agent/tool-values.ts";
import type { ToolContext } from "../../lophn-agent/tools/spi.ts";
import { readBuiltinSdk } from "../packages/builtin.ts";
import { PACKAGE_TOOLS } from "./package.ts";

const LIMIT = 24 * 1024;
const GUIDE_LINE =
  '- Field: "quoted" \\ backslash \\n literal \\n and "more" quotes, 한국어 줄 ---';

function guideOf(bytes: number): string {
  const lines: string[] = [];
  while (new TextEncoder().encode(`${lines.join("\n")}\n`).byteLength < bytes) {
    lines.push(GUIDE_LINE);
  }
  return `${lines.join("\n")}\n`;
}

// 내장 SDK 하나를 설치 사본 모양으로 깐다.
async function builtinRoot(bytes: number): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lophn-package-read-"));
  const folder = join(root, "sdk", "ui", "1.0.0");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "guide.md"), guideOf(bytes));
  return root;
}

const handler = () => {
  const tool = PACKAGE_TOOLS.find((one) => one.name === "package.read");
  assert.ok(tool?.handler !== undefined);
  return tool.handler;
};

async function run(
  core: (path: string, body: unknown) => Promise<Result<unknown>>,
  input: Record<string, unknown>,
) {
  const answer = await handler()(input, { core } as unknown as ToolContext);
  assert.ok(answer.ok);
  return toolResultSchema.parse(answer.value);
}

// guide가 결과 상한보다 길어도 창이 상한 안에 들어오고, 창을 이으면 본문이 그대로다.
test("긴 guide는 상한 안의 창으로 오고 이어 읽으면 본문 전체가 된다", async () => {
  const root = await builtinRoot(60 * 1024);
  try {
    const builtin = readBuiltinSdk({ dataRoot: root });
    const core = async (path: string, body: unknown) =>
      path === "/packages/builtin" ? builtin({} as never, body) : ok({});
    const full = guideOf(60 * 1024);
    let read = "";
    let offset: number | undefined;
    let windows = 0;
    let first: ToolResult | null = null;
    for (;;) {
      const result = await run(core, {
        name: "@lophn/ui",
        ...(offset === undefined ? {} : { offset_bytes: offset }),
      });
      first ??= result;
      assert.ok(result.content !== null, "content is never dropped");
      assert.ok(
        new TextEncoder().encode(JSON.stringify(result.content)).byteLength <=
          LIMIT,
      );
      const page = result.content as {
        guide: string;
        guide_truncated: boolean;
        guide_offset_bytes: number;
        guide_size_bytes: number;
      };
      assert.equal(page.guide_offset_bytes, offset ?? 0);
      assert.equal(
        page.guide_size_bytes,
        new TextEncoder().encode(full).byteLength,
      );
      read += page.guide;
      windows += 1;
      if (result.complete) {
        assert.equal(page.guide_truncated, false);
        assert.equal(result.continuation, null);
        break;
      }
      assert.equal(page.guide_truncated, true);
      const next = result.continuation?.read_next;
      assert.match(next ?? "", /^offset_bytes=\d+$/u);
      offset = Number(next!.slice("offset_bytes=".length));
      assert.ok(windows < 20, "too many windows");
    }
    assert.equal(read, full);
    assert.equal(first?.complete, false);
    assert.ok(windows > 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// 사용자 package도 같은 창 나누기를 쓴다. blob route가 창을 주므로 route 입력의 offset이 이어진다.
test("사용자 package guide도 같은 창으로 이어지고 요청한 offset으로 읽는다", async () => {
  const body = guideOf(60 * 1024);
  const seen: unknown[] = [];
  const core = async (
    path: string,
    input: unknown,
  ): Promise<Result<unknown>> => {
    if (path === "/packages/versions") {
      return ok({
        as_of_seq: "1",
        next_cursor: null,
        name: "@me/kit",
        owner_app: null,
        versions: [
          {
            version: "1.0.0",
            bundle_hash: "a".repeat(64),
            guide_hash: "b".repeat(64),
          },
        ],
      });
    }
    if (path === "/packages/usage") {
      return ok({
        as_of_seq: "1",
        next_cursor: null,
        name: "@me/kit",
        version: "1.0.0",
        usages: [],
      });
    }
    if (path === "/packages/guide_body") {
      seen.push(input);
      const { offset_bytes, length_bytes } = input as {
        offset_bytes: number;
        length_bytes: number;
      };
      const bytes = new TextEncoder().encode(body);
      const slice = bytes.subarray(
        offset_bytes,
        Math.min(bytes.byteLength, offset_bytes + length_bytes),
      );
      return ok({
        status: "available",
        hash: "a".repeat(64),
        size_bytes: bytes.byteLength,
        offset_bytes,
        length_bytes: slice.byteLength,
        truncated: slice.byteLength < bytes.byteLength,
        bytes: Buffer.from(slice).toString("base64"),
      });
    }
    throw new Error(`unexpected ${path}`);
  };
  const first = await run(core, { name: "@me/kit" });
  assert.ok(first.content !== null);
  const page = first.content as { guide: string; guide_truncated: boolean };
  assert.equal(page.guide_truncated, true);
  assert.equal(first.complete, false);
  const offset = Number(
    first.continuation?.read_next?.slice("offset_bytes=".length),
  );
  assert.equal(offset, new TextEncoder().encode(page.guide).byteLength);
  const second = await run(core, { name: "@me/kit", offset_bytes: offset });
  assert.deepEqual(seen[1], {
    name: "@me/kit",
    version: "1.0.0",
    offset_bytes: offset,
    length_bytes: LIMIT,
  });
  assert.ok(second.content !== null);
});
