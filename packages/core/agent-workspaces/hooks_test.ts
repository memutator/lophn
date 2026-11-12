import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MEMORY_MAX_BYTES } from "../../protocol/lophn-agent/tool-lists.ts";
import { createMemoryTools } from "../lophn-agent/tools/bundles/memory.ts";
import type { ToolContext } from "../lophn-agent/tools/mod.ts";
import { FILE_HOOKS } from "./hooks.ts";

const AGENT = "agt_0aaaaaaaaaaaaaaaaaaaaaaaaa";
const AGENT_OTHER = "agt_0bbbbbbbbbbbbbbbbbbbbbbbbb";
const PROJECT = "prj_0aaaaaaaaaaaaaaaaaaaaaaaaa";
const PROJECT_OTHER = "prj_0bbbbbbbbbbbbbbbbbbbbbbbbb";

const existing = async (path: string) =>
  readFile(path, "utf8").catch(() => null);

// memory를 쓰는 길에 자리 입력이 생기거나 부른 agent 말고 다른 파일이 정해지면 남의 memory를 덮어쓴다.
test("agent는 자기 memory만 쓰고 lophn은 자기 workspace의 memory만 쓴다", async () => {
  const data = await mkdtemp(join(tmpdir(), "lophn-memory-"));
  const home = process.env.LOPHN_HOME;
  process.env.LOPHN_HOME = data;
  try {
    const [tool] = createMemoryTools({
      ...FILE_HOOKS,
      aroundWrite: (_ctx, _target, run) => run(),
    });
    const edit = (agent: string, input: Record<string, unknown>) => {
      const parsed = tool!.input.safeParse(input);
      assert.ok(parsed.success, "input is accepted");
      return tool!.handler!(parsed.data, {
        agent,
        ids: { newId: (prefix: string) => `${prefix}_x` },
      } as ToolContext);
    };

    // 자리를 고르는 입력은 받지 않는다.
    assert.ok(
      !tool!.input.safeParse({ path: "../x", new_string: "a" }).success,
    );

    const mine = join(data, `agent-memory/${AGENT}.md`);
    const other = join(data, `agent-memory/${AGENT_OTHER}.md`);
    const prj = join(data, `projects/${PROJECT}/memory.md`);
    const prjOther = join(data, `projects/${PROJECT_OTHER}/memory.md`);
    await mkdir(join(data, "agent-memory"), { recursive: true });
    await writeFile(other, "other agent");

    assert.ok((await edit(AGENT, { new_string: "mine" }))?.ok);
    assert.deepStrictEqual(await existing(mine), "mine");
    assert.deepStrictEqual(await existing(other), "other agent");
    // 사람이 만든 agent는 workspace memory를 쓰지 못한다.
    assert.deepStrictEqual(await existing(prj), null);

    assert.ok((await edit(`lophn_${PROJECT}`, { new_string: "plan" }))?.ok);
    assert.deepStrictEqual(await existing(prj), "plan");
    assert.deepStrictEqual(await existing(prjOther), null);
    assert.deepStrictEqual(await existing(mine), "mine");

    // 넘치는 쓰기는 거절하고 파일은 그대로다. 오류에 지금 크기가 있다.
    const over = await edit(`lophn_${PROJECT}`, {
      new_string: "x".repeat(MEMORY_MAX_BYTES),
    });
    assert.ok(over && !over.ok);
    assert.ok(over.error.message.includes("4 bytes now"));
    assert.deepStrictEqual(await existing(prj), "plan");
  } finally {
    if (home === undefined) delete process.env.LOPHN_HOME;
    else process.env.LOPHN_HOME = home;
    await rm(data, { recursive: true, force: true });
  }
});
