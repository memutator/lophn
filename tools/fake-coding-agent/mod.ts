// 테스트가 쓰는 진입점. MCP client script로 lophn-mcp에 줄 단위 JSON-RPC를 보낸다.
// ticket show·claim·claim 반납(op release)·report와 app tool 호출은
// startFakeCodingAgent가 받은 step 순서대로 돈다(T20, T25). 수리 순서
// (claim → summary·bundle·more → reproduction → record_fix → lophn_app
// release_prepare → report)는 repair.ts가 응답을 보고 만든다.
import type { JsonRpcResponse } from "../../packages/coding-agent/mcp-server/mod.ts";

export type FakeAgentStep =
  | { kind: "show"; ticket: string }
  | { kind: "claim"; ticket: string; base_revision: string }
  | { kind: "app_tool"; tool: string; input: Record<string, unknown> }
  | {
    kind: "release";
    ticket: string;
    claim_seq: string;
    base_revision: string;
  }
  | {
    // 완료 보고다(coding-agent#T25). summary 본문은 lophn_ticket이 upload_summary로 올리고 준비 참조로
    // 보고한다. completion seq는 입력이 아니다.
    kind: "report";
    ticket: string;
    claim_seq: string;
    base_revision: string;
    release: string;
    summary: string;
    outputs?: string[];
    fix_records?: string[];
    verifications?: string[];
  }
  | {
    kind: "summary" | "bundle";
    selector: { ticket: string } | { problem: string };
  }
  | {
    // evidence는 lophn_problem more의 kind다. step 이름 kind와 겹치지 않게 둔다.
    kind: "more";
    problem: string;
    evidence: string;
    source: string;
    cursor?: string | null;
  }
  | { kind: "problem_show"; problem: string }
  | {
    kind: "reproduction" | "record_fix" | "release_prepare";
    body: Record<string, unknown>;
  };

export type FakeAgentResult = {
  steps: {
    step: FakeAgentStep;
    response: JsonRpcResponse | undefined;
  }[];
  claim_seq: string | null;
  release_state: string | null;
  // report 결과의 단계들이다. 완료 주장·보고 접수·확인 상태를 따로 남긴다.
  report_state: string | null;
  completion_seq: string | null;
  check_state: string | null;
};

export type FakeAgentCall = {
  step: FakeAgentStep;
  tool: string;
  input: Record<string, unknown>;
  response: JsonRpcResponse | undefined;
  isError: boolean;
  summary: string | null;
  data: Record<string, unknown>;
  code: string | null;
};

export type FakeAgentSession = {
  call(step: FakeAgentStep): Promise<FakeAgentCall>;
  close(): Promise<void>;
};

type SessionOptions = {
  command: string;
  args: readonly string[];
  env?: Record<string, string>;
  cwd?: string;
  protocolVersion?: string;
  label?: string;
};

type Child = {
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill(signal: Deno.Signal): void;
  status: Promise<number>;
};

// stdout 한 줄. 한 chunk에 줄이 여러 개면 남은 바이트를 다음 읽기에 남긴다.
class LineReader {
  #reader: ReadableStreamDefaultReader<Uint8Array>;
  #decoder = new TextDecoder();
  #pending = "";

  constructor(stdout: ReadableStream<Uint8Array>) {
    this.#reader = stdout.getReader();
  }

  async readLine(): Promise<string> {
    while (true) {
      const index = this.#pending.indexOf("\n");
      if (index >= 0) {
        const line = this.#pending.slice(0, index);
        this.#pending = this.#pending.slice(index + 1);
        return line;
      }
      const { done, value } = await this.#reader.read();
      if (done) throw new Error("lophn-mcp stdout이 닫혔다");
      this.#pending += this.#decoder.decode(value, { stream: true });
    }
  }
}

// 한 줄을 쓴다. stdio transport는 줄 단위 JSON-RPC다.
async function writeLine(
  stdin: WritableStream<Uint8Array>,
  text: string,
): Promise<void> {
  const writer = stdin.getWriter();
  await writer.write(new TextEncoder().encode(text + "\n"));
  writer.releaseLock();
}

// 툴 응답의 structuredContent만 해석한다. text는 structuredContent와 같은 사실이다.
function structuredOf(response: JsonRpcResponse | undefined): unknown {
  const result = (response?.result ?? {}) as {
    structuredContent?: unknown;
  };
  return result.structuredContent ?? {};
}

// 실제 lophn-mcp는 {summary, data, next}다. 값은 data 안에 있다. 테스트 double의
// 평평한 claim·release 응답은 structuredContent 자체다.
function payloadOf(
  response: JsonRpcResponse | undefined,
): Record<string, unknown> {
  const structured = structuredOf(response);
  if (typeof structured !== "object" || structured === null) return {};
  const record = structured as Record<string, unknown>;
  const data = record.data;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return record;
}

function summaryOf(response: JsonRpcResponse | undefined): string | null {
  const structured = structuredOf(response);
  if (typeof structured !== "object" || structured === null) return null;
  const summary = (structured as { summary?: unknown }).summary;
  return typeof summary === "string" ? summary : null;
}

// stdio 자식을 띄우고 initialize까지 끝낸 session이다. step은 호출자가 하나씩 보낸다.
// stdout 첫 줄 이후 JSON-RPC만 읽는다. 사람 데이터 root는 열지 않는다.
export async function openFakeCodingAgentSession(
  options: SessionOptions,
): Promise<FakeAgentSession> {
  const child = new Deno.Command(options.command, {
    args: [...options.args],
    env: options.env,
    cwd: options.cwd,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn() as unknown as Child;
  const drained = (async () => {
    for await (const _chunk of child.stderr) {
      // 진단은 버린다. protocol 통로는 stdout뿐이다.
    }
  })();
  const lines = new LineReader(child.stdout);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      child.kill("SIGTERM");
    } catch {
      // 이미 끝났으면 조용히 넘어간다.
    }
    await child.status.catch(() => {});
    await drained.catch(() => {});
  };
  try {
    // initialize는 프로토콜 시작이다. notification이 아니라 id 있는 요청이다.
    await writeLine(
      child.stdin,
      JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: options.protocolVersion ?? "2025-06-18",
          clientInfo: { name: options.label ?? "lophn-fake-coding-agent" },
        },
      }),
    );
    await lines.readLine();
  } catch (error) {
    await close();
    throw error;
  }
  let nextId = 1;
  return {
    async call(step) {
      const called = callOf(step);
      const id = nextId;
      nextId += 1;
      await writeLine(
        child.stdin,
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: called.tool, arguments: called.input },
        }),
      );
      const line = await lines.readLine();
      let response: JsonRpcResponse | undefined;
      try {
        response = JSON.parse(line) as JsonRpcResponse;
      } catch {
        response = undefined;
      }
      const result = (response?.result ?? {}) as { isError?: unknown };
      const data = payloadOf(response);
      const code = data.code;
      return {
        step,
        tool: called.tool,
        input: called.input,
        response,
        isError: result.isError === true,
        summary: summaryOf(response),
        data,
        code: typeof code === "string" ? code : null,
      };
    },
    close,
  };
}

// stdio로 lophn-mcp 자식 process를 띄우고 줄 단위 JSON-RPC로 돌린다.
// initialize로 붙은 뒤 step 순서대로 tools/call을 보내고, step 결과의
// structuredContent를 그대로 남긴다.
export async function startFakeCodingAgent(
  options: SessionOptions & { steps: readonly FakeAgentStep[] },
): Promise<FakeAgentResult> {
  let claimSeq: string | null = null;
  let releaseState: string | null = null;
  let reportState: string | null = null;
  let completionSeq: string | null = null;
  let checkState: string | null = null;
  const session = await openFakeCodingAgentSession(options);
  try {
    const emitted: FakeAgentResult["steps"] = [];
    for (const step of options.steps) {
      const called = await session.call(step);
      emitted.push({ step, response: called.response });
      const content = called.data as {
        claim_seq?: unknown;
        state?: unknown;
        report?: { accepted?: unknown; state?: unknown };
        completion_claim?: { completion_seq?: unknown };
        check?: { state?: unknown };
      };
      if (step.kind === "claim" && typeof content.claim_seq === "string") {
        claimSeq = content.claim_seq;
      }
      if (step.kind === "release" && typeof content.state === "string") {
        releaseState = content.state;
      }
      if (step.kind === "report") {
        if (
          content.report?.accepted === true &&
          typeof content.report.state === "string"
        ) {
          reportState = content.report.state;
        }
        const seq = content.completion_claim?.completion_seq;
        if (typeof seq === "string") completionSeq = seq;
        if (typeof content.check?.state === "string") {
          checkState = content.check.state;
        }
      }
    }
    return {
      steps: emitted,
      claim_seq: claimSeq,
      release_state: releaseState,
      report_state: reportState,
      completion_seq: completionSeq,
      check_state: checkState,
    };
  } finally {
    await session.close();
  }
}

// step에 대응하는 tools/call name·arguments다.
function callOf(step: FakeAgentStep): {
  tool: string;
  input: Record<string, unknown>;
} {
  switch (step.kind) {
    case "show":
      return {
        tool: "lophn_ticket",
        input: { op: "show", ticket: step.ticket },
      };
    case "claim":
      return {
        tool: "lophn_ticket",
        input: {
          op: "claim",
          ticket: step.ticket,
          base_revision: step.base_revision,
        },
      };
    case "app_tool":
      return { tool: step.tool, input: step.input };
    case "release":
      return {
        tool: "lophn_ticket",
        input: {
          op: "release",
          ticket: step.ticket,
          claim_seq: step.claim_seq,
          base_revision: step.base_revision,
        },
      };
    case "report":
      return {
        tool: "lophn_ticket",
        input: {
          op: "report",
          ticket: step.ticket,
          claim_seq: step.claim_seq,
          base_revision: step.base_revision,
          release: step.release,
          summary: step.summary,
          ...(step.outputs === undefined ? {} : { outputs: step.outputs }),
          ...(step.fix_records === undefined
            ? {}
            : { fix_records: step.fix_records }),
          ...(step.verifications === undefined
            ? {}
            : { verifications: step.verifications }),
        },
      };
    case "summary":
    case "bundle":
      return {
        tool: "lophn_problem",
        input: { op: step.kind, selector: step.selector },
      };
    case "more":
      return {
        tool: "lophn_problem",
        input: {
          op: "more",
          problem: step.problem,
          kind: step.evidence,
          source: step.source,
          ...(step.cursor === undefined ? {} : { cursor: step.cursor }),
        },
      };
    case "problem_show":
      return {
        tool: "lophn_problem",
        input: { op: "show", problem: step.problem },
      };
    case "reproduction":
      return {
        tool: "lophn_problem",
        input: { ...step.body, op: "test" },
      };
    case "record_fix":
      return {
        tool: "lophn_problem",
        input: { ...step.body, op: "record_fix" },
      };
    case "release_prepare":
      // ticket op release(claim 반납)와 다르다. release 준비는 lophn_app이다.
      return {
        tool: "lophn_app",
        input: { ...step.body, op: "release_prepare" },
      };
  }
}

export type { JsonRpcResponse };
