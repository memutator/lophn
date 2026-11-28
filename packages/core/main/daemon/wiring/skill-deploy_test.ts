import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { ReleaseRecord } from "../../../../protocol/apps/mod.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";
import { PROJECT_LAYER } from "../../../agent-workspaces/workspace/project-layer.ts";
import { appsSchemaSteps } from "../../../apps/registration/schema.ts";
import { releasesSchemaSteps } from "../../../apps/releases/schema.ts";
import { insertRelease } from "../../../apps/releases/store.ts";
import { ok } from "../../../../base/mod.ts";
import {
  createSkillDeployHandlers,
  createSkillDeployments,
  mayDeployWithoutAsking,
} from "./skill-deploy.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const OTHER = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";
const AGENT = "agt_01hzzzzzzzzzzzzzzzzzzzzzza" as never;
const PROJECT = {
  kind: "project",
  id: "prj_01hzzzzzzzzzzzzzzzzzzzzzza",
} as const;

// 권한 경계다. agent가 다른 agent의 prompt에 앱을 들이는 길이라, 앱 자기 workspace의 agent와 Home의 lophn 말고는 사람에게 묻는다.
test("앱 자기 workspace의 agent와 Home의 lophn만 묻지 않고 배포한다", () => {
  const rows: [
    string,
    Parameters<typeof mayDeployWithoutAsking>[0],
    boolean,
  ][] = [
    [
      "agent in the app's own workspace",
      { agent: "lophn_app" as never, workspace: { kind: "app", id: APP } },
      true,
    ],
    ["Home lophn", { agent: "lophn_home" as never, workspace: null }, true],
    [
      "agent in another app's workspace",
      { agent: "lophn_app" as never, workspace: { kind: "app", id: OTHER } },
      false,
    ],
    [
      "project lophn",
      { agent: "lophn_prj_1" as never, workspace: PROJECT },
      false,
    ],
    ["another agent at Home", { agent: AGENT, workspace: null }, false],
  ];
  for (const [name, who, want] of rows) {
    assert.equal(mayDeployWithoutAsking(who, APP), want, name);
  }
});

// 앱 `notes`(public skill guide와 비공개 skill internal)와 agent 정의 하나, 설정 대신 메모리 값을 쓰는 임시 data root다.
async function withRoot(
  run: (t: {
    root: string;
    global: { value: object[] };
    deployments: ReturnType<typeof createSkillDeployments>;
    ctx: Parameters<typeof createSkillDeployments>[0];
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "lophn-skill-deploy-"));
  try {
    const db = new DatabaseSync(join(root, "lophn.db"));
    for (const step of [...appsSchemaSteps, ...releasesSchemaSteps]) {
      db.exec(step.sql);
    }
    // agent 목록이 project 표를 읽는다. 비어 있어도 표는 있어야 한다.
    db.exec("create table projects (id text primary key)");
    db.prepare(
      "INSERT INTO apps VALUES (?, 'notes', 'n', 'd', NULL, NULL, NULL, 1, '1', 'active')",
    ).run(APP);
    const sql = {
      run: (text: string, params: never[]) => db.prepare(text).run(...params),
      get: (text: string, params: never[]) =>
        db.prepare(text).get(...params) as Record<string, never> | undefined,
      all: (text: string, params: never[]) =>
        db.prepare(text).all(...params) as Record<string, never>[],
    };
    const release = {
      id: "rel_01hzzzzzzzzzzzzzzzzzzzzzz1",
      app: APP,
      number: 1,
      code_commit: "0".repeat(40),
      bundle_hash: "0".repeat(64),
      declaration_hash: "0".repeat(64),
      data_schema: 1,
      data_changes: [],
      created_by: "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza",
      created_at: "2026-10-16T00:00:00.000Z",
      status: "prepared",
    } as unknown as ReleaseRecord;
    insertRelease(
      { sql } as unknown as Tx,
      release,
      JSON.stringify({
        commands: [],
        skills: [
          { name: "guide", public: true, commands: [] },
          { name: "internal", public: false, commands: [] },
        ],
      }),
      {} as never,
    );
    db.prepare(
      "UPDATE releases SET status = 'active', activated_at = ? WHERE id = ?",
    ).run(release.created_at, release.id);
    db.close();
    await mkdir(join(root, "agents"));
    await writeFile(
      join(root, "agents", `${AGENT}.md`),
      "---\nhandle: helper\nname: helper\n---\nbody\n",
    );
    const global = { value: [] as object[] };
    const ctx = {
      ledgerPath: join(root, "lophn.db"),
      root: { path: root },
      settings: { get: () => global.value },
      settingsUpdate: (changes: { value: object[] }[]) => {
        global.value = changes[0].value;
        return { ok: true, value: { rejected: [] } };
      },
    } as never;
    await run({
      root,
      global,
      deployments: createSkillDeployments(ctx),
      ctx,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const guide = { app: "notes", skill: "guide" };

// 권한 경계다. 앱 skill이 전역, workspace, agent 어느 층에 배포돼도 그 session은 앱에 닿고(호출이 묻지 않는다), 배포가 없거나 skill이 public이 아니면 닿지 않는다.
test("앱에 닿는지는 세 층의 배포와 active release의 public skill로 정해진다", async () => {
  await withRoot(async ({ root, global, deployments }) => {
    const agentFile = (deployed: string) =>
      writeFile(
        join(root, "agents", `${AGENT}.md`),
        `---\nhandle: helper\nname: helper\n${deployed}---\nbody\n`,
      );
    const workspaceFile = PROJECT_LAYER.extensionsFile(root, PROJECT);
    await mkdir(join(workspaceFile, ".."), { recursive: true });
    const workspaceDeploys = (list: object[]) =>
      writeFile(
        workspaceFile,
        JSON.stringify({
          mcp_servers: [],
          skills_off: [],
          mcp_off: [],
          deployed_skills: list,
        }),
      );
    const reaches = async (workspace = PROJECT) => {
      const access = await deployments.appAccess(
        { agent: AGENT, workspace },
        APP as never,
      );
      assert.ok(access.ok);
      return access.value.reached;
    };

    assert.equal(await reaches(), false, "nothing deployed");
    global.value = [guide];
    assert.equal(await reaches(), true, "global layer");
    global.value = [];
    await workspaceDeploys([guide]);
    assert.equal(await reaches(), true, "workspace layer");
    await workspaceDeploys([]);
    await agentFile("deployed_skills:\n  - app: notes\n    skill: guide\n");
    assert.equal(await reaches(), true, "agent layer");
    await agentFile(
      "deployed_skills:\n  - app: notes\n    skill: internal\n  - app: notes\n    skill: gone\n",
    );
    assert.equal(await reaches(), false, "a skill that is not public or gone");
    assert.equal(
      await reaches({ kind: "app", id: APP } as never),
      true,
      "the app's own workspace",
    );
  });
});

// 권한 경계다. 앱 자기 workspace의 agent와 Home의 lophn이 아니면 사람의 허락 없이 배포하지 못하고, 사람이 없으면 묻지도 못한다. 사람은 묻지 않고 하고 비공개 skill은 배포하지 못한다.
test("배포 명령은 묻지 않는 자격이 아니면 사람의 허락이 있어야 층을 바꾼다", async () => {
  await withRoot(async ({ root, global, deployments, ctx }) => {
    const asked: string[] = [];
    let answer: "run" | "rejected" = "run";
    const handlers = new Map(
      createSkillDeployHandlers({
        deployments,
        ledgerPath: (ctx as { ledgerPath: string }).ledgerPath,
        sessionOf: (session) =>
          ok(
            session === "ses_01hzzzzzzzzzzzzzzzzzzzzzzp"
              ? { agent: AGENT, workspace: PROJECT }
              : { agent: "lophn_home" as never, workspace: null },
          ),
        askPerson: (_who, input) => {
          asked.push(input.call.lines[0]);
          return Promise.resolve(
            ok(
              answer === "run"
                ? { kind: "run" as const }
                : {
                    kind: "rejected" as const,
                    reason: null,
                    by: "person" as const,
                  },
            ),
          );
        },
      }),
    );
    const deploy = handlers.get("skills/deploy")!;
    const person = { actor: "user", conditions: {} } as never;
    const asAgent = (
      session: string,
      turn = "trn_01hzzzzzzzzzzzzzzzzzzzzzza",
    ) =>
      ({
        actor: `agent:${session}`,
        conditions: { session, turn },
      }) as never;
    const PROJECT_SESSION = "ses_01hzzzzzzzzzzzzzzzzzzzzzzp";
    const HOME_SESSION = "ses_01hzzzzzzzzzzzzzzzzzzzzzzh";
    const input = (to: string, extra: object = {}) => ({
      app: "notes",
      skill: "guide",
      to,
      ...extra,
    });
    const agentLayer = () =>
      readFile(join(root, "agents", `${AGENT}.md`), "utf8");

    // 사람은 묻지 않고 세 층에 한다. 비공개 skill은 배포하지 못한다.
    assert.deepStrictEqual(
      await deploy(person, input("global")),
      ok({ deployed: true }),
    );
    assert.deepStrictEqual(global.value, [guide]);
    assert.deepStrictEqual(
      await deploy(person, input("global")),
      ok({ deployed: false }),
    );
    assert.ok((await deploy(person, input("agent:helper"))).ok);
    assert.match(await agentLayer(), /skill: guide/);
    const refused = await deploy(
      person,
      input("global", { skill: "internal" }),
    );
    assert.ok(!refused.ok && refused.error.code === "invalid_input");
    assert.equal(asked.length, 0);

    // 앱 workspace도 Home lophn도 아닌 agent는 사람에게 묻고 거절하면 층이 바뀌지 않는다. 물을 tool call이 없으면 묻지도 못한다.
    global.value = [];
    answer = "rejected";
    const rejected = await deploy(
      asAgent(PROJECT_SESSION),
      input("global", { tool_call: "tcl_01hzzzzzzzzzzzzzzzzzzzzzza" }),
    );
    assert.ok(!rejected.ok && rejected.error.code === "forbidden");
    const unaskable = await deploy(asAgent(PROJECT_SESSION), input("global"));
    assert.ok(!unaskable.ok && unaskable.error.code === "forbidden");
    assert.equal(asked.length, 1);
    assert.deepStrictEqual(global.value, []);
    answer = "run";
    assert.ok(
      (
        await deploy(
          asAgent(PROJECT_SESSION),
          input("global", { tool_call: "tcl_01hzzzzzzzzzzzzzzzzzzzzzza" }),
        )
      ).ok,
    );
    assert.deepStrictEqual(global.value, [guide]);

    // Home의 lophn은 묻지 않고 한다.
    global.value = [];
    assert.ok((await deploy(asAgent(HOME_SESSION), input("global"))).ok);
    assert.deepStrictEqual(global.value, [guide]);
    assert.equal(asked.length, 2);
  });
});
