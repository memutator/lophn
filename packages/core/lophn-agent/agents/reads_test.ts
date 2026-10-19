import { assert, assertEquals } from "@std/assert";
import type { ModelChoice } from "../../../protocol/lophn-agent/mod.ts";
import type {
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import { ROLE_TABLE } from "../../agent-roles/agents/role-table.ts";
import type { AgentFileSystem, AgentLookups } from "./ports.ts";
import { createAgentReads } from "./reads.ts";

const PROJECT = "prj_00000000000000000000000001";
const manager = { role: "project_manager", project: PROJECT } as never;
const choice = (model_name: string): ModelChoice => ({
  provider: "pvd_00000000000000000000000000",
  model_name,
  option_values: {},
});

// 정의 읽기의 model 출처는 turn 때 layers.ts가 전역 값을 쓸지 정한다. 출처가 틀리면 project나 agent가
// 고른 model이 전역 기본으로 바뀐다.
Deno.test("정의 읽기의 model 출처는 agent, project, global 순서다", () => {
  const read = (agentFile: string | null, project: ModelChoice | null) => {
    const lookups: AgentLookups = {
      placeExists: () => true,
      places: () => [{ kind: "project", id: PROJECT }],
      domains: () => [],
      skills: () => [],
      mcp: () => [],
      modelDefault: () => choice("global-model"),
      projectModel: (place) => place?.kind === "project" ? project : null,
    };
    const files: AgentFileSystem = {
      read: () => agentFile,
      writeAtomic: () => {},
      remove: () => {},
      list: () => [],
      ensureFolder: () => {},
    };
    const reads = createAgentReads({
      files,
      roles: ROLE_TABLE,
      lookups: () => lookups,
      operatorPlaceAllowed: () => false,
      dataRoot: "/data",
    });
    const result = reads.read.handle(
      { sql: {} } as unknown as ReadSnapshot,
      {} as RequestContext,
      { agent: manager },
    );
    assert(result.ok);
    return result.value.effective.model;
  };
  const own =
    "---\nmodel:\n  provider: pvd_00000000000000000000000000\n  model_name: agent-model\n  option_values: {}\n---\nbody\n";
  const agent = read(own, choice("project-model"));
  assertEquals([agent?.value.model_name, agent?.source], [
    "agent-model",
    "agent",
  ]);
  const project = read(null, choice("project-model"));
  assertEquals([project?.value.model_name, project?.source], [
    "project-model",
    "project",
  ]);
  const global = read(null, null);
  assertEquals([global?.value.model_name, global?.source], [
    "global-model",
    "global",
  ]);
});
