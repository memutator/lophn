// 정리 통로가 보내는 route 이름과 입력 모양. renderer 설정(DOM lib)은 contracts graph를 type
// 검사하지 못하므로 contracts를 들이지 않고 schema의 field 이름을 그대로 적는다.
import { assert, assertEquals } from "@std/assert";

import type { CoreCall } from "../../../../ipc/core.ts";
import type { CoreReply } from "../../../../ipc/core-api.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { coreOrganizeSource } from "./core-source.ts";
import type { DocumentDetail } from "./source.ts";

const ULID = "01k6aaaaaaaaaaaaaaaaaaaaaa";
const DOC = `doc_${ULID}`;
const VER = `ver_${ULID}`;
const PRJ = `prj_${ULID}`;
const PATH = "/work/lophn/notes.md";

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

function name(call: CoreCall): string {
  return `${call.kind}:${call.resource}/${call.method}`;
}

const documentValue = {
  id: DOC,
  title: "Notes",
  place: { kind: "project", id: PRJ },
  name: "notes",
  latest_version: VER,
  revision: "3",
  status: "active",
  file_source: { kind: "project_file", project: PRJ, path: PATH },
};

const DETAIL: DocumentDetail = {
  id: DOC,
  title: "Notes",
  name: "notes",
  place: { kind: "project", id: PRJ },
  revision: "3",
  latestVersion: VER,
  archived: false,
  file: { project: PRJ, path: PATH },
  singleFile: "notes.md",
};

Deno.test("documents/addressing#R9 shell/desktop#R28: 이름 바꾸기·자리 이동은 사람 command를 현재 revision 비교로 보내고 다시 읽은 문서를 돌려준다", async () => {
  const { core, calls } = coreOf((call) =>
    call.kind === "read"
      ? {
        ok: true,
        value: {
          document: { ...documentValue, revision: "4" },
          version: {
            id: VER,
            number: 2,
            files: [{
              path: "notes.md",
              media_type: "text/markdown",
              bytes: 4,
            }],
          },
        },
      }
      : { ok: true, value: documentValue }
  );
  const source = coreOrganizeSource(core, undefined, undefined);
  const renamed = await source.renameDocument(DETAIL, "plan");
  assert(renamed.ok);
  assertEquals(renamed.value.revision, "4");
  assertEquals(renamed.value.file, { project: PRJ, path: PATH });
  assertEquals(renamed.value.singleFile, "notes.md");
  await source.moveDocument(DETAIL, null, null);
  const commands = calls.filter((call) => call.kind === "command");
  assertEquals(commands.map(name), [
    "command:documents/rename",
    "command:documents/move",
  ]);
  const [rename, move] = commands.map((call) =>
    call.body as { input: unknown; compare: unknown }
  );
  assertEquals(rename!.input, { document: DOC, name: "plan" });
  assertEquals(rename!.compare, { base_revision: "3" });
  assertEquals(move!.input, { document: DOC, place: null, name: null });
});

Deno.test("documents/versions#R16: export는 사람이 고른 자리·문서·판·형식을 worker 읽기로 보내고 원래 파일 목록과 목록 blob 판을 구별한다", async () => {
  const { core, calls } = coreOf(() => ({
    ok: true,
    value: {
      format: "json",
      documents: [
        {
          document: documentValue,
          version: {
            id: VER,
            number: 2,
            files: [{ path: "a.pdf", media_type: "application/pdf", bytes: 9 }],
          },
        },
        {
          document: { ...documentValue, id: `doc_${ULID.slice(0, -1)}b` },
          version: { id: VER, number: 1, files: { hash: "ab".repeat(32) } },
        },
      ],
    },
  }));
  const source = coreOrganizeSource(core, undefined, undefined);
  const result = await source.exportDocuments(
    { kind: "project", id: PRJ },
    [{ document: DOC, version: VER }],
    "json",
  );
  assertEquals(calls.map(name), ["worker:documents/export"]);
  assertEquals(calls[0]!.body, {
    place: { kind: "project", id: PRJ },
    documents: [{ document: DOC, version: VER }],
    format: "json",
  });
  assert(result.ok);
  assertEquals(result.value.documents.map((item) => item.files), [
    [{ path: "a.pdf", mediaType: "application/pdf", bytes: 9 }],
    null,
  ]);
});

Deno.test("documents/file-tracking#R13 documents/file-tracking#R14: 두기는 main 편집 통로로 최신 판을 보내고 빼기는 대상 문서만 실은 파일 지우기 결정 창을 연다", async () => {
  const { core, calls } = coreOf(() => ({ ok: true, value: {} }));
  const placed: unknown[] = [];
  const opened: unknown[] = [];
  const source = coreOrganizeSource(
    core,
    {
      place: (input) => {
        placed.push(input);
        return Promise.resolve({
          ok: true,
          value: {
            file: "written",
            path: input.path,
            steps: {
              source: { state: "done" },
              tracking: { state: "skipped", reason: "already tracked" },
              move: { state: "skipped", reason: "already placed" },
            },
            failure: null,
          },
        });
      },
    },
    (intent) => {
      opened.push(intent);
      return Promise.resolve({ windowId: "win-2", displayId: "disp-1" });
    },
  );
  const place = await source.placeFile(DETAIL, PRJ, PATH);
  assert(place.ok);
  assertEquals(place.value.steps?.tracking.state, "skipped");
  const request = placed[0] as Record<string, unknown>;
  assertEquals(
    { ...request, request_key: undefined },
    {
      document: DOC,
      version: VER,
      project: PRJ,
      path: PATH,
      request_key: undefined,
    },
  );
  assert(String(request.request_key).startsWith("place-"));
  const removed = await source.removeFile(DETAIL);
  assertEquals(removed, { ok: true, value: { kind: "review" } });
  assertEquals(opened, [{
    request: {
      kind: "owner_decision",
      concern: "documents/file-tracking",
      decision: "delete_file",
      targets: [DOC],
    },
    parentWindow: "requesting-window",
  }]);
  // 파일 쓰기·지우기는 renderer core 통로로 가지 않는다.
  assertEquals(calls.length, 0);
  // 통로가 없는 창은 unavailable이다.
  const bare = coreOrganizeSource(core, undefined, undefined);
  assertEquals(await bare.removeFile(DETAIL), {
    ok: false,
    code: "unavailable",
  });
  assertEquals(await bare.placeFile(DETAIL, PRJ, PATH), {
    ok: false,
    code: "unavailable",
  });
});
