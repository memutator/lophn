// fake harness의 테스트 catalog다(coding-agent#T41). 일곱 제품 배포 catalog가
// 아니다. PATH 감지 command와 ExecutionSpec 둘(argv prompt, stdin_after_ready)만
// 둔다. prompt_flag·readiness는 그 전달을 따르는 데 필요한 값이다.
import type { ExecutionSpec } from "../../packages/coding-agent/harnesses/mod.ts";

export type TestExecution = {
  execution: ExecutionSpec;
  // argv 전달에서 prompt 앞의 flag다. null이면 positional 인자 하나다.
  prompt_flag: string | null;
  // stdin_after_ready의 composer 준비 신호다. argv 전달은 null이다.
  readiness: string | null;
};

export const TEST_CATALOG: {
  command: string;
  executions: readonly TestExecution[];
} = {
  command: "fake-harness",
  executions: [
    {
      execution: {
        transport: "pty",
        launch_argv: ["fake-harness"],
        resume_argv: null,
        prompt_delivery: "argv",
        session_evidence: "hook",
        capability: "supported",
      },
      prompt_flag: null,
      readiness: null,
    },
    {
      execution: {
        transport: "pty",
        launch_argv: ["fake-harness"],
        resume_argv: null,
        prompt_delivery: "stdin_after_ready",
        session_evidence: "listing",
        capability: "supported",
      },
      prompt_flag: null,
      readiness: "fake-harness:ready\n",
    },
  ],
};
