// deno-lint-ignore-file no-explicit-any
// lophn-agent/harness/tools#R23과 roles/context-engineer#R8, R11, R14, R15: Context Engineer에게만 계약·초안
// 읽기, 초안 쓰기, 미리보기, 판 제출, 위반 읽기, 용어집 읽기·쓰기 tool이 있고, 미리보기는 판·파일·ledger의
// context 상태를 바꾸지 않는다. 구현은 ctx-I57이 한다. core는 `ContractCall` fake이고 네트워크·model은
// 부르지 않는다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  BUILTIN_TOOLS,
  executeTool,
  FORBIDDEN_TOOL_NAMES,
  listTools,
  type RunCredential,
  runOperations,
  type ToolDefinition,
} from "./mod.ts";
import { ROLE_CAPS } from "../agents/mod.ts";
import {
  CONTEXT_ENGINEER_TOOL_NAMES,
  CONTEXT_ENGINEER_TOOLS,
  CONTEXT_PREVIEW_CONTRACT,
  type ContextPreviewRead,
  createContextEngineerToolHandlers,
} from "./context-engineer-tools.ts";

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const RUN = id("run", 1);
const CALL = id("tcl", 1);
const CTX = id("ctx", 1);
const BUNDLE = id("cbn", 1);
const APPLIED = id("cbn", 2);
const CHECK = id("chk", 1);
const ENTRY = id("trm", 1);
const HASH = "a".repeat(64);
const AGENT = `agent:${id("asg", 1)}`;

const N = CONTEXT_ENGINEER_TOOL_NAMES;
const READ_NAMES = [
  N.readContract,
  N.preview,
  N.readViolations,
  N.glossaryRead,
];
const WRITE_NAMES = [N.create, N.draft, N.submit, N.glossaryWrite];
const ALL_NAMES = [...READ_NAMES, ...WRITE_NAMES];

// 이 contract들은 Context Engineer 말고는 열리지 않는 쓰기·초안·미리보기다.
const ENGINEER_ONLY_CONTRACTS = [
  "context.create",
  "bundle.save_draft",
  "bundle.submit",
  "glossary.set",
  "glossary.remove",
  "context.draft",
  CONTEXT_PREVIEW_CONTRACT,
];

// ---- fixture: fake core ----

// schema 안에서 `command`라는 칸을 가진 object마다 그 object의 `kind` 상수를 모은다.
function commandKeyOwners(node: unknown, owners: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) commandKeyOwners(item, owners);
  } else if (typeof node === "object" && node !== null) {
    const properties = (node as Record<string, any>)["properties"];
    if (properties !== undefined && "command" in properties) {
      owners.push(String(properties["kind"]?.["const"]));
    }
    for (const value of Object.values(node)) commandKeyOwners(value, owners);
  }
  return owners;
}

type Seen = {
  contract: string;
  input: Record<string, unknown>;
  run: string;
  options: { compare?: unknown; idempotency_key?: string } | undefined;
};

const CONTENT = { schema: 1, contract: { types: [{ name: "Recipe" }] } };

// core가 쥔 context 상태: 적용된 판, project 파일, 만드는 중인 판, 용어집. 시험이 전후를 비교한다.
function world() {
  const state = {
    applied: { bundle: APPLIED, hash: HASH, content: CONTENT },
    files: ["recipes/pie.md", "recipes/stew.md"],
    contexts: [] as { id: string; project: string }[],
    draft: null as null | {
      bundle: string;
      content: unknown;
      revision: number;
    },
    check: null as null | {
      findings: { kind: string; target: string | null; detail: string }[];
    },
    glossary: [] as {
      id: string;
      term: string;
      meaning: string;
      revision: number;
    }[],
  };
  const seen: Seen[] = [];
  const snapshot = () => JSON.stringify(state);
  const summary = (status: string) => ({
    id: state.draft?.bundle ?? BUNDLE,
    context: CTX,
    number: status === "draft" ? null : 2,
    parent: APPLIED,
    bundle_hash: status === "draft" ? null : "b".repeat(64),
    status,
    check: status === "draft" ? null : CHECK,
    created_by: AGENT,
    revision: String(state.draft?.revision ?? 1),
  });
  const meta = { as_of_seq: "9", complete: true, next_cursor: null };
  const ports = {
    call(
      contract: string,
      input: unknown,
      run: string,
      options?: { compare?: unknown; idempotency_key?: string },
    ): Promise<Result<unknown>> {
      const body = input as Record<string, unknown>;
      seen.push({ contract, input: body, run, options });
      const reply = (value: unknown) => Promise.resolve(ok(value));
      switch (contract) {
        case "context.create": {
          const created = {
            id: body["id"] as string,
            project: body["project"] as string,
            title: body["title"] as string,
            purpose: body["purpose"] as string,
            status: "drafting",
            applied_bundle: null,
            revision: "1",
          };
          if (!state.contexts.some((c) => c.id === created.id)) {
            state.contexts.push(created);
          }
          return reply(created);
        }
        case "context.contract":
          return reply({
            ...meta,
            context: CTX,
            bundle: state.applied.bundle,
            bundle_hash: state.applied.hash,
            content: state.applied.content,
          });
        case "context.draft":
          return reply({
            ...meta,
            context: CTX,
            draft: state.draft === null ? null : {
              step: 2,
              bundle: summary(state.check === null ? "draft" : "failed"),
              content: state.draft.content,
              check: state.check === null ? null : {
                id: CHECK,
                context: CTX,
                bundle: state.draft.bundle,
                status: "failed",
                snapshot_hash: HASH,
                findings: state.check.findings,
                violation_count: 0,
                started_at: "2026-10-12T00:00:00.000Z",
                finished_at: "2026-10-12T00:00:01.000Z",
              },
            },
          });
        case "bundle.save_draft": {
          const base =
            (options?.compare as { base_revision?: string } | undefined)
              ?.base_revision;
          if (body["bundle"] === undefined) {
            state.draft = {
              bundle: BUNDLE,
              content: body["content"],
              revision: 1,
            };
          } else {
            if (state.draft === null || base !== String(state.draft.revision)) {
              return Promise.resolve(
                err({ code: "conflict", message: `stale draft of ${CTX}` }),
              );
            }
            state.draft = {
              bundle: state.draft.bundle,
              content: body["content"],
              revision: state.draft.revision + 1,
            };
            state.check = null;
          }
          return reply(summary("draft"));
        }
        case CONTEXT_PREVIEW_CONTRACT: {
          // 추출과 위반 계산만 한다. state를 바꾸지 않는다.
          const read: ContextPreviewRead = {
            context: CTX,
            bundle: body["bundle"] as string,
            types: [{ type: "Recipe", count: state.files.length }],
            violation_count: 45,
            violations: Array.from({ length: 20 }, (_, i) => ({
              kind: "rule" as const,
              rule: "Recipe.title-required",
              type: "Recipe",
              path: `recipes/r${i}.md`,
              section: null,
              target: null,
              message: "Every recipe has a title",
            })),
            findings: [],
            complete: false,
            next_cursor: "20",
          };
          return reply(read);
        }
        case "bundle.submit": {
          if (state.draft === null) {
            return Promise.resolve(
              err({ code: "not_found", message: "no draft" }),
            );
          }
          // 이 fake의 검사는 content가 `bad`를 담으면 실패한다. 실패한 판은 적용되지 않는다.
          const bad = JSON.stringify(state.draft.content).includes("bad");
          state.check = bad
            ? {
              findings: [{
                kind: "example_mismatch",
                target: "examples/0",
                detail: "expected pie",
              }],
            }
            : null;
          return reply(summary(bad ? "failed" : "checking"));
        }
        case "context.violations": {
          const rows = Array.from({ length: 20 }, (_, i) => ({
            context: CTX,
            bundle_hash: HASH,
            kind: "rule",
            rule: "Recipe.title-required",
            type: "Recipe",
            path: `recipes/r${i}.md`,
            section: null,
            target: null,
            message: "Every recipe has a title",
            handed_off: false,
          }));
          return reply({
            as_of_seq: "9",
            complete: false,
            next_cursor: "20",
            context: CTX,
            violations: rows.slice(
              0,
              (body["limit"] as number | undefined) ?? 30,
            ),
          });
        }
        case "glossary.list":
          return reply({
            ...meta,
            context: CTX,
            entries: state.glossary.map((entry) => ({
              id: entry.id,
              context: CTX,
              term: entry.term,
              meaning: entry.meaning,
              set_by: "agent",
              updated_at: "2026-10-12T00:00:00.000Z",
              revision: String(entry.revision),
            })),
          });
        case "glossary.set": {
          const base =
            (options?.compare as { base_revision?: string } | undefined)
              ?.base_revision;
          if (body["entry"] !== undefined) {
            const found = state.glossary.find((entry) =>
              entry.id === body["entry"]
            );
            if (found === undefined || base !== String(found.revision)) {
              return Promise.resolve(
                err({ code: "conflict", message: "stale entry" }),
              );
            }
            found.meaning = (body["meaning"] as string | undefined) ??
              found.meaning;
            found.term = (body["term"] as string | undefined) ?? found.term;
            found.revision += 1;
            return reply(entryOf(found));
          }
          const created = {
            id: body["id"] as string,
            term: body["term"] as string,
            meaning: body["meaning"] as string,
            revision: 1,
          };
          if (!state.glossary.some((entry) => entry.id === created.id)) {
            state.glossary.push(created);
          }
          return reply(entryOf(created));
        }
        case "glossary.remove": {
          const base =
            (options?.compare as { base_revision?: string } | undefined)
              ?.base_revision;
          const found = state.glossary.find((entry) =>
            entry.id === body["entry"]
          );
          if (found === undefined) {
            return Promise.resolve(
              err({ code: "not_found", message: "no entry" }),
            );
          }
          if (base !== String(found.revision)) {
            return Promise.resolve(
              err({ code: "conflict", message: "stale entry" }),
            );
          }
          state.glossary = state.glossary.filter((entry) => entry !== found);
          return reply({ entry: found.id });
        }
        default:
          return Promise.resolve(
            err({ code: "not_found", message: "no route" }),
          );
      }
    },
  };
  function entryOf(
    entry: { id: string; term: string; meaning: string; revision: number },
  ) {
    return {
      id: entry.id,
      context: CTX,
      term: entry.term,
      meaning: entry.meaning,
      set_by: "agent",
      updated_at: "2026-10-12T00:00:00.000Z",
      revision: String(entry.revision),
    };
  }
  return { state, seen, ports, snapshot };
}

function credential(
  listed: readonly ToolDefinition[],
  call: string | undefined = CALL,
): RunCredential {
  return {
    run: RUN,
    targets: new Set(),
    operations: new Set(runOperations(listed)),
    ...(call === undefined ? {} : { call }),
  };
}

function engineer(core = world()) {
  const listed = CONTEXT_ENGINEER_TOOLS;
  const handlers = createContextEngineerToolHandlers(core.ports);
  return {
    core,
    run: (name: string, input: unknown, call: string | undefined = CALL) =>
      executeTool(
        { listed, handlers, credential: credential(listed, call) },
        name,
        input,
      ),
  };
}

function capNames(role: string): readonly string[] {
  const cap = ROLE_CAPS.get(role);
  assert(cap !== undefined, role);
  return cap.tools;
}

function listedFor(role: string): readonly ToolDefinition[] {
  const names = capNames(role);
  return listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    { presetTools: names, roleTools: names },
  );
}

// ---- R23: 정의와 분류 ----

Deno.test("lophn-agent/harness/tools#R23 [ctx-I57]: Context Engineer tool은 읽기 넷과 쓰기 넷이고 context 생성·초안 쓰기·제출·용어집 쓰기만 write이며 매번 묻지 않는다", () => {
  assertEquals(
    CONTEXT_ENGINEER_TOOLS.map((d) => d.name).sort(),
    [...ALL_NAMES].sort(),
  );
  const byName = new Map(CONTEXT_ENGINEER_TOOLS.map((d) => [d.name, d]));
  for (const name of READ_NAMES) {
    const definition = byName.get(name)!;
    // 미리보기도 읽기다: 판·파일·ledger의 context 상태를 바꾸지 않는다.
    assertEquals(definition.effect, "read", name);
    assertEquals(definition.idempotent, true, name);
  }
  for (const name of WRITE_NAMES) {
    assertEquals(byName.get(name)!.effect, "write", name);
  }
  for (const definition of CONTEXT_ENGINEER_TOOLS) {
    assertEquals(definition.confirm, false, definition.name);
    assertEquals(definition.origin, "builtin");
    assert(definition.description.trim().length > 0);
    assert(definition.errors.includes("not_found"));
  }
  // 소유 contract는 context·terms가 연 route 이름 하나다.
  assertEquals(
    Object.fromEntries(CONTEXT_ENGINEER_TOOLS.map((d) => [d.name, d.contract])),
    {
      [N.create]: "context.create",
      [N.readContract]: "context.contract",
      [N.preview]: CONTEXT_PREVIEW_CONTRACT,
      [N.readViolations]: "context.violations",
      [N.glossaryRead]: "glossary.list",
      [N.draft]: "bundle.save_draft",
      [N.submit]: "bundle.submit",
      [N.glossaryWrite]: "glossary.set",
    },
  );
  // 계약 읽기는 만드는 중인 판을, 용어집 쓰기는 항목 지우기를 같은 자격으로 함께 부른다.
  const operations = runOperations(CONTEXT_ENGINEER_TOOLS);
  assert(operations.includes("context.draft"));
  assert(operations.includes("glossary.remove"));
});

Deno.test("lophn-agent/roles/context-engineer#R5 [ctx-I57]: Context Engineer tool에는 code·shell·파일 쓰기·앱 command 실행이 없고 계약은 선언으로만 쓴다", () => {
  assertEquals(CONTEXT_ENGINEER_TOOLS.length, ALL_NAMES.length);
  for (const definition of CONTEXT_ENGINEER_TOOLS) {
    assert(!FORBIDDEN_TOOL_NAMES.includes(definition.name), definition.name);
    assert(definition.origin !== "app" && definition.origin !== "external");
    assert(definition.contract !== "app.connect");
    assert(definition.effect !== "external");
  }
  // 초안의 content는 JSON 객체(선언)뿐이고 글 덩어리나 경로를 받지 않는다.
  const save = CONTEXT_ENGINEER_TOOLS.find((d) => d.name === N.draft)!;
  const schema = JSON.stringify(save.inputSchema ?? {});
  assert(schema.includes("content"));
  assertEquals(/shell|script|\"code\"/.test(schema), false);
  // `command`는 app-data Source가 읽을 앱 read command의 이름을 적는 선언 칸으로만 있다(실행 통로가 아니다).
  assertEquals(commandKeyOwners(save.inputSchema ?? {}), ["app-data"]);
  // Context Engineer 목록 전체(공통 읽기 포함)에도 금지 통로나 앱 command 실행이 없다.
  const listed = listedFor("context_engineer");
  assert(listed.length > CONTEXT_ENGINEER_TOOLS.length);
  for (const definition of listed) {
    assert(!FORBIDDEN_TOOL_NAMES.includes(definition.name), definition.name);
    assert(definition.contract !== "app.connect", definition.name);
  }
});

// ---- R23: Context Engineer에게만 ----

Deno.test("lophn-agent/harness/tools#R23 [ctx-I57]: 이 tool들은 Context Engineer의 역할 상한에만 있고 다른 세 역할의 목록에는 없다", () => {
  const builtin = new Set(BUILTIN_TOOLS.map((d) => d.name));
  for (const name of ALL_NAMES) {
    assert(builtin.has(name), `${name} is not a builtin tool`);
  }
  const engineer = listedFor("context_engineer").map((d) => d.name);
  for (const name of ALL_NAMES) {
    assert(
      capNames("context_engineer").includes(name),
      `engineer cap lacks ${name}`,
    );
    assert(engineer.includes(name), `engineer list lacks ${name}`);
  }
  for (const role of ["lophn", "app_engineer", "operator"]) {
    const names = new Set(listedFor(role).map((d) => d.name));
    for (const name of ALL_NAMES) {
      assert(!capNames(role).includes(name), `${role} cap has ${name}`);
      assert(!names.has(name), `${role} list has ${name}`);
    }
    // 쓰기·초안·미리보기 contract도 그 역할 run의 operation에 없다.
    const operations = runOperations(listedFor(role));
    for (const contract of ENGINEER_ONLY_CONTRACTS) {
      assert(!operations.includes(contract), `${role} may call ${contract}`);
    }
  }
  // 있는 역할은 쓰기 contract가 operation에 있다.
  const operations = runOperations(listedFor("context_engineer"));
  for (const contract of ENGINEER_ONLY_CONTRACTS) {
    assert(operations.includes(contract), contract);
  }
});

Deno.test("lophn-agent/roles/context-engineer#R15 [ctx-I57]: 관점·항목·용어 후보 쓰기 tool은 Context Engineer 상한에서 사라졌다", () => {
  const names = capNames("context_engineer");
  for (
    const old of [
      "context.add_item",
      "context.update_item",
      "context.remove_item",
      "term.propose_candidate",
      "term.update_candidate",
      "term.remove_candidate",
      "term.submit_definition_answer",
    ]
  ) {
    assert(!names.includes(old), `${old} should be gone`);
    assert(
      !BUILTIN_TOOLS.some((d) => d.name === old),
      `${old} is still a builtin tool`,
    );
  }
});

Deno.test("lophn-agent/harness/tools#R23 [ctx-I57]: Context Engineer 목록이 아닌 run에서 이 tool을 부르면 core를 부르기 전에 not_found다", async () => {
  const core = world();
  const handlers = createContextEngineerToolHandlers(core.ports);
  // operator의 run은 operation이 없으므로 같은 이름을 불러도 실행되지 않는다.
  const listed = listedFor("operator");
  const credentialOfOperator = credential(listed);
  for (const name of ALL_NAMES) {
    const outcome = await executeTool(
      {
        listed: CONTEXT_ENGINEER_TOOLS,
        handlers,
        credential: credentialOfOperator,
      },
      name,
      { context: CTX },
    );
    assertEquals(outcome.outcome.kind, "failure", name);
    assertEquals(outcome.executed, false, name);
  }
  assertEquals(core.seen, []);
});

// ---- R14: 읽기 ----

Deno.test("lophn-agent/roles/context-engineer#R14 [ctx-I57]: 계약 읽기는 적용된 판과 만드는 중인 판을 한 결과로 주고 용어집 읽기와 함께 읽기 contract만 부르며 쓰기 contract는 부르지 않는다", async () => {
  const box = engineer();
  box.core.state.draft = {
    bundle: BUNDLE,
    content: { draft: true },
    revision: 1,
  };
  const before = box.core.snapshot();

  const contract = await box.run(N.readContract, { context: CTX });
  assertEquals(contract.outcome.kind, "success");
  const content = contract.result.content as Record<string, any>;
  assertEquals(content["applied"]["bundle_hash"], HASH);
  assertEquals(content["applied"]["bundle"], APPLIED);
  assertEquals(content["applied"]["content"], CONTENT);
  assertEquals(content["draft"]["content"], { draft: true });
  assertEquals(content["draft"]["bundle"]["id"], BUNDLE);

  // 만드는 중인 판이 없으면 draft는 null이다.
  const idle = engineer();
  const none = await idle.run(N.readContract, { context: CTX });
  assertEquals((none.result.content as Record<string, any>)["draft"], null);

  assertEquals(
    (await box.run(N.glossaryRead, { context: CTX })).outcome.kind,
    "success",
  );

  assertEquals(
    box.core.seen.map((call) => call.contract),
    ["context.contract", "context.draft", "glossary.list"],
  );
  assertEquals(box.core.snapshot(), before);
  for (const call of box.core.seen) assertEquals(call.run, RUN);

  // 모르는 입력은 거절한다.
  const bad = await box.run(N.readContract, { context: CTX, bundle: BUNDLE });
  assertEquals(bad.outcome, { kind: "failure", code: "invalid_input" });
  assertEquals(box.core.seen.length, 3);
});

Deno.test("lophn-agent/harness/tools#R23 [ctx-T10d]: 24 KiB를 넘는 계약은 part와 section으로 나눠 읽고 없는 쪽 판은 core를 부르지 않는다", async () => {
  const box = engineer();
  const big = "x".repeat(20 * 1024);
  box.core.state.applied.content = {
    schema: 1,
    contract: { big },
    searches: [{ name: "s1" }],
    saved_views: [],
    examples: [{ big }],
  } as unknown as typeof box.core.state.applied.content;
  box.core.state.draft = {
    bundle: BUNDLE,
    content: { schema: 1, contract: { big }, searches: [{ name: "d1" }] },
    revision: 1,
  };

  // 둘 다 읽으면 24 KiB를 넘어 비워지고 complete가 거짓이다.
  const whole = await box.run(N.readContract, { context: CTX });
  assertEquals(whole.result.content, null);
  assertEquals(whole.result.complete, false);

  // 판 하나와 가지 하나로 나누면 읽힌다. 읽지 않는 쪽은 core를 부르지 않는다.
  const before = box.core.seen.length;
  const searches = await box.run(N.readContract, {
    context: CTX,
    part: "applied",
    section: "searches",
  });
  assertEquals(searches.result.complete, true);
  const applied = searches.result.content as Record<string, any>;
  assertEquals(applied["applied"]["content"], { searches: [{ name: "s1" }] });
  assertEquals(applied["applied"]["bundle_hash"], HASH);
  assertEquals("draft" in applied, false);
  assertEquals(applied["section"], "searches");
  assertEquals(
    box.core.seen.slice(before).map((call) => call.contract),
    ["context.contract"],
  );

  const draft = await box.run(N.readContract, {
    context: CTX,
    part: "draft",
    section: "searches",
  });
  const draftBody = draft.result.content as Record<string, any>;
  assertEquals(draftBody["draft"]["content"], { searches: [{ name: "d1" }] });
  assertEquals(draftBody["draft"]["bundle"]["id"], BUNDLE);
  assertEquals("applied" in draftBody, false);
  assertEquals(box.core.seen.at(-1)!.contract, "context.draft");

  // 만드는 중인 판이 없으면 draft는 null이다.
  const idle = engineer();
  const none = await idle.run(N.readContract, { context: CTX, part: "draft" });
  assertEquals((none.result.content as Record<string, any>)["draft"], null);

  // 모르는 part·section은 거절한다.
  for (const bad of [{ part: "both" }, { section: "types" }]) {
    const rejected = await box.run(N.readContract, { context: CTX, ...bad });
    assertEquals(rejected.outcome, { kind: "failure", code: "invalid_input" });
  }
});

Deno.test("lophn-agent/harness/tools#R23 [ctx-I57]: 위반 읽기는 한 번에 20개와 이어 보기를 돌려준다", async () => {
  const box = engineer();
  const first = await box.run(N.readViolations, { context: CTX });
  assertEquals(first.outcome.kind, "success");
  assertEquals(box.core.seen[0]!.contract, "context.violations");
  assertEquals(box.core.seen[0]!.input["limit"], 20);
  assertEquals("cursor" in box.core.seen[0]!.input, false);
  const content = first.result.content as Record<string, any>;
  assertEquals(content["violations"].length, 20);
  assertEquals(content["violations"][0]["path"], "recipes/r0.md");
  assertEquals(first.result.complete, false);
  assertEquals(first.result.continuation, { has_more: true, read_next: "20" });

  await box.run(N.readViolations, { context: CTX, cursor: "20" });
  assertEquals(box.core.seen[1]!.input["cursor"], "20");
  assertEquals(box.core.seen[1]!.input["limit"], 20);
});

// ---- R8: 초안 → 미리보기 → 제출 ----

Deno.test("lophn-agent/roles/context-engineer#R8 [ctx-I57]: 새 초안은 context와 내용만으로 쓰고 이미 있는 초안을 덮으려면 읽은 revision을 비교 기준으로 쓴다", async () => {
  const box = engineer();
  const first = await box.run(N.draft, {
    context: CTX,
    content: { contract: { types: [] } },
  });
  assertEquals(first.outcome.kind, "success");
  assertEquals(first.effect, "write");
  const call = box.core.seen[0]!;
  assertEquals(call.contract, "bundle.save_draft");
  assertEquals(call.input, {
    context: CTX,
    content: { contract: { types: [] } },
  });
  // 새로 만들 때는 비교 기준을 보내지 않는다. 같은 호출의 재전송은 최초 ToolCall ID로 묶는다.
  assertEquals(
    (call.options?.compare as Record<string, unknown> | undefined)
      ?.["base_revision"],
    undefined,
  );
  assertEquals(call.options?.idempotency_key, CALL);

  const overwrite = await box.run(
    N.draft,
    {
      context: CTX,
      bundle: BUNDLE,
      base_revision: "1",
      content: { contract: { types: [{}] } },
    },
    id("tcl", 2),
  );
  assertEquals(overwrite.outcome.kind, "success");
  const second = box.core.seen[1]!;
  assertEquals(second.input["bundle"], BUNDLE);
  assertEquals(second.options?.compare, { base_revision: "1" });
  assertEquals(second.options?.idempotency_key, id("tcl", 2));
  assertEquals(box.core.state.draft?.revision, 2);

  // 낡은 revision은 conflict로 끝나고 draft는 그대로다.
  const stale = await box.run(
    N.draft,
    { context: CTX, bundle: BUNDLE, base_revision: "1", content: { x: 1 } },
    id("tcl", 3),
  );
  assertEquals(stale.outcome, { kind: "failure", code: "conflict" });
  assertEquals(box.core.state.draft?.revision, 2);
});

Deno.test("lophn-agent/roles/context-engineer#R8 [ctx-I57]: 초안 쓰기 입력은 JSON 객체 내용과 bundle·base_revision 짝을 지키고 어긋나면 core를 부르지 않는다", async () => {
  const box = engineer();
  const bad: unknown[] = [
    { context: CTX }, // 내용 없음
    { context: CTX, content: "text" }, // 객체가 아니다
    { context: CTX, content: [] },
    { context: CTX, bundle: BUNDLE, content: {} }, // 덮으려면 base_revision이 필요하다
    { context: CTX, base_revision: "1", content: {} }, // 새 초안은 base_revision을 보내지 않는다
    { context: "ctx_nope", content: {} },
    { context: CTX, content: {}, stray: true },
  ];
  for (const input of bad) {
    const outcome = await box.run(N.draft, input);
    assertEquals(
      outcome.outcome,
      { kind: "failure", code: "invalid_input" },
      JSON.stringify(input),
    );
    assertEquals(outcome.executed, false);
  }
  assertEquals(box.core.seen, []);
});

Deno.test("lophn-agent/harness/tools#R23 [ctx-I57]: 미리보기는 초안을 지금 project 파일로 뽑아 type별 개수와 위반을 보이기만 하고 판·파일·초안·용어집 상태를 바꾸지 않는다", async () => {
  const box = engineer();
  box.core.state.draft = {
    bundle: BUNDLE,
    content: { draft: true },
    revision: 3,
  };
  box.core.state.glossary.push({
    id: ENTRY,
    term: "pie",
    meaning: "a baked dish",
    revision: 1,
  });
  const before = box.core.snapshot();

  const outcome = await box.run(N.preview, { context: CTX, bundle: BUNDLE });
  assertEquals(outcome.outcome.kind, "success");
  assertEquals(outcome.effect, "read");
  // 부른 contract는 미리보기 하나다. 쓰기·제출·적용 contract는 부르지 않는다.
  assertEquals(box.core.seen.map((call) => call.contract), [
    CONTEXT_PREVIEW_CONTRACT,
  ]);
  assertEquals(box.core.seen[0]!.input["bundle"], BUNDLE);
  assertEquals(box.core.snapshot(), before);

  const content = outcome.result.content as Record<string, any>;
  assertEquals(content["types"], [{ type: "Recipe", count: 2 }]);
  assertEquals(content["violation_count"], 45);
  assertEquals(content["violations"].length, 20);
  assertEquals(content["violations"][0]["message"], "Every recipe has a title");
  assertEquals(content["findings"], []);
  // 위반이 많으면 20개 요약과 이어 보기다(R13).
  assertEquals(outcome.result.continuation, {
    has_more: true,
    read_next: "20",
  });
  assertEquals(outcome.result.complete, false);

  // 몇 번을 불러도 상태가 같고 이어 보기 cursor는 그대로 core에 간다.
  await box.run(N.preview, { context: CTX, bundle: BUNDLE, cursor: "20" });
  assertEquals(box.core.seen[1]!.input["cursor"], "20");
  assertEquals(box.core.snapshot(), before);
});

Deno.test("lophn-agent/roles/context-engineer#R8 [ctx-I57]: 제출은 만든 판 하나를 비교 기준 없이 제출하고 실패한 판은 적용되지 않으며 실패 항목을 읽어 고쳐 다시 제출한다", async () => {
  const box = engineer();
  await box.run(N.draft, { context: CTX, content: { bad: true } });

  const failed = await box.run(N.submit, { bundle: BUNDLE }, id("tcl", 2));
  assertEquals(failed.outcome.kind, "success");
  assertEquals(failed.effect, "write");
  const submit = box.core.seen[1]!;
  assertEquals(submit.contract, "bundle.submit");
  assertEquals(submit.input, { bundle: BUNDLE });
  assertEquals(submit.options?.idempotency_key, id("tcl", 2));
  assertEquals(
    (failed.result.content as Record<string, any>)["status"],
    "failed",
  );
  // 적용된 판은 그대로다.
  assertEquals(box.core.state.applied.bundle, APPLIED);

  // 실패한 항목은 계약 읽기가 싣는 만드는 중인 판의 검사 보고로 읽는다.
  const draft = await box.run(N.readContract, { context: CTX }, id("tcl", 3));
  const check = (draft.result.content as Record<string, any>)["draft"]["check"];
  assertEquals(check["status"], "failed");
  assertEquals(check["findings"][0]["kind"], "example_mismatch");

  // 읽은 revision으로 덮어 쓰고 다시 제출하면 검사 중으로 간다.
  const rewritten = await box.run(
    N.draft,
    {
      context: CTX,
      bundle: BUNDLE,
      base_revision: "1",
      content: { fixed: true },
    },
    id("tcl", 4),
  );
  assertEquals(rewritten.outcome.kind, "success");
  const resubmitted = await box.run(N.submit, { bundle: BUNDLE }, id("tcl", 5));
  assertEquals(
    (resubmitted.result.content as Record<string, any>)["status"],
    "checking",
  );
  assertEquals(box.core.seen.map((call) => call.contract), [
    "bundle.save_draft",
    "bundle.submit",
    "context.contract",
    "context.draft",
    "bundle.save_draft",
    "bundle.submit",
  ]);

  // 제출 입력도 선언 밖 값을 거절한다.
  const bad = await box.run(N.submit, { bundle: BUNDLE, apply: true });
  assertEquals(bad.outcome, { kind: "failure", code: "invalid_input" });
  assertEquals(box.core.seen.length, 6);
});

// ---- R11: 용어집 ----

Deno.test("lophn-agent/roles/context-engineer#R11 [ctx-I57]: 새 용어집 항목의 id는 최초 ToolCall ID에서 정해져 재전송이 두 번째 항목을 만들지 않는다", async () => {
  const box = engineer();
  const input = { context: CTX, term: "pie", meaning: "a baked dish" };
  const first = await box.run(N.glossaryWrite, input, id("tcl", 7));
  assertEquals(first.outcome.kind, "success");
  assertEquals(first.effect, "write");
  const call = box.core.seen[0]!;
  assertEquals(call.contract, "glossary.set");
  assert(/^trm_[0-9a-hjkmnp-tv-z]{26}$/.test(call.input["id"] as string));
  assertEquals(call.input["context"], CTX);
  assertEquals(call.input["term"], "pie");
  assertEquals(call.input["meaning"], "a baked dish");
  assertEquals(call.options?.idempotency_key, id("tcl", 7));

  await box.run(N.glossaryWrite, input, id("tcl", 7));
  assertEquals(box.core.seen[1]!.input["id"], call.input["id"]);
  assertEquals(box.core.state.glossary.length, 1);

  // 다른 호출은 다른 항목이다.
  await box.run(N.glossaryWrite, input, id("tcl", 8));
  assertNotEquals(box.core.seen[2]!.input["id"], call.input["id"]);
  assertEquals(box.core.state.glossary.length, 2);
});

Deno.test("lophn-agent/roles/context-engineer#R11 [ctx-I57]: 이미 있는 항목의 수정과 삭제는 읽은 revision을 비교 기준으로 쓰고 용어집은 계약과 따로 있다", async () => {
  const box = engineer();
  box.core.state.glossary.push({
    id: ENTRY,
    term: "pie",
    meaning: "a baked dish",
    revision: 4,
  });

  const changed = await box.run(N.glossaryWrite, {
    entry: ENTRY,
    meaning: "a baked dish with a crust",
    base_revision: "4",
  });
  assertEquals(changed.outcome.kind, "success");
  const set = box.core.seen[0]!;
  assertEquals(set.contract, "glossary.set");
  assertEquals(set.input, {
    entry: ENTRY,
    meaning: "a baked dish with a crust",
  });
  assertEquals(set.options?.compare, { base_revision: "4" });

  const stale = await box.run(N.glossaryWrite, {
    entry: ENTRY,
    base_revision: "4",
    remove: true,
  });
  assertEquals(stale.outcome, { kind: "failure", code: "conflict" });
  assertEquals(box.core.state.glossary.length, 1);

  const removed = await box.run(N.glossaryWrite, {
    entry: ENTRY,
    base_revision: "5",
    remove: true,
  });
  assertEquals(removed.outcome.kind, "success");
  const remove = box.core.seen[2]!;
  assertEquals(remove.contract, "glossary.remove");
  assertEquals(remove.input, { entry: ENTRY });
  assertEquals(remove.options?.compare, { base_revision: "5" });
  assertEquals(box.core.state.glossary.length, 0);

  // 용어집 쓰기는 계약·적용된 판을 건드리지 않는다.
  assertEquals(box.core.state.applied.hash, HASH);
  assertEquals(
    box.core.seen.some((call) =>
      call.contract.startsWith("bundle.") ||
      call.contract === "context.contract"
    ),
    false,
  );

  // 수정은 항목 id와 바뀌는 값 하나 이상, 삭제는 항목 id가 필요하다.
  for (
    const [name, input] of [
      [N.glossaryWrite, { entry: ENTRY, base_revision: "5" }],
      [N.glossaryWrite, { entry: ENTRY, meaning: "x" }],
      [N.glossaryWrite, { context: CTX, term: "x" }],
      [N.glossaryWrite, {
        context: CTX,
        term: "x",
        meaning: "y",
        entry: ENTRY,
      }],
      [N.glossaryWrite, { entry: ENTRY, remove: true }],
      [N.glossaryWrite, { base_revision: "5", remove: true }],
      [N.glossaryWrite, { entry: ENTRY, base_revision: "5", remove: false }],
      [N.glossaryWrite, {
        entry: ENTRY,
        base_revision: "5",
        remove: true,
        meaning: "x",
      }],
    ] as [string, unknown][]
  ) {
    const outcome = await box.run(name, input);
    assertEquals(
      outcome.outcome,
      { kind: "failure", code: "invalid_input" },
      JSON.stringify(input),
    );
  }
  assertEquals(box.core.seen.length, 3);
});

// ---- R23: context 만들기 ----

Deno.test("lophn-agent/harness/tools#R23 [ctx-I58f]: context 생성 tool은 Context Engineer에게만 열리는 write이고 입력은 project·title·purpose뿐이다", async () => {
  const definition = CONTEXT_ENGINEER_TOOLS.find((d) => d.name === N.create)!;
  assertEquals(definition.name, "context.create");
  assertEquals(definition.effect, "write");
  assertEquals(definition.contract, "context.create");
  assertEquals(definition.confirm, false);
  assertEquals(definition.origin, "builtin");
  const schema = definition.inputSchema as Record<string, any>;
  assertEquals(Object.keys(schema["properties"]).sort(), [
    "project",
    "purpose",
    "title",
  ]);
  assertEquals([...schema["required"]].sort(), ["project", "purpose", "title"]);
  // id는 model이 정하지 않는다.
  assertEquals(
    definition.input.safeParse({
      id: CTX,
      project: id("prj", 1),
      title: "Recipes",
      purpose: "p",
    }).success,
    false,
  );
  assertEquals(
    definition.input.safeParse({
      project: id("prj", 1),
      title: "  ",
      purpose: "p",
    })
      .success,
    false,
  );

  // 역할 상한은 Context Engineer에게만 연다: 다른 세 역할의 상한·목록·operation에 없다.
  assert(capNames("context_engineer").includes(N.create));
  assert(
    listedFor("context_engineer").some((d) => d.name === N.create),
  );
  for (const role of ["lophn", "app_engineer", "operator"]) {
    assert(!capNames(role).includes(N.create), role);
    assert(!listedFor(role).some((d) => d.name === N.create), role);
    assert(!runOperations(listedFor(role)).includes("context.create"), role);
  }
  // 다른 역할의 run에서 불러도 core를 부르기 전에 막힌다.
  const core = world();
  const handlers = createContextEngineerToolHandlers(core.ports);
  const blocked = await executeTool(
    {
      listed: CONTEXT_ENGINEER_TOOLS,
      handlers,
      credential: credential(listedFor("lophn")),
    },
    N.create,
    { project: id("prj", 1), title: "Recipes", purpose: "p" },
  );
  assertEquals(blocked.executed, false);
  assertEquals(core.seen, []);
});

Deno.test("lophn-agent/harness/tools#R23 [ctx-I58f]: context 생성 handler는 core의 context.create를 project·title·purpose와 최초 ToolCall ID에서 정한 id로 한 번 부르고 재전송이 둘째 context를 만들지 않는다", async () => {
  const box = engineer();
  const PROJECT = id("prj", 1);
  const input = { project: PROJECT, title: "Recipes", purpose: "Keep recipes" };
  const first = await box.run(N.create, input, id("tcl", 7));
  assertEquals(first.outcome.kind, "success");
  assertEquals(first.effect, "write");
  assertEquals(box.core.seen.length, 1);
  const call = box.core.seen[0]!;
  assertEquals(call.contract, "context.create");
  assertEquals(call.run, RUN);
  assert(/^ctx_[0-9a-hjkmnp-tv-z]{26}$/.test(call.input["id"] as string));
  const { id: _id, ...rest } = call.input;
  assertEquals(rest, input);
  assertEquals(call.options?.idempotency_key, id("tcl", 7));
  // 결과에 새 context의 id가 있다.
  assertEquals(
    (first.result.content as Record<string, any>)["id"],
    call.input["id"],
  );

  // 같은 ToolCall의 재전송은 같은 id이고 context는 하나다.
  await box.run(N.create, input, id("tcl", 7));
  assertEquals(box.core.seen[1]!.input["id"], call.input["id"]);
  assertEquals(box.core.state.contexts.length, 1);

  // 다른 호출은 다른 context다.
  await box.run(N.create, input, id("tcl", 8));
  assertNotEquals(box.core.seen[2]!.input["id"], call.input["id"]);
  assertEquals(box.core.state.contexts.length, 2);

  // 모르는 입력은 core를 부르기 전에 거절한다.
  const bad = await box.run(N.create, { ...input, bundle: BUNDLE });
  assertEquals(bad.outcome, { kind: "failure", code: "invalid_input" });
  assertEquals(box.core.seen.length, 3);
});

// ---- R23: 초안 content의 계약 모양 ----

function fixtureContract(): unknown {
  return JSON.parse(Deno.readTextFileSync(
    new URL(
      "../../projects/contexts/testdata/eval-project.contract.json",
      import.meta.url,
    ),
  ));
}

Deno.test("lophn-agent/harness/tools#R23 [ctx-I58f]: 초안 content의 입력 schema는 계약 값(BundleContent)의 JSON Schema라 모양을 model이 짐작하지 않고 fixture 계약이 그 schema를 통과한다", () => {
  const draft = CONTEXT_ENGINEER_TOOLS.find((d) => d.name === N.draft)!;
  const schema = draft.inputSchema as Record<string, any>;
  assertEquals(schema["required"], ["context", "content"]);
  const content = schema["content"] ?? schema["properties"]["content"];
  // 계약의 일곱 Source kind와 검색·saved view·예시 칸이 schema에 있다.
  const text = JSON.stringify(content);
  for (
    const kind of [
      "folder",
      "docs",
      "series",
      "index",
      "section",
      "outline",
      "app-data",
    ]
  ) {
    assert(text.includes(`"const":"${kind}"`), kind);
  }
  assertEquals(
    Object.keys(content["properties"]).sort(),
    ["contract", "examples", "saved_views", "schema", "searches"],
  );
  // 재귀 조건의 참조는 입력 schema 뿌리의 $defs로 닿는다.
  const refs = [...text.matchAll(/"\$ref":"#\/\$defs\/([^"]+)"/g)].map((m) =>
    m[1]!
  );
  assert(refs.length > 0);
  for (const ref of refs) assert(ref in schema["$defs"], ref);
  assertEquals("$schema" in content, false);

  // fixture 계약은 schema를 통과하고 모양이 틀린 계약은 통과하지 못한다(JSON Schema → zod 왕복).
  const checker = z.fromJSONSchema(schema as never);
  const input = { context: CTX, content: fixtureContract() };
  assertEquals(checker.safeParse(input).success, true);
  assertEquals(draft.input.safeParse(input).success, true);
  const broken = structuredClone(input) as Record<string, any>;
  broken["content"]["contract"]["types"][0]["source"]["kind"] = "script";
  assertEquals(checker.safeParse(broken).success, false);
  const noSchema = structuredClone(input) as Record<string, any>;
  delete noSchema["content"]["schema"];
  assertEquals(checker.safeParse(noSchema).success, false);
});
