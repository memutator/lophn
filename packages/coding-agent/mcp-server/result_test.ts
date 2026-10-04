// MCP tool 결과 표현 테스트다(R5, R7). 성공·실패·effect_unknown이 structuredContent와
// 같은 뜻의 JSON text를 둘 다 내보내는지 본다. Codex는 structuredContent만, Gemini CLI·
// OpenCode는 text만 model에 넣으므로 둘 중 무엇을 읽어도 같은 사실이어야 한다.
import { assertEquals } from "@std/assert";
import { effectUnknownResult, failureResult, successResult } from "./result.ts";

type ResultView = {
  structuredContent: { summary: string; data: unknown; next: unknown };
  content: { type: string; text: string }[];
  isError?: boolean;
};

// 두 표현이 같은 뜻인지 본다. text는 structuredContent의 JSON이다(R5).
function assertDual(result: unknown): ResultView {
  const view = result as ResultView;
  assertEquals(view.content.length, 1);
  assertEquals(view.content[0].type, "text");
  assertEquals(JSON.parse(view.content[0].text), view.structuredContent);
  return view;
}

Deno.test(
  "coding-agent/mcp-server#R5: 성공 결과는 두 표현으로 같은 뜻을 내보낸다",
  () => {
    const result = assertDual(successResult({
      summary: "3 documents",
      data: { documents: ["notes/plan"] },
      next: ["lophn document show notes/plan"],
    }));
    assertEquals(result.isError, undefined);
    assertEquals(result.structuredContent.summary, "3 documents");
    // 본문을 summary에 중복하지 않는다(R5). documents가 summary에 없다.
    assertEquals(
      result.structuredContent.summary.includes("notes/plan"),
      false,
    );
  },
);

Deno.test(
  "coding-agent/mcp-server#R7: 실행 실패는 isError와 이유·진단을 남긴다",
  () => {
    const result = assertDual(failureResult({
      code: "invalid_input",
      message: "저장 입력이 맞지 않다",
      details: { title: "제목이 빠졌다" },
    }));
    assertEquals(result.isError, true);
    // 요약은 이유 한 줄이고 진단·대상은 data에 남긴다(R6).
    assertEquals(result.structuredContent.summary, "저장 입력이 맞지 않다");
    assertEquals(result.structuredContent.data, {
      code: "invalid_input",
      details: { title: "제목이 빠졌다" },
    });
    // 다음 read가 나온다(R6).
    assertEquals(
      (result.structuredContent.next as string[]).length > 0,
      true,
    );
  },
);

Deno.test(
  "coding-agent/mcp-server#R7: effect_unknown은 isError로 두 표현에 같은 뜻으로 전달된다",
  () => {
    // 기록 직후 응답 단절이다(R7). 성공·실패를 추측하지 않는다.
    const result = assertDual(effectUnknownResult({
      code: "unavailable",
      message: "효과를 확인하지 못했다",
    }));
    assertEquals(result.isError, true);
    assertEquals(result.structuredContent.summary, "효과를 확인하지 못했다");
    // 원래 key와 대상 read 안내가 진단에 남는다(R5, exit 계약과 같은 판정).
    assertEquals(
      (result.structuredContent.next as string[]).some((read) =>
        read.startsWith("commands/result")
      ),
      true,
    );
  },
);

Deno.test(
  "coding-agent/mcp-server#R7: effect_unknown이 아니면 실패로 전달된다",
  () => {
    // effect_unknown 모양이 아니면 실패 표현으로 간다. 표가 틀린 값을 숨기지 않는다.
    const result = assertDual(effectUnknownResult({
      code: "not_found",
      message: "문서가 없다",
    }));
    assertEquals(result.isError, true);
    assertEquals(result.structuredContent.summary, "문서가 없다");
    assertEquals(
      (result.structuredContent.data as { code?: string }).code,
      "not_found",
    );
  },
);
