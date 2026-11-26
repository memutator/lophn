import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionEntry } from "../../desktop/connection/events/sessions-store.ts";
import { openWorkspaceTerminal } from "../../desktop/router.ts";
import {
  addDesk,
  defaultWorkspaceLayout,
  MAIN_DESK,
  openFloatTab,
  openTab,
  updateDesk,
} from "../../shell/desk-model.ts";
import { findTerminalTabByRef, sessionAgentTarget } from "./panel-sessions.ts";

function sessionEntry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    session: "ses_remote_1",
    state: "idle",
    archived: false,
    ended: null,
    agent: "agt_01remoteagent0000000000000",
    workspace: { kind: "project", id: "prj_remote" },
    spawnedBy: null,
    unseen: false,
    ...overrides,
  };
}

test("openWorkspaceTerminal routes remote project and home coding agents directly to the terminal tab", () => {
  assert.deepEqual(
    openWorkspaceTerminal(
      { kind: "project", id: "prj_remote", machine: "mch_peer" },
      "trm_123",
    ),
    {
      space: "project",
      project: "prj_remote",
      terminal: "trm_123",
      machine: "mch_peer",
    },
  );
  assert.deepEqual(
    openWorkspaceTerminal({ kind: "home", machine: "mch_peer" }, "trm_home"),
    {
      space: "home",
      terminal: "trm_home",
      machine: "mch_peer",
    },
  );
  assert.deepEqual(
    openWorkspaceTerminal({ kind: "project", id: "prj_local" }, "trm_local"),
    {
      space: "project",
      project: "prj_local",
      terminal: "trm_local",
    },
  );
});

test("findTerminalTabByRef matches only tabs in the current workspace layout across desks and floats", () => {
  let layout = addDesk(defaultWorkspaceLayout(), "desk-2", "Second");
  layout = updateDesk(layout, "desk-2", (desk) =>
    openTab(desk, {
      key: "term-desk2",
      kind: "terminal",
      title: "Claude",
      fields: { terminal: "trm_in_desk2" },
    }),
  );
  layout = updateDesk(layout, MAIN_DESK, (desk) =>
    openFloatTab(
      desk,
      {
        key: "term-float",
        kind: "terminal",
        title: "Codex",
      },
      { x: 0, y: 0, width: 400, height: 300 },
    ),
  );
  const storeRefs = new Map<string, string>([
    ["term-float", "trm_in_float"],
    ["term-other-workspace", "trm_elsewhere"],
  ]);
  const refOf = (key: string) => storeRefs.get(key) ?? null;

  assert.equal(
    findTerminalTabByRef(layout, "trm_in_desk2", refOf)?.key,
    "term-desk2",
  );
  assert.equal(
    findTerminalTabByRef(layout, "trm_in_float", refOf)?.key,
    "term-float",
  );
  // 다른 workspace의 tab key만 store에 있을 때는 찾지 않아 새 탭을 열게 한다.
  assert.equal(findTerminalTabByRef(layout, "trm_elsewhere", refOf), undefined);
});

test("sessionAgentTarget opens remote sessions without waiting for sidebar agent list", () => {
  const workspace = {
    kind: "project",
    id: "prj_remote",
    machine: "mch_peer",
  } as const;
  // 원격 custom agent가 sidebarAgents에 아직 없어도 session 제목이나 기본 이름으로 바로 연다.
  assert.deepEqual(
    sessionAgentTarget(sessionEntry(), [], workspace, "Fix remote bug"),
    {
      assignment: "agt_01remoteagent0000000000000",
      name: "Fix remote bug",
    },
  );
  // 내장 coding agent는 제품 이름으로 떨어진다.
  assert.deepEqual(
    sessionAgentTarget(
      sessionEntry({ agent: "coding_claude" }),
      [],
      workspace,
      null,
    ),
    {
      assignment: "coding_claude",
      name: "Claude Code",
    },
  );
  // 다른 workspace의 session은 열지 않는다.
  assert.equal(
    sessionAgentTarget(
      sessionEntry({ workspace: { kind: "project", id: "prj_other" } }),
      [],
      workspace,
    ),
    undefined,
  );
});
