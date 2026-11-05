import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  CALL_POLICY_SETTING_KEY,
  callPolicySchema,
} from "../../../../protocol/lophn-agent/call-policy.ts";
import { callPolicyPrivateStep } from "./call-policy-private.ts";
import { callPolicyWorkspacesStep } from "./workspace-rename.ts";

// 사람의 규칙을 잃으면 곤란하다. 옛 정책은 규칙과 다른 설정을 그대로 두고 새 schema로 읽혀야 한다(틀리면 settings 전체가 거절된다).
test("an old call policy keeps its rules and other settings and parses after the data steps, run twice", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-call-policy-private-"));
  try {
    const path = join(root, "settings.json");
    const rule = {
      from: { kind: "project", id: "prj_01hzzzzzzzzzzzzzzzzzzzzzza" },
      to: { kind: "home" },
      allow: false,
    };
    const agents = [{ from: "lophn", to: "lophn", allow: true }];
    await writeFile(
      path,
      JSON.stringify({
        [CALL_POLICY_SETTING_KEY]: { places: [rule], agents },
        "shell.theme": "dark",
      }),
    );
    for (let round = 0; round < 2; round += 1) {
      assert.equal((await callPolicyPrivateStep.run(root)).ok, true);
      assert.equal((await callPolicyWorkspacesStep.run(root)).ok, true);
    }
    const settings = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(settings["shell.theme"], "dark");
    assert.deepEqual(
      callPolicySchema.parse(settings[CALL_POLICY_SETTING_KEY]),
      {
        private: [],
        workspaces: [rule],
        agents,
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
