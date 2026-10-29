import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentSessionStore } from "./session-store.ts";

const PRJ = "prj_00000000000000000000000000";

function note(id: string, title: string | null) {
  return {
    project: PRJ,
    folder_ref: `${PRJ}_0`,
    cwd: "/work",
    harness: "claude",
    external_session: id,
    title,
  };
}

test("같은 session은 started_at과 처음 받은 title을 지키고, 50개를 넘으면 오래된 것부터 버리며, 손상 파일은 빈 목록이다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-agent-sessions-"));
  try {
    let at = 1000;
    const store = createAgentSessionStore({
      dataRoot: root,
      now: () => at,
      resumable: (harness) => harness === "claude",
    });
    assert.deepEqual(await store.list(PRJ), []);

    await store.note(note("a", null));
    at = 2000;
    await store.note(note("a", "first prompt"));
    at = 3000;
    const list = await store.note(note("a", "second prompt"));
    assert.deepEqual(list, [
      {
        ...note("a", "first prompt"),
        started_at: 1000,
        last_at: 3000,
        resumable: true,
      },
    ]);

    for (let i = 0; i < 60; i += 1) {
      at += 1;
      await store.note(note(`s${i}`, null));
    }
    const capped = await store.list(PRJ);
    assert.equal(capped.length, 50);
    assert.equal(capped[0]?.external_session, "s59");
    assert.equal(
      capped.some((item) => item.external_session === "a"),
      false,
    );

    const dir = join(root, "shell", "agent-sessions");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "prj_corrupt.json"), "{not json");
    assert.deepEqual(await store.list("prj_corrupt"), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
