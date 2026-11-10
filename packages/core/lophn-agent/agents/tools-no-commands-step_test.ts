import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseAgentFile } from "./definition-file.ts";
import { agentToolsNoCommandsStep } from "./tools-no-commands-step.ts";

// custom 정의의 `tools`에서 옛 명령 이름만 빼고 사람의 다른 선택·본문·다른 칸은 건드리지 않는다. 틀리게 지우면 사람의 tool 선택이 사라진다.
test("tools에서 lophn 명령·앱 command 이름만 빠지고 나머지와 본문은 그대로이며 다시 돌려도 같다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-tools-no-commands-"));
  try {
    await mkdir(join(root, "agents"));
    const agent = "agt_01hzzzzzzzzzzzzzzzzzzzzzza" as never;
    const path = join(root, "agents", `${agent}.md`);
    await writeFile(
      path,
      "---\nhandle: coach\nname: Coach\nruntime: custom\ntools:\n  - file.read\n  - call.reply\n  - tab.open\n  - river-billing.invoice\n  - mcp__gh__issue\n  - ext__web__go_to\nskills:\n  - triage\n---\ntools:\n  - call.reply\n",
    );
    const onlyCommands = join(
      root,
      "agents",
      "agt_01hzzzzzzzzzzzzzzzzzzzzzzb.md",
    );
    await writeFile(
      onlyCommands,
      "---\nhandle: nav\nname: Nav\nruntime: custom\ntools:\n  - browser.open\n---\nx\n",
    );
    const clean = join(root, "agents", "agt_01hzzzzzzzzzzzzzzzzzzzzzzc.md");
    const kept =
      "---\nhandle: ok\nname: Ok\nruntime: custom\ntools: [file.read]\n---\nx\n";
    await writeFile(clean, kept);

    assert.ok((await agentToolsNoCommandsStep.run(root)).ok);
    const text = await readFile(path, "utf8");
    assert.ok(
      text.endsWith("---\ntools:\n  - call.reply\n"),
      "body is untouched",
    );
    const read = parseAgentFile(text, { agent });
    assert.ok(read.ok);
    assert.deepStrictEqual(read.value.tools, [
      "file.read",
      "mcp__gh__issue",
      "ext__web__go_to",
    ]);
    assert.deepStrictEqual(read.value.skills, ["triage"]);
    const nav = await readFile(onlyCommands, "utf8");
    assert.ok(!nav.includes("tools:"), "an empty tools list is dropped");
    assert.equal(await readFile(clean, "utf8"), kept);

    assert.ok((await agentToolsNoCommandsStep.run(root)).ok);
    assert.equal(await readFile(path, "utf8"), text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
