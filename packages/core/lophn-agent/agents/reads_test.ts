import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelChoice } from "../../../protocol/lophn-agent/mod.ts";
import type {
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import type { AgentFileSystem, AgentLookups } from "./ports.ts";
import { createAgentReads } from "./reads.ts";

const PROJECT = "prj_00000000000000000000000001";
const AGENT = "agt_00000000000000000000000001";
const choice = (model_name: string): ModelChoice => ({
  provider: "pvd_00000000000000000000000000",
  model_name,
  option_values: {},
});

test("정의 읽기의 model 출처는 agent, project, global 순서다", () => {
  const read = (agentFile: string, project: ModelChoice | null) => {
    const lookups: AgentLookups = {
      placeExists: () => true,
      domains: () => [],
      skills: () => [],
      mcp: () => [],
      modelDefault: () => choice("global-model"),
      projectModel: (place) => (place?.kind === "project" ? project : null),
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
      lookups: () => lookups,
      dataRoot: "/data",
    });
    const result = reads.read.handle(
      { sql: {} } as unknown as ReadSnapshot,
      {} as RequestContext,
      {
        agent: AGENT,
        place: { kind: "project", id: PROJECT },
      },
    );
    assert.ok(result.ok);
    return result.value.effective.model;
  };
  const own =
    "---\nname: reviewer\nmodel:\n  provider: pvd_00000000000000000000000000\n  model_name: agent-model\n  option_values: {}\n---\nbody\n";
  const agent = read(own, choice("project-model"));
  assert.deepEqual(
    [agent?.value.model_name, agent?.source],
    ["agent-model", "agent"],
  );
  const project = read(
    "---\nname: reviewer\n---\nbody\n",
    choice("project-model"),
  );
  assert.deepEqual(
    [project?.value.model_name, project?.source],
    ["project-model", "project"],
  );
  const global = read("---\nname: reviewer\n---\nbody\n", null);
  assert.deepEqual(
    [global?.value.model_name, global?.source],
    ["global-model", "global"],
  );
});
