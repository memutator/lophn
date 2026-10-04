// CLI --json 출력·exit 테스트다(cli#R2, R3). stdout에 JSON 하나와 newline만
// 있는지, 성공·입력 실패의 exit가 CLI_EXITS와 같은지 본다. backpressure가 없는
// collector WritableStream을 끼운다(TransformStream은 reader 대기 없이 write가
// 끝나지 않는다).
import { assertEquals } from "@std/assert";
import { CLI_EXITS, createOutput } from "./output.ts";

function collector() {
  const chunks: string[] = [];
  const stream = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(new TextDecoder().decode(chunk));
    },
  });
  return { stream, text: () => chunks.join("") };
}

const result = {
  summary: "3 documents",
  data: { documents: ["notes/plan"] },
  next: ["lophn document show notes/plan"],
};

Deno.test(
  "coding-agent/cli#R3: --json은 stdout에 JSON 하나와 newline만 쓴다",
  async () => {
    const out = collector();
    const err = collector();
    const output = createOutput({
      json: true,
      stdout: out.stream,
      stderr: err.stream,
    });
    await output.result(result);
    assertEquals(out.text(), `${JSON.stringify(result)}\n`);
    assertEquals(err.text(), "");
  },
);

Deno.test(
  "coding-agent/cli#R3: --json 실패는 stdout에 오류 JSON 하나를 쓴다",
  async () => {
    const out = collector();
    const err = collector();
    const output = createOutput({
      json: true,
      stdout: out.stream,
      stderr: err.stream,
    });
    const failure = {
      code: "invalid_input" as const,
      message: "입력이 맞지 않다",
    };
    await output.failure(failure);
    assertEquals(
      out.text(),
      `${JSON.stringify({ error: failure })}\n`,
    );
    assertEquals(err.text(), "");
  },
);

Deno.test(
  "coding-agent/cli#R3: 사람 출력은 summary와 data 줄로 표현한다",
  async () => {
    const out = collector();
    const err = collector();
    const output = createOutput({
      json: false,
      stdout: out.stream,
      stderr: err.stream,
    });
    await output.result(result);
    const text = out.text();
    assertEquals(text.includes("3 documents\n"), true);
    assertEquals(text.includes('documents: ["notes/plan"]\n'), true);
    assertEquals(text.includes("다음 조회:\n"), true);
    assertEquals(text.includes("  lophn document show notes/plan\n"), true);
  },
);

Deno.test(
  "coding-agent/cli#R3: 사람 실패 진단은 stderr로 나간다",
  async () => {
    const out = collector();
    const err = collector();
    const output = createOutput({
      json: false,
      stdout: out.stream,
      stderr: err.stream,
    });
    await output.failure({
      code: "invalid_input",
      message: "입력이 맞지 않다",
    });
    assertEquals(out.text(), "");
    assertEquals(err.text().includes("입력이 맞지 않다"), true);
  },
);

Deno.test("coding-agent/cli#R2: exit는 성공 0과 입력 2로 구별한다", () => {
  assertEquals(CLI_EXITS.success, 0);
  assertEquals(CLI_EXITS.invalid_input, 2);
  assertEquals(CLI_EXITS.unauthorized, 3);
  assertEquals(CLI_EXITS.failed, 4);
  assertEquals(CLI_EXITS.transport, 5);
  assertEquals(CLI_EXITS.effect_unknown, 6);
  assertEquals(CLI_EXITS.internal, 1);
});
