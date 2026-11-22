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
import { agentAvatarStep } from "./avatar-step.ts";
import { parseAgentFile } from "./definition-file.ts";

// 이 step은 ids를 쓰지 않지만 DataStep은 deps를 늘 받는다.
const stepDeps = {
  ids: createIdSource({ clock: manualClock(0), random: seededRandom(1) }),
};

// 옛 `profile` 칸으로 저장된 정의가 새 판에서 거절되거나 그림을 잃으면 사람의 agent가 망가진다. 키 한 줄만 옮기고 나머지는 한 byte도 건드리지 않는다.
test("profile 칸은 avatar로 옮겨지고 값·다른 칸·본문은 그대로이며 다시 돌려도 같다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-avatar-step-"));
  try {
    await mkdir(join(root, "agents"));
    const agent = "agt_01hzzzzzzzzzzzzzzzzzzzzzza" as never;
    const path = join(root, "agents", `${agent}.md`);
    const before =
      "---\nhandle: coach\nname: Coach\nprofile:\n  kind: character\n  shape: pear\n  color: coral\nruntime: custom\nbrowser_profile: bpf_01hzzzzzzzzzzzzzzzzzzzzzzz\n---\nprofile: keep\r\nbody\n";
    await writeFile(path, before);
    const other = join(root, "agents", "agt_01hzzzzzzzzzzzzzzzzzzzzzzb.md");
    const kept = "---\nhandle: cx\nname: Cx\nruntime: codex\n---\nx\n";
    await writeFile(other, kept);

    assert.ok((await agentAvatarStep.run(root, stepDeps)).ok);
    const text = await readFile(path, "utf8");
    assert.equal(
      text,
      before.replace("\nprofile:\n  kind", "\navatar:\n  kind"),
    );
    const read = parseAgentFile(text, { agent });
    assert.ok(read.ok);
    assert.deepStrictEqual(read.value.avatar, {
      kind: "character",
      shape: "pear",
      color: "coral",
    });
    assert.equal(await readFile(other, "utf8"), kept);

    assert.ok((await agentAvatarStep.run(root, stepDeps)).ok);
    assert.equal(await readFile(path, "utf8"), text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
