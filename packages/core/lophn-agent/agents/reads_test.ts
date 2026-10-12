import { assert, assertEquals } from "@std/assert";
import { APP, ASG, CTX, OTHER_PRJ, PRJ } from "./registration_test.ts";
import {
  type AgentHarness,
  failure,
  issuesOf,
  machineCred,
  openAgents,
  readAgentFile,
  seedFixtureFiles,
  sha256,
  userCred,
  value,
  writeAgentFile,
} from "./harness_test.ts";

// ListAgents·ReadAgent·ReadPlaceAgentSettings. 실제 reader(harness)와 실제 임시 폴더를 쓴다.

const PROJECT = { kind: "project", id: PRJ } as const;
const APP_PLACE = { kind: "app", id: APP } as const;
const OTHER = { kind: "project", id: OTHER_PRJ } as const;

const DATA = new URL("./testdata/", import.meta.url);
const WORKSPACE = JSON.parse(
  Deno.readTextFileSync(new URL("workspace.json", DATA)),
) as { models: Record<string, unknown> };

function fixture<T>(path: string): T {
  return JSON.parse(Deno.readTextFileSync(new URL(path, DATA))) as T;
}

async function withAgents(run: (ctx: AgentHarness) => Promise<void>) {
  const ctx = await openAgents();
  try {
    seedFixtureFiles(ctx.root);
    await run(ctx);
  } finally {
    await ctx.h.close();
  }
}

type Row = {
  assignment: string;
  role: string;
  kind: string;
  name: string;
  profile: unknown;
  model: unknown;
  state: string;
  issues: { field: string; code: string }[];
  counts: {
    contexts: number | null;
    skills: number | null;
    mcp: number | null;
  };
};

async function list(ctx: AgentHarness, place: unknown): Promise<Row[]> {
  const read = value(
    await ctx.h.read({ resource: "agents", method: "list" }, userCred, {
      place,
    }),
  ) as { agents: Row[] };
  return read.agents;
}

function readAgent(ctx: AgentHarness, place: unknown, assignment: string) {
  return ctx.h.read({ resource: "agents", method: "read" }, userCred, {
    place,
    assignment,
  });
}

const workspace = () => layerOf("workspace");
const layerOf = (layer: string) => ({ layer, place: null });
const inPlace = (place: unknown) => ({ layer: "place", place });
const inDefinition = (place: unknown) => ({ layer: "definition", place });

Deno.test("lophn-agent/agents#R7 [agent-I9]: a project lists lophn, Context Engineer and its own Operators in that order", async () => {
  await withAgents(async (ctx) => {
    const rows = await list(ctx, PROJECT);
    assertEquals(rows.map((row) => row.assignment), [
      ASG.lophn,
      ASG.context_engineer,
      ASG.reviewer,
      ASG.scribe,
    ]);
    assertEquals(rows.map((row) => [row.role, row.kind, row.state]), [
      ["lophn", "built_in", "enabled"],
      ["context_engineer", "built_in", "enabled"],
      ["operator", "operator", "enabled"],
      ["operator", "operator", "enabled"],
    ]);
    assertEquals(rows.map((row) => row.name), [
      "lophn",
      "Context Engineer",
      "Reviewer",
      "Scribe",
    ]);
    // 거둔 Operator, 다른 project의 Operator, 앱의 Operator와 App Engineer는 없다.
    for (const other of [ASG.withdrawn, ASG.other_project, ASG.watcher]) {
      assert(!rows.some((row) => row.assignment === other));
    }
    assert(!rows.some((row) => row.role === "app_engineer"));
  });
});

Deno.test("lophn-agent/agents#R7 [agent-I9]: an app lists lophn, its App Engineer and its own Operators, never Context Engineer", async () => {
  await withAgents(async (ctx) => {
    const rows = await list(ctx, APP_PLACE);
    assertEquals(rows.map((row) => row.assignment), [
      ASG.lophn,
      ASG.app_engineer,
      ASG.watcher,
    ]);
    assertEquals(rows.map((row) => row.name), [
      "lophn",
      "App Engineer",
      "Status watcher",
    ]);
  });
});

Deno.test("lophn-agent/agents#R7 [agent-I9]: the built-in rows show the place's own file and settings, not another place's", async () => {
  await withAgents(async (ctx) => {
    const inProject = (await list(ctx, PROJECT))[0];
    const elsewhere = (await list(ctx, OTHER))[0];
    // 같은 전역 lophn assignment라도 자리마다 그 자리의 정의와 설정을 쓴다.
    assertEquals(inProject.assignment, elsewhere.assignment);
    assertEquals(inProject.profile, { kind: "icon", icon: "compass" });
    assertEquals(elsewhere.profile, { kind: "icon", icon: "dock" });
    assertEquals(inProject.model, {
      provider: "pvd_01arz3ndektsv4rrffq69g5fc2",
      model_name: "claude-sonnet",
      source: inPlace(PROJECT),
    });
    assertEquals(elsewhere.model, {
      provider: "pvd_01arz3ndektsv4rrffq69g5fc1",
      model_name: "gpt-5",
      source: workspace(),
    });
  });
});

Deno.test("lophn-agent/agents#R12 [agent-I9]: the model summary carries the layer it came from", async () => {
  await withAgents(async (ctx) => {
    const rows = await list(ctx, PROJECT);
    const byId = new Map(rows.map((row) => [row.assignment, row]));
    // 정의에 model을 둔 Operator.
    assertEquals(byId.get(ASG.reviewer)!.model, {
      provider: "pvd_01arz3ndektsv4rrffq69g5fc1",
      model_name: "gpt-5",
      source: inDefinition(PROJECT),
    });
    // 어느 자리 칸에도 없는 role은 Workspace 역할별 기본을 따른다.
    assertEquals(byId.get(ASG.scribe)!.model, {
      provider: "pvd_01arz3ndektsv4rrffq69g5fc1",
      model_name: "gpt-5-mini",
      source: workspace(),
    });
    assertEquals(byId.get(ASG.context_engineer)!.model, {
      provider: "pvd_01arz3ndektsv4rrffq69g5fc1",
      model_name: "gpt-5-mini",
      source: workspace(),
    });
  });
});

Deno.test("shell/workspace#R36 [agent-I9]: rows count the enabled skills and MCP and the active contexts an Operator picked", async () => {
  await withAgents(async (ctx) => {
    const byId = new Map(
      (await list(ctx, PROJECT)).map((row) => [row.assignment, row]),
    );
    // built-in은 context 수가 없다. 등록은 skill 둘, MCP tool 셋이다.
    assertEquals(byId.get(ASG.lophn)!.counts, {
      contexts: null,
      skills: 2,
      mcp: 3,
    });
    assertEquals(byId.get(ASG.context_engineer)!.counts, {
      contexts: null,
      skills: 2,
      mcp: 3,
    });
    // Reviewer는 spreadsheet skill과 web fetch MCP를 끄고 context 하나를 골랐다.
    assertEquals(byId.get(ASG.reviewer)!.counts, {
      contexts: 1,
      skills: 1,
      mcp: 2,
    });
    // Scribe는 아무것도 바꾸지 않았다.
    assertEquals(byId.get(ASG.scribe)!.counts, {
      contexts: 0,
      skills: 2,
      mcp: 3,
    });
    // 앱 Operator는 context를 고르지 않아 0이다.
    const app = (await list(ctx, APP_PLACE)).find((row) =>
      row.assignment === ASG.watcher
    )!;
    assertEquals(app.counts, { contexts: 0, skills: 2, mcp: 3 });
  });
});

Deno.test("lophn-agent/agents#R24 [agent-I9]: a wrong file lists its reasons and counts nothing while the other agents are untouched", async () => {
  await withAgents(async (ctx) => {
    const healthy = await list(ctx, PROJECT);
    writeAgentFile(
      ctx.root,
      PROJECT,
      `${ASG.scribe}.md`,
      "---\nname: Scribe\n\nno closing line\n",
    );
    const rows = await list(ctx, PROJECT);
    const scribe = rows.find((row) => row.assignment === ASG.scribe)!;
    assertEquals(scribe.issues, [{ field: "frontmatter", code: "malformed" }]);
    assertEquals(scribe.counts, { contexts: null, skills: null, mcp: null });
    assertEquals(scribe.model, null);
    assertEquals(scribe.state, "enabled");
    assertEquals(scribe.kind, "operator");
    assertEquals(
      rows.filter((row) => row.assignment !== ASG.scribe),
      healthy.filter((row) => row.assignment !== ASG.scribe),
    );

    // 직접 고친 파일의 칸 이유도 항목별로 보인다.
    writeAgentFile(
      ctx.root,
      PROJECT,
      `${ASG.reviewer}.md`,
      "---\nname: lophn\ncolor: red\n---\n\n",
    );
    const reviewer = (await list(ctx, PROJECT)).find((row) =>
      row.assignment === ASG.reviewer
    )!;
    assertEquals(
      reviewer.issues.map((issue) => `${issue.field}:${issue.code}`).sort(),
      ["body:required", "color:unknown_field", "name:reserved_name"],
    );
  });
});

Deno.test("lophn-agent/agents#R24 [agent-I54]: a context archived after the save leaves the definition as it is and only drops out of the count", async () => {
  await withAgents(async (ctx) => {
    // 저장 때는 고를 수 있던 context가 그 뒤 보관됐다: 정의는 그대로 읽히고 이유도 없다.
    writeAgentFile(
      ctx.root,
      PROJECT,
      `${ASG.scribe}.md`,
      `---\nname: Scribe\ncontexts:\n  - ${CTX.one}\n  - ${CTX.archived}\n---\n\nWrite.\n`,
    );
    const scribe = (await list(ctx, PROJECT)).find((row) =>
      row.assignment === ASG.scribe
    )!;
    assertEquals(scribe.issues, []);
    assertEquals(scribe.counts.contexts, 1);
    const read = value(await readAgent(ctx, PROJECT, ASG.scribe)) as {
      definition: { contexts: string[] };
      issues: unknown[];
    };
    assertEquals(read.definition.contexts, [CTX.one, CTX.archived]);
    assertEquals(read.issues, []);
  });
});

Deno.test("lophn-agent/agents#R7 [agent-I9]: an Operator assignment without a file is not an agent", async () => {
  await withAgents(async (ctx) => {
    Deno.removeSync(
      `${ctx.root}/projects/${PRJ}/agents/${ASG.reviewer}.md`,
    );
    const rows = await list(ctx, PROJECT);
    assert(!rows.some((row) => row.assignment === ASG.reviewer));
    failure(await readAgent(ctx, PROJECT, ASG.reviewer), "not_found");
    // 파일이 없는 built-in은 제품 기본으로 그대로 있다.
    assertEquals(
      (await list(ctx, OTHER)).map((row) => row.assignment),
      [ASG.lophn, ASG.context_engineer],
    );
  });
});

Deno.test("lophn-agent/agents#R7 [agent-I9]: both people and machines can list", async () => {
  await withAgents(async (ctx) => {
    const read = value(
      await ctx.h.read({ resource: "agents", method: "list" }, machineCred, {
        place: PROJECT,
      }),
    ) as { agents: unknown[] };
    assertEquals(read.agents.length, 4);
    failure(
      await ctx.h.read({ resource: "agents", method: "list" }, userCred, {
        place: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fzz" },
      }),
      "not_found",
    );
  });
});

Deno.test("lophn-agent/agents#R12 [agent-I9]: ReadAgent gives the definition, its file hash and each effective value with its layer", async () => {
  await withAgents(async (ctx) => {
    const text = readAgentFile(ctx.root, PROJECT, `${ASG.reviewer}.md`)!;
    const read = value(await readAgent(ctx, PROJECT, ASG.reviewer)) as Record<
      string,
      unknown
    >;
    assertEquals(read.assignment, ASG.reviewer);
    assertEquals(read.role, "operator");
    assertEquals(read.kind, "operator");
    assertEquals(read.place, PROJECT);
    assertEquals(
      read.definition,
      fixture(
        "projects/prj_01arz3ndektsv4rrffq69g5fa1/agents/asg_01arz3ndektsv4rrffq69g5fa6.json",
      ),
    );
    assertEquals(read.hash, sha256(text));
    assertEquals(read.issues, []);
    const expected = fixture<{
      model: unknown;
      tools: string[];
    }>("expected/project-operator-reviewer.json");
    assertEquals(read.effective, {
      name: { value: "Reviewer", source: inDefinition(PROJECT) },
      profile: {
        value: { kind: "image", image: "avatar.png" },
        source: inDefinition(PROJECT),
      },
      model: { value: expected.model, source: inDefinition(PROJECT) },
      permissions: {
        value: { tools: expected.tools },
        source: inDefinition(PROJECT),
      },
    });
  });
});

Deno.test("lophn-agent/agents#R11 [agent-I9]: a built-in without a file reads as the product default with the lower layers' values", async () => {
  await withAgents(async (ctx) => {
    const read = value(
      await readAgent(ctx, OTHER, ASG.context_engineer),
    ) as Record<string, unknown>;
    assertEquals(read.definition, null);
    assertEquals(read.hash, null);
    assertEquals(read.kind, "built_in");
    assertEquals(read.issues, []);
    const effective = read.effective as Record<string, unknown>;
    assertEquals(effective.name, {
      value: "Context Engineer",
      source: layerOf("default"),
    });
    assertEquals(effective.profile, {
      value: { kind: "icon", icon: "contexts" },
      source: layerOf("default"),
    });
    assertEquals(effective.model, {
      value: WORKSPACE.models["context_engineer"],
      source: workspace(),
    });
    // 정의에 권한 칸이 없으면 역할 상한을 Workspace 기본 권한으로 줄이고 출처는 Workspace다.
    const caps = fixture<{ role_caps: Record<string, string[]> }>(
      "environment.json",
    ).role_caps["context_engineer"];
    assertEquals(effective.permissions, {
      value: { tools: caps },
      source: workspace(),
    });
  });
});

Deno.test("lophn-agent/agents#R12 [agent-I9]: the place layer shows as the source when the place settings win", async () => {
  await withAgents(async (ctx) => {
    const read = value(await readAgent(ctx, PROJECT, ASG.lophn)) as {
      effective: { model: unknown; permissions: { source: unknown } };
    };
    assertEquals(read.effective.model, {
      value: {
        provider: "pvd_01arz3ndektsv4rrffq69g5fc2",
        model_name: "claude-sonnet",
        option_values: { effort: "high" },
      },
      source: inPlace(PROJECT),
    });
    // lophn.md가 권한 칸을 가지고 있어 권한은 정의 층이다.
    assertEquals(read.effective.permissions.source, inDefinition(PROJECT));
  });
});

Deno.test("lophn-agent/agents#R24 [agent-I9]: reading a wrong file gives no definition, its hash and the reasons", async () => {
  await withAgents(async (ctx) => {
    const broken = "---\nname: Reviewer\nmodel: nope\n---\n\nbody\n";
    writeAgentFile(ctx.root, PROJECT, `${ASG.reviewer}.md`, broken);
    const read = value(await readAgent(ctx, PROJECT, ASG.reviewer)) as {
      definition: unknown;
      hash: string;
      issues: unknown[];
      effective: { model: unknown };
    };
    assertEquals(read.definition, null);
    assertEquals(read.hash, sha256(broken));
    assertEquals(read.issues, [{ field: "model", code: "invalid_value" }]);
    assertEquals(read.effective.model, null);
  });
});

Deno.test("lophn-agent/agents#R7 [agent-I9]: ReadAgent of an assignment the place does not list is not_found", async () => {
  await withAgents(async (ctx) => {
    failure(await readAgent(ctx, APP_PLACE, ASG.context_engineer), "not_found");
    failure(await readAgent(ctx, PROJECT, ASG.app_engineer), "not_found");
    failure(await readAgent(ctx, PROJECT, ASG.watcher), "not_found");
    failure(await readAgent(ctx, PROJECT, ASG.other_project), "not_found");
    failure(await readAgent(ctx, PROJECT, ASG.withdrawn), "not_found");
    failure(
      await readAgent(ctx, PROJECT, "asg_01arz3ndektsv4rrffq69g5fzz"),
      "not_found",
    );
  });
});

function readSettings(ctx: AgentHarness, place: unknown) {
  return ctx.h.read(
    { resource: "place-agent-settings", method: "read" },
    userCred,
    { place },
  );
}

Deno.test("lophn-agent/agents#R12 [agent-I9]: place settings read gives the fields, the file hash and the actual model of each role left empty", async () => {
  await withAgents(async (ctx) => {
    const text = readAgentFile(ctx.root, PROJECT, "settings.md")!;
    const read = value(await readSettings(ctx, PROJECT)) as {
      place: unknown;
      settings: unknown;
      hash: string;
      effective_models: Record<string, unknown>;
    };
    assertEquals(read.place, PROJECT);
    assertEquals(
      read.settings,
      fixture(
        "projects/prj_01arz3ndektsv4rrffq69g5fa1/agents/settings.json",
      ),
    );
    assertEquals(read.hash, sha256(text));
    // 이 자리가 model을 정한 lophn은 비운 칸이 아니라 effective에 없다.
    assertEquals(Object.keys(read.effective_models).sort(), [
      "app_engineer",
      "context_engineer",
      "operator",
    ]);
    for (const role of Object.keys(read.effective_models)) {
      assertEquals(read.effective_models[role], {
        value: WORKSPACE.models[role],
        source: workspace(),
      });
    }
  });
});

Deno.test("lophn-agent/agents#R11 [agent-I9]: a place without a settings file reads as empty with a null hash", async () => {
  await withAgents(async (ctx) => {
    const read = value(await readSettings(ctx, OTHER)) as {
      settings: unknown;
      hash: unknown;
      effective_models: Record<string, unknown>;
    };
    assertEquals(read.settings, {});
    assertEquals(read.hash, null);
    assertEquals(Object.keys(read.effective_models).sort(), [
      "app_engineer",
      "context_engineer",
      "lophn",
      "operator",
    ]);
    failure(
      await readSettings(ctx, {
        kind: "app",
        id: "app_01arz3ndektsv4rrffq69g5fzz",
      }),
      "not_found",
    );
  });
});

Deno.test("lophn-agent/agents#R24 [agent-I9]: a wrong settings file is invalid_input with the reasons", async () => {
  await withAgents(async (ctx) => {
    writeAgentFile(
      ctx.root,
      OTHER,
      "settings.md",
      "---\ncolor: red\n---\n",
    );
    assertEquals(issuesOf(await readSettings(ctx, OTHER)), [
      "color:unknown_field",
    ]);
  });
});
