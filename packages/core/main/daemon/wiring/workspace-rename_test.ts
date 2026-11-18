import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../../base/mod.ts";
import { jobActionSchema } from "../../../../protocol/jobs/mod.ts";
import { callTargetSchema } from "../../../../protocol/lophn-agent/calls.ts";
import type { SchemaStep } from "../../../../protocol/server/mod.ts";
import { workflowInstanceSchema } from "../../../../protocol/workflows/instances.ts";
import { jobsSchemaSteps } from "../../../jobs/schema.ts";
import { ROUTER_SCHEMA_STEPS } from "../../../router/mod.ts";
import { runsSchemaSteps } from "../../../runs/schema.ts";
import { applyMigrations } from "../../../storage/migration/mod.ts";
import { workflowsSchemaSteps } from "../../../workflows/mod.ts";
import {
  callPolicyWorkspacesStep,
  workflowWorkspaceStep,
  workspaceLayoutsStep,
} from "./workspace-rename.ts";
import { conversationTestSteps } from "../../../lophn-agent/session/test-steps.ts";

// 이 step은 ids를 쓰지 않지만 DataStep은 deps를 늘 받는다.
const stepDeps = {
  ids: createIdSource({ clock: manualClock(0), random: seededRandom(1) }),
};

const PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzza";
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const AT = "2026-11-01T00:00:00.000Z";

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "lophn-workspace-rename-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const NEW_STEPS = new Set([
  "lophn-agent.sessions.workspace",
  "jobs.workspace",
  "runs.workspace",
  "router.agent-calls.workspace",
  "workflows.workspace",
]);

const ALL_STEPS: readonly SchemaStep[] = [
  ...conversationTestSteps,
  ...jobsSchemaSteps,
  ...runsSchemaSteps,
  ...ROUTER_SCHEMA_STEPS,
  ...workflowsSchemaSteps,
];

// 이미 쓰던 ledger의 끝난 행(끝난 call·run은 trigger가 고치기를 막는다)도 옛 key를 잃지 않고 새 이름으로 읽힌다.
test("place 이름으로 저장된 ledger 행은 새 schema step 뒤 workspace 이름으로 읽힌다", async () => {
  await withRoot(async (root) => {
    const path = join(root, "lophn.db");
    const deps = { clock: manualClock(Date.UTC(2026, 10, 1)) };
    const before = ALL_STEPS.filter((step) => !NEW_STEPS.has(step.id));
    assert.equal(before.length, ALL_STEPS.length - NEW_STEPS.size);
    assert.equal((await applyMigrations(path, before, deps)).ok, true);

    const db = new DatabaseSync(path);
    db.exec(`
      insert into sessions (id, agent, project, place_kind, place_id, created_seq, state_seq)
        values ('ses_1', 'lophn_home', '${PRJ}', 'project', '${PRJ}', 1, 1);
      insert into agent_calls (call, from_session, "to", reply, state, created_at, state_at)
        values ('cal_1', 'ses_1',
          '{"kind":"new_session","agent":{"agent":"lophn_home","place":{"kind":"app","id":"${APP}"}}}',
          'result', 'done', '${AT}', '${AT}');
      insert into jobs (id, title, creator_agent, creator_place, every, action, missed_policy, enabled, created_at, updated_at)
        values ('job_1', 'daily', 'lophn_home', '${PRJ}', 'day',
          '{"kind":"agent_run","agent":"lophn_home","agent_place":null,"prompt":"go"}', 'run', 1, '${AT}', '${AT}');
      insert into runs (id, kind, target, session_opened, state, created_at, finished_at, state_seq, agent_key, place_key)
        values ('run_1', 'agent', '{"agent":{"agent":"lophn_home","place":{"kind":"project","id":"${PRJ}"}}}',
          0, 'done', '${AT}', '${AT}', 1, 'lophn_home@${PRJ}', 'project:${PRJ}');
      insert into workflow_instances (id, project, workflow, input, state, participants, steps, human_turn, started_by, created_at, finished_at, state_seq)
        values ('wfi_1', '${PRJ}', 'review', '"x"', 'ended',
          '{"writer":{"agent":"lophn","place":{"app":"notes"}},"me":{"kind":"human"},"editor":{"agent":"lophn"}}',
          '[]', 0, '{"kind":"user"}', '${AT}', '${AT}', 1);
    `);
    db.close();

    assert.equal((await applyMigrations(path, ALL_STEPS, deps)).ok, true);
    const after = new DatabaseSync(path);
    try {
      assert.deepEqual(
        {
          ...after
            .prepare("select workspace_kind, workspace_id from sessions")
            .get(),
        },
        { workspace_kind: "project", workspace_id: PRJ },
      );
      const to = callTargetSchema.parse(
        JSON.parse(
          String(after.prepare(`select "to" from agent_calls`).get()?.["to"]),
        ),
      );
      assert.deepEqual(to, {
        kind: "new_session",
        agent: { agent: "lophn_home", workspace: { kind: "app", id: APP } },
      });
      const job = after
        .prepare("select creator_workspace, action from jobs")
        .get();
      assert.equal(job?.["creator_workspace"], PRJ);
      assert.deepEqual(
        jobActionSchema.parse(JSON.parse(String(job?.["action"]))),
        {
          kind: "agent_run",
          agent: "lophn_home",
          agent_workspace: null,
          prompt: "go",
        },
      );
      const run = after.prepare("select workspace_key, target from runs").get();
      assert.equal(run?.["workspace_key"], `project:${PRJ}`);
      assert.deepEqual(JSON.parse(String(run?.["target"])), {
        agent: { agent: "lophn_home", workspace: { kind: "project", id: PRJ } },
      });
      const participants = workflowInstanceSchema.shape.participants.parse(
        JSON.parse(
          String(
            after
              .prepare("select participants from workflow_instances")
              .get()?.["participants"],
          ),
        ),
      );
      assert.deepEqual(participants, {
        writer: { agent: "lophn", workspace: { app: "notes" } },
        me: { kind: "human" },
        editor: { agent: "lophn" },
      });
      // 끝난 행을 막는 trigger는 다시 섰다.
      assert.throws(() => after.exec("update runs set state_seq = 2"));
      assert.throws(() => after.exec("update agent_calls set consumed = 1"));
    } finally {
      after.close();
    }
  });
});

test("판 9 layout은 workspace 자리로 옮겨 판 10이 되고, 이미 있는 파일은 덮지 않는다", async () => {
  await withRoot(async (root) => {
    const from = join(root, "shell", "places");
    const to = join(root, "shell", "workspaces");
    await mkdir(from, { recursive: true });
    await mkdir(to, { recursive: true });
    const agentTab = {
      kind: "agent",
      key: "agent:1",
      agent: "lophn",
      work_place: { kind: "app", id: APP },
    };
    const layout = {
      schema_version: 9,
      active_desk: "_default",
      desks: {
        _default: {
          tabs: [agentTab],
          floats: [{ tab: { ...agentTab, key: "agent:2" } }],
        },
      },
    };
    await writeFile(join(from, `${PRJ}.json`), JSON.stringify(layout));
    await writeFile(join(from, "home.json"), "old home");
    await writeFile(join(to, "home.json"), "new home");

    assert.equal((await workspaceLayoutsStep.run(root, stepDeps)).ok, true);
    const moved = JSON.parse(await readFile(join(to, `${PRJ}.json`), "utf8"));
    const { work_place: _, ...rest } = agentTab;
    const renamed = { ...rest, workspace: { kind: "app", id: APP } };
    assert.deepEqual(moved, {
      schema_version: 10,
      active_desk: "_default",
      desks: {
        _default: {
          tabs: [renamed],
          floats: [{ tab: { ...renamed, key: "agent:2" } }],
        },
      },
    });
    assert.equal(await readFile(join(to, "home.json"), "utf8"), "new home");
    assert.deepEqual(await readdir(from), ["home.json"]);
    // 다시 돌아도 같다.
    assert.equal((await workspaceLayoutsStep.run(root, stepDeps)).ok, true);
    assert.deepEqual(
      JSON.parse(await readFile(join(to, `${PRJ}.json`), "utf8")),
      moved,
    );
  });
});

test("call 정책과 workflow 파일의 place는 workspace로 바뀌고 나머지 글은 그대로다", async () => {
  await withRoot(async (root) => {
    const policy = {
      places: [
        {
          from: { kind: "home", id: "" },
          to: { kind: "project", id: PRJ },
          allow: false,
        },
      ],
      agents: [],
    };
    await writeFile(
      join(root, "settings.json"),
      JSON.stringify({
        "lophn-agent.call_policy": policy,
        "shell.theme": "dark",
      }),
    );
    const folder = join(root, "projects", PRJ, "workflows", "review");
    await mkdir(folder, { recursive: true });
    const yaml = [
      "# 검토 workflow",
      "participants:",
      "  writer: { agent: lophn, place: { app: notes } } # 앱에서 쓴다",
      "  editor:",
      "    agent: reviewer",
      '    "place":',
      "      project: site",
      "  me: { kind: human }",
      "steps:",
      "  draft: { by: writer, next: end }",
      "  place: { by: editor, next: end }",
      "",
    ].join("\n");
    await writeFile(join(folder, "workflow.yaml"), yaml);
    const flow = [
      'const place = "kept";',
      'await agent({ agent: "lophn", place: { app: "notes" } });',
      "await agent({ agent: 'x', 'place': {'project': 'site'} });",
      "",
    ].join("\n");
    await writeFile(join(folder, "flow.ts"), flow);

    assert.equal((await callPolicyWorkspacesStep.run(root, stepDeps)).ok, true);
    assert.equal((await workflowWorkspaceStep.run(root, stepDeps)).ok, true);

    assert.deepEqual(
      JSON.parse(await readFile(join(root, "settings.json"), "utf8")),
      {
        "lophn-agent.call_policy": { workspaces: policy.places, agents: [] },
        "shell.theme": "dark",
      },
    );
    assert.equal(
      await readFile(join(folder, "workflow.yaml"), "utf8"),
      yaml
        .replace("place: { app: notes }", "workspace: { app: notes }")
        .replace('"place":', '"workspace":'),
    );
    assert.equal(
      await readFile(join(folder, "flow.ts"), "utf8"),
      [
        'const place = "kept";',
        'await agent({ agent: "lophn", workspace: { app: "notes" } });',
        "await agent({ agent: 'x', 'workspace': {'project': 'site'} });",
        "",
      ].join("\n"),
    );
  });
});
