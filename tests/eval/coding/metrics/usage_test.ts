// 세 질문
// - contract: eval roadmap "공통 수치"의 coding agent 열. Claude Code JSONL에서 읽은 token과 tool 오류 비율이 비교의 근거다.
// - 현실적 회귀: message.id 중복을 안 빼서 token이 두 배쯤 부푸는 수정, subagent file을 빼먹는 수정, hook 줄을 명령으로 세는 수정.
// - 왜 지금 test로 못 잡나: 값이 부풀어도 오류 없이 숫자만 틀려진다. 다른 test는 이 module을 부르지 않는다.
import { assertEquals } from "@std/assert";
import { countHook, parseCommandLog } from "./commands.ts";
import { parseClaudeJsonl } from "./jsonl.ts";

const usage = (input: number, output: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: 10,
  cache_creation_input_tokens: 5,
});
const assistant = (id: string, model: string, u: object, block: string) =>
  JSON.stringify({
    type: "assistant",
    message: { id, model, usage: u, content: [{ type: block }] },
  });
const result = (id: string, isError: boolean) =>
  JSON.stringify({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: id, is_error: isError }],
    },
  });

Deno.test("같은 message.id의 token은 한 번만 세고 subagent file은 합쳐지며 tool 오류 비율이 맞다", () => {
  const main = [
    assistant("m1", "claude-sonnet-5-5", usage(100, 20), "thinking"),
    assistant("m1", "claude-sonnet-5-5", usage(100, 20), "tool_use"),
    result("t1", false),
    result("t2", true),
    result("t2", true), // 같은 tool_use_id는 한 번
    '{"type":"assistant","message":{"id":"m2"', // 쓰는 도중 끊긴 줄
  ].join("\n");
  const sub = [
    assistant("m3", "claude-haiku-5-5", usage(50, 5), "text"),
    result("t3", false),
    result("t4", true),
  ].join("\n");

  assertEquals(parseClaudeJsonl([main, sub]), {
    files: 2,
    models: ["claude-haiku-5-5", "claude-sonnet-5-5"],
    api_calls: 2,
    input: 150,
    output: 25,
    cache_read: 20,
    cache_write: 10,
    input_total: 180,
    cache_hit_rate: 20 / 180,
    tool_results: 4,
    tool_errors: 2,
    tool_error_rate: 0.5,
  });
});

Deno.test("명령 기록은 hook 줄을 빼고 시각순으로 읽고 PermissionRequest hook만 센다", () => {
  const text = [
    "2026-10-18T00:00:03Z\tmessage\tsend\tagt_1",
    "2026-10-18T00:00:01Z\thook\tclaude\tPermissionRequest",
    "2026-10-18T00:00:02Z\tticket\treport\t",
    "2026-10-18T00:00:04Z\thook\tclaude\tStop",
    "2026-10-18T00:00:05Z\tversion\t--json\t",
    "깨진 줄",
    "",
  ].join("\n");
  assertEquals(parseCommandLog(text), [
    { at: "2026-10-18T00:00:02Z", name: "ticket report" },
    { at: "2026-10-18T00:00:03Z", name: "message send" },
    { at: "2026-10-18T00:00:05Z", name: "version" },
  ]);
  assertEquals(countHook(text, "PermissionRequest"), 1);
});
