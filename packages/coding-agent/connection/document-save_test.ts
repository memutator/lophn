// 문서 저장 통로 테스트다(mcp#R13–R15, cli#R15). core 대신 route별로 답을 정한 흐름
// client를 끼워 호출 순서·CAS·준비 참조·무저장 보장을 본다. 실제 core와의 통합은
// apps/core/documents-save-tool_test.ts에 있다.
import { assert, assertEquals } from "@std/assert";
import { documentIdSchema } from "../../contracts/documents/mod.ts";
import { documentIdForKey, saveDocument } from "./document-save.ts";
import { describeSave, describeSaveFailure } from "./save-result.ts";
import {
  documentFiles,
  fail,
  preparedFor,
  PROJECT_PLACE,
  savedResult,
  scriptedFlow,
  SERIES_ID,
  VERSION_1,
  VERSION_2,
} from "./testing/mod.ts";

const EMPTY_LIST = { documents: [], next_cursor: null };

function existingList(document: string, latest: string, name = "plan") {
  return {
    documents: [{
      document: { id: document, name },
      latest_version: { id: latest },
    }],
    next_cursor: null,
  };
}

Deno.test("coding-agent/mcp-server#R13: 새 문서는 준비 뒤 같은 key·CAS·준비 참조로 저장하고 고정 주소를 돌려준다", async () => {
  const flow = scriptedFlow({
    "document.list": EMPTY_LIST,
    "document.prepare": preparedFor,
    "document.save": (input) => (savedResult(
      "saved",
      (input as { document: string }).document,
    )),
  });
  const saved = await saveDocument(flow.client, {
    files: documentFiles(),
    place: PROJECT_PLACE,
    slug: "plan",
    title: "계획",
    idempotency_key: "key-1",
  });
  assert(saved.ok, saved.ok ? "" : saved.error.message);
  assertEquals(saved.value.saved.status, "saved");
  assertEquals(saved.value.created, true);
  assertEquals(saved.value.placed, true);
  // 준비 입력은 첫 파일 primary와 새 문서 metadata를 담는다.
  const prepare = flow.calls("document.prepare")[0].input as {
    document: string;
    base_version: unknown;
    metadata: unknown;
    files: { path: string; primary: boolean }[];
  };
  assertEquals(prepare.base_version, null);
  assertEquals(prepare.metadata, {
    title: "계획",
    place: PROJECT_PLACE,
    name: "plan",
  });
  assertEquals(prepare.files.map((file) => [file.path, file.primary]), [
    ["plan.md", true],
    ["extra.txt", false],
  ]);
  assert(documentIdSchema.safeParse(prepare.document).success);
  // 저장은 준비 결과 그대로를 입력으로 하고 CAS와 준비 참조를 묶는다.
  const save = flow.calls("document.save")[0];
  assertEquals(save.compare, { base_version: null });
  assertEquals(save.prepared, ["prep-ref-key-1"]);
  assertEquals(save.idempotency_key, "key-1");
  assertEquals(
    (save.input as { idempotency_key: string }).idempotency_key,
    "key-1",
  );
  const report = describeSave(saved.value);
  assertEquals(report.summary, "새 문서로 저장했다: notes/plan@1");
  assertEquals((report.data as { address: string }).address, "notes/plan@1");
});

Deno.test("coding-agent/mcp-server#R13: 같은 요청의 재전송은 기존 문서의 기준 판으로 보내 새 판 없이 unchanged를 낸다", async () => {
  const doc = "doc_01arz3ndektsv4rrffq69g5fax";
  const flow = scriptedFlow({
    "document.list": existingList(doc, VERSION_1),
    "document.prepare": preparedFor,
    "document.save": (
      input,
    ) => (savedResult("unchanged", (input as { document: string }).document)),
  });
  const saved = await saveDocument(flow.client, {
    files: documentFiles(),
    place: PROJECT_PLACE,
    slug: "plan",
  });
  assert(saved.ok);
  assertEquals(saved.value.saved.status, "unchanged");
  assertEquals(saved.value.saved.event_seq, null);
  assertEquals(saved.value.created, false);
  // 기존 문서이므로 새 문서 ID를 만들지 않고 최신 판을 기준으로 CAS한다.
  const prepare = flow.calls("document.prepare")[0].input as {
    document: string;
    base_version: string;
    metadata?: unknown;
  };
  assertEquals(prepare.document, doc);
  assertEquals(prepare.base_version, VERSION_1);
  assertEquals(prepare.metadata, undefined);
  assertEquals(flow.calls("document.save")[0].compare, {
    base_version: VERSION_1,
  });
  assertEquals(
    describeSave(saved.value).summary.startsWith(
      "내용이 같아 새 판을 만들지 않았다",
    ),
    true,
  );
});

Deno.test("coding-agent/mcp-server#R13: 자리 없는 같은 요청의 재전송은 같은 key라 같은 문서 ID로 간다", async () => {
  const flow = scriptedFlow({
    "document.prepare": preparedFor,
    "document.save": (
      input,
    ) => (savedResult("saved", (input as { document: string }).document)),
  });
  const first = await saveDocument(flow.client, { files: documentFiles() });
  const second = await saveDocument(flow.client, { files: documentFiles() });
  assert(first.ok && second.ok);
  const [a, b] = flow.calls("document.prepare").map((call) =>
    call.input as { document: string; idempotency_key: string }
  );
  assertEquals(a.idempotency_key, b.idempotency_key);
  assertEquals(a.document, b.document);
  // 내용이 다르면 다른 key·다른 문서다.
  const other = documentFiles();
  other[0] = { ...other[0], blob_hash: "d".repeat(64) };
  other[0].content = {
    kind: "prepared",
    blob: {
      preparation: "prep-d",
      principal: "cac",
      purpose: "document_file",
      hash: "d".repeat(64),
      size_bytes: 7,
    },
  };
  await saveDocument(flow.client, { files: other });
  const c = flow.calls("document.prepare")[2].input as { document: string };
  assert(c.document !== a.document);
  assertEquals(await documentIdForKey("same"), await documentIdForKey("same"));
});

Deno.test("coding-agent/mcp-server#R13: series만 있고 key가 없으면 어떤 호출도 하기 전에 거절한다", async () => {
  const flow = scriptedFlow({});
  const saved = await saveDocument(flow.client, {
    files: documentFiles(),
    series: { series: SERIES_ID },
  });
  assert(!saved.ok);
  assertEquals(saved.error.code, "invalid_input");
  assertEquals(flow.sent.length, 0);
  const keyOnly = await saveDocument(flow.client, {
    files: documentFiles(),
    key: "1",
  });
  assert(!keyOnly.ok);
  assertEquals(flow.sent.length, 0);
});

Deno.test("coding-agent/mcp-server#R14: 명시 format 부적합은 준비에서 거절되고 저장을 시작하지 않는다", async () => {
  const flow = scriptedFlow({
    "document.prepare": fail(
      "invalid_input",
      "requested format failed validation",
    ),
  });
  const saved = await saveDocument(flow.client, {
    files: documentFiles(),
    format: {
      name: "document",
      module_hash: "c".repeat(64),
      explicit: true,
    },
  });
  assert(!saved.ok);
  assertEquals(saved.error.code, "invalid_input");
  // 무저장: save command는 부르지 않았다.
  assertEquals(flow.calls("document.save").length, 0);
  const failure = describeSaveFailure(saved.error);
  assertEquals(failure.next[0].includes("lophn_format"), true);
});

Deno.test("coding-agent/mcp-server#R14: 추론 format 경고는 저장 결과의 경고로 전달한다", async () => {
  const warning = {
    severity: "warning",
    code: "invalid_structure",
    message: "heading이 없다",
    file: "plan.md",
    start_line: 1,
    end_line: 1,
    column: null,
  };
  const flow = scriptedFlow({
    "document.prepare": preparedFor,
    "document.save": (
      input,
    ) => (savedResult("saved", (input as { document: string }).document, [
      warning,
    ])),
  });
  const saved = await saveDocument(flow.client, { files: documentFiles() });
  assert(saved.ok);
  const report = describeSave(saved.value);
  assertEquals((report.data as { warnings: unknown[] }).warnings, [warning]);
  assertEquals(report.next.some((line) => line.includes("경고 1건")), true);
});

Deno.test("coding-agent/mcp-server#R15: 자리 없는 저장은 고정 주소와 자리 선택 안내를 낸다", async () => {
  const flow = scriptedFlow({
    "document.prepare": preparedFor,
    "document.save": (input) => {
      const document = (input as { document: string }).document;
      return ({
        ...savedResult("saved", document),
        reference: { document, version: VERSION_1, section: null },
      });
    },
  });
  const saved = await saveDocument(flow.client, { files: documentFiles() });
  assert(saved.ok);
  const prepare = flow.calls("document.prepare")[0].input as {
    metadata: { place: unknown; name: unknown; title: string };
  };
  // 자리·이름 없이 새 문서를 만들고 제목은 첫 파일 이름에서 온다.
  assertEquals(prepare.metadata, { title: "plan", place: null, name: null });
  const report = describeSave(saved.value);
  assertEquals((report.data as { placed: boolean }).placed, false);
  assertEquals(
    (report.data as { reference: { version: string } }).reference.version,
    VERSION_1,
  );
  assertEquals(report.next[0].includes("자리 선택은 사람이"), true);
  // 자리를 옮기거나 파일을 건드리는 호출은 하지 않았다.
  assertEquals(
    flow.sent.map((call) => call.name),
    ["document.prepare", "document.save"],
  );
});

Deno.test("coding-agent/mcp-server#R15: 자리는 이름과 함께만 쓰고 이름은 자리와 함께만 쓴다", async () => {
  const flow = scriptedFlow({});
  const placeOnly = await saveDocument(flow.client, {
    files: documentFiles(),
    place: PROJECT_PLACE,
  });
  assert(!placeOnly.ok);
  const slugOnly = await saveDocument(flow.client, {
    files: documentFiles(),
    slug: "plan",
  });
  assert(!slugOnly.ok);
  assertEquals(flow.sent.length, 0);
  // null은 자리 없음이다. 두 필드가 모두 없는 저장과 같다.
  const open = scriptedFlow({
    "document.prepare": preparedFor,
    "document.save": (
      input,
    ) => (savedResult("saved", (input as { document: string }).document)),
  });
  const nulls = await saveDocument(open.client, {
    files: documentFiles(),
    place: null,
    slug: null,
  });
  assert(nulls.ok);
  assertEquals(nulls.value.placed, false);
});

Deno.test("coding-agent/mcp-server#R13: 기준 판을 주었는데 문서가 없거나 새 문서를 주장하는데 이미 있으면 충돌이다", async () => {
  const doc = "doc_01arz3ndektsv4rrffq69g5fax";
  const none = scriptedFlow({ "document.list": EMPTY_LIST });
  const missing = await saveDocument(none.client, {
    files: documentFiles(),
    place: PROJECT_PLACE,
    slug: "plan",
    base_revision: VERSION_1,
  });
  assert(!missing.ok);
  assertEquals(missing.error.code, "conflict");
  const some = scriptedFlow({ "document.list": existingList(doc, VERSION_1) });
  const claimed = await saveDocument(some.client, {
    files: documentFiles(),
    place: PROJECT_PLACE,
    slug: "plan",
    base_revision: null,
  });
  assert(!claimed.ok);
  assertEquals(claimed.error.code, "conflict");
  assertEquals(some.calls("document.prepare").length, 0);
});

const SERIES_VIEW = (entries: { key: string; document: string }[]) => ({
  series: { id: SERIES_ID, revision: "12", title: "Daily" },
  entries,
  next_cursor: null,
});

Deno.test("coding-agent/mcp-server#R13: series 저장은 저장 뒤 같은 key로 가입하고 가입 CAS는 읽은 revision이다", async () => {
  const flow = scriptedFlow({
    "series.get": SERIES_VIEW([{ key: "1", document: "doc_other" }]),
    "document.prepare": preparedFor,
    "document.save": (
      input,
    ) => (savedResult("saved", (input as { document: string }).document)),
    "series.add_instance": { id: SERIES_ID },
  });
  const saved = await saveDocument(flow.client, {
    files: documentFiles(),
    idempotency_key: "key-s",
    series: { series: SERIES_ID },
    key: "2",
  });
  assert(saved.ok, saved.ok ? "" : saved.error.message);
  assertEquals(saved.value.series, {
    series: SERIES_ID,
    key: "2",
    joined: true,
  });
  const join = flow.calls("series.add_instance")[0];
  assertEquals(join.compare, { base_revision: "12" });
  assertEquals(join.input, {
    series: SERIES_ID,
    document: saved.value.saved.document,
    key: "2",
  });
  assertEquals(join.idempotency_key, "key-s-join");
  // 저장이 가입보다 앞선다.
  assertEquals(
    flow.sent.map((call) => call.name),
    ["series.get", "document.prepare", "document.save", "series.add_instance"],
  );
});

Deno.test("coding-agent/mcp-server#R13: 이미 쓴 key는 저장 전에 거절하고 이미 가입한 문서의 재전송은 다시 가입하지 않는다", async () => {
  const taken = scriptedFlow({
    "series.get": SERIES_VIEW([{ key: "2", document: "doc_other" }]),
  });
  const refused = await saveDocument(taken.client, {
    files: documentFiles(),
    series: { series: SERIES_ID },
    key: "2",
  });
  assert(!refused.ok);
  assertEquals(refused.error.code, "conflict");
  assertEquals(refused.error.message, "이미 사용한 key다");
  // 무저장: 준비도 시작하지 않았다.
  assertEquals(taken.sent.map((call) => call.name), ["series.get"]);

  const doc = "doc_01arz3ndektsv4rrffq69g5fax";
  const again = scriptedFlow({
    "series.get": SERIES_VIEW([{ key: "2", document: doc }]),
    "document.list": existingList(doc, VERSION_1),
    "document.prepare": preparedFor,
    "document.save": savedResult("unchanged", doc),
  });
  const resent = await saveDocument(again.client, {
    files: documentFiles(),
    place: PROJECT_PLACE,
    slug: "plan",
    series: { series: SERIES_ID },
    key: "2",
  });
  assert(resent.ok, resent.ok ? "" : resent.error.message);
  assertEquals(resent.value.series?.joined, true);
  assertEquals(again.calls("series.add_instance").length, 0);

  const other = scriptedFlow({
    "series.get": SERIES_VIEW([{ key: "1", document: doc }]),
    "document.list": existingList(doc, VERSION_1),
  });
  const different = await saveDocument(other.client, {
    files: documentFiles(),
    place: PROJECT_PLACE,
    slug: "plan",
    series: { series: SERIES_ID },
    key: "2",
  });
  assert(!different.ok);
  assertEquals(different.error.code, "conflict");
});

Deno.test("coding-agent/mcp-server#R13: 저장 뒤 가입이 거절되면 저장된 고정 주소를 오류에 남긴다", async () => {
  const flow = scriptedFlow({
    "series.get": SERIES_VIEW([]),
    "document.prepare": preparedFor,
    "document.save": (
      input,
    ) => (savedResult("saved", (input as { document: string }).document)),
    "series.add_instance": fail("conflict", "document place does not match"),
  });
  const saved = await saveDocument(flow.client, {
    files: documentFiles(),
    series: { series: SERIES_ID },
    key: "1",
  });
  assert(!saved.ok);
  assertEquals(saved.error.code, "conflict");
  const details = saved.error.details as {
    saved: { document: string; version: string };
  };
  assertEquals(details.saved.version, VERSION_1);
  const failure = describeSaveFailure(saved.error);
  assertEquals(failure.next[0], "lophn_read로 저장된 문서를 확인한다");
});

Deno.test("coding-agent/mcp-server#R13: 기존 문서의 title은 바꾸지 않고 알린다", async () => {
  const doc = "doc_01arz3ndektsv4rrffq69g5fax";
  const flow = scriptedFlow({
    "document.list": existingList(doc, VERSION_2),
    "document.prepare": preparedFor,
    "document.save": savedResult("saved", doc),
  });
  const saved = await saveDocument(flow.client, {
    files: documentFiles(),
    place: PROJECT_PLACE,
    slug: "plan",
    title: "다른 제목",
  });
  assert(saved.ok);
  assertEquals(saved.value.notes, ["기존 문서라 title은 바뀌지 않는다"]);
});
