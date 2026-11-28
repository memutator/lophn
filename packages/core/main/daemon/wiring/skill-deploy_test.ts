import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { CODING_DEPLOYED_SKILLS_SETTING_KEY } from "../../../../protocol/lophn-agent/skill-settings.ts";
import type { ReleaseRecord } from "../../../../protocol/apps/mod.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";
import { PROJECT_LAYER } from "../../../agent-workspaces/workspace/project-layer.ts";
import { projectsSchemaSteps } from "../../../projects/registry/schema.ts";
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
  // harness는 누구든 agent가 묻는다.
  for (const [name, who] of rows) {
    assert.equal(mayDeployWithoutAsking(who, APP, "harness"), false, name);
  }
});

// 앱 `notes`(public skill guide와 비공개 skill internal)와 agent 정의 하나, 설정 대신 메모리 값을 쓰는 임시 data root다.
async function withRoot(
  run: (t: {
    root: string;
    global: {
      value: object[];
      harness: object[];
      keys: string[];
      off: string[];
    };
    deployments: ReturnType<typeof createSkillDeployments>;
    ctx: Parameters<typeof createSkillDeployments>[0];
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "lophn-skill-deploy-"));
  try {
    const db = new DatabaseSync(join(root, "lophn.db"));
    for (const step of [
      ...projectsSchemaSteps,
      ...appsSchemaSteps,
      ...releasesSchemaSteps,
    ]) {
      db.exec(step.sql);
    }
    db.prepare(
      "INSERT INTO projects (id, name, title, purpose, revision, status) VALUES (?, 'Household', 'Household', '', '1', 'active')",
    ).run(PROJECT.id);
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
    const global = {
      value: [] as object[],
      harness: [] as object[],
      keys: [] as string[],
      off: [] as string[],
    };
    const ctx = {
      ledgerPath: join(root, "lophn.db"),
      root: { path: root },
      settings: {
        get: (setting: { key: string }) =>
          setting.key === "lophn-agent.extensions.skills_off"
            ? global.off
            : setting.key === CODING_DEPLOYED_SKILLS_SETTING_KEY
              ? global.harness
              : global.value,
      },
      settingsUpdate: (changes: { key: string; value: object[] }[]) => {
        global.keys.push(changes[0].key);
        if (changes[0].key === CODING_DEPLOYED_SKILLS_SETTING_KEY) {
          global.harness = changes[0].value;
        } else {
          global.value = changes[0].value;
        }
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

const guide = { app: APP, skill: "guide" };

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
    const workspaceOff = (off: string[]) =>
      writeFile(
        workspaceFile,
        JSON.stringify({
          mcp_servers: [],
          skills_off: off,
          mcp_off: [],
          deployed_skills: [],
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
    await agentFile(`deployed_skills:\n  - app: ${APP}\n    skill: guide\n`);
    assert.equal(await reaches(), true, "agent layer");
    await agentFile(
      `deployed_skills:\n  - app: ${APP}\n    skill: internal\n  - app: ${APP}\n    skill: gone\n`,
    );
    assert.equal(await reaches(), false, "a skill that is not public or gone");
    assert.equal(
      await reaches({ kind: "app", id: APP } as never),
      true,
      "the app's own workspace",
    );

    // 기록은 앱을 id로 가리킨다: 다른 id(지운 앱의 기록)는 같은 slug·skill 이름이어도 닿지 않는다.
    global.value = [{ app: OTHER, skill: "guide" }];
    assert.equal(await reaches(), false, "another app's id");

    // 받지 않는 skill은 닿지 않는다: 전역, workspace, agent 어느 층에서 꺼도 그 이름의 배포는 앱에 닿게 하지 못한다.
    global.value = [guide];
    assert.equal(await reaches(), true);
    global.off = ["guide"];
    assert.equal(await reaches(), false, "switched off globally");
    global.off = [];
    await workspaceOff(["guide"]);
    assert.equal(await reaches(), false, "switched off in the workspace");
    await workspaceOff([]);
    await agentFile("skills_off:\n  - guide\n");
    assert.equal(await reaches(), false, "switched off for the agent");
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
              : session === "ses_01hzzzzzzzzzzzzzzzzzzzzzza"
                ? {
                    agent: "lophn_app" as never,
                    workspace: { kind: "app", id: APP } as const,
                  }
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

    // 터미널 coding agent(harness)는 agent가 쓴 글이 사람의 coding agent의 전역 skill 폴더에 쓰이는 일이라(shell이 있고 Gate가 없다) 앱 자기
    // workspace의 agent와 Home의 lophn도 묻는다. 사람만 카드 없이 한다. 묻지 못하는 호출(tool call 없음)은 거절한다.
    const APP_SESSION = "ses_01hzzzzzzzzzzzzzzzzzzzzzza";
    global.value = [];
    global.keys = [];
    assert.ok((await deploy(person, input("harness"))).ok);
    assert.deepStrictEqual(global.keys, [CODING_DEPLOYED_SKILLS_SETTING_KEY]);
    const askedBefore = asked.length;
    for (const session of [APP_SESSION, HOME_SESSION, PROJECT_SESSION]) {
      global.harness = [];
      const unaskable = await deploy(asAgent(session), input("harness"));
      assert.ok(!unaskable.ok && unaskable.error.code === "forbidden");
      assert.deepStrictEqual(global.harness, []);
    }
    assert.equal(asked.length, askedBefore);
    for (const session of [APP_SESSION, HOME_SESSION]) {
      global.harness = [];
      answer = "rejected";
      const refused = await deploy(
        asAgent(session),
        input("harness", { tool_call: "tcl_01hzzzzzzzzzzzzzzzzzzzzzza" }),
      );
      assert.ok(!refused.ok && refused.error.code === "forbidden");
      assert.deepStrictEqual(global.harness, []);
      answer = "run";
      assert.ok(
        (
          await deploy(
            asAgent(session),
            input("harness", { tool_call: "tcl_01hzzzzzzzzzzzzzzzzzzzzzza" }),
          )
        ).ok,
      );
      assert.deepStrictEqual(global.harness, [guide]);
    }
    assert.equal(asked.length, askedBefore + 4);
    global.value = [];
    global.harness = [];

    // 모든 workspace에 `lophn`이 있다: 사람이 workspace 없이 주면 후보를 알리며 거절하고, agent session이 주면 자기 workspace의 lophn이다.
    const ambiguous = await deploy(person, input("agent:lophn"));
    assert.ok(!ambiguous.ok && ambiguous.error.code === "invalid_input");
    assert.match(ambiguous.error.message, /agent:lophn@home/);
    assert.ok((await deploy(person, input("agent:lophn@home"))).ok);
    assert.match(
      await readFile(join(root, "agents", "lophn_home.md"), "utf8"),
      /skill: guide/,
    );
    await rm(join(root, "agents", "lophn_home.md"));
    assert.ok((await deploy(asAgent(HOME_SESSION), input("agent:lophn"))).ok);
    assert.match(
      await readFile(join(root, "agents", "lophn_home.md"), "utf8"),
      /skill: guide/,
    );
    global.value = [];

    // Home의 lophn은 묻지 않고 한다.
    global.value = [];
    assert.ok((await deploy(asAgent(HOME_SESSION), input("global"))).ok);
    assert.deepStrictEqual(global.value, [guide]);
    assert.equal(asked.length, askedBefore + 4);
  });
});

// 권한 경계다. `always`는 부른 session의 workspace 층에만 쓰고(전역이나 다른 agent에게 넓히지 않는다), 앱을 지우거나 보관하면 어느 자리에도 그 앱의 기록이 남지 않는다.
test("always 배포는 그 workspace 층에만 쓰고, 앱을 지우면 모든 자리의 배포가 거두어진다", async () => {
  await withRoot(async ({ root, global, deployments }) => {
    const workspaceFile = PROJECT_LAYER.extensionsFile(root, PROJECT);
    const agentFileText = () =>
      readFile(join(root, "agents", `${AGENT}.md`), "utf8");
    const deployed = async () =>
      JSON.parse(await readFile(workspaceFile, "utf8")).deployed_skills;

    const added = await deployments.deployAll(
      { layer: "workspace", workspace: PROJECT },
      APP,
    );
    assert.deepStrictEqual(added, ok(["guide"]));
    assert.deepStrictEqual(await deployed(), [guide]);
    assert.deepStrictEqual(global.keys, [], "no setting written");
    assert.doesNotMatch(await agentFileText(), /deployed_skills/);

    // 모든 자리에 이 앱과 다른 앱(OTHER)의 기록을 둔다.
    const other = { app: OTHER, skill: "guide" };
    global.value = [guide, other];
    global.harness = [guide, other];
    await writeFile(
      workspaceFile,
      JSON.stringify({
        mcp_servers: [],
        skills_off: [],
        mcp_off: [],
        deployed_skills: [guide, other],
      }),
    );
    await writeFile(
      join(root, "agents", `${AGENT}.md`),
      `---\nhandle: helper\nname: helper\ndeployed_skills:\n  - app: ${APP}\n    skill: guide\n  - app: ${OTHER}\n    skill: guide\n---\nbody\n`,
    );
    const logged: string[] = [];
    await deployments.strip(APP, (message) => logged.push(message));
    assert.deepStrictEqual(global.value, [other]);
    assert.deepStrictEqual(global.harness, [other]);
    assert.deepStrictEqual(await deployed(), [other]);
    const agent = await agentFileText();
    assert.doesNotMatch(agent, new RegExp(APP));
    assert.match(agent, new RegExp(OTHER));
    assert.deepStrictEqual(logged, []);
  });
});

// 의존이 보여야 한다. 앱이 skill을 바꾸거나 지울 때 그 skill을 받는 자리는 전역, harness, workspace, agent 어디든 같은 목록에서 나오고,
// 앱이 더는 내놓지 않는 기록도 목록에 남아 거둘 수 있다(받는 쪽은 말없이 빼므로 여기서만 보인다).
test("앱의 skill을 받는 자리는 모든 층에서 한 목록으로 나오고, 앱이 더는 내놓지 않는 기록은 provided false로 보인다", async () => {
  await withRoot(async ({ root, global, deployments }) => {
    const gone = { app: APP, skill: "internal" };
    global.value = [guide, gone];
    global.harness = [guide];
    await mkdir(join(PROJECT_LAYER.extensionsFile(root, PROJECT), ".."), {
      recursive: true,
    });
    await writeFile(
      PROJECT_LAYER.extensionsFile(root, PROJECT),
      JSON.stringify({
        mcp_servers: [],
        skills_off: [],
        mcp_off: [],
        deployed_skills: [guide],
      }),
    );
    await writeFile(
      join(root, "agents", `${AGENT}.md`),
      `---\nhandle: helper\nname: helper\ndeployed_skills:\n  - app: ${APP}\n    skill: guide\n---\nbody\n`,
    );

    const places = await deployments.receivers(APP, ["guide"]);
    assert.ok(places.ok);
    assert.deepStrictEqual(places.value.found.map((one) => one.layer).sort(), [
      "agent",
      "global",
      "harness",
      "workspace",
    ]);
    // 앱이 내놓지 않는 skill은 받는 것이 아니다.
    const none = await deployments.receivers(APP, ["internal"]);
    assert.ok(none.ok);
    assert.deepStrictEqual(none.value.found, []);

    const listed = await deployments.list("notes");
    assert.ok(listed.ok);
    assert.deepStrictEqual(
      listed.value.rows
        .filter((one) => one.layer === "global")
        .map((one) => [one.skill, one.provided]),
      [
        ["guide", true],
        ["internal", false],
      ],
    );
  });
});

// 데이터 보존이다. 앱을 보관해도 배포 기록은 그대로이고(되살리면 다시 닿는다), 보관한 동안은 아무도 받지 않으며 목록과 지우기 창이 그 기록을 보인다.
test("앱을 보관하면 배포 기록은 남고 아무에게도 닿지 않으며, 되살리면 다시 닿는다", async () => {
  await withRoot(async ({ global, deployments, ctx }) => {
    global.value = [guide];
    const who = { agent: AGENT, workspace: PROJECT };
    const setStatus = (status: string) => {
      const db = new DatabaseSync((ctx as { ledgerPath: string }).ledgerPath);
      db.prepare(
        "UPDATE apps SET status = ?, run_enabled = 0 WHERE id = ?",
      ).run(status, APP);
      db.close();
    };
    const reached = async () => {
      const access = await deployments.appAccess(who, APP);
      assert.ok(access.ok);
      return access.value.reached;
    };
    assert.equal(await reached(), true);

    setStatus("archived");
    assert.equal(await reached(), false);
    assert.deepStrictEqual(global.value, [guide], "the record stays");
    const listed = await deployments.list("notes");
    assert.ok(listed.ok);
    assert.deepStrictEqual(
      listed.value.rows.map((one) => [one.provided, one.archived]),
      [[false, true]],
    );
    // 지우기 창이 지울 기록을 보인다.
    const places = await deployments.receivers(APP);
    assert.ok(places.ok);
    assert.equal(places.value.found.length, 1);

    setStatus("active");
    assert.equal(await reached(), true);
  });
});

// P12. 배포 목록은 누가 묻느냐에 따라 보이는 범위가 다르다: 다른 agent에게 다른 workspace의 이름과 그 skill이 새면 안 된다.
// 사람과 Home의 lophn은 모두 보고, 다른 agent는 자기에게 닿는 자리만, 자기 앱을 물은 앱 session은 다른 자리를 수로만 받는다.
test("배포 목록은 agent에게 자기에게 닿는 자리만 보이고 자기 앱의 다른 자리는 수로만 센다", async () => {
  await withRoot(async ({ root, global, deployments, ctx }) => {
    global.value = [guide];
    await mkdir(join(PROJECT_LAYER.extensionsFile(root, PROJECT), ".."), {
      recursive: true,
    });
    await writeFile(
      PROJECT_LAYER.extensionsFile(root, PROJECT),
      JSON.stringify({
        mcp_servers: [],
        skills_off: [],
        mcp_off: [],
        deployed_skills: [guide],
      }),
    );
    await writeFile(
      join(root, "agents", `${AGENT}.md`),
      `---\nhandle: helper\nname: helper\ndeployed_skills:\n  - app: ${APP}\n    skill: guide\n---\nbody\n`,
    );
    const sessions: Record<string, { agent: never; workspace: unknown }> = {
      ses_01hzzzzzzzzzzzzzzzzzzzzzzp: {
        agent: AGENT,
        workspace: PROJECT,
      },
      ses_01hzzzzzzzzzzzzzzzzzzzzzza: {
        agent: "lophn_app" as never,
        workspace: { kind: "app", id: APP },
      },
      ses_01hzzzzzzzzzzzzzzzzzzzzzzh: {
        agent: "lophn_home" as never,
        workspace: null,
      },
    };
    const handlers = new Map(
      createSkillDeployHandlers({
        deployments,
        ledgerPath: (ctx as { ledgerPath: string }).ledgerPath,
        sessionOf: (session) => ok((sessions[session] ?? null) as never),
        askPerson: () => Promise.resolve(ok({ kind: "run" as const })),
      }),
    );
    const read = async (who: string, input: object = {}) => {
      const actor = who === "user" ? "user" : `agent:${who}`;
      const done = await handlers.get("skills/deployments")!(
        { actor, conditions: {} } as never,
        input,
      );
      assert.ok(done.ok);
      return done.value as {
        deployments: { layer: string; at: string | null }[];
        others: number;
      };
    };
    const places = (out: {
      deployments: { layer: string; at: string | null }[];
    }) => out.deployments.map((one) => `${one.layer}:${one.at ?? ""}`).sort();

    assert.deepStrictEqual(places(await read("user")), [
      "agent:helper",
      "global:",
      `workspace:${PROJECT.id}`,
    ]);
    assert.deepStrictEqual(
      places(await read("ses_01hzzzzzzzzzzzzzzzzzzzzzzh")),
      ["agent:helper", "global:", `workspace:${PROJECT.id}`],
    );
    // project의 agent는 자기 project와 전역만 본다. 다른 workspace의 이름도 그 agent도 없다.
    assert.deepStrictEqual(
      places(await read("ses_01hzzzzzzzzzzzzzzzzzzzzzzp")),
      ["global:", `workspace:${PROJECT.id}`],
    );
    // 앱 session이 자기 앱을 물으면 전역 줄과 다른 자리의 수만 받는다(project 하나와 agent 하나).
    const own = await read("ses_01hzzzzzzzzzzzzzzzzzzzzzza", { app: "notes" });
    assert.deepStrictEqual(places(own), ["global:"]);
    assert.equal(own.others, 2);
  });
});
