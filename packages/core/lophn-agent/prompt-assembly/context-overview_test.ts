// lophn-agent/roles/app-engineer#R2 [ctx-I58b]: resolved agent의 context가 prompt 자료로 읽힌다. App Engineer
// (앱 하나에 묶인 credential)의 자료가 담당 앱을 app-data로 읽는 context의 overview·용어집을 싣는지 본다. 어느
// context인지는 agent 층이 정한다(agent-layers). core는 `CoreCall` fake로 흉내 내고, 앱 하나에
// 묶인 credential에는 그 앱을 읽는 context만 보이는 core의 답(목록은 그 줄만, 나머지는 not_found)을 따른다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
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
} from "../../../protocol/projects/mod.ts";
import { routePath } from "../../../protocol/server/mod.ts";
import type { CoreCall } from "../run-loop/core-call.ts";
import { loadContextMaterials } from "./context-overview.ts";

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const PROJECT = id("prj", 1);
const APP = "notes";
// 앱 slug가 가리키는 앱 ID다(core가 `context.list`의 app을 context_app_data의 slug와 이어 푼다).
const APP_IDS: Record<string, string> = {
  notes: id("app", 1),
  mail: id("app", 2),
};
const CALENDAR_CTX = id("ctx", 1);
const MAIL_CTX = id("ctx", 2);
const PLAIN_CTX = id("ctx", 3);
const META = { as_of_seq: "9", complete: true, next_cursor: null };
const AT = "2026-10-12T00:00:00.000Z";

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
      const byApp = request["app"];
      return Promise.resolve(ok(contextListReadSchema.parse({
        ...META,
        contexts: ENTRIES.filter(visible).filter((entry) =>
          byApp === undefined ||
          (entry.reads !== null && APP_IDS[entry.reads] === byApp)
        ).map((entry) => ({
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

Deno.test("lophn-agent/roles/app-engineer#R2 [ctx-I58b]: App Engineer의 resolved agent context는 담당 앱을 app-data로 읽는 context의 overview와 용어집을 prompt 자료로 싣는다", async () => {
  const core = boundCore(APP);
  // agent 층이 담당 앱을 읽는 context만 골라 준다. 앱을 읽지 않는 context는 core가 이 credential에 보이지 않는다.
  const set = await loadContextMaterials(core.call, {
    contexts: [CALENDAR_CTX, MAIL_CTX],
  });
  // 다른 앱을 읽는 context는 자료에 없다.
  assertEquals(set.materials.map((item) => item.context), [CALENDAR_CTX]);
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
  // 읽기만 했고 R2가 말한 읽기(get·contract·overview·glossary)뿐이다.
  assertEquals(
    new Set(core.seen.map((entry) => entry.path)),
    new Set([
      routePath(contextGetRoute),
      routePath(contextContractRoute),
      routePath(contextOverviewRoute),
      routePath(glossaryListRoute),
    ]),
  );
});

Deno.test("lophn-agent/roles/app-engineer#R2 [ctx-I56b]: 이름으로 고른 다른 앱의 context와 없는 context는 싣지 않는다", async () => {
  const core = boundCore(APP);
  const named = await loadContextMaterials(core.call, {
    contexts: [MAIL_CTX, id("ctx", 99)],
  });
  assertEquals(named.materials, []);
});

Deno.test("lophn-agent/harness/prompt-assemble#R4 [ctx-I58b]: 앱에 묶이지 않은 역할의 resolved agent context는 모두 싣는다", async () => {
  const set = await loadContextMaterials(boundCore(null).call, {
    contexts: [CALENDAR_CTX, MAIL_CTX, PLAIN_CTX],
  });
  assertEquals(set.materials.map((item) => item.context), [
    CALENDAR_CTX,
    MAIL_CTX,
    PLAIN_CTX,
  ]);
});

Deno.test("lophn-agent/harness/prompt-assemble#R4 [ctx-I56b]: 고른 context를 읽지 못하면 조용히 빼지 않고 context마다 이유를 남기고 보관·판 없는 context는 이유 없이 뺀다", async () => {
  const core = boundCore(APP);
  // 담당 앱이 읽지 않는 context(get이 not_found)와 없는 context는 이유가 남는다.
  const set = await loadContextMaterials(core.call, {
    contexts: [CALENDAR_CTX, MAIL_CTX, id("ctx", 99)],
  });
  assertEquals(set.materials.map((item) => item.context), [CALENDAR_CTX]);
  assertEquals(set.omitted.map((item) => item.context), [
    MAIL_CTX,
    id("ctx", 99),
  ]);
  for (const item of set.omitted) {
    assertEquals(item.title, item.context);
    assert(item.reason.includes("not_found"), item.reason);
  }

  // 계약이나 용어집 읽기가 실패한 context는 이름과 이유를 남긴다.
  const failing: CoreCall = (path, body) =>
    path === routePath(glossaryListRoute)
      ? Promise.resolve(err({ code: "unavailable", message: "down" }))
      : core.call(path, body);
  const down = await loadContextMaterials(failing, {
    contexts: [CALENDAR_CTX],
  });
  assertEquals(down.materials, []);
  assertEquals(down.omitted, [{
    context: CALENDAR_CTX,
    title: "Calendar",
    reason: "용어집을 읽지 못했다(unavailable)",
  }]);

  // 보관된 context와 적용된 판이 없는 context는 읽지 못한 것이 아니다.
  const inactive: CoreCall = (path, body) =>
    core.call(path, body).then((reply) => {
      if (!reply.ok || path !== routePath(contextGetRoute)) return reply;
      const value = reply.value as { context: Record<string, unknown> };
      return ok({
        ...value,
        context: { ...value.context, status: "archived" },
      });
    });
  const quiet = await loadContextMaterials(inactive, {
    contexts: [CALENDAR_CTX],
  });
  assertEquals([quiet.materials, quiet.omitted], [[], []]);
});
