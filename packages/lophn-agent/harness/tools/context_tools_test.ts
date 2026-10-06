import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  productPresetDefinition,
  ROLE_CAPS,
  validateDefinition,
  type ValidateDeps,
} from "../../presets/mod.ts";
import {
  BUILTIN_TOOLS,
  CONTEXT_READ_TOOL_NAMES,
  CONTEXT_WRITE_TOOL_NAMES,
  createBuiltinToolHandlers,
  executeTool,
  listTools,
  METADATA_TOOL_NAMES,
  type RunCredential,
  runOperations,
  TOOL_BUNDLES,
} from "./mod.ts";

// context·term 묶음의 정의와 handler. 소유 contract(documents/contexts·terms)는 메모리 fake로 흉내 낸다.
// 실제 core·documents worker를 거친 변경과 run revert는 apps/core/context-revert_test.ts가 본다.
// 이 시험은 model provider를 부르지 않는다.

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const RUN = id("run", 1);
const CALL = id("tcl", 1);
const DOC_A = id("doc", 1);
const DOC_B = id("doc", 2);
const DOC_C = id("doc", 3);
const VER_A = id("ver", 1);
const VER_B = id("ver", 2);
const VER_C = id("ver", 3);
const APP = id("app", 1);
const PROJECT = id("prj", 1);

type Call = {
  contract: string;
  input: Record<string, unknown>;
  options: { compare?: unknown; idempotency_key?: string } | undefined;
};

type Item = {
  target: Record<string, unknown>;
  perspective: string;
  reason: string;
};
type Ctx = {
  id: string;
  title: string;
  purpose: string;
  items: Item[];
  revision: string;
  status: "active" | "archived";
};
type Term = {
  id: string;
  context: string;
  name: string;
  definition: string | null;
  evidence: Record<string, unknown>[];
  revision: string;
  status: "active" | "archived";
};

function notFound(): Result<never> {
  return err({ code: "not_found", message: "no such target" });
}

function key(target: Record<string, unknown>): string {
  return JSON.stringify([
    target["kind"],
    target["document"] ?? target["app"],
    target["section"] ?? target["command"] ?? null,
  ]);
}

// documents의 context·term 변경을 흉내 내는 메모리 world다. 변경은 revision CAS를 하고 새 revision은
// 변경마다 늘어난다. cursor는 offset 문자열이다.
function ledgerWorld() {
  const contexts = new Map<string, Ctx>();
  const terms = new Map<string, Term>();
  const calls: Call[] = [];
  // 사람이 답한 질문(정의 답 전달의 질문 정본). 답이 없거나 action이 없는 선택지는 거절 소스다.
  const questions = new Map<string, {
    status: string;
    closed_seq: string | null;
    answer: { kind: string; option_key: string | null } | null;
    options: {
      key: string;
      action: Record<string, unknown> | null;
    }[];
  }>();
  // 범위 밖 context. 읽기도 변경도 없는 것과 같은 not_found다.
  const hidden = new Set<string>();
  let seq = 10;
  let unavailable = false;
  const texts = new Map<string, string>([[`${DOC_A}@${VER_A}`, "본문 A"], [
    `${DOC_B}@${VER_B}`,
    "본문 B",
  ], [`${DOC_C}@${VER_C}`, "본문 C"]]);
  const next = () => String(++seq);
  const visible = (context: string) => {
    const found = contexts.get(context);
    return found === undefined || hidden.has(context) ? undefined : found;
  };
  const page = <T>(all: T[], body: Record<string, unknown>) => {
    const offset = body["cursor"] === undefined ? 0 : Number(body["cursor"]);
    const limit = Number(body["limit"] ?? 50);
    return {
      items: all.slice(offset, offset + limit),
      next: offset + limit < all.length ? String(offset + limit) : null,
    };
  };
  const world = {
    contexts,
    terms,
    questions,
    calls,
    hidden,
    setUnavailable(value: boolean) {
      unavailable = value;
    },
    seedContext(n: number, over: Partial<Ctx> = {}): Ctx {
      const context: Ctx = {
        id: id("ctx", n),
        title: `맥락 ${n}`,
        purpose: `목적 ${n}`,
        items: [],
        revision: next(),
        status: "active",
        ...over,
      };
      contexts.set(context.id, context);
      return context;
    },
    seedTerm(n: number, context: string, over: Partial<Term> = {}): Term {
      const term: Term = {
        id: id("trm", n),
        context,
        name: `용어 ${n}`,
        definition: null,
        evidence: [{
          document: DOC_A,
          version: VER_A,
          section: "intro",
          start_line: null,
          end_line: null,
        }],
        revision: next(),
        status: "active",
        ...over,
      };
      terms.set(term.id, term);
      return term;
    },
    // 사람이 고른 정의 답 질문. 답 없는 질문·action 없는 선택지는 거절을 본 소스다.
    seedQuestion(
      n: number,
      over: {
        status?: string;
        answer?: { kind: string; option_key: string | null } | null;
        option?: { key: string; action: Record<string, unknown> | null };
      } = {},
    ) {
      const option = over.option ?? { key: "apply", action: null };
      const question = {
        status: over.status ?? "answered",
        closed_seq: (over.status ?? "answered") === "answered"
          ? next()
          : null,
        answer: over.answer === undefined
          ? { kind: "option", option_key: option.key }
          : over.answer,
        options: [option],
      };
      questions.set(id("qst", n), question);
      return question;
    },
    seedApplyAction(n: number): Record<string, unknown> {
      return {
        concern: "documents/terms",
        command: "term.define",
        targets: [id("trm", n)],
        input: {
          kind: "inline",
          value: {
            term: id("trm", n),
            name: `용어 ${n}`,
            definition: "사람이 고른 뜻",
          },
        },
        comparison: { base_revision: "7" },
        input_hash: "a".repeat(64),
        binding_hash: "b".repeat(64),
      };
    },
    call(
      contract: string,
      input: unknown,
      _run: string,
      options?: Call["options"],
    ): Promise<Result<unknown>> {
      const body = input as Record<string, unknown>;
      calls.push({ contract, input: body, options });
      return Promise.resolve(world.handle(contract, body, options));
    },
    handle(
      contract: string,
      body: Record<string, unknown>,
      options?: Call["options"],
    ): Result<unknown> {
      const base = (options?.compare as { base_revision?: string } | undefined)
        ?.base_revision;
      const isChange = [
        "context.create",
        "context.update",
        "context.set_item",
        "context.remove_item",
        "context.archive",
        "term.propose",
        "term.update",
        "term.archive",
      ].includes(contract);
      if (isChange && unavailable) {
        return err({ code: "unavailable", message: "no answer" });
      }
      switch (contract) {
        case "context.list": {
          const all = [...contexts.values()].filter((context) =>
            !hidden.has(context.id) &&
            (body["status"] === undefined || body["status"] === "all" ||
              context.status === body["status"])
          );
          const shown = page(all, body);
          return ok({
            as_of_seq: "1",
            contexts: shown.items,
            complete: shown.next === null,
            next_cursor: shown.next,
          });
        }
        case "context.get": {
          const context = visible(String(body["context"]));
          return context === undefined
            ? notFound()
            : ok({ as_of_seq: "1", context, next_cursor: null });
        }
        case "outline.context": {
          const context = visible(String(body["context"]));
          if (context === undefined) return notFound();
          const shown = page(context.items, body);
          return ok({
            kind: "context",
            as_of_seq: "1",
            basis_seq: "1",
            context: context.id,
            title: context.title,
            purpose: context.purpose,
            entries: shown.items,
            coverage: { state: "complete" },
            perspectives: { basis: [], reference: [], watch: [] },
            glossary: [],
            candidates: [],
            complete: shown.next === null,
            next_cursor: shown.next,
          });
        }
        case "context.related": {
          const target = body["target"] as Record<string, unknown>;
          const all = [...contexts.values()].filter((context) =>
            !hidden.has(context.id) &&
            context.items.some((item) => key(item.target) === key(target))
          );
          const shown = page(all, body);
          return ok({
            as_of_seq: "1",
            contexts: shown.items,
            complete: shown.next === null,
            next_cursor: shown.next,
          });
        }
        case "term.list": {
          const context = visible(String(body["context"]));
          if (context === undefined) return notFound();
          const own = [...terms.values()].filter((term) =>
            term.context === context.id
          );
          return ok({
            as_of_seq: "1",
            definitions: own.filter((term) => term.definition !== null),
            candidates: own.filter((term) => term.definition === null),
            complete: true,
            next_cursor: null,
          });
        }
        case "term.get": {
          const term = terms.get(String(body["term"]));
          return term === undefined || hidden.has(term.context)
            ? notFound()
            : ok({ as_of_seq: "1", term, next_cursor: null });
        }
        case "project.list":
          return ok({
            as_of_seq: "1",
            projects: [{
              id: PROJECT,
              name: "alpha",
              title: "알파",
              purpose: "목적",
              status: "active",
              revision: "3",
              // 사용자 모양이 새어 들어오더라도 폴더 경로는 결과에 싣지 않는다.
              folders: [{ path: "/home/someone/alpha", description: "" }],
            }],
            next_cursor: null,
          });
        case "project.get":
          return body["project"] === PROJECT
            ? ok({
              as_of_seq: "1",
              project: {
                id: PROJECT,
                name: "alpha",
                title: "알파",
                purpose: "목적",
                status: "active",
                revision: "3",
                folders: [{ path: "/home/someone/alpha", description: "" }],
                documents: [{ document: DOC_A, version: VER_A }],
              },
              next_cursor: null,
            })
            : notFound();
        case "app.list":
          return ok({
            as_of_seq: "1",
            apps: [appRecord()],
            next_cursor: null,
          });
        case "app.get":
          return body["app"] === APP
            ? ok({ as_of_seq: "1", app: appRecord(), next_cursor: null })
            : notFound();
        case "document.read": {
          const reference = body["reference"] as {
            document: string;
            version: string;
          };
          const text = texts.get(`${reference.document}@${reference.version}`);
          return text === undefined ? notFound() : ok({
            as_of_seq: "1",
            document: reference.document,
            version: reference.version,
            latest_version: reference.version,
            format: { name: "document" },
            section: null,
            section_status: "whole",
            include_children: false,
            ranges: [{ start_line: 1, end_line: 1 }],
            text,
            redacted: false,
            failure_reason: null,
            omission_reason: null,
            complete: true,
            next_cursor: null,
          });
        }
        case "context.create": {
          if (contexts.has(String(body["id"]))) {
            return err({ code: "conflict", message: "exists" });
          }
          const created: Ctx = {
            id: String(body["id"]),
            title: String(body["title"]),
            purpose: String(body["purpose"]),
            items: (body["items"] as Item[]) ?? [],
            revision: next(),
            status: "active",
          };
          contexts.set(created.id, created);
          return ok(created);
        }
        case "context.update":
        case "context.set_item":
        case "context.remove_item":
        case "context.archive": {
          const context = visible(String(body["context"]));
          if (context === undefined) return notFound();
          if (context.revision !== base) {
            return err({ code: "conflict", message: "revision changed" });
          }
          if (contract === "context.update") {
            if (body["title"] !== undefined) {
              context.title = String(body["title"]);
            }
            if (body["purpose"] !== undefined) {
              context.purpose = String(body["purpose"]);
            }
          } else if (contract === "context.set_item") {
            const item = body["item"] as Item;
            const at = context.items.findIndex((existing) =>
              key(existing.target) === key(item.target)
            );
            if (at >= 0) context.items[at] = item;
            else context.items.push(item);
          } else if (contract === "context.remove_item") {
            const target = body["target"] as Record<string, unknown>;
            const at = context.items.findIndex((existing) =>
              key(existing.target) === key(target)
            );
            if (at < 0) return notFound();
            context.items.splice(at, 1);
          } else {
            context.status = "archived";
          }
          context.revision = next();
          return ok(context);
        }
        case "term.propose": {
          if (terms.has(String(body["id"]))) {
            return err({ code: "conflict", message: "exists" });
          }
          if (visible(String(body["context"])) === undefined) {
            return notFound();
          }
          const created: Term = {
            id: String(body["id"]),
            context: String(body["context"]),
            name: String(body["name"]),
            definition: null,
            evidence: body["evidence"] as Record<string, unknown>[],
            revision: next(),
            status: "active",
          };
          terms.set(created.id, created);
          return ok(created);
        }
        case "term.update":
        case "term.archive": {
          const term = terms.get(String(body["term"]));
          if (term === undefined || hidden.has(term.context)) {
            return notFound();
          }
          if (term.revision !== base) {
            return err({ code: "conflict", message: "revision changed" });
          }
          if (contract === "term.update") {
            if (body["name"] !== undefined) term.name = String(body["name"]);
            if (body["evidence"] !== undefined) {
              term.evidence = body["evidence"] as Record<string, unknown>[];
            }
          } else {
            term.status = "archived";
          }
          term.revision = next();
          return ok(term);
        }
        case "CreateQuestion":
          return ok({ id: body["id"], status: "open" });
        case "ReadQuestion": {
          const question = questions.get(String(body["question"]));
          return question === undefined ? notFound() : ok({
            as_of_seq: "1",
            question,
            next_cursor: null,
          });
        }
        case "ApplyQuestionOption": {
          // 전달된 질문·option·action은 질문 정본과 같아야 한다. 시험은 호출 내용을 본다.
          const question = questions.get(String(body["question"]));
          if (question === undefined) return notFound();
          const option = question.options.find((entry) =>
            entry.key === body["option_key"]
          );
          if (option === undefined) {
            return err({ code: "forbidden", message: "not the chosen option" });
          }
          return ok({
            question: body["question"],
            option_key: body["option_key"],
            applied: true,
            receipt_seq: next(),
          });
        }
        default:
          return err({ code: "invalid_input", message: contract });
      }
    },
  };
  return world;
}

function appRecord() {
  return {
    id: APP,
    slug: "notes",
    name: "메모",
    description: "메모를 모은다",
    planning_version: null,
    // 소스 경로·release·실행 허용은 목적이 아니다.
    source_path: "/home/someone/notes-source",
    active_release: id("rel", 1),
    revision: "5",
    run_enabled: true,
    status: "active",
  };
}

function rig(names?: readonly string[]) {
  const world = ledgerWorld();
  const all = names ?? BUILTIN_TOOLS.map((tool) => tool.name);
  const listed = listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    { presetTools: all, roleTools: all },
  );
  const handlers = createBuiltinToolHandlers({
    call: world.call,
    newId: () => id("qst", 99),
    runFacts: () =>
      Promise.resolve(ok({
        session: null,
        role: "context_engineer" as const,
        original_message: id("msg", 1),
        assignment: "asg_01arz3ndektsv4rrffq69g5fav",
      })),
  });
  const operations = new Set(runOperations(listed));
  const run = (
    tool: string,
    input: unknown,
    call: string | undefined = CALL,
  ) => {
    const credential: RunCredential = {
      run: RUN,
      targets: new Set(),
      operations,
      ...(call === undefined ? {} : { call }),
    };
    return executeTool({ listed, handlers, credential }, tool, input);
  };
  return { world, listed, run };
}

type Outcome = Awaited<ReturnType<ReturnType<typeof rig>["run"]>>;
// 결과 내용은 시험마다 모양이 달라 느슨하게 읽는다.
// deno-lint-ignore no-explicit-any
function content(outcome: Outcome): Record<string, any> {
  // deno-lint-ignore no-explicit-any
  return outcome.result.content as Record<string, any>;
}

const READ_CONTRACTS = new Set([
  "context.list",
  "context.get",
  "outline.context",
  "context.related",
  "term.list",
  "term.get",
  "project.list",
  "project.get",
  "app.list",
  "app.get",
  "document.read",
]);

function item(
  document: string,
  perspective = "basis",
  reason = "목적의 근거다",
  section: string | null = null,
) {
  return {
    target: { kind: "document", document, section },
    perspective,
    reason,
  };
}

function evidence(document: string, version: string, section = "intro") {
  return { document, version, section, start_line: null, end_line: null };
}

Deno.test("lophn-agent/roles/context-engineer#R4: 읽기 tool은 context 목록·읽기·항목·용어·문서 소속과 용어 읽기를 읽기로만 주고 아무것도 바꾸지 않는다", async () => {
  const { world, listed, run } = rig();
  const context = world.seedContext(1, {
    items: [item(DOC_A, "basis"), item(DOC_B, "watch", "변화만 본다", "intro")],
  });
  const defined = world.seedTerm(1, context.id, {
    definition: "사람이 정한 뜻",
  });
  const candidate = world.seedTerm(2, context.id);
  // 정의된 읽기 tool 전부가 read 효과이고 확인이 필요 없다.
  for (const name of [...CONTEXT_READ_TOOL_NAMES, ...METADATA_TOOL_NAMES]) {
    const definition = listed.find((tool) => tool.name === name);
    assert(definition !== undefined, name);
    assertEquals(definition.effect, "read", name);
    assertEquals(definition.confirm, false, name);
    assert(READ_CONTRACTS.has(definition.contract), name);
  }
  const listing = await run("context.list", {});
  assertEquals(listing.outcome.kind, "success");
  // 목록은 항목 없이 요약만 싣는다.
  assertEquals(content(listing)["contexts"], [{
    id: context.id,
    title: context.title,
    purpose: context.purpose,
    status: "active",
    revision: context.revision,
    item_count: 2,
  }]);
  const read = await run("context.read", { context: context.id });
  assertEquals(read.outcome.kind, "success");
  assertEquals(content(read)["context"]["revision"], context.revision);
  assertEquals(content(read)["items"].length, 2);
  assertEquals(content(read)["items"][1]["perspective"], "watch");
  const items = await run("context.items", { context: context.id });
  assertEquals(items.outcome.kind, "success");
  assertEquals(content(items)["entries"].length, 2);
  assertEquals(content(items)["title"], context.title);
  const terms = await run("context.terms", { context: context.id });
  assertEquals(terms.outcome.kind, "success");
  // 사람이 정의한 용어와 agent 후보는 섞이지 않는다.
  assertEquals(content(terms)["definitions"].map((t: Term) => t.id), [
    defined.id,
  ]);
  assertEquals(content(terms)["candidates"].map((t: Term) => t.id), [
    candidate.id,
  ]);
  const membership = await run("context.document_membership", {
    document: DOC_B,
    section: "intro",
  });
  assertEquals(membership.outcome.kind, "success");
  assertEquals(content(membership)["contexts"].map((c: Ctx) => c.id), [
    context.id,
  ]);
  const wholeDocument = await run("context.document_membership", {
    document: DOC_B,
  });
  assertEquals(content(wholeDocument)["contexts"], []);
  const term = await run("term.read", { term: defined.id });
  assertEquals(content(term)["term"]["definition"], "사람이 정한 뜻");
  // 읽기는 소유 읽기 contract만 불렀다.
  for (const call of world.calls) {
    assert(READ_CONTRACTS.has(call.contract), call.contract);
    assertEquals(call.options, undefined);
  }
  assertEquals(world.contexts.get(context.id)!.revision, context.revision);
});

Deno.test("lophn-agent/roles/context-engineer#R4: project와 app 읽기는 이름·목적·상태만 주고 폴더 경로·소스 경로·release·실행 허용과 앱 command는 싣지 않는다", async () => {
  const { world, run } = rig();
  const projects = await run("project.list", {});
  assertEquals(projects.outcome.kind, "success");
  assertEquals(content(projects)["projects"], [{
    id: PROJECT,
    name: "alpha",
    title: "알파",
    purpose: "목적",
    status: "active",
    revision: "3",
  }]);
  const project = await run("project.read", { project: PROJECT });
  assertEquals(content(project)["project"]["purpose"], "목적");
  assertEquals(content(project)["documents"], [{
    document: DOC_A,
    version: VER_A,
  }]);
  const apps = await run("app.list", {});
  assertEquals(apps.outcome.kind, "success");
  const purpose = await run("app.read_purpose", { app: APP });
  assertEquals(content(purpose)["app"], {
    id: APP,
    slug: "notes",
    name: "메모",
    description: "메모를 모은다",
    planning_version: null,
    status: "active",
  });
  for (const outcome of [projects, project, apps, purpose]) {
    const text = JSON.stringify(outcome.result);
    for (
      const leaked of [
        "/home/someone",
        "source_path",
        "active_release",
        "run_enabled",
      ]
    ) {
      assertEquals(text.includes(leaked), false, leaked);
    }
  }
  // 없는 대상은 안전한 문장 하나이고 원문 오류를 싣지 않는다.
  const absent = await run("app.read_purpose", { app: id("app", 9) });
  assertEquals(absent.outcome.kind, "failure");
  assertEquals(absent.result.summary, "tool target is not available");
  for (const call of world.calls) assert(READ_CONTRACTS.has(call.contract));
});

Deno.test("lophn-agent/roles/context-engineer#R4: Context Engineer의 읽기 선택은 문서·context·project·format·역할·assignment 조회와 앱 목적뿐이고 앱 command 호출과 시리즈 조회가 없다", () => {
  const caps = ROLE_CAPS.get("context_engineer")!.tools;
  const defined = new Map(BUILTIN_TOOLS.map((tool) => [tool.name, tool]));
  const reads = caps.filter((name) => defined.get(name)?.effect === "read");
  // 선택한 읽기가 이름·목적·목차·검색·고정 판·절·범위·이력·차이 조회와 검사에 한정된다.
  assertEquals(reads.slice().sort(), [
    "app.commands",
    "app.list",
    "app.read_purpose",
    "approval.read_decision",
    "assignment.list",
    "assignment.read",
    "context.document_membership",
    "context.items",
    "context.list",
    "context.read",
    "context.terms",
    "document.diff",
    "document.history",
    "document.list",
    "document.outline",
    "document.read_range",
    "document.read_section",
    "document.read_version",
    "document.search",
    "format.examples",
    "format.list",
    "format.rules",
    "format.validate",
    "handoff.read_result",
    "handoff.read_status",
    "preset.list",
    "preset.read",
    "project.list",
    "project.read",
    "question.read_decision",
    "run.read_result",
    "term.read",
    "visual.prepare_document",
    "visual.read",
  ]);
  // 앱 command는 목록과 설명이 전부다. 호출·시리즈·ticket·release 읽기는 선택에 없다.
  for (const name of caps) {
    assert(
      !/^(app\.(call_read_command|command_metadata|blueprint|releases|health|invocations)|series\.|ticket\.|problem\.|sdk\.)/
        .test(name),
      name,
    );
  }
  // 정의가 아직 없는 선택은 소유 contract가 서는 작업이 채운다. 이 목록 밖에는 정의 없는 선택이 없다.
  const undefinedYet = caps.filter((name) => !defined.has(name)).sort();
  assertEquals(undefinedYet, [
    "term.submit_definition_answer",
  ]);
});

Deno.test("lophn-agent/roles/context-engineer#R4: 목록은 20개씩 이어 읽고 조건이 다른 cursor는 거절하며 읽기 묶음은 역할 상한 안이다", async () => {
  const { world, run } = rig();
  for (let n = 1; n <= 45; n += 1) world.seedContext(n);
  const first = await run("context.list", {});
  assertEquals(content(first)["contexts"].length, 20);
  const second = await run("context.list", {
    cursor: first.result.continuation!.read_next,
  });
  assertEquals(content(second)["contexts"].length, 20);
  const third = await run("context.list", {
    cursor: second.result.continuation!.read_next,
  });
  assertEquals(content(third)["contexts"].length, 5);
  assertEquals(third.result.continuation, null);
  const seen = [first, second, third].flatMap((outcome) =>
    content(outcome)["contexts"].map((context: Ctx) => context.id)
  );
  assertEquals(new Set(seen).size, 45);
  const other = await run("context.list", {
    status: "archived",
    cursor: first.result.continuation!.read_next,
  });
  assertEquals(other.outcome.kind, "failure");
  assertEquals(other.outcome.code, "invalid_input");
  // 읽기 묶음은 읽기만 담고 쓰기 묶음과 따로 고르며, 역할 상한은 묶음 뒤에도 적용된다.
  const defined = new Map(BUILTIN_TOOLS.map((tool) => [tool.name, tool]));
  for (const name of TOOL_BUNDLES.get("context-read")!) {
    assertEquals(defined.get(name)!.effect, "read", name);
  }
  for (const name of TOOL_BUNDLES.get("metadata-read")!) {
    assertEquals(defined.get(name)!.effect, "read", name);
  }
  assertEquals(TOOL_BUNDLES.get("context-write"), CONTEXT_WRITE_TOOL_NAMES);
  const validate: ValidateDeps = {
    bundles: TOOL_BUNDLES,
    mcpServers: new Map(),
    roleCaps: ROLE_CAPS,
    definitionKey: () => undefined,
    catalogEntry: () => undefined,
    modelListed: () => null,
    credentialKeys: () => [],
  };
  const selecting = (
    kind: "context_engineer" | "operator",
    names: string[],
  ) => ({
    ...productPresetDefinition("context_engineer", "a".repeat(64)),
    kind,
    capability: {
      bundles: names.map((name) => ({ name, revision: 1 })),
      tools: [],
    },
  });
  const engineer = validateDefinition(
    selecting("context_engineer", [
      "context-read",
      "context-write",
      "metadata-read",
    ]),
    validate,
  );
  assert(engineer.ok, JSON.stringify(engineer));
  // Operator 상한에는 context 변경이 없고 읽기도 일부만이라 두 묶음 모두 거절된다.
  const operatorWrite = validateDefinition(
    selecting("operator", ["context-write"]),
    validate,
  );
  assertEquals(operatorWrite.ok, false);
  assertEquals(!operatorWrite.ok && operatorWrite.error.code, "forbidden");
  const operatorRead = validateDefinition(
    selecting("operator", ["context-read"]),
    validate,
  );
  assertEquals(operatorRead.ok, false);
});

Deno.test("lophn-agent/roles/context-engineer#R4: 범위 밖 context와 없는 context의 읽기는 같은 결과이고 이름이나 원문 오류를 싣지 않는다", async () => {
  const { world, run } = rig();
  const secret = world.seedContext(1, { title: "숨은 이름" });
  world.hidden.add(secret.id);
  const term = world.seedTerm(1, secret.id);
  for (
    const [tool, input, absent] of [
      ["context.read", { context: secret.id }, { context: id("ctx", 90) }],
      ["context.items", { context: secret.id }, { context: id("ctx", 90) }],
      ["context.terms", { context: secret.id }, { context: id("ctx", 90) }],
      ["term.read", { term: term.id }, { term: id("trm", 90) }],
    ] as const
  ) {
    const hiddenRead = await run(tool, input);
    const absentRead = await run(tool, absent);
    assertEquals(hiddenRead.outcome, absentRead.outcome, tool);
    assertEquals(hiddenRead.result, absentRead.result, tool);
    assertEquals(hiddenRead.result.summary, "tool target is not available");
    assertEquals(
      JSON.stringify(hiddenRead.result).includes("숨은 이름"),
      false,
    );
  }
  const listing = await run("context.list", {});
  assertEquals(content(listing)["contexts"], []);
  // 소유 contract 권한이 없으면 handler에 닿지 않고 없는 tool과 같다.
  const noScope = await executeTool(
    {
      listed: rig().listed,
      handlers: createBuiltinToolHandlers({
        call: world.call,
        newId: () => id("qst", 1),
        runFacts: () =>
          Promise.resolve(err({ code: "unavailable", message: "x" })),
      }),
      credential: { run: RUN, targets: new Set(), operations: new Set() },
    },
    "context.read",
    { context: secret.id },
  );
  assertEquals(noScope.outcome.code, "not_found");
});

Deno.test("lophn-agent/roles/context-engineer#R5: 쓰기 tool은 context 생성·이름·목적·보관·항목 변경과 용어 후보 관리뿐이고 되돌릴 수 있는 write로 묻지 않고 삭제·이동·정의 tool이 없다", () => {
  assertEquals(CONTEXT_WRITE_TOOL_NAMES, [
    "context.create",
    "context.rename",
    "context.set_purpose",
    "context.archive",
    "context.add_item",
    "context.update_item",
    "context.remove_item",
    "term.propose_candidate",
    "term.update_candidate",
    "term.remove_candidate",
    "term.submit_definition_answer",
  ]);
  const defined = new Map(BUILTIN_TOOLS.map((tool) => [tool.name, tool]));
  for (const name of CONTEXT_WRITE_TOOL_NAMES) {
    const tool = defined.get(name)!;
    assertEquals(tool.effect, "write", name);
    assertEquals(tool.reversible, true, name);
    assertEquals(tool.confirm, false, name);
    assertEquals(tool.origin, "builtin", name);
  }
  // 정의 확정·context 삭제·해제·분할·병합·감시 기록은 어느 tool의 contract도 아니다.
  const contracts = new Set(BUILTIN_TOOLS.map((tool) => tool.contract));
  for (
    const forbidden of [
      "term.define",
      "term.unarchive",
      "context.unarchive",
      "context.record_watch_change",
      "context.export",
    ]
  ) {
    assertEquals(contracts.has(forbidden), false, forbidden);
  }
  for (const name of defined.keys()) {
    assertEquals(
      /^(context|term)\.(delete|merge|split|define|unarchive)/.test(name),
      false,
      name,
    );
  }
  // 변경은 사람의 질문 없이 허용되는 내부 write라 효과 선언으로 승인을 만들지 않는다.
  assertEquals(
    CONTEXT_WRITE_TOOL_NAMES.every((name) =>
      defined.get(name)!.effect !== "external"
    ),
    true,
  );
  // 이 묶음에는 문서 쓰기가 없다. 요청 범위 보고 저장은 문서 묶음의 저장 tool이다.
  assertEquals(
    CONTEXT_WRITE_TOOL_NAMES.some((name) =>
      defined.get(name)!.contract === "SaveToolDocument"
    ),
    false,
  );
});

Deno.test("lophn-agent/roles/context-engineer#R5: Context Engineer의 쓰기 선택은 context·용어 변경, 요청 범위 보고 저장, 질문과 허용 handoff, Operator 초안 제출뿐이다", () => {
  const caps = ROLE_CAPS.get("context_engineer")!.tools;
  const defined = new Map(BUILTIN_TOOLS.map((tool) => [tool.name, tool]));
  const writes = caps.filter((name) => defined.get(name)?.effect === "write");
  assertEquals(
    writes.slice().sort(),
    [
      ...CONTEXT_WRITE_TOOL_NAMES,
      "approval.submit_assignment",
      "document.create",
      "document.save_version",
      "handoff.submit",
      "question.submit",
      "visual.show",
    ].sort(),
  );
  // 요청 범위 보고는 읽은 version 기준의 문서 저장 contract 하나로만 저장된다.
  assertEquals(defined.get("document.create")!.contract, "SaveToolDocument");
  assertEquals(
    defined.get("document.save_version")!.contract,
    "SaveToolDocument",
  );
  assertEquals(defined.get("question.submit")!.contract, "CreateQuestion");
  assertEquals(defined.get("handoff.submit")!.contract, "SubmitHandoff");
  // 아직 정의가 없는 쓰기 선택은 정의 답 전달(questions의 option action 경로)이다.
  // Operator 초안 제출은 T52가 정의를 두므로 이제 정의된 쓰기다. 실제 assignment 적용·
  // 권한 예외·사람 대신 승인 tool은 선택에도 정의에도 없다.
  assertEquals(
    caps.filter((name) => !defined.has(name)).filter((name) =>
      /submit|apply|approve/.test(name)
    ).sort(),
    ["term.submit_definition_answer"],
  );
  // 초안 제출은 platform/approvals의 소유 contract로 person 결정을 연다(P9).
  assertEquals(
    defined.get("approval.submit_assignment")!.contract,
    "create_approval_request",
  );
  for (const name of defined.keys()) {
    assertEquals(
      /^(assignment|preset)\.(apply|create|update|set)/.test(name),
      false,
      name,
    );
    assertEquals(/^approval\.(grant|approve|decide)/.test(name), false, name);
  }
});

Deno.test("lophn-agent/roles/context-engineer#R5: context 생성·이름·목적·항목·보관은 읽은 revision을 기준으로 소유 contract 하나씩 부르고 새 revision을 이어 쓴다", async () => {
  const { world, run } = rig();
  const created = await run("context.create", {
    title: "알파 설계",
    purpose: "알파의 설계 근거를 모은다",
    items: [item(DOC_A)],
  }, id("tcl", 1));
  assertEquals(created.outcome.kind, "success", JSON.stringify(created.result));
  const context = content(created)["context"] as Ctx & { item_count: number };
  assert(/^ctx_[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(context.id), context.id);
  assertEquals(context.item_count, 1);
  assertEquals(content(created)["created"], true);
  const make = world.calls.find((call) => call.contract === "context.create")!;
  // 새 ID와 idempotency key는 호출 내용에서 정했고 본문 hash나 blob 참조는 없다.
  assertEquals(make.options?.idempotency_key, id("tcl", 1));
  assertEquals(make.options?.compare, {});
  assertEquals(Object.keys(make.input).sort(), [
    "id",
    "items",
    "purpose",
    "title",
  ]);
  // 읽지 않은 revision은 만든 revision이어도 새로 읽은 것만 기준이 된다. 방금 만든 revision은 알고 있다.
  const renamed = await run("context.rename", {
    context: context.id,
    title: "알파 설계 기준",
    base_revision: context.revision,
  }, id("tcl", 2));
  assertEquals(renamed.outcome.kind, "success", JSON.stringify(renamed.result));
  const afterRename = content(renamed)["context"].revision as string;
  assert(afterRename !== context.revision);
  const purposed = await run("context.set_purpose", {
    context: context.id,
    purpose: "알파의 설계와 결정 근거를 모은다",
    base_revision: afterRename,
  }, id("tcl", 3));
  assertEquals(purposed.outcome.kind, "success");
  const added = await run("context.add_item", {
    context: context.id,
    item: item(DOC_B, "reference", "배경 지식이다"),
    position: 0,
    base_revision: content(purposed)["context"].revision,
  }, id("tcl", 4));
  assertEquals(added.outcome.kind, "success", JSON.stringify(added.result));
  const updated = await run("context.update_item", {
    context: context.id,
    item: item(DOC_B, "watch", "변화만 따라간다"),
    base_revision: content(added)["context"].revision,
  }, id("tcl", 5));
  assertEquals(updated.outcome.kind, "success", JSON.stringify(updated.result));
  const removed = await run("context.remove_item", {
    context: context.id,
    target: { kind: "document", document: DOC_A, section: null },
    base_revision: content(updated)["context"].revision,
  }, id("tcl", 6));
  assertEquals(removed.outcome.kind, "success", JSON.stringify(removed.result));
  const archived = await run("context.archive", {
    context: context.id,
    base_revision: content(removed)["context"].revision,
  }, id("tcl", 7));
  assertEquals(
    archived.outcome.kind,
    "success",
    JSON.stringify(archived.result),
  );
  const stored = world.contexts.get(context.id)!;
  assertEquals(stored.title, "알파 설계 기준");
  assertEquals(stored.purpose, "알파의 설계와 결정 근거를 모은다");
  assertEquals(
    stored.items.map((entry) => [entry.target["document"], entry.perspective]),
    [
      [DOC_B, "watch"],
    ],
  );
  assertEquals(stored.status, "archived");
  // 변경 호출은 읽은 revision을 compare로, 최초 ToolCall ID를 key로 보냈다.
  const writes = world.calls.filter((call) => call.options !== undefined);
  assertEquals(
    writes.map((call) => call.contract),
    [
      "context.create",
      "context.update",
      "context.update",
      "context.set_item",
      "context.set_item",
      "context.remove_item",
      "context.archive",
    ],
  );
  for (const [index, call] of writes.slice(1).entries()) {
    assertEquals(
      typeof (call.options!.compare as { base_revision: string }).base_revision,
      "string",
    );
    assertEquals(call.options!.idempotency_key, id("tcl", index + 2));
  }
  // 이 run에서 읽은 적 없는 context는 기준을 알 수 없어 소유 contract를 부르지 않는다.
  const foreign = world.seedContext(50);
  const before = world.calls.length;
  const unread = await run("context.rename", {
    context: foreign.id,
    title: "바꾸기",
    base_revision: foreign.revision,
  });
  assertEquals(unread.outcome.code, "invalid_input");
  assertEquals(world.calls.length, before);
});

Deno.test("lophn-agent/roles/context-engineer#R5: 읽은 뒤 바뀐 revision은 소유 contract가 conflict로 막고 지어낸 revision과 이미 있는 항목 추가·없는 항목 변경은 거절한다", async () => {
  const { world, run } = rig();
  const context = world.seedContext(1, { items: [item(DOC_A)] });
  const read = await run("context.read", { context: context.id });
  const base = content(read)["context"].revision as string;
  // 사람이 그 뒤 고쳤다.
  world.contexts.get(context.id)!.revision = "999";
  const stale = await run("context.rename", {
    context: context.id,
    title: "새 이름",
    base_revision: base,
  });
  assertEquals(stale.outcome.kind, "failure");
  assertEquals(stale.outcome.code, "conflict");
  assertEquals(world.contexts.get(context.id)!.title, context.title);
  // 읽은 적 없는 revision을 지어내면 진입하지 않는다.
  const before = world.calls.length;
  const invented = await run("context.archive", {
    context: context.id,
    base_revision: "12345",
  });
  assertEquals(invented.outcome.code, "invalid_input");
  assertEquals(world.calls.length, before);
  // 이미 있는 항목의 추가와 없는 항목의 변경은 현재 항목을 읽어 거절한다.
  const fresh = await run("context.read", { context: context.id });
  const current = content(fresh)["context"].revision as string;
  const duplicate = await run("context.add_item", {
    context: context.id,
    item: item(DOC_A, "reference"),
    base_revision: current,
  });
  assertEquals(duplicate.outcome.code, "invalid_input");
  const missing = await run("context.update_item", {
    context: context.id,
    item: item(DOC_C),
    base_revision: current,
  });
  assertEquals(missing.outcome.code, "not_found");
  assertEquals(
    world.calls.some((call) => call.contract === "context.set_item"),
    false,
  );
  // 입력 검사: 모르는 필드, 문자열 revision 대신 숫자, 정의 필드는 진입 전에 거절된다.
  for (
    const input of [
      { context: context.id, title: "x", base_revision: current, extra: 1 },
      { context: context.id, title: "x", base_revision: 7 },
      { context: context.id, title: "  ", base_revision: current },
    ]
  ) {
    const rejected = await run("context.rename", input);
    assertEquals(rejected.outcome.code, "invalid_input");
    assertEquals(rejected.executed, false);
  }
});

Deno.test("lophn-agent/roles/context-engineer#R5: 용어 후보는 이름과 이 run이 읽은 고정 판의 근거 최대 5개만 받고 정의를 쓰는 길이 없으며 정의된 용어는 바꾸거나 보관하지 않는다", async () => {
  const { world, run } = rig();
  const context = world.seedContext(1);
  const read = async (document: string, version: string) =>
    await run("document.read_version", {
      reference: { document, version, section: null },
    });
  // 읽지 않은 판은 근거가 될 수 없다. 모델의 말이 아니라 읽기 기록이 정한다.
  const unread = await run("term.propose_candidate", {
    context: context.id,
    name: "정산 주기",
    evidence: [evidence(DOC_A, VER_A)],
  });
  assertEquals(unread.outcome.code, "invalid_input");
  assertEquals(world.terms.size, 0);
  assertEquals((await read(DOC_A, VER_A)).outcome.kind, "success");
  const proposed = await run("term.propose_candidate", {
    context: context.id,
    name: "정산 주기",
    evidence: [evidence(DOC_A, VER_A)],
  }, id("tcl", 20));
  assertEquals(
    proposed.outcome.kind,
    "success",
    JSON.stringify(proposed.result),
  );
  const candidate = content(proposed)["term"] as Term;
  assert(/^trm_[0-7]/.test(candidate.id));
  assertEquals(candidate.definition, null);
  const call = world.calls.find((entry) => entry.contract === "term.propose")!;
  assertEquals(Object.keys(call.input).sort(), [
    "context",
    "evidence",
    "id",
    "name",
  ]);
  // 근거는 후보당 최대 5개이고 위치(절 또는 줄 범위)가 필요하다.
  const six = await run("term.propose_candidate", {
    context: context.id,
    name: "여섯",
    evidence: Array.from(
      { length: 6 },
      (_, index) => evidence(DOC_A, VER_A, `s${index}`),
    ),
  });
  assertEquals(six.outcome.code, "invalid_input");
  const placeless = await run("term.propose_candidate", {
    context: context.id,
    name: "자리 없음",
    evidence: [{
      document: DOC_A,
      version: VER_A,
      section: null,
      start_line: null,
      end_line: null,
    }],
  });
  assertEquals(placeless.outcome.code, "invalid_input");
  // 정의는 후보 tool 어디에도 입력으로 없다.
  for (const tool of ["term.propose_candidate", "term.update_candidate"]) {
    const withDefinition = await run(tool, {
      context: context.id,
      term: candidate.id,
      name: "정산 주기",
      definition: "매월 말에 정산하는 주기",
      evidence: [evidence(DOC_A, VER_A)],
      base_revision: candidate.revision,
    });
    assertEquals(withDefinition.outcome.code, "invalid_input", tool);
    assertEquals(withDefinition.executed, false);
  }
  // 후보의 이름·근거 변경과 후보 보관은 읽은 revision이 기준이다.
  const reread = await run("term.read", { term: candidate.id });
  const revision = content(reread)["term"].revision as string;
  const renamed = await run("term.update_candidate", {
    term: candidate.id,
    name: "정산 주기(월)",
    base_revision: revision,
  });
  assertEquals(renamed.outcome.kind, "success", JSON.stringify(renamed.result));
  assertEquals(world.terms.get(candidate.id)!.name, "정산 주기(월)");
  const nothing = await run("term.update_candidate", {
    term: candidate.id,
    base_revision: content(renamed)["term"].revision,
  });
  assertEquals(nothing.outcome.code, "invalid_input");
  const removed = await run("term.remove_candidate", {
    term: candidate.id,
    base_revision: content(renamed)["term"].revision,
  });
  assertEquals(removed.outcome.kind, "success");
  assertEquals(world.terms.get(candidate.id)!.status, "archived");
  // 사람이 정의한 용어는 읽어도 이 tool로 바꾸거나 보관할 수 없다.
  const defined = world.seedTerm(5, context.id, { definition: "사람의 뜻" });
  const definedRead = await run("term.read", { term: defined.id });
  const definedRevision = content(definedRead)["term"].revision as string;
  const writesBefore =
    world.calls.filter((entry) => entry.options !== undefined).length;
  for (
    const [tool, input] of [
      ["term.update_candidate", {
        term: defined.id,
        name: "다른 이름",
        base_revision: definedRevision,
      }],
      ["term.remove_candidate", {
        term: defined.id,
        base_revision: definedRevision,
      }],
    ] as const
  ) {
    const refused = await run(tool, input);
    assertEquals(refused.outcome.code, "invalid_input", tool);
  }
  assertEquals(
    world.calls.filter((entry) => entry.options !== undefined).length,
    writesBefore,
  );
  assertEquals(world.terms.get(defined.id)!.definition, "사람의 뜻");
  assertEquals(world.terms.get(defined.id)!.name, "용어 5");
});

Deno.test("lophn-agent/roles/context-engineer#R5: 사람의 정의 답은 질문 선택지의 고정 action으로만 적용되고 agent는 선택지에 action을 싣지도 term.define을 부르지도 못한다", async () => {
  const { world, run } = rig();
  const context = world.seedContext(1);
  // 어떤 tool도 정의를 쓰는 contract나 definition 입력을 갖지 않는다.
  for (const tool of BUILTIN_TOOLS) {
    assertEquals(
      ["term.define", "term.update_definition"].includes(tool.contract),
      false,
      tool.name,
    );
  }
  // 질문 tool은 선택지에 고정 action을 싣는 입력이 없다: action은 사람이 열람한 owner 동작을 고정하는
  // 별도 경로(lophn-agent/questions의 option action)가 정한다.
  const withAction = await run("question.submit", {
    prompt: "정산 주기를 어떻게 정의할까요",
    reason: "문서마다 뜻이 다르다",
    options: [{
      key: "monthly",
      label: "월 단위",
      description: "매월 말 정산",
      evidence: [],
      adoption: null,
      action: { concern: "documents/terms", command: "term.define" },
    }],
    recommendation: null,
    expires_at: null,
  });
  assertEquals(withAction.outcome.code, "invalid_input");
  assertEquals(withAction.executed, false);
  // 정의 확정이 아닌 질문(action 없음)은 그대로 제출된다. 답을 정의로 적용하는 일은 tool 밖이다.
  const plain = await run("question.submit", {
    prompt: "정산 주기를 어떻게 정의할까요",
    reason: "문서마다 뜻이 다르다",
    options: [{
      key: "monthly",
      label: "월 단위",
      description: "매월 말 정산",
      evidence: [],
      adoption: null,
      action: null,
    }],
    recommendation: null,
    expires_at: null,
  });
  assertEquals(plain.outcome.kind, "success", JSON.stringify(plain.result));
  assertEquals(
    world.calls.filter((call) => call.contract === "CreateQuestion").length,
    1,
  );
  // term.define은 contract의 user actor만 받고 agent 호출 이름도 제공 목록에 없다.
  const named = await run("term.define", {
    context: context.id,
    name: "x",
    definition: "y",
  });
  assertEquals(named.outcome.code, "not_found");
  assertEquals(
    world.calls.some((call) => call.contract === "term.define"),
    false,
  );
});

Deno.test("lophn-agent/roles/context-engineer#R5: 정의 답 전달 tool은 Context Engineer에게만 열리고 사람 고정 action을 그대로 전하며 답이 없거나 action 없는 선택지면 전하지 않는다", async () => {
  const { world, listed, run } = rig();
  const anchor = world.seedContext(1);
  // 이 tool은 context·term 묶음의 write이고 contract는 ApplyQuestionOption이다.
  const submission = listed.find((tool) =>
    tool.name === "term.submit_definition_answer"
  );
  assert(submission !== undefined);
  assertEquals(submission.contract, "ApplyQuestionOption");
  assertEquals(submission.effect, "write");
  // 역할 상한: Context Engineer만, Operator는 없다.
  const engineerCaps = ROLE_CAPS.get("context_engineer")!.tools;
  const operatorCaps = ROLE_CAPS.get("operator")!.tools;
  assert(engineerCaps.includes("term.submit_definition_answer"));
  assert(!operatorCaps.includes("term.submit_definition_answer"));
  // Context Engineer의 선택으로 실행하면 질문 정본을 먼저 읽는다.
  const action = world.seedApplyAction(1);
  world.seedQuestion(10, { option: { key: "apply", action } });
  const answered = await run("term.submit_definition_answer", {
    question: id("qst", 10),
  }, id("tcl", 40));
  assertEquals(answered.outcome.kind, "success", JSON.stringify(answered.result));
  const read = world.calls.find((call) => call.contract === "ReadQuestion");
  assert(read !== undefined);
  assertEquals(read.input, { question: id("qst", 10) });
  const applied = world.calls.find(
    (call) => call.contract === "ApplyQuestionOption",
  );
  assert(applied !== undefined);
  // 전달은 사람이 고른 고정 action 그대로다. 모델이 정한 값은 없다.
  assertEquals(applied.input, {
    question: id("qst", 10),
    answered_seq: "12",
    option_key: "apply",
    action,
    evidence: { question: id("qst", 10), option: "apply" },
  });
  void anchor;
  // 답이 없는 질문(미답·만료)은 전달하지 않는다.
  world.seedQuestion(11, {
    status: "pending",
    answer: null,
    option: { key: "apply", action: world.seedApplyAction(2) },
  });
  const none = await run("term.submit_definition_answer", {
    question: id("qst", 11),
  }, id("tcl", 41));
  assertEquals(none.outcome.code, "invalid_input");
  // action이 없는 선택지를 골랐으면 자유 답으로 해석하지 않는다(questions#R15).
  world.seedQuestion(12, {
    option: { key: "apply", action: null },
  });
  const plain = await run("term.submit_definition_answer", {
    question: id("qst", 12),
  }, id("tcl", 42));
  assertEquals(plain.outcome.code, "invalid_input");
  assertEquals(
    world.calls.filter((call) => call.contract === "ApplyQuestionOption")
      .length,
    1,
  );
  // 없는 질문과 범위 밖 질문은 같은 결과다.
  const absent = await run("term.submit_definition_answer", {
    question: id("qst", 90),
  }, id("tcl", 43));
  assertEquals(absent.outcome.code, "not_found");
});

Deno.test("lophn-agent/roles/context-engineer#R5: 응답이 없는 변경은 완료도 실패도 아닌 효과 불명확이고 같은 ToolCall의 재전송은 같은 새 ID와 key를 쓴다", async () => {
  const { world, run } = rig();
  world.setUnavailable(true);
  const lost = await run("context.create", {
    title: "알파",
    purpose: "목적",
  }, id("tcl", 30));
  assertEquals(lost.outcome.kind, "uncertain");
  assertEquals(lost.result.status, "uncertain");
  assertEquals(lost.result.pending, ["change_confirmation"]);
  assertEquals(content(lost)["accepted"], null);
  assertEquals(content(lost)["confirmed"], false);
  const lostId = content(lost)["context"] as string;
  assertEquals(content(lost)["idempotency_key"], id("tcl", 30));
  world.setUnavailable(false);
  const resent = await run("context.create", {
    title: "알파",
    purpose: "목적",
  }, id("tcl", 30));
  assertEquals(resent.outcome.kind, "success");
  assertEquals(content(resent)["context"]["id"], lostId);
  // 같은 호출을 한 번 더 보내면 두 번째 context가 아니라 이미 있다는 conflict다.
  const again = await run("context.create", {
    title: "알파",
    purpose: "목적",
  }, id("tcl", 30));
  assertEquals(again.outcome.code, "conflict");
  assertEquals(world.contexts.size, 1);
  // 호출이 다르면 ID도 다르다. 호출 ID가 없으면 호출 내용에서 정한다.
  const other = await run(
    "context.create",
    { title: "베타", purpose: "목적" },
    id("tcl", 31),
  );
  assert(content(other)["context"]["id"] !== lostId);
  const noCall = await run(
    "context.create",
    { title: "감마", purpose: "목적" },
    undefined,
  );
  const noCallAgain = await run("context.create", {
    title: "감마",
    purpose: "목적",
  }, undefined);
  assertEquals(noCall.outcome.kind, "success");
  assertEquals(noCallAgain.outcome.code, "conflict");
});
