import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentSessionStore, sessionsFolder } from "./session-store.ts";

const PRJ = "prj_00000000000000000000000000";

function note(id: string, title: string | null, name: string | null = null) {
  return {
    project: PRJ,
    folder_ref: `${PRJ}_0`,
    cwd: "/work",
    harness: "claude",
    external_session: id,
    title,
    name,
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
        pinned: false,
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

    const dir = sessionsFolder(root);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "prj_corrupt.json"), "{not json");
    assert.deepEqual(await store.list("prj_corrupt"), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("사람이 붙인 session 이름은 hook 이름에 덮이지 않고, 이름을 지우면 다시 hook 이름을 따른다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-agent-name-"));
  try {
    const store = createAgentSessionStore({
      dataRoot: root,
      now: () => 1000,
      resumable: () => true,
    });
    await store.note(note("a", "prompt", "hook name"));
    await store.rename({
      project: PRJ,
      harness: "claude",
      external_session: "a",
      name: "my name",
    });

    const pinned = await store.note(note("a", "prompt", "later hook name"));
    assert.equal(pinned[0]?.name, "my name");

    await store.rename({
      project: PRJ,
      harness: "claude",
      external_session: "a",
      name: null,
    });
    const unpinned = await store.note(note("a", "prompt", "later hook name"));
    assert.equal(unpinned[0]?.name, "later hook name");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("null·빈 문자열·harness 기본 라벨은 기존 title·name을 덮지 않는다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-agent-title-protect-"));
  try {
    let at = 1000;
    const store = createAgentSessionStore({
      dataRoot: root,
      now: () => at,
      resumable: () => true,
    });

    await store.note({
      ...note("conv-alive", "first prompt", "Summary Title"),
      harness: "antigravity",
    });
    // null, 공백, harness 기본 라벨("Antigravity")은 기존 title/name을 지우지 못한다.
    at = 2000;
    await store.note({
      ...note("conv-alive", null, "   "),
      harness: "antigravity",
    });
    at = 3000;
    const protectedList = await store.note({
      ...note("conv-alive", "Antigravity", "Antigravity"),
      harness: "antigravity",
    });
    assert.equal(protectedList[0]?.title, "first prompt");
    assert.equal(protectedList[0]?.name, "Summary Title");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
