// MCP tool 결과 표현이다(architecture/coding-agent 5.1). 성공·실패·effect_unknown을
// 모두 contracts의 mcpToolResult로 만든다. Codex는 structuredContent만, Gemini CLI·
// OpenCode는 text만 model에 넣으므로 둘 다 내보내야 같은 사실이 전달된다.
import {
  type AgentFailure,
  agentResultSchema,
  type McpToolResult,
  mcpToolResult,
} from "../../protocol/coding-agent/mod.ts";
import { effectUnknownSchema } from "../../protocol/coding-agent/mod.ts";
import type { LophnError } from "../../base/mod.ts";

// 성공 domain 결과를 두 표현으로 내보낸다. summary는 본문을 담지 않는다.
export function successResult(value: {
  summary: string;
  data: unknown;
  next: string[];
}): McpToolResult {
  return mcpToolResult(agentResultSchema.parse(value));
}

// 실행 실패·범위거절·credential 실패는 isError true다. 승인 대기는
// 실패가 아니므로 여기로 오지 않는다.
export function failureResult(failure: AgentFailure): McpToolResult {
  return mcpToolResult(
    {
      // 요약은 이유 한 줄이고 진단·대상은 data에 남긴다. 본문을 summary에 중복하지 않는다.
      summary: failure.message,
      data: { code: failure.code, details: failure.details ?? {} },
      next: nextOf(failure),
    },
    true,
  );
}

// 효과 불명은 성공·domain 실패가 아니다. 원래 key와 대상 read 안내가 진단에 남고
// isError로 모델에 전달된다(exit 계약과 같은 판정).
export function effectUnknownResult(error: LophnError): McpToolResult {
  const unknown = effectUnknownSchema.safeParse(error);
  if (!unknown.success) return failureResult(error as AgentFailure);
  // details의 진단·key·대상을 data로 옮겨 두 표현 모두에 같은 뜻으로 넣는다.
  return mcpToolResult(
    {
      summary: unknown.data.message,
      data: {
        code: unknown.data.code,
        details: unknown.data.details,
      },
      next: [
        `commands/result?idempotency_key=${
          unknown.data.details["idempotency_key"]
        }`,
      ],
    },
    true,
  );
}

// 실패 뒤의 다음 read는 code에 따라 정해진다. 승인 대기·도메인 오류는 공통
// 사실 그대로를 전달한다.
function nextOf(failure: AgentFailure): string[] {
  if (failure.code === "invalid_input") {
    return ["lophn_format list 권한 확인 후 올바른 입력으로 다시 시도"];
  }
  if (failure.code === "unavailable") {
    return ["commands/result 재조회"];
  }
  return ["현재 상태 read 후 다시 시도"];
}
