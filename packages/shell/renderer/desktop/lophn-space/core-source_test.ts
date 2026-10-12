// core 통로가 보내는 route 이름과 입력 모양. renderer 설정(DOM lib)은 contracts graph를
// type 검사하지 못하므로 contracts를 들이지 않고 schema의 field 이름을 그대로 적는다.
import { assert, assertEquals } from "@std/assert";

import type { CoreCall } from "../../../ipc/core.ts";
import type { CoreReply } from "../../../ipc/core-api.ts";
import type { CoreSource } from "../connection/connection.ts";
import { coreLophnSource } from "./core-source.ts";
import { EMPTY_CONDITIONS } from "./model.ts";
import type { Series } from "./source.ts";

const ULID = "01k6aaaaaaaaaaaaaaaaaaaaaa";
const DOC = `doc_${ULID}`;
const VER1 = `ver_01k6aaaaaaaaaaaaaaaaaaaaa1`;
const VER2 = `ver_01k6aaaaaaaaaaaaaaaaaaaaa2`;
const PRJ = `prj_${ULID}`;
const SER = `ser_${ULID}`;

type Answer = (call: CoreCall) => CoreReply;

function coreOf(answer: Answer): { core: CoreSource; calls: CoreCall[] } {
  const calls: CoreCall[] = [];
  return {
    calls,
    core: {
      subscribe: () => () => {},
      call(input) {
        calls.push(input);
        return Promise.resolve(answer(input));
      },
    },
  };
}

function name(call: CoreCall): string {
  return `${call.kind}:${call.resource}/${call.method}`;
}

const seriesValue = {
  id: SER,
  place: { kind: "project", id: PRJ },
  name: "weekly",
  title: "Weekly report",
  format: "document",
  order: { kind: "key", direction: "ascending" },
  next_rule: "week-{n}",
  draft: null,
  revision: "7",
  status: "active",
};

const series: Series = {
  id: SER,
  place: { kind: "project", id: PRJ },
  name: "weekly",
  title: "Weekly report",
  format: "document",
  order: { kind: "key", direction: "ascending" },
  nextRule: "week-{n}",
  revision: "7",
  archived: false,
  draft: null,
};

Deno.test("shell/desktop#R1: 검색은 worker search/query로 조건을 보내고 지연·누락을 옮긴다", async () => {
  const { core, calls } = coreOf(() => ({
    ok: true,
    value: {
      results: [{
        document: DOC,
        version: VER1,
        latest_version: VER2,
        format: { name: "document" },
        section: "goals",
        title: "Plan",
        snippet: "the goals are",
        match_source: "summary",
      }],
      coverage: {
        lagging: true,
        rebuilding: false,
        omissions: [{ document: DOC, version: VER1, reason: "x" }],
      },
      next_cursor: "c2",
    },
  }));
  const source = coreLophnSource(core);
  const result = await source.search({
    ...EMPTY_CONDITIONS,
    query: "goals",
    place: { kind: "project", id: PRJ },
    format: "document",
  });
  assertEquals(name(calls[0]!), "worker:search/query");
  assertEquals(calls[0]!.body, {
    query: "goals",
    place: { kind: "project", id: PRJ },
    formats: ["document"],
  });
  assert(result.ok);
  assertEquals(result.value.hits[0]!.fromSummary, true);
  assertEquals(result.value.hits[0]!.latestVersion, VER2);
  assertEquals(result.value.coverage, {
    lagging: true,
    rebuilding: false,
    omissions: 1,
  });
  assertEquals(result.value.nextCursor, "c2");
});

Deno.test("shell/desktop#R1: 보관 포함은 보관 문서 목록에서 제목과 format으로 고른다", async () => {
  const { core, calls } = coreOf(() => ({
    ok: true,
    value: {
      documents: [
        {
          document: { id: DOC, title: "Old Goals", status: "archived" },
          latest_version: { id: VER1, format: { name: "document" } },
        },
        {
          document: { id: `doc_${"1".repeat(26)}`, title: "Notes" },
          latest_version: { id: VER2, format: { name: "document" } },
        },
      ],
      next_cursor: null,
    },
  }));
  const result = await coreLophnSource(core).archived({
    ...EMPTY_CONDITIONS,
    query: "goals",
    includeArchived: true,
  });
  assertEquals(name(calls[0]!), "read:documents/list");
  assertEquals((calls[0]!.body as { status: string }).status, "archived");
  assert(result.ok);
  assertEquals(result.value.map((hit) => hit.document), [DOC]);
});

Deno.test("shell/desktop#R1: 목차의 다음 page와 본문 이어 읽기는 처음 고정한 판을 그대로 쓴다", async () => {
  const { core, calls } = coreOf((call) => {
    if (call.resource === "outline") {
      const body = call.body as { cursor?: string };
      return {
        ok: true,
        value: {
          document: DOC,
          version: VER1,
          latest_version: VER2,
          section_status: "whole",
          entries: body.cursor === undefined
            ? [{ key: "goals", title: "Goals", level: 2 }]
            : [{ key: "plan", title: "Plan", level: 2 }],
          complete: body.cursor !== undefined,
          next_cursor: body.cursor === undefined ? "o2" : null,
        },
      };
    }
    return {
      ok: true,
      value: {
        section_status: "found",
        text: "## Goals",
        redacted: false,
        complete: false,
        next_cursor: "r2",
      },
    };
  });
  const source = coreLophnSource(core);
  const outline = await source.outline(DOC, null);
  assert(outline.ok);
  assertEquals(outline.value.version, VER1);
  assertEquals(outline.value.latestVersion, VER2);
  assertEquals(outline.value.sections.map((item) => item.key), [
    "goals",
    "plan",
  ]);
  const first = calls[0]!.body as { reference: { version: string | null } };
  const second = calls[1]!.body as { reference: { version: string | null } };
  assertEquals(first.reference.version, null);
  assertEquals(second.reference.version, VER1);

  const page = await source.read(DOC, VER1, "goals", "r2");
  assert(page.ok);
  assertEquals(page.value.nextCursor, "r2");
  const read = calls[2]!;
  assertEquals(name(read), "worker:documents/read");
  assertEquals(read.body, {
    reference: { document: DOC, version: VER1, section: null },
    section: "goals",
    cursor: "r2",
  });
});

Deno.test("shell/desktop#R1: 옛 링크는 documents/resolve로 풀고 옮겨짐·지정 판을 알린다", async () => {
  const { core, calls } = coreOf(() => ({
    ok: true,
    value: {
      resolved: {
        document: DOC,
        version: VER1,
        section: null,
        redirected: true,
        current_reference: {
          place: "lophn",
          document: "plan",
          section: null,
          version: 1,
        },
        section_status: "whole",
      },
    },
  }));
  const source = coreLophnSource(core);
  const resolved = await source.resolve("lophn/old-plan@1");
  assertEquals(name(calls[0]!), "read:documents/resolve");
  assert(resolved.ok && resolved.value !== null);
  assertEquals(resolved.value.moved, true);
  assertEquals(resolved.value.pinned, true);
  assertEquals(resolved.value.current, "lophn/plan");
  const bad = await source.resolve("not a link");
  assert(bad.ok);
  assertEquals(bad.value, null);
  assertEquals(calls.length, 1);
});

Deno.test("shell/desktop#R28: lophn 공간 조건의 자리는 전체 목차(outline/root)에서 읽는다", async () => {
  const { core, calls } = coreOf(() => ({
    ok: true,
    value: {
      entries: [
        { kind: "project", id: PRJ, title: "lophn" },
        { kind: "app", id: `app_${ULID}`, title: "Groceries" },
        { kind: "unplaced", document_count: 2 },
      ],
      complete: true,
      next_cursor: null,
    },
  }));
  const catalog = await coreLophnSource(core).catalog();
  assertEquals(calls.map(name), ["read:outline/root"]);
  assertEquals(calls[0]!.body, {});
  assert(catalog.ok);
  assertEquals(catalog.value.projects, [{ id: PRJ, title: "lophn" }]);
  assertEquals(catalog.value.apps.length, 1);
});

Deno.test("shell/desktop#R1: series 목록·상세·다음 key는 읽기만 하고 다음 key 조회는 command를 보내지 않는다", async () => {
  const { core, calls } = coreOf((call) => {
    if (call.method === "list") {
      return {
        ok: true,
        value: {
          series: [{ ...seriesValue, member_count: 2 }],
          next_cursor: null,
        },
      };
    }
    if (call.method === "next") {
      return {
        ok: true,
        value: {
          suggestion: {
            series_revision: "7",
            key: "week-3",
            title: "week-3",
            from: "week-2",
            taken: false,
            document_name: "week-3",
          },
        },
      };
    }
    return {
      ok: true,
      value: {
        series: seriesValue,
        entries: [{
          key: "week-1",
          document: DOC,
          title: "Week 1",
          version: VER1,
          latest_version: VER2,
          status: "active",
        }],
        complete: true,
        next_cursor: null,
      },
    };
  });
  const source = coreLophnSource(core);
  const list = await source.seriesList("all");
  assert(list.ok);
  assertEquals(list.value[0]!.members, 2);
  const detail = await source.series(SER);
  assert(detail.ok);
  assertEquals(detail.value.members[0]!.key, "week-1");
  const next = await source.nextKey(SER);
  await source.nextKey(SER);
  assert(next.ok);
  assertEquals(next.value, { key: "week-3", from: "week-2", taken: false });
  assertEquals(calls.filter((call) => call.kind === "command").length, 0);
});

Deno.test("shell/desktop#R1: series 등록·멤버 추가·보관은 base_revision을 비교하는 command다", async () => {
  const { core, calls } = coreOf(() => ({
    ok: true,
    value: seriesValue,
  }));
  const source = coreLophnSource(core, (prefix) => `${prefix}_${ULID}`);
  await source.createSeries({
    place: { kind: "project", id: PRJ },
    name: "weekly",
    title: "Weekly report",
    format: "document",
    direction: "ascending",
    nextRule: "week-{n}",
  });
  assertEquals((calls[0]!.body as { input: unknown }).input, {
    id: SER,
    place: { kind: "project", id: PRJ },
    name: "weekly",
    title: "Weekly report",
    format: "document",
    order: { kind: "key", direction: "ascending" },
    next_rule: "week-{n}",
  });
  await source.addMember(series, DOC, "week-1");
  assertEquals(
    (calls[1]!.body as { compare: unknown }).compare,
    { base_revision: "7" },
  );
  await source.setArchived(series, true);
  assertEquals(name(calls[2]!), "command:series/archive");
  await source.setArchived({ ...series, archived: true }, false);
  assertEquals(name(calls[3]!), "command:series/unarchive");
});

Deno.test("documents/series#R11: 새 멤버 쓰기는 예정 문서·key·가족 format의 FormatRef를 글 없이 draft에 두고, 버리기는 base_revision을 비교한다", async () => {
  const MODULE = "ab".repeat(32);
  const { core, calls } = coreOf((call) =>
    call.resource === "formats"
      ? {
        ok: true,
        value: {
          formats: [{ name: "pdf", module_hash: "cd".repeat(32) }, {
            name: "document",
            module_hash: MODULE,
          }],
        },
      }
      : {
        ok: true,
        value: {
          ...seriesValue,
          revision: "8",
          draft: { document: DOC, key: "week-3" },
        },
      }
  );
  const source = coreLophnSource(core, (prefix) => `${prefix}_${ULID}`);
  const started = await source.startDraft(series, "week-3");
  assert(started.ok);
  assertEquals(started.value.draft, { document: DOC, key: "week-3" });
  assertEquals(name(calls[1]!), "command:series/set_draft");
  const body = calls[1]!.body as { input: unknown; compare: unknown };
  assertEquals(body.input, {
    series: SER,
    draft: {
      document: DOC,
      key: "week-3",
      base_version: null,
      format: { name: "document", module_hash: MODULE, explicit: false },
      content: null,
    },
  });
  assertEquals(body.compare, { base_revision: "7" });
  await source.clearDraft(started.value);
  assertEquals(name(calls[2]!), "command:series/clear_draft");
  assertEquals(
    (calls[2]!.body as { compare: unknown }).compare,
    { base_revision: "8" },
  );
});
