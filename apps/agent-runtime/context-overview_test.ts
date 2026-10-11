// lophn-agent/presets#R17 lophn-agent/roles/app-engineer#R2 [ctx-I58b]: preset의 `work_place`·`assignment_scope`
// context 선택을 푸는 순수 함수와, App Engineer(앱 하나에 묶인 credential)의 prompt 자료가 담당 앱을
// app-data로 읽는 context의 overview·용어집을 싣는지 본다. core는 `CoreCall` fake로 흉내 내고, 앱 하나에
// 묶인 credential에는 그 앱을 읽는 context만 보이는 core의 답(목록은 그 줄만, 나머지는 not_found)을 따른다.
import { assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  bundleContentSchema,
  contextContractReadSchema,
  contextContractRoute,
  contextGetReadSchema,
  contextGetRoute,
  contextListReadSchema,
  contextListRoute,
  contextOverviewReadSchema,
  contextOverviewRoute,
  glossaryListReadSchema,
  glossaryListRoute,
} from "../../packages/contracts/documents/mod.ts";
import { routePath } from "../../packages/contracts/platform/mod.ts";
import type { CoreCall } from "./core-call.ts";
import {
  loadContextMaterials,
  resolveContextSelections,
} from "./context-overview.ts";

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const PROJECT = id("prj", 1);
const APP = "notes";
const CALENDAR_CTX = id("ctx", 1);
const MAIL_CTX = id("ctx", 2);
const PLAIN_CTX = id("ctx", 3);
const META = { as_of_seq: "9", complete: true, next_cursor: null };
const AT = "2026-10-12T00:00:00.000Z";

const project = { kind: "project", id: PROJECT } as const;
const app = { kind: "app", id: id("app", 1) } as const;
const global = { kind: "global", id: null } as const;

Deno.test("lophn-agent/presets#R17 [ctx-I58b]: work_place는 작업 자리의 project로, assignment_scope는 담당 범위로 풀리고 다른 선택은 그대로다", () => {
  const all = { kind: "all", target: null };
  const doc = { kind: "document", target: "doc_x" };
  const resolve = (
    selections: { kind: string; target: string | null }[],
    place: { kind: string; id: string | null },
    scope: { kind: string; id: string | null },
  ) => resolveContextSelections(selections, { place, scope });

  assertEquals(
    resolve([{ kind: "work_place", target: null }], project, global),
    [{ kind: "project", target: PROJECT }],
  );
  // 작업 자리가 project가 아니면 work_place는 자료가 없다.
  assertEquals(
    resolve([{ kind: "work_place", target: null }], app, global),
    [],
  );
  assertEquals(
    resolve([{ kind: "work_place", target: null }], global, global),
    [],
  );

  const scoped = [{ kind: "assignment_scope", target: null }];
  assertEquals(resolve(scoped, global, { kind: "project", id: PROJECT }), [
    { kind: "project", target: PROJECT },
  ]);
  // 담당 범위가 앱이면 작업 자리 project 안에서 읽고, 어느 context가 보이는지는 core가 정한다.
  assertEquals(resolve(scoped, project, app), [all]);
  assertEquals(resolve(scoped, global, global), [all]);

  assertEquals(
    resolve([all, doc, { kind: "context", target: CALENDAR_CTX }], global, app),
    [all, doc, { kind: "context", target: CALENDAR_CTX }],
  );
});

function contentReading(app: string | null) {
  return bundleContentSchema.parse({
    schema: 1,
    contract: {
      types: [{
        name: "Event",
        summary: "A calendar event",
        visibility: "private",
        source: app === null
          ? { kind: "docs", paths: ["events/*.md"] }
          : { kind: "app-data", app, command: "events.list", result_path: [] },
        key: "id",
        fields: [{
          name: "id",
          from: app === null
            ? { kind: "path", capture: "file" }
            : { kind: "item", key_path: ["id"] },
          value_type: "string",
        }],
        relations: [],
        rules: [],
      }],
    },
    searches: [],
    saved_views: [],
    examples: [],
  });
}

type Entry = {
  id: string;
  title: string;
  hash: string;
  reads: string | null;
  glossary: { term: string; meaning: string }[];
};

const ENTRIES: Entry[] = [
  {
    id: CALENDAR_CTX,
    title: "Calendar",
    hash: "a".repeat(64),
    reads: APP,
    glossary: [{ term: "일정", meaning: "달력에 적은 약속 하나" }],
  },
  {
    id: MAIL_CTX,
    title: "Mail",
    hash: "b".repeat(64),
    reads: "mail",
    glossary: [{ term: "편지", meaning: "받은 메일 하나" }],
  },
  {
    id: PLAIN_CTX,
    title: "Plain",
    hash: "c".repeat(64),
    reads: null,
    glossary: [],
  },
];

// 담당 앱 `notes`에 묶인 credential이 보는 core다: 그 앱을 읽는 context만 보이고 나머지는 없는 대상이다.
function boundCore(bound: string | null) {
  const seen: { path: string; body: unknown }[] = [];
  const visible = (entry: Entry) => bound === null || entry.reads === bound;
  const value = (entry: Entry) => ({
    id: entry.id,
    project: PROJECT,
    title: entry.title,
    purpose: `${entry.title} purpose`,
    status: "active",
    applied_bundle: id("cbn", 1),
    violation_mark: 0,
    revision: "3",
  });
  const call: CoreCall = (path, body): Promise<Result<unknown>> => {
    seen.push({ path, body });
    const request = body as Record<string, unknown>;
    if (path === routePath(contextListRoute)) {
      return Promise.resolve(ok(contextListReadSchema.parse({
        ...META,
        contexts: ENTRIES.filter(visible).map((entry) => ({
          ...value(entry),
          applied_number: 1,
          draft_bundle: null,
          checking_bundle: null,
        })),
      })));
    }
    const found = ENTRIES.find((entry) => entry.id === request["context"]);
    if (found === undefined || !visible(found)) {
      return Promise.resolve(
        err({ code: "not_found", message: "target not found" }),
      );
    }
    if (path === routePath(contextGetRoute)) {
      return Promise.resolve(ok(contextGetReadSchema.parse({
        ...META,
        context: value(found),
        applied: {
          id: id("cbn", 1),
          context: found.id,
          number: 1,
          parent: null,
          bundle_hash: found.hash,
          status: "applied",
          check: id("chk", 1),
          created_by: `agent:${id("asg", 1)}`,
          revision: "4",
        },
      })));
    }
    if (path === routePath(contextContractRoute)) {
      return Promise.resolve(ok(contextContractReadSchema.parse({
        ...META,
        context: found.id,
        bundle: id("cbn", 1),
        bundle_hash: found.hash,
        content: contentReading(found.reads),
      })));
    }
    if (path === routePath(contextOverviewRoute)) {
      return Promise.resolve(ok(contextOverviewReadSchema.parse({
        ...META,
        context: value(found),
        bundle_hash: found.hash,
        types: [{ type: "Event", count: 0 }],
        violation_count: 0,
      })));
    }
    if (path === routePath(glossaryListRoute)) {
      return Promise.resolve(ok(glossaryListReadSchema.parse({
        ...META,
        context: found.id,
        entries: found.glossary.map((entry, index) => ({
          id: id("trm", index + 1),
          context: found.id,
          term: entry.term,
          meaning: entry.meaning,
          set_by: "user",
          updated_at: AT,
          revision: "2",
        })),
      })));
    }
    return Promise.resolve(err({ code: "not_found", message: "no route" }));
  };
  return { call, seen };
}

Deno.test("lophn-agent/roles/app-engineer#R2 [ctx-I58b]: App Engineer의 assignment_scope 선택은 담당 앱을 app-data로 읽는 context의 overview와 용어집을 prompt 자료로 싣는다", async () => {
  const core = boundCore(APP);
  const selections = resolveContextSelections(
    [{ kind: "assignment_scope", target: null }],
    { place: project, scope: app },
  );
  const set = await loadContextMaterials(core.call, {
    project: PROJECT,
    selections,
  });
  // 다른 앱을 읽는 context와 앱 data를 읽지 않는 context는 자료에 없다.
  assertEquals(set.materials.map((item) => item.context), [CALENDAR_CTX]);
  assertEquals(set.reason, null);
  const [material] = set.materials;
  assertEquals(
    material!.text,
    [
      `[context] Calendar | ${CALENDAR_CTX}`,
      "type:",
      "- Event: A calendar event (0개)",
      "관계: 없음",
      "용어집:",
      "- 일정: 달력에 적은 약속 하나",
    ].join("\n"),
  );
  // 읽기만 했고 R2가 말한 읽기(list·get·contract·overview·glossary)뿐이다.
  assertEquals(
    new Set(core.seen.map((entry) => entry.path)),
    new Set([
      routePath(contextListRoute),
      routePath(contextGetRoute),
      routePath(contextContractRoute),
      routePath(contextOverviewRoute),
      routePath(glossaryListRoute),
    ]),
  );
});

Deno.test("lophn-agent/roles/app-engineer#R2 [ctx-I58b]: 작업 자리 project가 없으면 App Engineer의 자료는 없고 이유를 남긴다. 이름으로 고른 다른 앱의 context도 싣지 않는다", async () => {
  const core = boundCore(APP);
  const none = await loadContextMaterials(core.call, {
    project: null,
    selections: resolveContextSelections(
      [{ kind: "assignment_scope", target: null }],
      { place: global, scope: app },
    ),
  });
  assertEquals(none.materials, []);
  assertEquals(none.reason !== null, true);
  assertEquals(core.seen, []);

  const named = await loadContextMaterials(core.call, {
    project: PROJECT,
    selections: [{ kind: "context", target: MAIL_CTX }, {
      kind: "context",
      target: id("ctx", 99),
    }],
  });
  assertEquals(named.materials, []);
});

Deno.test("lophn-agent/presets#R17 [ctx-I58b]: 앱에 묶이지 않은 역할의 assignment_scope는 project의 모든 active context를 싣는다", async () => {
  const set = await loadContextMaterials(boundCore(null).call, {
    project: PROJECT,
    selections: resolveContextSelections(
      [{ kind: "assignment_scope", target: null }],
      { place: global, scope: { kind: "project", id: PROJECT } },
    ),
  });
  assertEquals(set.materials.map((item) => item.context), [
    CALENDAR_CTX,
    MAIL_CTX,
    PLAIN_CTX,
  ]);
});
