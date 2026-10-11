import { assert, assertEquals } from "@std/assert";
import type {
  AgentDefinition,
  AgentPlace,
  AgentRole,
  AgentSettings,
  McpTool,
  Profile,
  ResolvedAgent,
} from "../../contracts/lophn-agent/mod.ts";
import { effectiveAgent, resolveAgent, type ResolveInput } from "./mod.ts";

// 읽기는 동기라 async인 resolveAgent를 부르지 못한다. effectiveAgent가 같은 층 합치기를 동기로
// 하므로 resolveAgent의 정답(testdata/expected)과 층 조합마다 같은 값을 내는지 본다.

const DATA = new URL("./testdata/", import.meta.url);
const PROJECT_DIR = "projects/prj_01arz3ndektsv4rrffq69g5fa1/agents/";
const APP_DIR = "apps/app_01arz3ndektsv4rrffq69g5fa2/agents/";

function json<T>(path: string): T {
  return JSON.parse(Deno.readTextFileSync(new URL(path, DATA))) as T;
}

type Environment = {
  role_caps: Record<AgentRole, string[]>;
  default_profiles: Record<AgentRole, Profile>;
  skills: string[];
  mcp: McpTool[];
  active_contexts: Record<string, string[]>;
};

const ENV = json<Environment>("environment.json");
const WORKSPACE = json<AgentSettings>("workspace.json");

const PRJ: AgentPlace = {
  kind: "project",
  id: "prj_01arz3ndektsv4rrffq69g5fa1",
};
const APP: AgentPlace = { kind: "app", id: "app_01arz3ndektsv4rrffq69g5fa2" };

const ASG = {
  lophn: "asg_01arz3ndektsv4rrffq69g5fa3",
  context_engineer: "asg_01arz3ndektsv4rrffq69g5fa4",
  app_engineer: "asg_01arz3ndektsv4rrffq69g5fa5",
  reviewer: "asg_01arz3ndektsv4rrffq69g5fa6",
  scribe: "asg_01arz3ndektsv4rrffq69g5fa7",
  watcher: "asg_01arz3ndektsv4rrffq69g5fa8",
};

type Build = {
  role: AgentRole;
  assignment: string;
  place: AgentPlace;
  definition: string | null;
};

function input(build: Build): ResolveInput {
  const { role, assignment, place } = build;
  const dir = place.kind === "project" ? PROJECT_DIR : APP_DIR;
  return {
    assignment,
    role,
    place,
    definition: build.definition === null
      ? null
      : json<AgentDefinition>(`${dir}${build.definition}`),
    workspace: WORKSPACE,
    place_settings: json<AgentSettings>(`${dir}settings.json`),
    session_model: null,
    environment: {
      role_caps: ENV.role_caps[role],
      default_profile: ENV.default_profiles[role],
      skills: ENV.skills,
      mcp: ENV.mcp,
      active_contexts: place.kind === "project"
        ? ENV.active_contexts[place.id] ?? []
        : [],
    },
  };
}

const CASES: { name: string; build: Build }[] = [
  {
    name: "project-lophn",
    build: {
      role: "lophn",
      assignment: ASG.lophn,
      place: PRJ,
      definition: "lophn.json",
    },
  },
  {
    name: "project-context-engineer",
    build: {
      role: "context_engineer",
      assignment: ASG.context_engineer,
      place: PRJ,
      definition: "context-engineer.json",
    },
  },
  {
    name: "project-operator-reviewer",
    build: {
      role: "operator",
      assignment: ASG.reviewer,
      place: PRJ,
      definition: `${ASG.reviewer}.json`,
    },
  },
  {
    name: "project-operator-scribe",
    build: {
      role: "operator",
      assignment: ASG.scribe,
      place: PRJ,
      definition: `${ASG.scribe}.json`,
    },
  },
  {
    name: "app-lophn-without-file",
    build: {
      role: "lophn",
      assignment: ASG.lophn,
      place: APP,
      definition: null,
    },
  },
  {
    name: "app-engineer",
    build: {
      role: "app_engineer",
      assignment: ASG.app_engineer,
      place: APP,
      definition: "app-engineer.json",
    },
  },
  {
    name: "app-operator-status-watcher",
    build: {
      role: "operator",
      assignment: ASG.watcher,
      place: APP,
      definition: `${ASG.watcher}.json`,
    },
  },
];

// resolveAgent의 값 가운데 읽기가 쓰는 칸과 그 출처다.
function shared(value: ResolvedAgent) {
  return {
    name: value.name,
    profile: value.profile,
    model: value.model,
    tools: value.tools,
    skills: value.skills,
    mcp: value.mcp,
    contexts: value.contexts,
    sources: {
      name: value.sources.name,
      profile: value.sources.profile,
      model: value.sources.model,
      tools: value.sources.tools,
    },
  };
}

function withoutModel<
  T extends { model: unknown; sources: { model: unknown } },
>(value: T) {
  const { model: _model, sources, ...rest } = value;
  const { model: _source, ...others } = sources;
  return { ...rest, sources: others };
}

for (const { name, build } of CASES) {
  Deno.test(`lophn-agent/agents#R25 [agent-I9]: the synchronous layers give the golden resolved agent (${name})`, () => {
    const effective = effectiveAgent(input(build));
    assert(effective.ok);
    assertEquals(
      effective.value,
      shared(json<ResolvedAgent>(`expected/${name}.json`)),
    );
  });
}

Deno.test("lophn-agent/agents#R9 [agent-I9]: for every combination of layers the synchronous layers equal resolveAgent", async () => {
  const bases = [
    CASES[0].build,
    CASES[2].build,
    CASES[3].build,
    CASES[4].build,
    CASES[6].build,
  ];
  let compared = 0;
  for (const build of bases) {
    for (const workspace of [true, false]) {
      for (const placeSettings of [true, false]) {
        for (const dropModel of [true, false]) {
          for (const dropPermissions of [true, false]) {
            const base = input(build);
            const definition = base.definition === null ? null : {
              ...base.definition,
            };
            if (definition !== null && dropModel) delete definition.model;
            if (definition !== null && dropPermissions) {
              delete definition.permissions;
            }
            const patched: ResolveInput = {
              ...base,
              definition,
              workspace: workspace ? base.workspace : {},
              place_settings: placeSettings ? base.place_settings : {},
            };
            const effective = effectiveAgent(patched);
            const expected = await resolveAgent(patched);
            if (!expected.ok) {
              // 어느 층에도 model이 없으면 resolve는 시작하지 않는다. 읽기는 model만 비운다.
              assertEquals(expected.error.code, "invalid_input");
              assert(effective.ok);
              assertEquals(effective.value.model, null);
              assertEquals(effective.value.sources.model, null);
              const placeholder = await resolveAgent({
                ...patched,
                session_model: {
                  provider: "pvd_01arz3ndektsv4rrffq69g5fc1",
                  model_name: "placeholder",
                  option_values: {},
                },
              });
              assert(placeholder.ok);
              assertEquals(
                withoutModel(effective.value),
                withoutModel(
                  shared(placeholder.value),
                ),
              );
            } else {
              assert(effective.ok);
              assertEquals(effective.value, shared(expected.value));
            }
            compared++;
          }
        }
      }
    }
  }
  assertEquals(compared, 80);
});

Deno.test("lophn-agent/agents#R7 [agent-I9]: an Operator without a definition is not_found and a role outside its place is not allowed", () => {
  const operator = effectiveAgent({
    ...input(CASES[2].build),
    definition: null,
  });
  assert(!operator.ok);
  assertEquals(operator.error.code, "not_found");
  const appEngineerInProject = effectiveAgent({
    ...input(CASES[5].build),
    place: PRJ,
  });
  assert(!appEngineerInProject.ok);
  assertEquals(appEngineerInProject.error.code, "invalid_input");
});
