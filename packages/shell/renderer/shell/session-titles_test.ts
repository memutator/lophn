import assert from "node:assert/strict";
import { test } from "node:test";

import { sessionOf } from "../workspace/agent/tab-fields.ts";
import { emptyDesk, groupTabs } from "./desk-model.ts";
import {
  deskTabGroups,
  groupDeskSessions,
  type SidebarSession,
} from "./left-sidebar-model.ts";
import { sessionRowTitle, sessionTitlesKey } from "./session-titles.ts";

// 여러 번 고친 bug: session 이름이 agent 이름으로 떨어졌다가 그 탭을 다시 골라야 돌아왔다.
test("session titles are re-read when a turn starts, and a row is named by the session title", () => {
  const entry = (state: string, ended: string | null = null) => [
    { session: "ses_a", ended, state },
  ];
  // 자동 제목은 첫 말에 붙는다. session이 생긴 뒤 turn이 돌기 시작하면 다시 읽어야 한다.
  assert.notEqual(
    sessionTitlesKey(entry("idle")),
    sessionTitlesKey(entry("running")),
  );
  assert.notEqual(
    sessionTitlesKey(entry("idle")),
    sessionTitlesKey(entry("idle", "archived")),
  );
  // 물음을 기다리는 것처럼 제목과 상관없는 변화에는 다시 읽지 않는다.
  assert.equal(
    sessionTitlesKey(entry("idle")),
    sessionTitlesKey(entry("waiting")),
  );

  const names = { agentName: "lophn", untitled: "Untitled" };
  assert.equal(
    sessionRowTitle({ title: "alpha", open: true, ...names }),
    "alpha",
  );
  assert.equal(sessionRowTitle({ title: null, open: true, ...names }), "lophn");
  assert.equal(
    sessionRowTitle({ title: undefined, open: false, ...names }),
    "Untitled",
  );
});

test("left sidebar collapses sessions sharing a tab group or workflow step when 2+ items belong to it", () => {
  const tab = (key: string, session: string) => ({
    key,
    kind: "agent",
    title: key,
    fields: { session, agent: "asg_lophn" },
  });
  let wfDesk = emptyDesk("wfi_1", "git-worktree", "feature-cleanroom", "wfi_1");
  wfDesk = {
    ...wfDesk,
    tabs: [
      tab("t1", "ses_1"),
      tab("t2", "ses_2"),
      tab("t3", "ses_3"),
      tab("t4", "ses_4"),
      { key: "doc_1", kind: "document", title: "README.md" },
    ],
  };
  // ses_2·ses_3은 workflow bundle, ses_4는 문서 탭과 2-leaf split(session 1개뿐이라 묶이지 않는다).
  wfDesk = groupTabs(wfDesk, ["t2", "t3"], {
    groupId: "wfi_1:research",
    label: "research",
  });
  wfDesk = groupTabs(wfDesk, ["t4", "doc_1"], {});

  const row = (
    ref: string,
    title: string,
    dot: SidebarSession["dot"],
  ): SidebarSession => ({
    kind: "session",
    ref,
    title,
    agent: { kind: "workflow" },
    dot,
    actions: true,
    at: 0,
  });

  const stepOf: Record<string, string> = {
    ses_2: "research",
    ses_3: "research",
    ses_5: "ui-research",
    ses_6: "ui-research",
  };
  const items = groupDeskSessions({
    roots: [
      row("ses_1", "Intro", "finished"),
      row("ses_2", "Research A", "finished"),
      row("ses_3", "Research B", "working"),
      row("ses_4", "Solo Split", "finished"),
      // 탭이 아직 없는 같은 workflow step 2개도 묶인다.
      row("ses_5", "UI A", "waiting"),
      row("ses_6", "UI B", "finished"),
    ],
    layoutGroups: deskTabGroups(wfDesk, sessionOf),
    workflowGroupOf: (item) => {
      const step = stepOf[item.ref];
      return step === undefined ? null : { key: `wfi_1:${step}`, label: step };
    },
  });

  assert.equal(items.length, 4);
  assert.equal(items[0]!.kind, "session");
  assert.equal(items[1]!.kind, "group");
  if (items[1]!.kind === "group") {
    assert.equal(items[1]!.label, "research");
    assert.equal(items[1]!.dot, "working");
    assert.deepEqual(
      items[1]!.items.map((one) => one.ref),
      ["ses_2", "ses_3"],
    );
  }
  assert.equal(items[2]!.kind, "session");
  if (items[2]!.kind === "session") assert.equal(items[2]!.ref, "ses_4");
  assert.equal(items[3]!.kind, "group");
  if (items[3]!.kind === "group") {
    assert.equal(items[3]!.label, "ui-research");
    assert.equal(items[3]!.dot, "waiting");
    assert.deepEqual(
      items[3]!.items.map((one) => one.ref),
      ["ses_5", "ses_6"],
    );
  }
});
