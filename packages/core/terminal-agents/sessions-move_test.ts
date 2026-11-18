import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentSessionStore, sessionsFolder } from "./session-store.ts";
import { moveSavedSessions } from "./sessions-move.ts";

const A = `prj_${"a".repeat(26)}`;
const B = `prj_${"b".repeat(26)}`;
const C = `prj_${"c".repeat(26)}`;

const saved = (project: string, external: string, name: string | null) => ({
  harness: "claude",
  external_session: external,
  project,
  folder_ref: `${project}_0`,
  cwd: "/work/repo",
  title: "fix the build",
  name,
  pinned: name !== null,
  started_at: 1000,
  last_at: 2000,
});

// 사람의 data root에서 도는 step이다. 옮기다 session 기록을 잃으면 사람은 이어 가기(resume)로 지난 coding agent 대화를 다시 열 수 없다.
test("shell/agent-sessions를 옮긴 뒤 이어 가기에 쓰는 session 기록이 남고, 새 자리의 file은 바뀌지 않으며 다시 돌아도 같다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-sessions-move-"));
  try {
    const old = join(root, "shell", "agent-sessions");
    await mkdir(old, { recursive: true });
    const fileA = JSON.stringify({ sessions: [saved(A, "cli-a", "my name")] });
    const fileB = JSON.stringify({ sessions: [saved(B, "cli-b", null)] });
    await writeFile(join(old, `${A}.json`), fileA, { mode: 0o600 });
    await writeFile(join(old, `${B}.json`), fileB, { mode: 0o640 });
    await writeFile(join(old, `${C}.json`), "old");
    const target = sessionsFolder(root);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, `${C}.json`), "new");

    for (let run = 0; run < 2; run += 1) {
      assert.ok((await moveSavedSessions(root)).ok);
    }

    const store = createAgentSessionStore({
      dataRoot: root,
      now: () => 3000,
      resumable: (harness) => harness === "claude",
    });
    const pick = (one: Record<string, unknown>) => ({
      harness: one.harness,
      external_session: one.external_session,
      folder_ref: one.folder_ref,
      cwd: one.cwd,
      name: one.name,
      pinned: one.pinned,
      resumable: one.resumable,
    });
    assert.deepEqual((await store.list(A)).map(pick), [
      {
        harness: "claude",
        external_session: "cli-a",
        folder_ref: `${A}_0`,
        cwd: "/work/repo",
        name: "my name",
        pinned: true,
        resumable: true,
      },
    ]);
    assert.equal((await store.list(B))[0]?.external_session, "cli-b");
    assert.equal(await readFile(join(target, `${A}.json`), "utf8"), fileA);
    if (process.platform !== "win32") {
      assert.equal((await stat(join(target, `${B}.json`))).mode & 0o777, 0o640);
    }
    assert.equal(await readFile(join(target, `${C}.json`), "utf8"), "new");
    assert.deepEqual(await readdir(join(root, "shell")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
