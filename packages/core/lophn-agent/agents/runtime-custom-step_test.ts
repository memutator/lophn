import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseAgentFile } from "./definition-file.ts";
import { agentRuntimeCustomStep } from "./runtime-custom-step.ts";

// 옛 이름 `bare`로 저장된 정의가 새 판에서 거절되면 사람의 agent가 사라진다. 그 한 줄만 옮기고 본문은 건드리지 않는다.
test("runtime: bare는 custom으로 옮겨지고 본문·다른 칸·다른 runtime은 그대로이며 다시 돌려도 같다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-runtime-custom-step-"));
  try {
    await mkdir(join(root, "agents"));
    const agent = "agt_01hzzzzzzzzzzzzzzzzzzzzzza" as never;
    const path = join(root, "agents", `${agent}.md`);
    await writeFile(
      path,
      "---\nhandle: coach\nname: Coach\nruntime: bare\ntools:\n  - file.read\n---\nruntime: bare\n",
    );
    const other = join(root, "agents", "agt_01hzzzzzzzzzzzzzzzzzzzzzzb.md");
    const kept = "---\nhandle: cx\nname: Cx\nruntime: codex\n---\nx\n";
    await writeFile(other, kept);

    assert.ok((await agentRuntimeCustomStep.run(root)).ok);
    const text = await readFile(path, "utf8");
    assert.ok(text.endsWith("---\nruntime: bare\n"), "body is untouched");
    const read = parseAgentFile(text, { agent });
    assert.ok(read.ok);
    assert.equal(read.value.runtime, "custom");
    assert.deepStrictEqual(read.value.tools, ["file.read"]);
    assert.equal(await readFile(other, "utf8"), kept);

    assert.ok((await agentRuntimeCustomStep.run(root)).ok);
    assert.equal(await readFile(path, "utf8"), text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
