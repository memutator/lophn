import type { SafeReportDetails } from "@lophn/protocol/problems/sdk-report";
import type { ProblemReportCall } from "@lophn/protocol/problems/sdk-problem";

// cap-tool이 놓는 port와 같은 symbol이다. SDK는 cap-tool을 import하지 않고 invocation만 읽는다.
const APP_TOOL_PORT = Symbol.for("lophn.cap-tool");

function currentInvocation(): string | undefined {
  const port = (globalThis as Record<symbol, unknown>)[APP_TOOL_PORT] as
    | { current?: () => { invocation?: string } | null }
    | undefined;
  return port?.current?.()?.invocation;
}

function detailsText(details: SafeReportDetails): string {
  try {
    return JSON.stringify(details) ?? String(details);
  } catch {
    return String(details);
  }
}

// 앱 log에 `error <name>[: <message>][ <details JSON>]` 한 줄을 쓴다. stderr 한 줄이 log 한 줄이므로
// 줄바꿈은 공백으로 바꾼다. redaction과 자르기는 supervisor의 log writer가 한다.
export const reportProblem: ProblemReportCall = (name, message, details) => {
  try {
    let line = `error ${name}`;
    if (typeof message === "string" && message !== "") line += `: ${message}`;
    if (details !== undefined) line += ` ${detailsText(details)}`;
    line = line.replace(/[\r\n]/g, " ");
    const invocation = currentInvocation();
    console.error(invocation ? `[inv=${invocation}] ${line}` : line);
  } catch {
    // 보고가 업무 흐름을 깨지 않는다.
  }
};
