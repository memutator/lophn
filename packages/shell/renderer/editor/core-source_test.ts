import { assertEquals } from "@std/assert";

import type { CoreCall } from "../../ipc/core.ts";
import type { CoreReply } from "../../ipc/core-api.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { coreEditorSource } from "./core-source.ts";
import type { BodyState } from "./source.ts";

const DOC = "doc_0000000000000000000000000a";
const VER = "ver_0000000000000000000000000a";

function coreOf(
  answer: (call: CoreCall) => CoreReply,
): { core: CoreSource; calls: CoreCall[] } {
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

function page(
  text: string | null,
  ranges: { start_line: number; end_line: number }[],
  next: string | null,
  status = "whole",
) {
  return {
    section_status: status,
    text,
    ranges,
    redacted: text === null && status === "whole",
    complete: next === null,
    next_cursor: next,
  };
}

Deno.test("shell/editor#R4: 문서 머리는 documents.get의 제목·판과 주 파일의 이름·상대 경로를 쓴다", async () => {
  const { core, calls } = coreOf(() => ({
    ok: true,
    value: {
      document: { id: DOC, title: "Release plan", name: "plan" },
      version: {
        id: VER,
        number: 3,
        saved_at: "2026-10-05T09:00:00.000Z",
        files: [
          { path: "docs/img.png", primary: false },
          { path: "docs/plan.md", primary: true },
        ],
      },
    },
  }));
  const result = await coreEditorSource(core).document(DOC);
  assertEquals(calls[0], {
    kind: "read",
    resource: "documents",
    method: "get",
    body: { document: DOC },
  });
  assertEquals(result, {
    ok: true,
    value: {
      id: DOC,
      title: "Release plan",
      fileName: "plan.md",
      path: "docs/plan.md",
      version: VER,
      versionNumber: 3,
      savedAt: Date.parse("2026-10-05T09:00:00.000Z"),
    },
  });
});

Deno.test("shell/editor#R8: 본문은 고정 판의 documents.read page를 cursor로 끝까지 잇고 page마다 보인다", async () => {
  const pages = [
    page("# Title\nlong li", [{ start_line: 1, end_line: 2 }], "c1"),
    page("ne\nend", [{ start_line: 2, end_line: 3 }], null),
  ];
  const { core, calls } = coreOf(() => ({ ok: true, value: pages.shift() }));
  const seen: BodyState[] = [];
  const final = await coreEditorSource(core).body(
    DOC,
    VER,
    (state) => seen.push(state),
  );
  assertEquals(calls.map((call) => [call.kind, call.body]), [
    ["worker", { reference: { document: DOC, version: VER, section: null } }],
    ["worker", {
      reference: { document: DOC, version: VER, section: null },
      cursor: "c1",
    }],
  ]);
  assertEquals(seen[0], {
    kind: "text",
    text: "# Title\nlong li",
    complete: false,
  });
  assertEquals(final, {
    kind: "text",
    text: "# Title\nlong line\nend",
    complete: true,
  });
});

Deno.test("shell/editor#R8: 글이 없는 page는 documents가 준 이유대로만 보인다", async () => {
  const cases: [ReturnType<typeof page>, BodyState["kind"]][] = [
    [page(null, [], null), "hidden"],
    [page(null, [], null, "unverified"), "unreadable"],
    [page(null, [], null, "unsupported"), "unsupported"],
  ];
  for (const [value, kind] of cases) {
    const { core } = coreOf(() => ({ ok: true, value }));
    const final = await coreEditorSource(core).body(DOC, VER, () => {});
    assertEquals(final.kind, kind);
  }
  const { core } = coreOf(() => ({
    ok: false,
    error: { code: "unavailable", message: "" },
  }));
  assertEquals(
    (await coreEditorSource(core).body(DOC, VER, () => {})).kind,
    "failed",
  );
});

Deno.test("shell/design-system#R23: 목차는 outline.document의 절을 제목 줄과 함께 읽는다", async () => {
  const { core, calls } = coreOf(() => ({
    ok: true,
    value: {
      entries: [
        {
          key: "_preamble",
          title: "",
          level: 0,
          subtree_range: { start_line: 1 },
        },
        {
          key: "intro",
          title: "Intro",
          level: 1,
          subtree_range: { start_line: 3 },
        },
      ],
      complete: true,
      next_cursor: null,
    },
  }));
  const result = await coreEditorSource(core).outline(DOC, VER);
  assertEquals(calls[0]?.resource, "outline");
  assertEquals(calls[0]?.method, "document");
  assertEquals(result, {
    ok: true,
    value: [{ key: "intro", title: "Intro", level: 1, line: 3 }],
  });
});

Deno.test("shell/editor#R11: 링크 후보는 프로젝트 이름과 문서 이름으로 address를 만들고 이름 없는 문서는 뺀다", async () => {
  const { core } = coreOf((call) =>
    call.resource === "projects"
      ? { ok: true, value: { project: { name: "lophn" } } }
      : {
        ok: true,
        value: {
          documents: [
            { document: { title: "Plan", name: "plan" } },
            { document: { title: "Loose", name: null } },
          ],
          next_cursor: null,
        },
      }
  );
  const result = await coreEditorSource(core).linkTargets(
    "prj_0000000000000000000000000a",
  );
  assertEquals(result, {
    ok: true,
    value: [{ address: "lophn/plan", title: "Plan", name: "plan" }],
  });
});

Deno.test("shell/editor#R4: 문서 링크는 documents.resolve로 문서를 찾고 외부 주소는 풀지 않는다", async () => {
  const { core, calls } = coreOf(() => ({
    ok: true,
    value: { resolved: { document: DOC } },
  }));
  const source = coreEditorSource(core);
  assertEquals(await source.resolveLink("lophn/plan#scope"), {
    ok: true,
    value: DOC,
  });
  assertEquals(calls[0]?.body, {
    reference: {
      place: "lophn",
      document: "plan",
      section: "scope",
      version: null,
    },
  });
  assertEquals(await source.resolveLink("https://example.com"), {
    ok: true,
    value: null,
  });
  assertEquals(calls.length, 1);
});
