import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseAgentFile } from "./definition-file.ts";
import { agentHandleStep } from "./handle-step.ts";

// 옛 name이 주소였다. handle이 name을 그대로 받아야 name으로 쓴 call·workflow.yaml이 계속 닿고, 다른 칸과 본문은 그대로여야 한다.
test("옛 정의의 handle은 name이 되고 다른 칸·본문·lophn.md는 그대로이며 다시 돌려도 같다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-handle-step-"));
  try {
    await mkdir(join(root, "agents"));
    const agent = "agt_01hzzzzzzzzzzzzzzzzzzzzzza" as never;
    const path = join(root, "agents", `${agent}.md`);
    await writeFile(
      path,
      "---\nname: Code Reviewer\nskip: true\ndescription: reviews\n---\nBe careful.\n",
    );
    const lophn = join(root, "agents", "lophn.md");
    await writeFile(lophn, "");
    const done = join(root, "agents", "agt_01hzzzzzzzzzzzzzzzzzzzzzzb.md");
    const kept = "---\nhandle: mine\nname: Other\n---\nx\n";
    await writeFile(done, kept);

    assert.ok((await agentHandleStep.run(root)).ok);
    const read = parseAgentFile(await readFile(path, "utf8"), { agent });
    assert.ok(read.ok);
    assert.deepStrictEqual(read.value, {
      handle: "Code Reviewer",
      name: "Code Reviewer",
      description: "reviews",
      skip: true,
      body: "Be careful.",
    });
    assert.equal(await readFile(lophn, "utf8"), "");
    assert.equal(await readFile(done, "utf8"), kept);

    const again = await readFile(path, "utf8");
    assert.ok((await agentHandleStep.run(root)).ok);
    assert.equal(await readFile(path, "utf8"), again);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
