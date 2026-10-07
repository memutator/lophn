// lophn-agent/roles/app-engineer#R2: 실제 core(temp LOPHN_HOME)에서 App Engineer run credential이
// core가 발급하는 모양 그대로(targets {assignment, run}, conditions {assignment, run, process})일 때
// 담당 앱 문서는 읽고 다른 앱 문서는 없는 문서와 같은 답인지 본다. 모델 provider는 부르지 않고
// 사람 데이터 root(~/.lophn)는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { agentConditions } from "./agent-credentials.ts";
import { saveFromPaths } from "../../packages/coding-agent/connection/mod.ts";
import {
  DOCUMENT_OPERATIONS,
  openScopeWorld,
  type ScopeWorld,
} from "./testing/coding-agent-scope.ts";

const ASSIGNMENT = "asg_01arz3ndektsv4rrffq69g5fav";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const ABSENT_DOC = "doc_01arz3ndektsv4rrffq69g5fb9";
const TOKEN = "e".repeat(43);

type Saved = { document: string; version: string };

async function saveIn(
  world: ScopeWorld,
  slug: string,
  text: string,
  place: { kind: "app" | "project"; id: string } | undefined,
): Promise<Saved> {
  await Deno.writeTextFile(`${world.work}/${slug}.md`, text);
  const saved = await saveFromPaths(world.saveDeps("all"), {
    paths: [`${slug}.md`],
    ...(place === undefined ? {} : { place, slug }),
  });
  assert(saved.ok, saved.ok ? "" : JSON.stringify(saved.error));
  return saved.value.saved;
}

async function acceptAgent(world: ScopeWorld, app: string) {
  // core가 발급하는 모양 그대로다: targets는 assignment·run뿐이고 앱은 conditions가 고정한다.
  const context: AuthenticatedContext = {
    principal: `agent:${ASSIGNMENT}`,
    actor: `agent:${ASSIGNMENT}`,
    scope: {
      operations: [...DOCUMENT_OPERATIONS],
      targets: { assignment: ASSIGNMENT, run: RUN },
    },
    conditions: agentConditions({
      assignment: ASSIGNMENT,
      run: RUN,
      process: "agent-runtime",
      role: "app_engineer",
      scope: { kind: "app", id: app },
    }),
    credential_ref: "cred-ae",
  };
  const accepted = await world.core.acceptTestCredential?.(context, TOKEN);
  assert(accepted?.ok, JSON.stringify(accepted));
  const recorded = await world.core.record(context);
  assert(recorded.ok);
}

async function post(world: ScopeWorld, path: string, body: unknown) {
  const response = await fetch(`${world.baseUrl}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

Deno.test("lophn-agent/roles/app-engineer#R2: core가 발급하는 조건은 App Engineer에만 담당 앱을 고정한다", () => {
  const base = { assignment: ASSIGNMENT, run: RUN, process: "agent-runtime" };
  const scope = { kind: "app", id: "app_01arz3ndektsv4rrffq69g5fav" };
  assertEquals(agentConditions({ ...base, role: "app_engineer", scope }), {
    ...base,
    app: scope.id,
  });
  for (const role of ["lophn", "context_engineer", "operator"]) {
    assertEquals(agentConditions({ ...base, role, scope }), base);
  }
});

Deno.test("lophn-agent/roles/app-engineer#R2: 실제 core에서 담당 앱 A 문서는 읽고 다른 앱·project·자리 없는 문서는 없는 문서와 같은 답이다", async () => {
  const world = await openScopeWorld(DOCUMENT_OPERATIONS);
  try {
    const a = await saveIn(world, "plan-a", "# A\n\n## 개요\n에이\n", {
      kind: "app",
      id: world.appA,
    });
    const b = await saveIn(world, "plan-b", "# B\n\n## 개요\n비\n", {
      kind: "app",
      id: world.appB,
    });
    const p = await saveIn(world, "plan-p", "# P\n\n## 개요\n피\n", {
      kind: "project",
      id: world.project,
    });
    const u = await saveIn(world, "plan-u", "# U\n\n## 개요\n무\n", undefined);
    await acceptAgent(world, world.appA);
    const reads = (doc: Saved) =>
      [
        ["documents/get", { document: doc.document }],
        ["documents/read", {
          reference: {
            document: doc.document,
            version: doc.version,
            section: null,
          },
          section: null,
          include_children: false,
          ranges: [],
        }],
        ["outline/document", {
          reference: {
            document: doc.document,
            version: doc.version,
            section: null,
          },
        }],
        ["documents/history", { document: doc.document }],
      ] as const;
    const absent: Saved = { document: ABSENT_DOC, version: a.version };
    // 담당 앱 문서는 읽힌다.
    for (const [path, body] of reads(a)) {
      const reply = await post(world, path, body);
      assertEquals(reply.status, 200, `${path} ${JSON.stringify(reply.body)}`);
    }
    // 다른 앱·project·자리 없는 문서는 없는 문서와 같은 상태와 본문이다.
    for (const hidden of [b, p, u]) {
      const absentReads = reads(absent);
      for (const [index, [path, body]] of reads(hidden).entries()) {
        const same = absentReads[index]!;
        const got = await post(world, path, body);
        const missing = await post(world, same[0], same[1]);
        assertEquals(got.status, 404, path);
        assertEquals(got.status, missing.status, path);
        assertEquals(got.body, missing.body, path);
      }
    }
    // 자리 목록도 담당 앱 문서만 보인다.
    const listed = await post(world, "documents/list", {});
    assertEquals(listed.status, 200);
    assertEquals(
      (listed.body as { documents: { document: { id: string } }[] })
        .documents.map((entry) => entry.document.id),
      [a.document],
    );
  } finally {
    await world.dispose();
  }
});
