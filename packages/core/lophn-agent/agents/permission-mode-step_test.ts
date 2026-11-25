import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../base/mod.ts";
import { LOPHN_HOME_ID } from "../../../protocol/lophn-agent/mod.ts";
import { parseAgentFile } from "./definition-file.ts";
import { agentPermissionModeStep } from "./permission-mode-step.ts";

const stepDeps = {
  ids: createIdSource({ clock: manualClock(0), random: seededRandom(1) }),
};

// skip: true는 permission_mode: full로, skip: false는 칸 삭제로 옮기고 이미 옮겨진 파일은 다시 돌려도 그대로다.
test("agentPermissionModeStep은 skip을 permission_mode로 옮기고 멱등하다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-perm-mode-step-"));
  try {
    await mkdir(join(root, "agents"));
    const fullAgent = "agt_01hzzzzzzzzzzzzzzzzzzzzzza" as const;
    const defaultAgent = "agt_01hzzzzzzzzzzzzzzzzzzzzzzb" as const;
    const keepAgent = "agt_01hzzzzzzzzzzzzzzzzzzzzzzc" as const;

    const fullPath = join(root, "agents", `${fullAgent}.md`);
    const defaultPath = join(root, "agents", `${defaultAgent}.md`);
    const keepPath = join(root, "agents", `${keepAgent}.md`);
    const lophnPath = join(root, "agents", "lophn.md");

    await writeFile(
      fullPath,
      "---\nhandle: skipper\nname: Skipper\nskip: true\n---\nRun fast.\n",
    );
    await writeFile(
      defaultPath,
      "---\nhandle: helper\nname: Helper\nskip: false\n---\nAsk first.\n",
    );
    await writeFile(
      keepPath,
      "---\nhandle: reader\nname: Reader\npermission_mode: read_only\nskip: true\n---\nRead only.\n",
    );
    await writeFile(lophnPath, "---\nskip: false\n---\n\nHome body.\n");

    assert.ok((await agentPermissionModeStep.run(root, stepDeps)).ok);

    const parsedFull = parseAgentFile(await readFile(fullPath, "utf8"), {
      agent: fullAgent,
    });
    assert.ok(parsedFull.ok);
    assert.equal(parsedFull.value.permission_mode, "full");
    assert.equal(parsedFull.value.body, "Run fast.");

    const parsedDefault = parseAgentFile(await readFile(defaultPath, "utf8"), {
      agent: defaultAgent,
    });
    assert.ok(parsedDefault.ok);
    assert.equal(parsedDefault.value.permission_mode, undefined);
    assert.equal(parsedDefault.value.body, "Ask first.");

    const parsedKeep = parseAgentFile(await readFile(keepPath, "utf8"), {
      agent: keepAgent,
    });
    assert.ok(parsedKeep.ok);
    assert.equal(parsedKeep.value.permission_mode, "read_only");

    // frontmatter가 비면 울타리까지 걷어 낸다.
    const lophnText = await readFile(lophnPath, "utf8");
    assert.equal(lophnText, "Home body.\n");
    const parsedLophn = parseAgentFile(lophnText, { agent: LOPHN_HOME_ID });
    assert.ok(parsedLophn.ok);
    assert.equal(parsedLophn.value.permission_mode, undefined);

    // 두 번째 실행은 모든 파일을 그대로 둔다.
    const snapFull = await readFile(fullPath, "utf8");
    const snapDefault = await readFile(defaultPath, "utf8");
    const snapKeep = await readFile(keepPath, "utf8");
    assert.ok((await agentPermissionModeStep.run(root, stepDeps)).ok);
    assert.equal(await readFile(fullPath, "utf8"), snapFull);
    assert.equal(await readFile(defaultPath, "utf8"), snapDefault);
    assert.equal(await readFile(keepPath, "utf8"), snapKeep);
    assert.equal(await readFile(lophnPath, "utf8"), lophnText);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
