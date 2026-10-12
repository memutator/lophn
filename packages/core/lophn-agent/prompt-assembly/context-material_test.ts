// lophn-agent/harness/prompt-assemble#R4: 실제 core(temp LOPHN_HOME)에서 run의 agent 자격이 prompt의 context
// 자료(overview·용어집)를 읽는지 본다. 자격은 runtime이 청하는 operation 상한(roleOperations)과 core가 발급하는
// 조건 그대로고, 읽기는 runtime의 loadContextMaterials가 agentCall로 한다. 모델 provider는 부르지 않고
// 사람 데이터 root(~/.lophn)는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import { routePath } from "../../../protocol/base/mod.ts";
import {
  bundleFinishCheckRoute,
  bundleSaveDraftRoute,
  bundleSubmitRoute,
  contextCreateRoute,
  glossarySetRoute,
} from "../../../protocol/projects/mod.ts";
import { evalContent } from "../../projects/contexts/api/testing.ts";
import { openIndexStore } from "../../projects/contexts/index/mod.ts";
import { agentCall } from "../../main/agent-runtime/core-http.ts";
import { loadContextMaterials } from "./context-overview.ts";
import { contextWorkerCredential } from "../../projects/contexts/register.ts";
import {
  agentConditions,
  roleOperations,
} from "../run-loop/agent-credentials.ts";
import {
  DOCUMENT_OPERATIONS,
  openScopeWorld,
  type ScopeWorld,
} from "../../testing/coding-agent-scope.ts";

const ASSIGNMENT = "asg_01arz3ndektsv4rrffq69g5fav";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fa1";
const TERM = "trm_01arz3ndektsv4rrffq69g5fa1";
const SHA = "a".repeat(64);

// post가 /v1/을 붙이므로 route 경로에서 판을 뗀다.
const pathOf = (route: { resource: string; method: string }) =>
  routePath(route).replace(/^\/v\d+\//, "");

const envelope = (input: unknown) => ({
  input,
  idempotency_key: `k-${crypto.randomUUID()}`,
  compare: {},
  prepared: [],
});

async function accept(
  world: ScopeWorld,
  context: AuthenticatedContext,
  token: string,
) {
  const accepted = await world.core.acceptTestCredential?.(context, token);
  assert(accepted?.ok, JSON.stringify(accepted));
  const recorded = await world.core.record(context);
  assert(recorded.ok);
}

async function post(
  world: ScopeWorld,
  path: string,
  body: unknown,
  token: string,
) {
  const response = await fetch(`${world.baseUrl}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

// 앱 slug `notes`(appA)를 app-data로 읽는 type 하나가 든 계약이다.
function content(): Record<string, unknown> {
  const value = evalContent() as {
    contract: { types: { name: string; source: { app?: string } }[] };
  };
  for (const type of value.contract.types) {
    if (type.name === "Event") type.source.app = "notes";
  }
  return value as unknown as Record<string, unknown>;
}

// project에 context 하나를 만들고 판을 적용하고 용어집 하나를 둔다. 만들기는 사람이, 초안·제출은
// Context Engineer가, 검사 통과는 worker가 한다(documents/contexts).
async function applyContext(world: ScopeWorld) {
  const user = "U".repeat(43);
  const engineer = "E".repeat(43);
  const worker = "W".repeat(43);
  const admin = "A".repeat(43);
  await accept(world, {
    principal: "user-contexts",
    actor: "user",
    scope: {
      operations: [contextCreateRoute.name, glossarySetRoute.name],
      targets: {},
    },
    conditions: {},
    credential_ref: "cred-material-user",
  }, user);
  await accept(world, {
    principal: "admin",
    actor: "machine",
    scope: { operations: ["ListAssignments", "AcceptRun"], targets: {} },
    conditions: {},
    credential_ref: "cred-material-admin",
  }, admin);
  const listed = await post(world, "assignments/list", {}, admin);
  assertEquals(listed.status, 200, JSON.stringify(listed.body));
  const assignment = (listed.body as {
    assignments: { id: string; role: string; revision: number }[];
  }).assignments.find((entry) => entry.role === "context_engineer");
  assert(assignment !== undefined);
  const run = "run_01arz3ndektsv4rrffq69g5fa1";
  const accepted = await post(
    world,
    "runs/accept",
    {
      input: {
        id: run,
        assignment: assignment.id,
        session: null,
        source: { kind: "message", message: "msg_01arz3ndektsv4rrffq69g5fa1" },
        continued_from: null,
        start_after: null,
      },
      idempotency_key: `k-${crypto.randomUUID()}`,
      compare: { assignment_revision: assignment.revision },
      prepared: [],
    },
    admin,
  );
  assertEquals(accepted.status, 200, JSON.stringify(accepted.body));
  await accept(world, {
    principal: `agent:${assignment.id}`,
    actor: `agent:${assignment.id}`,
    scope: {
      operations: ["bundle.save_draft", "bundle.submit"],
      targets: { assignment: assignment.id, run },
    },
    conditions: { assignment: assignment.id, run },
    credential_ref: "cred-material-engineer",
  }, engineer);
  const contextWorker = contextWorkerCredential();
  await accept(world, {
    principal: contextWorker.principal,
    actor: contextWorker.actor,
    scope: contextWorker.scope,
    conditions: contextWorker.conditions,
    credential_ref: "cred-material-worker",
  } as AuthenticatedContext, worker);

  const created = await post(
    world,
    pathOf(contextCreateRoute),
    envelope({
      id: CONTEXT,
      project: world.project,
      title: "Notes data",
      purpose: "Notes data purpose",
    }),
    user,
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const draft = await post(
    world,
    pathOf(bundleSaveDraftRoute),
    envelope({ context: CONTEXT, content: content() }),
    engineer,
  );
  assertEquals(draft.status, 200, JSON.stringify(draft.body));
  const submitted = await post(
    world,
    pathOf(bundleSubmitRoute),
    envelope({ bundle: (draft.body as { id: string }).id }),
    engineer,
  );
  assertEquals(submitted.status, 200, JSON.stringify(submitted.body));
  const body = submitted.body as { check: string; bundle_hash: string };
  const finished = await post(
    world,
    pathOf(bundleFinishCheckRoute),
    envelope({
      check: body.check,
      result: "passed",
      bundle_hash: body.bundle_hash,
      snapshot_hash: SHA,
      findings: [],
      violation_count: 0,
    }),
    worker,
  );
  assertEquals(finished.status, 200, JSON.stringify(finished.body));
  // overview는 context worker의 derived index가 갱신돼 있어야 읽힌다.
  await Deno.mkdir(`${world.core.dataRoot}/derived`, { recursive: true });
  const store = openIndexStore(
    `${world.core.dataRoot}/derived/contexts.sqlite`,
  );
  try {
    store.transaction((sql) => {
      sql.run(
        `INSERT OR REPLACE INTO index_state (context, bundle_hash, scanned_at, result)
         VALUES (?, ?, ?, 'complete')`,
        [CONTEXT, body.bundle_hash, "2024-01-01T00:00:00.000Z"],
      );
    });
  } finally {
    store.close();
  }
  const term = await post(
    world,
    pathOf(glossarySetRoute),
    envelope({
      id: TERM,
      context: CONTEXT,
      term: "Note",
      meaning: "One written note",
    }),
    user,
  );
  assertEquals(term.status, 200, JSON.stringify(term.body));
}

// runtime이 청하는 상한(roleOperations)과 core가 발급하는 조건 그대로의 run agent 자격이다.
async function acceptRunAgent(world: ScopeWorld, role: string, token: string) {
  await accept(world, {
    principal: `agent:${ASSIGNMENT}`,
    actor: `agent:${ASSIGNMENT}`,
    scope: {
      operations: [...roleOperations(role)],
      targets: { assignment: ASSIGNMENT, run: RUN },
    },
    conditions: agentConditions({
      assignment: ASSIGNMENT,
      run: RUN,
      process: "agent-runtime",
      role,
      scope: role === "app_engineer"
        ? { kind: "app", id: world.appA }
        : { kind: "project", id: world.project },
    }),
    credential_ref: `cred-${token.slice(0, 4)}`,
  }, token);
}

Deno.test("lophn-agent/harness/prompt-assemble#R4 [ctx-I55b]: 실제 core에서 네 역할의 run agent 자격(roleOperations)이 resolved agent의 context의 자료를 읽는다", async () => {
  const world = await openScopeWorld(DOCUMENT_OPERATIONS);
  try {
    await applyContext(world);
    const tokens: Record<string, string> = {
      lophn: "l".repeat(43),
      operator: "o".repeat(43),
      context_engineer: "c".repeat(43),
      app_engineer: "p".repeat(43),
    };
    for (const [role, token] of Object.entries(tokens)) {
      await acceptRunAgent(world, role, token);
      const agent = agentCall({ port: world.core.port, token });
      const set = await loadContextMaterials(agent, { contexts: [CONTEXT] });
      assertEquals(
        set.materials.map((material) => material.context),
        [CONTEXT],
        `${role} ${JSON.stringify(set)}`,
      );
      const material = set.materials[0]!;
      assertEquals(material.title, "Notes data", role);
      assert(material.text.includes("Note: One written note"), role);
      assert(material.type_names.length > 0, role);
      assertEquals(set.omitted, [], role);
    }
  } finally {
    await world.dispose();
  }
});
