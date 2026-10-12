import { assert, assertEquals } from "@std/assert";
import { defineBlobField } from "../../../protocol/storage/mod.ts";
import {
  capacityFields,
  type Protection,
  pruningRequest,
  subjectIdentities,
  trimCandidatesOf,
  trimPlan,
  type TrimReference,
} from "./retention.ts";

// 보존 정리의 판정만 본다(observability#R23, R24, R25, R26). 용량 숫자와 실제 파일 삭제는
// platform/blob-store·platform/ledger 몫이라 여기서는 파일·ledger를 열지 않는다(platform#T44).

const MCL = "mcl1";
const TCL = "tcl1";
const RUN = "run1";
const MSG = "msg1";
const QST = "qst1";
const APV = "apv1";
const REV = "rev1";

// sha256 모양의 hash. 실제 본문은 없다: 이 leaf는 본문을 읽지 않는다.
function hash(seed: string): string {
  return seed.padEnd(64, "0");
}

// agent가 등록한 field. 큰 자료(model 호출 본문·tool 입출력)만 capacity이고 변경 기록(run basis)·
// 확정 결과(run result)·사람 말(message)·질문·handoff 본문은 permanent다.
const AGENT_FIELDS = [
  defineBlobField({
    owner_kind: "model_call",
    field: "input",
    retention: { kind: "capacity", category: "model_call_body" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: "model_call",
    field: "context_basis",
    retention: { kind: "capacity", category: "model_call_body" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: "model_call",
    field: "output",
    retention: { kind: "capacity", category: "model_call_body" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: "tool_call",
    field: "input",
    retention: { kind: "capacity", category: "model_call_body" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: "tool_call",
    field: "output",
    retention: { kind: "capacity", category: "model_call_body" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: "run",
    field: "basis",
    retention: { kind: "permanent" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: "run",
    field: "result",
    retention: { kind: "permanent" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: "message",
    field: "body",
    retention: { kind: "permanent" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: "question",
    field: "prompt",
    retention: { kind: "permanent" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: "handoff",
    field: "body",
    retention: { kind: "permanent" },
    general_read: false,
  }),
];

// blob_refs 참조 행 하나의 관측. 등록 순번이 정리 순서를 정한다.
function reference(
  seed: string,
  owner: { kind: string; key: string; field: string },
  seq: number,
  sizeBytes = 1024,
): TrimReference {
  return {
    hash: hash(seed),
    owner_kind: owner.kind,
    owner_key: owner.key,
    field: owner.field,
    size_bytes: sizeBytes,
    registered_seq: String(seq),
  };
}

Deno.test("lophn-agent/observability#R23: 큰 자료만 오래된 것부터 정리 대상이고 변경 기록·확정 결과는 대상이 아니며 상한 숫자는 이 leaf에 없다", () => {
  const references = [
    reference("a1", { kind: "model_call", key: MCL, field: "output" }, 5, 900),
    reference("a2", { kind: "run", key: RUN, field: "basis" }, 2),
    reference("a3", { kind: "model_call", key: MCL, field: "input" }, 1, 10),
    reference("a4", { kind: "message", key: MSG, field: "body" }, 4),
    reference("a5", { kind: "tool_call", key: TCL, field: "input" }, 3, 4000),
    reference("a6", { kind: "run", key: RUN, field: "result" }, 6),
  ];
  const candidates = trimCandidatesOf(AGENT_FIELDS, references);
  // 등록 순번이 앞선 것부터다(오래된 것부터). 크기는 순서를 바꾸지 않는다.
  assertEquals(candidates.map((candidate) => candidate.hash), [
    hash("a3"),
    hash("a5"),
    hash("a1"),
  ]);
  assertEquals(candidates.map((candidate) => candidate.registered_seq), [
    "1",
    "3",
    "5",
  ]);
  assertEquals(candidates.map((candidate) => candidate.category), [
    "model_call_body",
    "model_call_body",
    "model_call_body",
  ]);
  // 변경 기록(run basis)·확정 결과(run result)·사람 말(message body)은 정리 대상이 아니다.
  const permanent = [hash("a2"), hash("a4"), hash("a6")];
  for (const kept of permanent) {
    assert(!candidates.some((candidate) => candidate.hash === kept));
  }
  // 이 leaf는 상한 숫자를 두지 않는다: 자르지 않고 큰 자료 참조를 전부 넘긴다(용량 숫자와 실제
  // 삭제는 platform/blob-store·platform/ledger).
  assertEquals(candidates.length, 3);
  assertEquals(
    capacityFields(AGENT_FIELDS).map((field) =>
      `${field.owner_kind}:${field.field}`
    ),
    [
      "model_call:input",
      "model_call:context_basis",
      "model_call:output",
      "tool_call:input",
      "tool_call:output",
    ],
  );
});

Deno.test("lophn-agent/observability#R24: 진행 run·미반영 입력·답·approval 대기·revert 근거는 정리 대상으로 넘기지 않고 근거별로 구별된다", () => {
  const references = [
    reference("b1", { kind: "model_call", key: "mcl1", field: "output" }, 1),
    reference("b2", { kind: "model_call", key: "mcl2", field: "input" }, 2),
    reference("b3", { kind: "tool_call", key: "tcl1", field: "output" }, 3),
    reference(
      "b4",
      { kind: "model_call", key: "mcl4", field: "context_basis" },
      4,
    ),
    reference("b5", { kind: "tool_call", key: "tcl5", field: "input" }, 5),
    reference("b6", { kind: "model_call", key: "mcl6", field: "output" }, 6),
    reference("b7", { kind: "tool_call", key: "tcl7", field: "input" }, 7),
  ];
  const protections: Protection[] = [
    { verdict: { kind: "active_run", run: RUN }, hashes: [hash("b1")] },
    {
      verdict: { kind: "unreflected_input", message: MSG },
      hashes: [hash("b2")],
    },
    {
      verdict: { kind: "pending_answer", question: QST },
      hashes: [hash("b3")],
    },
    // 같은 근거가 여러 본문을 가리키고, 같은 본문이 두 근거에 걸릴 수 있다.
    {
      verdict: { kind: "pending_approval", approval: APV },
      hashes: [hash("b4"), hash("b6")],
    },
    {
      verdict: { kind: "revert_basis", revert: REV },
      hashes: [hash("b5"), hash("b6")],
    },
  ];
  const plan = trimPlan(AGENT_FIELDS, references, protections);
  // 보호 근거가 가리키는 hash는 하나도 넘기지 않는다. 남은 것만 정리 대상이다.
  assertEquals(plan.targets.map((target) => target.hash), [hash("b7")]);
  assertEquals(plan.kept.map((kept) => kept.hash), [
    hash("b1"),
    hash("b2"),
    hash("b3"),
    hash("b4"),
    hash("b5"),
    hash("b6"),
  ]);
  // 근거는 서로 구별된다: 진행 run·미반영 입력·답 대기·approval 대기·revert 근거.
  assertEquals(plan.kept.map((kept) => kept.verdict.kind), [
    "active_run",
    "unreflected_input",
    "pending_answer",
    "pending_approval",
    "revert_basis",
    "pending_approval",
  ]);
  // 같은 hash가 두 근거에 걸려도 판정은 하나다(먼저 든 근거).
  assertEquals(plan.kept.length, 6);
  assertEquals(plan.kept[5]?.verdict, {
    kind: "pending_approval",
    approval: APV,
  });
  // 보호 대상은 요청에도 들어가지 않는다.
  assertEquals(plan.request.hashes, [hash("b7")]);
});

Deno.test("lophn-agent/observability#R25: 사라진 본문의 derived index·cache 제거와 부재 표시를 요청하고 다른 store와 한 transaction을 약속하지 않는다", () => {
  const references = [
    reference("c1", { kind: "model_call", key: MCL, field: "output" }, 2),
    // 같은 본문을 두 참조가 가리킨다(hash가 같다).
    reference("c1", { kind: "tool_call", key: TCL, field: "input" }, 3),
    reference("c2", { kind: "tool_call", key: TCL, field: "output" }, 4),
  ];
  const plan = trimPlan(AGENT_FIELDS, references, []);
  const request = plan.request;
  assertEquals(request.hashes, [hash("c1"), hash("c2")]);
  assertEquals(request.remove_derived, ["index", "cache"]);
  assertEquals(request.mark_absence, true);
  // store마다 따로 진행한다: 한 transaction으로 묶지 않는다.
  assertEquals(request.atomic, false);
  // 요청은 hash 목록과 요청 종류뿐이다: 본문·식별·용량 숫자는 담지 않는다.
  assertEquals(Object.keys(request).sort(), [
    "atomic",
    "hashes",
    "mark_absence",
    "remove_derived",
  ]);
  // 빈 대상은 요청도 비운다.
  assertEquals(pruningRequest([]).hashes, []);
});

Deno.test("lophn-agent/observability#R26: 보존 종료는 문서·release 삭제로 번지지 않고 변경 주체의 최소 식별이 남는다", () => {
  const references = [
    reference("d1", { kind: "model_call", key: MCL, field: "output" }, 1),
    reference("d2", { kind: "model_call", key: MCL, field: "input" }, 2),
    // 그 과정에서 만든 문서·release의 blob이다. agent 등록 field가 아니다.
    {
      hash: hash("d3"),
      owner_kind: "document_version",
      owner_key: "ver1",
      field: "file",
      size_bytes: 4096,
      registered_seq: "3",
    },
    {
      hash: hash("d4"),
      owner_kind: "release_backup",
      owner_key: "rel1",
      field: "archive",
      size_bytes: 4096,
      registered_seq: "4",
    },
  ];
  const plan = trimPlan(AGENT_FIELDS, references, []);
  // 문서·release는 큰 자료 분류에 들어오지 않는다: 정리 대상도 요청도 아니다.
  assertEquals(plan.targets.map((target) => target.owner_kind), [
    "model_call",
    "model_call",
  ]);
  assertEquals(plan.request.hashes, [hash("d1"), hash("d2")]);
  // 본문이 사라져도 변경 주체의 최소 식별(run·호출 id)은 남는다: 저자 구별이 유지된다.
  assertEquals(plan.subjects, [{ owner_kind: "model_call", owner_key: MCL }]);
  assertEquals(subjectIdentities(plan.targets), plan.subjects);
  // 최소 식별에는 본문·hash·field·용량 숫자가 없다.
  assertEquals(Object.keys(plan.subjects[0]!).sort(), [
    "owner_key",
    "owner_kind",
  ]);
});
