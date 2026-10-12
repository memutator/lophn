import { err, ok, type Result } from "../../packages/base/mod.ts";
import appEngineer from "../../packages/core/lophn-agent/roles/app-engineer/prompt.md" with {
  type: "text",
};
import contextEngineer from "../../packages/core/lophn-agent/roles/context-engineer/prompt.md" with {
  type: "text",
};
import lophn from "../../packages/core/lophn-agent/roles/lophn/prompt.md" with {
  type: "text",
};
import operator from "../../packages/core/lophn-agent/roles/operator/prompt.md" with {
  type: "text",
};

// 역할 prompt 자산은 모듈에 묶어 가져온다. runtime은 `--allow-read`가 data root뿐이라 소스 폴더의
// 파일을 읽지 못하고, 자산은 core가 preset의 prompt blob으로 준비한 것과 같은 파일이다.
const ROLE_PROMPTS: ReadonlyMap<string, string> = new Map([
  ["lophn", lophn],
  ["context_engineer", contextEngineer],
  ["app_engineer", appEngineer],
  ["operator", operator],
]);

export function rolePrompt(role: string): Promise<Result<string>> {
  const text = ROLE_PROMPTS.get(role);
  return Promise.resolve(
    text === undefined
      ? err({ code: "unavailable", message: "role prompt is not available" })
      : ok(text),
  );
}

// 제품 공통 지시(prompt 층 1). 역할과 상관없이 모든 run의 맨 앞에 온다.
export const PRODUCT_INSTRUCTIONS = [
  "You are an agent inside lophn, a local workspace where a person keeps documents, projects and apps.",
  "Use only the tools you are given. Never ask for, reveal or guess secrets, tokens or credentials.",
  "Answer in the language the person writes in. Be concise and say plainly when something is not possible.",
].join("\n");
