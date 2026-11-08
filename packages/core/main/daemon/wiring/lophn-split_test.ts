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
import { manualClock } from "../../../../base/mod.ts";
import {
  callPolicySchema,
  CALL_POLICY_SETTING_KEY,
} from "../../../../protocol/lophn-agent/call-policy.ts";
import { parseAgentFile } from "../../../lophn-agent/agents/definition-file.ts";
import { applyMigrations } from "../../../storage/migration/mod.ts";
import { TEAMS, WIRINGS } from "../assembly.ts";
import { assemble } from "../registration.ts";
import { lophnSplitDataStep } from "./lophn-split.ts";

const PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzza";
const ARCHIVED = "prj_01hzzzzzzzzzzzzzzzzzzzzzzb";
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const AGT = "agt_01hzzzzzzzzzzzzzzzzzzzzzza";
const LOPHNS = [
  "lophn_home",
  `lophn_${PRJ}`,
  `lophn_${ARCHIVED}`,
  `lophn_${APP}`,
];

// core가 내는 schema step 전체(마지막이 이 분리 step)다.
function registeredSteps() {
  const wirings = WIRINGS.map((make) => make());
  const assembled = assemble(TEAMS, {});
  assert.ok(assembled.ok);
  return [
    ...wirings.flatMap((wiring) => wiring.schemaSteps ?? []),
    ...assembled.value.schemaSteps,
    ...wirings.flatMap((wiring) => wiring.schemaStepsAfterTeams ?? []),
  ];
}

const LOPHN_MD = `---
name: Lophn
mcp_servers:
  - name: gh
    enabled: true
    call_timeout_ms: 30000
    transport: http
    http:
      url: https://mcp.example.com/mcp
      headers: {}
      auth:
        kind: bearer
        credential:
          secret: mcp.lophn.gh
apps:
  - notes
---
Always answer in Korean.
`;

const TAB = (workspace: unknown) => ({
  schema_version: 10,
  desks: {
    _default: {
      tabs: [
        { kind: "agent", key: "agent:lophn:1", agent: "lophn", workspace },
      ],
    },
  },
});

async function files(root: string, sub: string) {
  return (await readdir(join(root, sub))).sort();
}

// 옛 모양의 root(전역 lophn.md, `lophn` id로 저장된 session·job·run·call·share request, call 정책 규칙, MCP token)를
// 옮기면 모든 workspace의 lophn이 같은 값을 갖고 옛 `lophn` id가 남지 않으며, 다시 돌려도 같다.
test("옛 root를 옮기면 모든 workspace의 lophn이 같은 값을 갖고 옛 lophn id가 남지 않으며 다시 돌려도 같다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-split-"));
  try {
    const steps = registeredSteps();
    const deps = { clock: manualClock(0) };
    const ledger = join(root, "lophn.db");
    const before = await applyMigrations(ledger, steps.slice(0, -1), deps);
    assert.ok(before.ok);
    const db = new DatabaseSync(ledger);
    db.exec("pragma foreign_keys = off");
    for (const [id, name, status] of [
      [PRJ, "p1", "active"],
      [ARCHIVED, "p2", "archived"],
    ]) {
      db.prepare(
        "insert into projects (id, name, title, purpose, revision, status) values (?, ?, ?, '', '1', ?)",
      ).run(id, name, name, status);
    }
    db.prepare(
      `insert into apps (id, slug, name, description, run_enabled, revision, status)
       values (?, 'notes', 'Notes', 'd', 1, '1', 'active')`,
    ).run(APP);
    const session = db.prepare(
      `insert into sessions (id, agent, project, app, workspace_kind, workspace_id, created_seq, state_seq)
       values (?, ?, ?, ?, ?, ?, 1, 1)`,
    );
    session.run("ses_home", "lophn", null, null, null, null);
    session.run("ses_prj", "lophn", PRJ, null, "project", PRJ);
    session.run("ses_app", "lophn", null, APP, "app", APP);
    session.run("ses_agt", AGT, PRJ, null, "project", PRJ);
    const job = db.prepare(
      `insert into jobs (id, title, creator_agent, creator_workspace, every, action, missed_policy, enabled, created_at, updated_at)
       values (?, 't', ?, ?, '1h', ?, 'run', 1, 'x', 'x')`,
    );
    job.run(
      "job_1",
      "lophn",
      PRJ,
      JSON.stringify({
        kind: "agent_run",
        agent: "lophn",
        agent_workspace: { kind: "project", id: PRJ },
        prompt: "p",
      }),
    );
    job.run(
      "job_2",
      "lophn",
      null,
      JSON.stringify({
        kind: "agent_run",
        agent: "lophn",
        agent_workspace: null,
        prompt: "p",
      }),
    );
    const run = db.prepare(
      `insert into runs (id, kind, target, session_opened, state, result, created_at, finished_at, state_seq, agent_key, workspace_key)
       values (?, 'agent', ?, 0, 'done', 'null', 'x', 'x', 1, ?, null)`,
    );
    run.run(
      "run_1",
      JSON.stringify({
        agent: { agent: "lophn", workspace: { kind: "project", id: PRJ } },
      }),
      `lophn@${PRJ}`,
    );
    run.run(
      "run_2",
      JSON.stringify({ agent: { agent: "lophn", workspace: null } }),
      "lophn",
    );
    db.prepare(
      `insert into agent_calls (call, from_session, "to", reply, state, created_at, state_at)
       values ('cal_1', 'ses_agt', ?, 'none', 'done', 'x', 'x')`,
    ).run(
      JSON.stringify({
        kind: "new_session",
        agent: { agent: "lophn", workspace: { kind: "app", id: APP } },
      }),
    );
    db.prepare(
      `insert into share_requests (app, agents, coding_agents, reason, session, requested_at)
       values (?, ?, 0, 'r', 'ses_agt', 'x')`,
    ).run(APP, JSON.stringify(["lophn", AGT]));
    db.close();

    await mkdir(join(root, "agents"));
    await writeFile(join(root, "agents", "lophn.md"), LOPHN_MD);
    await writeFile(join(root, "agents", `${AGT}.md`), "---\nname: A\n---\n");
    await writeFile(
      join(root, "settings.json"),
      JSON.stringify({
        other: 1,
        [CALL_POLICY_SETTING_KEY]: {
          private: [],
          workspaces: [],
          agents: [
            { from: "lophn", to: AGT, allow: false },
            { from: AGT, to: "lophn", allow: false },
            { from: "lophn", to: "lophn", allow: false },
          ],
        },
      }),
      { mode: 0o600 },
    );
    const oauth = (part: string) => `mcp-oauth.lophn.gh.${part}`;
    await writeFile(
      join(root, "secrets.json"),
      JSON.stringify({
        "mcp.lophn.gh": "key",
        [oauth("access")]: "a",
        [oauth("refresh")]: "r",
        [oauth("meta")]: "{}",
        "mcp-oauth.global.gh.access": "g",
        "provider.x": "p",
      }),
      { mode: 0o600 },
    );
    await mkdir(join(root, "shell", "workspaces"), { recursive: true });
    await writeFile(
      join(root, "shell", "workspaces", `${PRJ}.json`),
      JSON.stringify(TAB({ kind: "project", id: PRJ })),
    );
    await writeFile(
      join(root, "shell", "workspaces", "home.json"),
      JSON.stringify(TAB({ kind: "home" })),
    );

    // ledger step은 실제 목록의 마지막 step으로 적용하고, data step은 그 뒤에 돈다.
    const applied = await applyMigrations(ledger, steps, deps);
    assert.deepStrictEqual(applied, { ok: true, value: 1 });
    const first = await lophnSplitDataStep.run(root);
    assert.ok(first.ok);

    const check = new DatabaseSync(ledger);
    const agents = (table: string, column: string) =>
      check
        .prepare(`select ${column} as v from ${table} order by 1`)
        .all()
        .map((row) => String(row["v"]));
    assert.deepStrictEqual(
      check
        .prepare("select id, agent from sessions order by id")
        .all()
        .map((row) => `${row["id"]}=${row["agent"]}`),
      [
        `ses_agt=${AGT}`,
        `ses_app=lophn_${APP}`,
        "ses_home=lophn_home",
        `ses_prj=lophn_${PRJ}`,
      ],
    );
    assert.deepStrictEqual(agents("jobs", "creator_agent"), [
      "lophn_home",
      `lophn_${PRJ}`,
    ]);
    assert.deepStrictEqual(agents("jobs", "action ->> '$.agent'"), [
      "lophn_home",
      `lophn_${PRJ}`,
    ]);
    assert.deepStrictEqual(agents("runs", "target ->> '$.agent.agent'"), [
      "lophn_home",
      `lophn_${PRJ}`,
    ]);
    assert.deepStrictEqual(agents("runs", "agent_key"), [
      "lophn_home",
      `lophn_${PRJ}@${PRJ}`,
    ]);
    assert.deepStrictEqual(agents("agent_calls", `"to" ->> '$.agent.agent'`), [
      `lophn_${APP}`,
    ]);
    assert.deepStrictEqual(
      JSON.parse(agents("share_requests", "agents")[0]!).sort(),
      [AGT, ...LOPHNS].sort(),
    );
    // 끝난 행을 막는 trigger는 다시 서 있다.
    assert.throws(() =>
      check.exec("update runs set state = 'running' where id = 'run_1'"),
    );
    assert.throws(() =>
      check.exec("update sessions set agent = 'x' where id = 'ses_home'"),
    );
    check.close();

    // 전역 정의는 모든 workspace의 lophn으로 복사되고(secret 이름만 그 lophn의 것) 전역 file은 없다.
    assert.deepStrictEqual(
      await files(root, "agents"),
      [`${AGT}.md`, ...LOPHNS.map((id) => `${id}.md`)].sort(),
    );
    for (const id of LOPHNS) {
      const text = await readFile(join(root, "agents", `${id}.md`), "utf8");
      assert.equal(text, LOPHN_MD.replace("mcp.lophn.gh", `mcp.${id}.gh`));
      const parsed = parseAgentFile(text, { agent: id as never });
      assert.ok(parsed.ok, id);
      assert.equal(parsed.value.mcp_servers?.length, 1);
    }

    const settings = JSON.parse(
      await readFile(join(root, "settings.json"), "utf8"),
    );
    assert.equal(settings.other, 1);
    const policy = callPolicySchema.parse(settings[CALL_POLICY_SETTING_KEY]);
    // lophn→agt(4) + agt→lophn(4) + lophn→lophn(4x4)
    assert.equal(policy.agents.length, 24);
    assert.equal(policy.agents[0]?.from, "lophn_home");

    const secrets = JSON.parse(
      await readFile(join(root, "secrets.json"), "utf8"),
    );
    assert.equal(Object.keys(secrets).length, 2 + LOPHNS.length * 4);
    for (const id of LOPHNS) {
      assert.equal(secrets[`mcp.${id}.gh`], "key");
      assert.equal(secrets[`mcp-oauth.${id}.gh.refresh`], "r");
    }
    assert.equal(secrets["provider.x"], "p");

    const layout = (key: string) =>
      readFile(join(root, "shell", "workspaces", `${key}.json`), "utf8");
    assert.match(await layout(PRJ), new RegExp(`"agent":"lophn_${PRJ}"`));
    assert.match(await layout("home"), /"agent":"lophn_home"/);

    // 옛 id가 어디에도 남지 않는다: 이름과 값 어디에도 `lophn` 단독 id가 없다.
    const all = await Promise.all([
      readFile(join(root, "settings.json"), "utf8"),
      readFile(join(root, "secrets.json"), "utf8"),
      layout(PRJ),
      layout("home"),
    ]);
    for (const text of all) {
      assert.doesNotMatch(
        text,
        /"agent":"lophn"|"(from|to)":"lophn"|\.lophn\./,
      );
    }

    // 두 번 돌려도 같다.
    const snapshot = async () =>
      JSON.stringify([
        await files(root, "agents"),
        ...(await Promise.all(
          ["settings.json", "secrets.json"].map((name) =>
            readFile(join(root, name), "utf8"),
          ),
        )),
        await layout(PRJ),
      ]);
    const once = await snapshot();
    const second = await lophnSplitDataStep.run(root);
    assert.ok(second.ok);
    assert.equal(await snapshot(), once);
    assert.deepStrictEqual(await applyMigrations(ledger, steps, deps), {
      ok: true,
      value: 0,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
