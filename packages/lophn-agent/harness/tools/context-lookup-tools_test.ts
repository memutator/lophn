// deno-lint-ignore-file no-explicit-any
// lophn-agent/roles/lophn#R3, R14: lophn만 모든 project의 context 목록, context 하나의 overview·용어집, 문서
// 경로를 덮는 context를 읽는 tool 셋을 가진다. 셋 모두 읽기이고 소유 contract만 부른다. core는 `ContractCall`
// fake이고 네트워크·model은 부르지 않는다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  BUILTIN_TOOLS,
  CONTEXT_LOOKUP_TOOL_NAME_LIST,
  CONTEXT_LOOKUP_TOOL_NAMES,
  CONTEXT_LOOKUP_TOOLS,
  createContextLookupToolHandlers,
  executeTool,
  listTools,
  type RunCredential,
  runOperations,
  TOOL_BUNDLES,
} from "./mod.ts";
import { ROLE_CAPS } from "../../agents/mod.ts";

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const RUN = id("run", 1);
const PRJ_A = id("prj", 1);
const PRJ_B = id("prj", 2);
const PRJ_GONE = id("prj", 3);
const CTX_A1 = id("ctx", 1);
const CTX_B1 = id("ctx", 3);
const HASH = "a".repeat(64);
const N = CONTEXT_LOOKUP_TOOL_NAMES;

type Seen = { contract: string; input: Record<string, any> };

type FakeContext = {
  id: string;
  project: string;
  title: string;
  purpose: string;
  status: string;
};

function context(
  n: number,
  project: string,
  over: Partial<FakeContext> = {},
): FakeContext {
  return {
    id: id("ctx", n),
    project,
    title: `Context ${n}`,
    purpose: `Purpose ${n}`,
    status: "active",
    ...over,
  };
}

function world(init: {
  projects?: { id: string; title: string }[];
  contexts?: FakeContext[];
  forbidden?: string[];
  pageSize?: number;
} = {}) {
  const projects = init.projects ?? [
    { id: PRJ_A, title: "Project A" },
    { id: PRJ_B, title: "Project B" },
  ];
  const contexts = init.contexts ?? [
    context(1, PRJ_A),
    context(2, PRJ_A),
    context(3, PRJ_B),
  ];
  const seen: Seen[] = [];
  const pageOf = <T>(rows: T[], input: Record<string, any>) => {
    const size = init.pageSize ?? rows.length + 1;
    const start = input["cursor"] === undefined ? 0 : Number(input["cursor"]);
    const slice = rows.slice(start, start + size);
    const next = start + slice.length < rows.length
      ? String(start + slice.length)
      : null;
    return { slice, next };
  };
  const ports = {
    call(
      contract: string,
      input: unknown,
      run: string,
    ): Promise<Result<unknown>> {
      const body = input as Record<string, any>;
      seen.push({ contract, input: body });
      assertEquals(run, RUN);
      switch (contract) {
        case "project.list": {
          const page = pageOf(projects, body);
          return Promise.resolve(ok({
            projects: page.slice,
            as_of_seq: "1",
            complete: page.next === null,
            next_cursor: page.next,
          }));
        }
        case "context.list": {
          if (init.forbidden?.includes(body["project"])) {
            return Promise.resolve(
              err({ code: "forbidden", message: "no" }),
            );
          }
          if (!projects.some((p) => p.id === body["project"])) {
            return Promise.resolve(
              err({ code: "not_found", message: "no project" }),
            );
          }
          const rows = contexts.filter((c) =>
            c.project === body["project"] &&
            (body["status"] === undefined || c.status === body["status"])
          );
          const page = pageOf(rows, body);
          return Promise.resolve(ok({
            contexts: page.slice,
            as_of_seq: "1",
            complete: page.next === null,
            next_cursor: page.next,
          }));
        }
        case "context.get": {
          const found = contexts.find((c) => c.id === body["context"]);
          return Promise.resolve(
            found === undefined
              ? err({ code: "not_found", message: "no" })
              : ok({ context: found, applied: null, as_of_seq: "1" }),
          );
        }
        case "context.contract":
          return Promise.resolve(ok({
            context: body["context"],
            bundle_hash: HASH,
            content: { schema: 1, contract: { types: [] } },
            as_of_seq: "1",
          }));
        case "context.overview":
          return Promise.resolve(ok({
            context: found(body["context"]),
            bundle_hash: HASH,
            types: [{ type: "Recipe", count: 3 }],
            violation_count: 0,
            as_of_seq: "1",
          }));
        case "glossary.list":
          return Promise.resolve(ok({
            context: body["context"],
            entries: [{ term: "pie", meaning: "a baked dish" }],
            as_of_seq: "1",
          }));
        case "context.containing":
          return Promise.resolve(ok({
            contexts: body["path"] === "recipes/pie.md"
              ? [{ context: CTX_A1, title: "Context 1", types: ["Recipe"] }]
              : [],
            as_of_seq: "1",
          }));
        default:
          return Promise.resolve(
            err({ code: "not_found", message: "no route" }),
          );
      }
    },
  };
  function found(ctx: string) {
    return contexts.find((c) => c.id === ctx);
  }
  return { seen, ports };
}

function credential(listed = CONTEXT_LOOKUP_TOOLS): RunCredential {
  return {
    run: RUN,
    targets: new Set(),
    operations: new Set(runOperations(listed)),
  };
}

function lookup(
  core = world(),
  render = (input: any) =>
    `TEXT ${input.context.title} ${input.glossary.length}`,
) {
  const handlers = createContextLookupToolHandlers(core.ports, render);
  return {
    core,
    run: (name: string, input: unknown) =>
      executeTool(
        { listed: CONTEXT_LOOKUP_TOOLS, handlers, credential: credential() },
        name,
        input,
      ),
  };
}

// ---- 정의와 상한 ----

Deno.test("lophn-agent/roles/lophn#R3 [ctx-I58g]: the context lookup tools are three read tools with no confirm and each names one owner contract", () => {
  assertEquals(
    CONTEXT_LOOKUP_TOOLS.map((tool) => tool.name),
    ["context.list", "context.overview", "context.containing"],
  );
  assertEquals([...CONTEXT_LOOKUP_TOOL_NAME_LIST], [
    "context.list",
    "context.overview",
    "context.containing",
  ]);
  for (const tool of CONTEXT_LOOKUP_TOOLS) {
    assertEquals(tool.effect, "read", tool.name);
    assertEquals(tool.confirm, false, tool.name);
    assertEquals(tool.origin, "builtin", tool.name);
    assertEquals(tool.reversible, true, tool.name);
    assertEquals(tool.idempotent, true, tool.name);
    assert(tool.inputSchema !== undefined, tool.name);
    assertEquals(tool.contract, tool.name, tool.name);
  }
  // 셋 모두 BUILTIN_TOOLS와 묶음에 있다.
  for (const tool of CONTEXT_LOOKUP_TOOLS) {
    assert(BUILTIN_TOOLS.includes(tool), tool.name);
  }
  assertEquals(
    TOOL_BUNDLES.get("context-lookup"),
    CONTEXT_LOOKUP_TOOL_NAME_LIST,
  );
});

Deno.test("lophn-agent/roles/lophn#R3 [ctx-I58g]: the input schemas take ids and a path only and reject extra fields or wrong ids", async () => {
  const box = lookup();
  const bad: [string, unknown][] = [
    [N.list, { project: "nope" }],
    [N.list, { extra: 1 }],
    [N.overview, {}],
    [N.overview, { context: PRJ_A }],
    [N.containing, { project: PRJ_A }],
    [N.containing, { project: PRJ_A, path: "" }],
    [N.containing, { project: PRJ_A, path: "a.md", extra: true }],
  ];
  for (const [name, input] of bad) {
    const outcome = await box.run(name, input);
    assertEquals(
      outcome.outcome.kind,
      "failure",
      `${name} ${JSON.stringify(input)}`,
    );
    assertEquals(outcome.executed, false, name);
  }
  assertEquals(box.core.seen, []);
});

Deno.test("lophn-agent/roles/lophn#R3 [ctx-I58g]: only lophn has the context lookup tools in its cap and the other roles are not offered them", () => {
  for (const [role, cap] of ROLE_CAPS) {
    for (const name of CONTEXT_LOOKUP_TOOL_NAME_LIST) {
      assertEquals(
        cap.tools.includes(name),
        role === "lophn",
        `${role} ${name}`,
      );
    }
    // 목록도 같다.
    const listed = listTools(
      { builtin: BUILTIN_TOOLS, app: [], external: [] },
      { presetTools: cap.tools, roleTools: cap.tools },
    ).map((tool) => tool.name);
    for (const name of CONTEXT_LOOKUP_TOOL_NAME_LIST) {
      assertEquals(listed.includes(name), role === "lophn", `${role} ${name}`);
    }
  }
});

Deno.test("lophn-agent/roles/lophn#R3 [ctx-I58g]: a role without them cannot run the tools even with a preset that names them", async () => {
  const box = lookup();
  const operator = ROLE_CAPS.get("operator")!.tools;
  const listed = listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    {
      presetTools: [...operator, ...CONTEXT_LOOKUP_TOOL_NAME_LIST],
      roleTools: operator,
    },
  );
  const handlers = createContextLookupToolHandlers(box.core.ports, () => "");
  for (const name of CONTEXT_LOOKUP_TOOL_NAME_LIST) {
    const outcome = await executeTool(
      { listed, handlers, credential: credential(listed) },
      name,
      { context: CTX_A1, project: PRJ_A, path: "a.md" },
    );
    assertEquals(outcome.outcome.kind, "failure", name);
    assertEquals(outcome.executed, false, name);
  }
  assertEquals(box.core.seen, []);
});

Deno.test("lophn-agent/roles/lophn#R3 [ctx-I58g]: the credential of a run with the tools holds every contract the handlers call and nothing that writes", async () => {
  const box = lookup();
  const inputs: [string, unknown][] = [
    [N.list, {}],
    [N.overview, { context: CTX_A1 }],
    [N.containing, { project: PRJ_A, path: "recipes/pie.md" }],
  ];
  for (const [name, input] of inputs) {
    const outcome = await box.run(name, input);
    assertEquals(outcome.outcome.kind, "success", name);
  }
  const operations = new Set(runOperations(CONTEXT_LOOKUP_TOOLS));
  for (const call of box.core.seen) {
    assert(operations.has(call.contract), call.contract);
  }
  assertEquals([...operations].sort(), [
    "context.containing",
    "context.contract",
    "context.get",
    "context.list",
    "context.overview",
    "glossary.list",
    "project.list",
  ]);
});

// ---- context.list ----

Deno.test("lophn-agent/roles/lophn#R3 [ctx-I58g]: context.list reads the active contexts of every project through project.list and context.list", async () => {
  const box = lookup(world({
    contexts: [
      context(1, PRJ_A),
      context(2, PRJ_A, { status: "drafting" }),
      context(3, PRJ_B),
      context(4, PRJ_A, { status: "archived" }),
    ],
  }));
  const outcome = await box.run(N.list, {});
  assertEquals(outcome.outcome.kind, "success");
  const content = outcome.result.content as any;
  assertEquals(content.total, 2);
  assertEquals(content.contexts, [
    {
      id: CTX_A1,
      title: "Context 1",
      purpose: "Purpose 1",
      project: PRJ_A,
      project_title: "Project A",
    },
    {
      id: CTX_B1,
      title: "Context 3",
      purpose: "Purpose 3",
      project: PRJ_B,
      project_title: "Project B",
    },
  ]);
  assertEquals(outcome.result.complete, true);
  assertEquals(outcome.result.continuation, null);
  // 읽기 route만 부르고 project마다 active만 청한다.
  assertEquals(box.core.seen.map((call) => call.contract), [
    "project.list",
    "context.list",
    "context.list",
  ]);
  assertEquals(box.core.seen[0]!.input["status"], "active");
  assertEquals(box.core.seen[1]!.input["project"], PRJ_A);
  assertEquals(box.core.seen[1]!.input["status"], "active");
});

Deno.test("lophn-agent/roles/lophn#R3 [ctx-I58g]: context.list with a project reads only that project and keeps core's error for it", async () => {
  const box = lookup();
  const one = await box.run(N.list, { project: PRJ_B });
  assertEquals((one.result.content as any).contexts.map((c: any) => c.id), [
    CTX_B1,
  ]);
  assertEquals(box.core.seen.map((call) => call.contract), ["context.list"]);
  const missing = await box.run(N.list, { project: PRJ_GONE });
  assertEquals(missing.outcome.kind, "failure");
  assertEquals(missing.outcome.code, "not_found");
});

Deno.test("lophn-agent/roles/lophn#R3 [ctx-I58g]: context.list skips a project the run may not read and pages 20 at a time without losing or repeating a context", async () => {
  const many = Array.from(
    { length: 45 },
    (_, i) => context(i + 1, i % 2 === 0 ? PRJ_A : PRJ_B),
  );
  const box = lookup(world({ contexts: many, pageSize: 7 }));
  const seen: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  for (;;) {
    const outcome = await box.run(
      N.list,
      cursor === undefined ? {} : { cursor },
    );
    assertEquals(outcome.outcome.kind, "success");
    const content = outcome.result.content as any;
    assert(content.contexts.length <= 20);
    seen.push(...content.contexts.map((c: any) => c.id));
    pages++;
    const next = outcome.result.continuation;
    if (next === null) {
      assertEquals(outcome.result.complete, true);
      break;
    }
    assertEquals(outcome.result.complete, false);
    cursor = next.read_next ?? undefined;
  }
  assertEquals(pages, 3);
  assertEquals(seen.length, 45);
  assertEquals(new Set(seen).size, 45);

  // 읽을 수 없는 project는 없는 것과 같다.
  const skipped = lookup(world({ forbidden: [PRJ_A] }));
  const outcome = await skipped.run(N.list, {});
  assertEquals((outcome.result.content as any).contexts.map((c: any) => c.id), [
    CTX_B1,
  ]);
});

Deno.test("lophn-agent/roles/lophn#R3 [ctx-I58g]: context.list rejects a cursor that came from another request", async () => {
  const many = Array.from({ length: 30 }, (_, i) => context(i + 1, PRJ_A));
  const box = lookup(world({ contexts: many }));
  const first = await box.run(N.list, { project: PRJ_A });
  const cursor = first.result.continuation!.read_next;
  const other = await box.run(N.list, { project: PRJ_B, cursor });
  assertEquals(other.outcome.kind, "failure");
  assertEquals(other.outcome.code, "invalid_input");
});

Deno.test("lophn-agent/roles/lophn#R3 [ctx-I58g]: context.list marks a list that reached the read limit as not complete", async () => {
  const many = Array.from({ length: 12 }, (_, i) => context(i + 1, PRJ_A));
  // 쪽당 1개씩 주는 core라 한 project를 10쪽에서 멈춘다.
  const box = lookup(world({ contexts: many, pageSize: 1 }));
  const outcome = await box.run(N.list, {});
  assertEquals(outcome.outcome.kind, "success");
  assertEquals(outcome.result.complete, false);
  assertEquals(outcome.result.pending.length, 1);
  assertEquals((outcome.result.content as any).total, 10);
});

// ---- context.overview ----

Deno.test("lophn-agent/roles/lophn#R3 [ctx-I58g]: context.overview gives purpose and the prompt-material text built by the injected renderer from the contract, counts, and glossary", async () => {
  const rendered: any[] = [];
  const box = lookup(world(), (input) => {
    rendered.push(input);
    return `TEXT ${input.context.title}`;
  });
  const outcome = await box.run(N.overview, { context: CTX_A1 });
  assertEquals(outcome.outcome.kind, "success");
  assertEquals(outcome.result.content, {
    context: CTX_A1,
    title: "Context 1",
    project: PRJ_A,
    purpose: "Purpose 1",
    bundle_hash: HASH,
    text: "TEXT Context 1",
  });
  assertEquals(rendered.length, 1);
  assertEquals(rendered[0], {
    context: { id: CTX_A1, title: "Context 1" },
    bundle_hash: HASH,
    contract: { types: [] },
    counts: [{ type: "Recipe", count: 3 }],
    glossary: [{ term: "pie", meaning: "a baked dish" }],
  });
  assertEquals(
    new Set(box.core.seen.map((call) => call.contract)),
    new Set([
      "context.get",
      "context.contract",
      "context.overview",
      "glossary.list",
    ]),
  );
});

Deno.test("lophn-agent/roles/lophn#R3 [ctx-I58g]: context.overview of a context that is not active or does not exist is the same not_found", async () => {
  const box = lookup(world({
    contexts: [context(1, PRJ_A, { status: "drafting" })],
  }));
  const drafting = await box.run(N.overview, { context: CTX_A1 });
  const missing = await box.run(N.overview, { context: CTX_B1 });
  for (const outcome of [drafting, missing]) {
    assertEquals(outcome.outcome.kind, "failure");
    assertEquals(outcome.outcome.code, "not_found");
  }
  assertEquals(drafting.result.summary, missing.result.summary);
});

Deno.test("lophn-agent/roles/lophn#R3 [ctx-I58g]: context.overview does not mix counts of another bundle and a long text is cut at the result limit", async () => {
  const stale = world();
  const call = stale.ports.call.bind(stale.ports);
  stale.ports.call = (contract, input, run) =>
    contract === "context.overview"
      ? Promise.resolve(ok({
        context: CTX_A1,
        bundle_hash: "b".repeat(64),
        types: [],
        violation_count: 0,
      }))
      : call(contract, input, run);
  const changed = await lookup(stale).run(N.overview, { context: CTX_A1 });
  assertEquals(changed.outcome.kind, "failure");
  assertEquals(changed.outcome.code, "conflict");

  const long = lookup(world(), () => "line\n".repeat(1000));
  const outcome = await long.run(N.overview, { context: CTX_A1 });
  assertEquals(outcome.outcome.kind, "success");
  assertEquals(outcome.result.complete, false);
  assert(
    new TextEncoder().encode((outcome.result.content as any).text).length <=
      24 * 1024,
  );
});

// ---- context.containing ----

Deno.test("lophn-agent/roles/lophn#R14 [ctx-I58g]: context.containing gives the contexts whose Sources cover a path, which is the shape place recommendation takes", async () => {
  const box = lookup();
  const covered = await box.run(N.containing, {
    project: PRJ_A,
    path: "recipes/pie.md",
  });
  assertEquals(covered.outcome.kind, "success");
  assertEquals(covered.result.content, {
    project: PRJ_A,
    path: "recipes/pie.md",
    contexts: [{ context: CTX_A1, title: "Context 1", types: ["Recipe"] }],
  });
  assertEquals(box.core.seen.at(-1), {
    contract: "context.containing",
    input: { project: PRJ_A, path: "recipes/pie.md" },
  });
  const uncovered = await box.run(N.containing, {
    project: PRJ_A,
    path: "notes/other.md",
  });
  assertEquals((uncovered.result.content as any).contexts, []);
  assertEquals(uncovered.result.complete, true);
});

Deno.test("lophn-agent/roles/lophn#R14 [ctx-I58g]: context.containing keeps core's error for a project it cannot read", async () => {
  const box = lookup();
  box.core.ports.call = () =>
    Promise.resolve(err({ code: "not_found", message: "no project" }));
  const outcome = await box.run(N.containing, {
    project: PRJ_GONE,
    path: "a.md",
  });
  assertEquals(outcome.outcome.kind, "failure");
  assertEquals(outcome.outcome.code, "not_found");
});
