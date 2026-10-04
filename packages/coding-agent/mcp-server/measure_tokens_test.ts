// discovery schema의 token 수를 재는 배포 테스트다(R4). tokenizer는 저장소가 고정한
// js-tiktoken 1.0.21의 cl100k_base encoding이다(이유는 docs/dev/stack.md의 의존성
// 목록). 2,000 token 목표(R4)는 전체 toolset 대상이고, schema만 줄여서는 못 미치므로
// 전·후 수치와 남은 차이는 docs/plan/coding-agent.md의 T11 블록과 "## 질문"에 남는다.
import { assertEquals } from "@std/assert";
import { Tiktoken } from "js-tiktoken";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";
import {
  findTool,
  inputSchema,
  STATIC_TOOLS,
  toolEntries,
} from "./registry.ts";

// 고정 tokenizer다. cl100k_base ranks로 encoding해 token 수를 잰다.
const tokenizer = new Tiktoken(cl100k_base);

function measureTokens(json: string): { tokens: number; bytes: number } {
  return {
    tokens: tokenizer.encode(json).length,
    bytes: new TextEncoder().encode(json).length,
  };
}

const ALL_TOOLSETS = STATIC_TOOLS.map((tool) => tool.toolset);

Deno.test(
  "coding-agent/mcp-server#R4: 전체 discovery schema는 실제 tokenizer로 재측정한다",
  () => {
    const json = JSON.stringify(toolEntries(ALL_TOOLSETS));
    const { tokens, bytes } = measureTokens(json);
    // 전(원본 toJSONSchema) 12,268 token / 43,393 bytes.
    // 후(strip + union 펴기) 이번 줄인 schema다. 2,000 token 목표에는 못 미치므로
    // 남은 차이와 다음 수단은 계획 "## 질문"에 있다.
    console.log(
      `MCP 전체 discovery schema: ${tokens} token (${bytes} bytes, 2,000 token 목표)`,
    );
    assertEquals(bytes > 0, true);
  },
);

Deno.test(
  "coding-agent/mcp-server#R4: 기본 core discovery는 전체보다 작다",
  () => {
    // 기본 core만 켠 discovery가 전체 tool보다 작은지 본다(R3).
    const core = JSON.stringify(toolEntries(["core"]));
    const whole = JSON.stringify(toolEntries(ALL_TOOLSETS));
    assertEquals(
      measureTokens(core).tokens < measureTokens(whole).tokens,
      true,
    );
    const { tokens, bytes } = measureTokens(core);
    console.log(`MCP core discovery: ${tokens} token (${bytes} bytes)`);
  },
);

Deno.test(
  "coding-agent/mcp-server#R4: discovery schema는 minified UTF-8 JSON이다",
  () => {
    // 발견 schema는 toJSONSchema output을 strip·폈기 때문에 minified UTF-8 JSON인지 본다(R4).
    const read = findTool("lophn_read");
    const schema = JSON.stringify(inputSchema(read!.input));
    assertEquals(schema.startsWith("{"), true);
    assertEquals(schema.includes('", "'), false);
    assertEquals(schema.includes(": "), false);
  },
);

Deno.test(
  "coding-agent/mcp-server#R4: 편 union의 discriminator enum은 literal 목록이다",
  () => {
    // op·kind union을 편 뒤 discriminator의 enum은 literal string 목록이어야 한다(R4).
    // JSON Schema enum 항목은 literal이고 property schema를 넣으면 유효 입력이 거절된다.
    const entries = toolEntries(["core"]);
    const index = entries.find((entry) => entry.name === "lophn_index")!;
    const schema = index.inputSchema as {
      properties: Record<string, { enum?: unknown[] }>;
    };
    const opEnum = schema.properties.op.enum!;
    assertEquals(opEnum.length > 0, true);
    assertEquals(opEnum.every((item) => typeof item === "string"), true);
    // 유효 op literal이 enum에 살아 있어야 한다(거절되지 않는다).
    assertEquals(index.description.includes("index"), true);
    assertEquals(
      opEnum.every((item) => index.description.includes(item as string)),
      true,
    );
  },
);
