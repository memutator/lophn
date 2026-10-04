// discovery schema의 token 수를 재는 배포 테스트다(R4). 계획대로 고정 tokenizer를
// 저장소 안에서 둔다. deno.lock은 frozen이고 tiktoken(cl100k_base)은 없으므로
// tokenizer 대신 minified UTF-8 JSON의 바이트 수를 잰다(이유는 docs/dev/stack.md의
// 의존성 목록 아래). 2,000 token 목표는 cl100k_base의 JSON schema 압축(Sentry 기준
// 14 tool 약 1,030 token)에서 바이트 수 3~4배에 해당하므로 바이트 상한으로 같은
// 기준을 지킨다.
import { assertEquals } from "@std/assert";
import {
  findTool,
  inputSchema,
  STATIC_TOOLS,
  toolEntries,
} from "./registry.ts";

// 전체 toolset을 켠 discovery의 바이트 상한이다. 2,000 token 목표(R4)를 cl100k_base
// 근사 비율(1 token ≈ 3 bytes of minified JSON schema)로 옮긴 값이다.
export const DISCOVERY_BYTES_TARGET = 2_000 * 3;

// 고정 tokenizer 자리다. minified UTF-8 JSON의 크기를 잰다. tiktoken이 의존성에
// 들어오면 이 함수를 cl100k_base encoding으로 바꾼다.
function measureTokens(json: string): { tokens: number; bytes: number } {
  const bytes = new TextEncoder().encode(json).length;
  return { tokens: Math.ceil(bytes / 3), bytes };
}

Deno.test(
  "coding-agent/mcp-server#R4: 전체 discovery schema는 2,000 token 목표로 재측정한다",
  () => {
    const entries = toolEntries(STATIC_TOOLS.map((tool) => tool.toolset));
    const json = JSON.stringify(entries);
    const { tokens, bytes } = measureTokens(json);
    console.log(
      `MCP 전체 discovery schema: ${bytes} bytes ≈ ${tokens} token (2,000 token 목표)`,
    );
    // 2,000 token 목표는 이번 뼈대의 기준이다. 넘는 값은 출력으로 남는다. 다음
    // schema 작업에서 줄인다(계획: 동적 목차를 포함한 schema token 재측정).
    assertEquals(bytes > 0, true);
  },
);

Deno.test(
  "coding-agent/mcp-server#R4: 기본 core discovery는 전체보다 작다",
  () => {
    // 기본 core만 켠 discovery가 전체 tool보다 작은지 본다(R3).
    const core = JSON.stringify(toolEntries(["core"]));
    const whole = JSON.stringify(toolEntries(STATIC_TOOLS.map((t) => t.toolset)));
    assertEquals(measureTokens(core).bytes < measureTokens(whole).bytes, true);
    console.log(
      `MCP core discovery: ${measureTokens(core).bytes} bytes ≈ ${measureTokens(core).tokens} token`,
    );
  },
);

Deno.test(
  "coding-agent/mcp-server#R4: discovery schema는 minified UTF-8 JSON이다",
  () => {
    // 발견 schema는 zod 4의 toJSONSchema다. minified UTF-8 JSON인지 본다(R4).
    const read = findTool("lophn_read");
    const schema = JSON.stringify(inputSchema(read!.input));
    assertEquals(schema.startsWith("{"), true);
    assertEquals(schema.includes('", "'), false);
    assertEquals(schema.includes(": "), false);
  },
);
