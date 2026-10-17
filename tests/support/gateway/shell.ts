// shell main이 하는 일을 route 호출로 옮긴 helper다. PTY와 실행 파일 실행은 없다.
import {
  codingTerminalExited,
  type CodingTerminalRequest,
  codingTerminalResult,
  type HarnessId,
  harnessReport,
} from "../../../packages/protocol/coding-agent/mod.ts";
import type { Core } from "../core/mod.ts";
import type { Gateway } from "./mod.ts";

export type CodingLaunchPlan = Extract<
  CodingTerminalRequest,
  { kind: "open" }
>["plan"];

// detection 하나를 알린다. 실행 파일은 실제로 실행되지 않으므로 경로는 가짜 절대 경로다.
export async function reportHarness(
  core: Core,
  harness: HarnessId = "claude",
): Promise<void> {
  const path = `/e2e/bin/${harness}`;
  await core.call(harnessReport, {
    detections: [{
      harness_id: harness,
      observed_at: new Date().toISOString(),
      discovery: "detected",
      candidates: [{ path, source: "e2e", executable_result: "ok" }],
      selected_executable: path,
      version: { result: "verified", value: "1.0.0", reason: null },
      auth: { result: "verified", evidence: "e2e", reason: null },
      probe_results: [],
    }],
  });
}

// core가 보낸 `open` 요청 하나를 기다린다.
export async function waitCodingTerminal(
  gateway: Gateway,
): Promise<{ request: string; plan: CodingLaunchPlan }> {
  const frame = await gateway.next(
    "coding_terminal",
    (item) => item.request.kind === "open",
  );
  const { request } = frame;
  if (request.kind !== "open") throw new Error("open 요청이 아니다");
  return { request: request.request, plan: request.plan };
}

export async function answerTerminal(
  core: Core,
  request: string,
): Promise<void> {
  await core.call(codingTerminalResult, { request, ok: true });
}

export async function exitTerminal(
  core: Core,
  session: string,
  reason: "exited" | "killed" | "host_lost" = "exited",
): Promise<void> {
  await core.call(codingTerminalExited, {
    session,
    exit_code: reason === "exited" ? 0 : null,
    reason,
  });
}
