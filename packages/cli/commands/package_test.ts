import assert from "node:assert/strict";
import { test } from "node:test";
import { ok, type Result } from "../../base/mod.ts";
import { PACKAGE_COMMANDS } from "./package.ts";
import type { CommandContext } from "./types.ts";

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

const read = PACKAGE_COMMANDS.find((c) => c.name === "package.read")!;

async function run(
  core: (route: string, input: unknown) => Promise<Result<unknown>>,
  input: Record<string, unknown>,
) {
  const ran = await read.run(input, {
    core: {
      read: (route: { name: string }, i: unknown) => core(route.name, i),
    },
  } as unknown as CommandContext);
  assert.ok(ran.ok);
  return ran.value.content as {
    guide: string;
    guide_truncated: boolean;
    guide_offset_bytes: number;
    guide_size_bytes: number;
    guide_next_offset_bytes: number | null;
  };
}

// guide가 결과 상한보다 길어도 창이 상한 안에 들어오고, 창을 이으면 본문이 그대로다.
test("긴 guide는 상한 안의 창으로 오고 이어 읽으면 본문 전체가 된다", async () => {
  const full = guideOf(60 * 1024);
  const core = (route: string) =>
    Promise.resolve(
      route === "packages.builtin"
        ? ok({
            packages: [
              { name: "@lophn/ui", version: "1.0.0", has_guide: true },
            ],
            guide: { text: full, truncated: false },
          })
        : ok({}),
    );
  let got = "";
  let offset: number | undefined;
  let windows = 0;
  for (;;) {
    const page = await run(core, {
      name: "@lophn/ui",
      ...(offset === undefined ? {} : { offset_bytes: offset }),
    });
    assert.ok(
      new TextEncoder().encode(JSON.stringify(page)).byteLength <= LIMIT,
    );
    assert.equal(page.guide_offset_bytes, offset ?? 0);
    got += page.guide;
    windows += 1;
    if (page.guide_next_offset_bytes === null) {
      assert.equal(page.guide_truncated, false);
      break;
    }
    assert.equal(page.guide_truncated, true);
    offset = page.guide_next_offset_bytes;
    assert.ok(windows < 20, "too many windows");
  }
  assert.equal(got, full);
  assert.ok(windows > 1);
});

// 사용자 package도 같은 창 나누기를 쓴다. blob route가 창을 주므로 route 입력의 offset이 이어진다.
test("사용자 package guide도 같은 창으로 이어지고 요청한 offset으로 읽는다", async () => {
  const body = new TextEncoder().encode(guideOf(60 * 1024));
  const seen: unknown[] = [];
  const core = async (route: string, input: unknown) => {
    if (route === "packages.versions") {
      return ok({
        name: "@me/kit",
        owner_app: null,
        versions: [{ version: "1.0.0" }],
      });
    }
    if (route === "packages.usage") return ok({ usages: [] });
    if (route === "packages.guide_body") {
      seen.push(input);
      const { offset_bytes, length_bytes } = input as {
        offset_bytes: number;
        length_bytes: number;
      };
      const slice = body.subarray(offset_bytes, offset_bytes + length_bytes);
      return ok({
        status: "available",
        size_bytes: body.byteLength,
        offset_bytes,
        bytes: Buffer.from(slice).toString("base64"),
      });
    }
    throw new Error(`unexpected ${route}`);
  };
  const first = await run(core, { name: "@me/kit" });
  assert.equal(first.guide_truncated, true);
  const offset = first.guide_next_offset_bytes!;
  assert.equal(offset, new TextEncoder().encode(first.guide).byteLength);
  await run(core, { name: "@me/kit", offset_bytes: offset });
  assert.deepEqual(seen[1], {
    name: "@me/kit",
    version: "1.0.0",
    offset_bytes: offset,
    length_bytes: LIMIT,
  });
});
