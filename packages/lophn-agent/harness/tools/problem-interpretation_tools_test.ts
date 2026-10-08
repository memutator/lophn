import { assertEquals } from "@std/assert";
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import { createProblemInterpretationToolHandlers } from "./bundles/problem-interpretation.ts";
import {
  executeTool,
  problemSetInterpretationTool,
  type RunCredential,
  runOperations,
} from "./mod.ts";

// 문제 해석 참조 설정 tool의 command 전 read 단계(problems#T19에서 넘어온 것).
// reader로 documents get·outline.document를 부른 뒤 command로 넘기는지 본다. 소유
// contract(LinkProblemInterpretation)는 대역이 받는다. 실제 core·documents worker와
// 실제 사람 데이터 root는 열지 않는다.

const RUN = "run_01h455vb4pex5v6nkc6gd5fdw1";
const CALL = "tcl_01h455vb4pex5v6nkc6gd5fdw1";
const DOC = "doc_01h455vb4pex5v6nkc6gd5fdw1";
const VER = "ver_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER_VER = "ver_01h455vb4pex5v6nkc6gd5fdw9";
const PROBLEM = "prb_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER_PROBLEM = "prb_01h455vb4pex5v6nkc6gd5fdw2";

type Seen = {
  contract: string;
  input: Record<string, unknown>;
  options?: { compare?: unknown; idempotency_key?: string };
};

function rig(
  options: {
    readable?: boolean;
    section?: string;
    problemSeq?: string;
    interpretation?: unknown;
    missingProblem?: boolean;
  } = {},
) {
  const seen: Seen[] = [];
  const ports = {
    call(
      contract: string,
      input: unknown,
      _run: string,
      callOptions?: Seen["options"],
    ): Promise<Result<unknown>> {
      const value = (input ?? {}) as Record<string, unknown>;
      seen.push({
        contract,
        input: value,
        ...(callOptions === undefined ? {} : { options: callOptions }),
      });
      if (contract === "document.get") {
        if (options.readable === false) {
          return Promise.resolve(
            err({ code: "not_found", message: "no version" }),
          );
        }
        return Promise.resolve(ok({
          version: { id: value["version"] === OTHER_VER ? "wrong" : VER },
          as_of_seq: "5",
          next_cursor: null,
        }));
      }
      if (contract === "outline.document") {
        return Promise.resolve(ok({
          section_status: options.section ?? "found",
          as_of_seq: "5",
          next_cursor: null,
        }));
      }
      if (contract === "GetProblem") {
        if (options.missingProblem === true) {
          return Promise.resolve(
            err<LophnError>({ code: "not_found", message: "없는 문제다" }),
          );
        }
        return Promise.resolve(ok({
          problem: {
            id: value["problem"],
            seq: options.problemSeq ?? "12",
            interpretation: options.interpretation === undefined
              ? null
              : options.interpretation,
          },
          as_of_seq: "9",
          next_cursor: null,
        }));
      }
      if (contract === "LinkProblemInterpretation") {
        return Promise.resolve(ok({
          interpretation: value["interpretation"],
        }));
      }
      return Promise.resolve(
        err({ code: "internal", message: contract }),
      );
    },
  };
  const credential: RunCredential = {
    run: RUN,
    targets: new Set(),
    operations: new Set([problemSetInterpretationTool.contract]),
    call: CALL,
  };
  const run = (input: unknown) =>
    executeTool(
      {
        listed: [problemSetInterpretationTool],
        handlers: createProblemInterpretationToolHandlers(ports),
        credential,
      },
      problemSetInterpretationTool.name,
      input,
    );
  return { seen, run };
}

const LINK = { version: VER, section: "cause" };

Deno.test("lophn-agent/harness/tools#R8: 해석 참조 설정 tool은 command 전에 version 존재·읽기 가능·절 존재를 documents 읽기로 확인한다", async () => {
  const { seen, run } = rig();
  const outcome = await run({
    problem: PROBLEM,
    document: DOC,
    interpretation: LINK,
    explanation: "원인 가설의 절을 연결한다",
  });
  assertEquals(outcome.outcome.kind, "success");
  // command 전에 reader가 get과 outline을 부른다.
  assertEquals(seen.map((call) => call.contract).slice(0, 2), [
    "document.get",
    "outline.document",
  ]);
  // 그 뒤 문제의 현재 참조(compare.previous)와 command를 부른다.
  const sent = seen.find((call) =>
    call.contract === "LinkProblemInterpretation"
  )!;
  assertEquals(sent.input, { problem: PROBLEM, interpretation: LINK });
  assertEquals(
    (sent.options?.compare as { previous?: unknown }).previous,
    null,
  );
  assertEquals(sent.options?.idempotency_key, CALL);
});

Deno.test("lophn-agent/harness/tools#R8: 없거나 읽기 권한 밖 version은 not_found다", async () => {
  const missing = rig({ readable: false });
  const refused = await missing.run({
    problem: PROBLEM,
    document: DOC,
    interpretation: LINK,
    explanation: "설명",
  });
  assertEquals(refused.outcome.kind, "failure");
  assertEquals(refused.outcome.code, "not_found");
  // command까지 가지 않는다.
  assertEquals(
    missing.seen.some((call) => call.contract === "LinkProblemInterpretation"),
    false,
  );
});

Deno.test("lophn-agent/harness/tools#R8: missing·unsupported·unverified 절은 invalid_input이다", async () => {
  for (const state of ["missing", "unsupported", "unverified"]) {
    const fixture = rig({ section: state });
    const refused = await fixture.run({
      problem: PROBLEM,
      document: DOC,
      interpretation: LINK,
      explanation: "설명",
    });
    assertEquals(refused.outcome.kind, "failure", state);
    assertEquals(refused.outcome.code, "invalid_input", state);
    assertEquals(
      fixture.seen.some((call) =>
        call.contract === "LinkProblemInterpretation"
      ),
      false,
      state,
    );
  }
});

Deno.test("lophn-agent/harness/tools#R8: 절 없는 연결은 절 확인 없이 command로 넘긴다", async () => {
  const { seen, run } = rig();
  const outcome = await run({
    problem: PROBLEM,
    document: DOC,
    interpretation: { version: VER, section: null },
    explanation: "판 전체를 가리킨다",
  });
  assertEquals(outcome.outcome.kind, "success");
  // readable은 확인하고 절 확인은 없다.
  assertEquals(seen.map((call) => call.contract).slice(0, 2), [
    "document.get",
    "GetProblem",
  ]);
});

Deno.test("lophn-agent/harness/tools#R8: 연결 해제(interpretation null)는 검사 없이 command로 넘긴다", async () => {
  const { seen, run } = rig({ interpretation: LINK });
  const outcome = await run({
    problem: PROBLEM,
    document: DOC,
    interpretation: null,
    explanation: "연결을 해제한다",
  });
  assertEquals(outcome.outcome.kind, "success");
  assertEquals(seen[0]!.contract, "GetProblem");
  const sent = seen.find((call) =>
    call.contract === "LinkProblemInterpretation"
  )!;
  assertEquals(sent.input, { problem: PROBLEM, interpretation: null });
  // compare.previous는 문제의 현재 참조다.
  assertEquals(
    (sent.options?.compare as { previous?: unknown }).previous,
    LINK,
  );
});

Deno.test("lophn-agent/harness/tools#R8: compare는 읽은 문제 seq와 현재 참조를 싣는다", async () => {
  const current = { version: OTHER_VER, section: null };
  const { seen, run } = rig({ problemSeq: "15", interpretation: current });
  const outcome = await run({
    problem: PROBLEM,
    document: DOC,
    interpretation: LINK,
    explanation: "설명",
  });
  assertEquals(outcome.outcome.kind, "success");
  const sent = seen.find((call) =>
    call.contract === "LinkProblemInterpretation"
  )!;
  assertEquals(
    sent.options?.compare,
    { problem_seq: "15", previous: current },
  );
});

Deno.test("lophn-agent/harness/tools#R8: 없는 문제는 없는 대상과 같은 not_found이고 command로 넘기지 않는다", async () => {
  const { run } = rig({ missingProblem: true });
  const refused = await run({
    problem: OTHER_PROBLEM,
    document: DOC,
    interpretation: LINK,
    explanation: "설명",
  });
  assertEquals(refused.outcome.kind, "failure");
  assertEquals(refused.outcome.code, "not_found");
});

Deno.test("lophn-agent/harness/tools#R8: run의 agent operation은 command와 command 전 읽기를 함께 담는다", () => {
  // handler가 command 전에 같은 자격으로 부르는 읽기가 run의 agent operation에 없으면
  // 제품 경로에서 그 읽기가 forbidden이 된다(problems#T19).
  const operations = new Set(runOperations([problemSetInterpretationTool]));
  for (
    const name of [
      problemSetInterpretationTool.contract,
      "document.get",
      "outline.document",
      "GetProblem",
    ]
  ) {
    assertEquals(operations.has(name), true, name);
  }
});
