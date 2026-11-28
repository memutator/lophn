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
import { parseAgentFile } from "./definition-file.ts";
import { agentDropAppsPermissionsStep } from "./drop-apps-permissions-step.ts";

// 이 step은 ids를 쓰지 않지만 DataStep은 deps를 늘 받는다.
const stepDeps = {
  ids: createIdSource({ clock: manualClock(0), random: seededRandom(1) }),
};

// 사람의 data를 잃으면 안 된다: 옛 `apps`·`permissions`만 지우고 다른 agent의 다른 칸, `remote_apps`, 본문은 그대로다. 안 지우면 새 schema가 정의 파일을 거절한다.
test("옛 apps와 permissions만 지우고 remote_apps·다른 칸·본문은 그대로이며 다시 돌려도 같다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-drop-apps-"));
  try {
    await mkdir(join(root, "agents"));
    const agent = "agt_01hzzzzzzzzzzzzzzzzzzzzzza" as never;
    const path = join(root, "agents", `${agent}.md`);
    await writeFile(
      path,
      `---
handle: reviewer
name: Reviewer
apps:
  - notes
remote_apps:
  - machine: mch_01hzzzzzzzzzzzzzzzzzzzzzza
    app: app_01hzzzzzzzzzzzzzzzzzzzzzza
    name: Notes
    removed: []
permissions:
  deny:
    - lophn(notes add)
skills_off:
  - triage
---
apps:
  - not a field, this is the body
`,
    );
    // lophn의 정의 파일에 apps만 있으면 칸이 모두 사라져 파일이 비고, 비어도 lophn의 기본 정의다.
    const lophn = join(root, "agents", "lophn_home.md");
    await writeFile(lophn, "---\napps:\n  - notes\n---\n");
    const clean = join(root, "agents", "agt_01hzzzzzzzzzzzzzzzzzzzzzzb.md");
    const kept = "---\nhandle: ok\nname: Ok\n---\nx\n";
    await writeFile(clean, kept);

    assert.ok((await agentDropAppsPermissionsStep.run(root, stepDeps)).ok);
    const text = await readFile(path, "utf8");
    const read = parseAgentFile(text, { agent });
    assert.ok(read.ok);
    assert.equal(read.value.remote_apps?.length, 1);
    assert.deepStrictEqual(read.value.skills_off, ["triage"]);
    assert.ok(!text.split("---\n")[1].includes("apps:\n  - notes"));
    assert.ok(text.endsWith("---\napps:\n  - not a field, this is the body\n"));
    assert.equal(await readFile(lophn, "utf8"), "");
    assert.equal(await readFile(clean, "utf8"), kept);

    assert.ok((await agentDropAppsPermissionsStep.run(root, stepDeps)).ok);
    assert.equal(await readFile(path, "utf8"), text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
