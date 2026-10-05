// 테스트가 쓰는 진입점. MCP client script로 lophn-mcp의 ticket tool을 돌린다:
// ticket show → claim → (app tool 호출) → release 준비 → (T25 뒤) report.
// apps 팀 new-app·change-app E2E가 coding agent 자리에 쓴다(Q10).
import type {
  JsonRpcId,
  JsonRpcResponse,
} from "../../packages/coding-agent/mcp-server/mod.ts";

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
    kind: "report";
    ticket: string;
    claim_seq: string;
    base_revision: string;
  };

export type FakeAgentResult = {
  steps: {
    step: FakeAgentStep;
    response: JsonRpcResponse | undefined;
  }[];
  claim_seq: string | null;
  release_state: string | null;
  report_state: string | null;
};

type Child = {
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill(signal: Deno.Signal): void;
  status: Promise<number>;
};

// stdout에서 한 줄(개행까지)을 읽어 문자열로 돌려준다.
async function readLine(stdout: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let line = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) throw new Error("lophn-mcp stdout이 닫혔다");
    line += decoder.decode(value, { stream: true });
    const index = line.indexOf("\n");
    if (index >= 0) {
      reader.releaseLock();
      return line.slice(0, index);
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

// stdio로 lophn-mcp 자식 process를 띄우고 줄 단위 JSON-RPC로 돌린다. stdout 첫
// 줄 이후 JSON-RPC만 읽는다. 사람 데이터 root는 열지 않는다(worker-common).
// initialize로 붙은 뒤 step 순서대로 tools/call을 보내고, step 결과의
// structuredContent를 그대로 남긴다.
export async function startFakeCodingAgent(
  options: {
    command: string;
    args: readonly string[];
    env?: Record<string, string>;
    cwd?: string;
    steps: readonly FakeAgentStep[];
    protocolVersion?: string;
    label?: string;
  },
): Promise<FakeAgentResult> {
  let claimSeq: string | null = null;
  let releaseState: string | null = null;
  let reportState: string | null = null;

  const child = new Deno.Command(options.command, {
    args: [...options.args],
    env: options.env,
    cwd: options.cwd,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const process = child.spawn() as unknown as Child;
  void (async () => {
    for await (const _chunk of process.stderr) {
      // 진단은 버린다. protocol 통로는 stdout뿐이다.
    }
  })();

  try {
    // initialize는 프로토콜 시작이다. notification이 아니라 id 있는 요청이다.
    await writeLine(
      process.stdin,
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
    await readLine(process.stdout);

    const emitted: {
      step: FakeAgentStep;
      response: JsonRpcResponse | undefined;
    }[] = [];
    for (const [index, step] of options.steps.entries()) {
      const called = callOf(step);
      await writeLine(
        process.stdin,
        JSON.stringify({
          jsonrpc: "2.0",
          id: index + 1,
          method: "tools/call",
          params: { name: called.tool, arguments: called.input },
        }),
      );
      const line = await readLine(process.stdout);
      let response: JsonRpcResponse | undefined;
      try {
        response = JSON.parse(line) as JsonRpcResponse;
      } catch {
        response = undefined;
      }
      emitted.push({ step, response });
      const content = structuredOf(response) as {
        claim_seq?: unknown;
        state?: unknown;
      };
      if (step.kind === "claim" && typeof content.claim_seq === "string") {
        claimSeq = content.claim_seq;
      }
      if (step.kind === "release" && typeof content.state === "string") {
        releaseState = content.state;
      }
      if (step.kind === "report" && typeof content.state === "string") {
        reportState = content.state;
      }
    }
    return {
      steps: emitted,
      claim_seq: claimSeq,
      release_state: releaseState,
      report_state: reportState,
    };
  } finally {
    try {
      process.kill("SIGTERM");
    } catch {
      // 이미 끝났으면 조용히 넘어간다.
    }
    await process.status.catch(() => {});
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
        },
      };
  }
}

export type { JsonRpcId, JsonRpcResponse };
