// fake coding agent 실행 테스트다(T20). 가짜 lophn-mcp로 initialize → step
// tools/call 순서를 본다. 실제 process를 띄우지 않으려고 stdin·stdout을
// 주입한다. 사람 데이터 root는 열지 않는다(worker-common).
import { assertEquals } from "@std/assert";
import { startFakeCodingAgent } from "./mod.ts";

// 줄 단위 JSON-RPC로 답하는 가짜 lophn-mcp다. initialize와 tools/call에
// structuredContent를 남긴다.
function fakeMcpScript(): string {
  return `
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const buf = new Uint8Array(0);
    let line = "";
    for await (const chunk of Deno.stdin.readable) {
      line += decoder.decode(chunk, { stream: true });
      const index = line.indexOf("\\n");
      if (index < 0) continue;
      const text = line.slice(0, index);
      line = line.slice(index + 1);
      const request = JSON.parse(text);
      if (request.method === "initialize") {
        await Deno.stdout.write(
          encoder.encode(JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: { protocolVersion: "2025-06-18" },
          }) + "\\n"),
        );
        continue;
      }
      if (request.method === "tools/call") {
        const op = request.params?.arguments?.op ?? "";
        const claims = { claim: { ticket: request.params.arguments.ticket, connection: "cac", claim_seq: "12", expires_at: "e" } };
        const reported = {
          ticket: request.params.arguments.ticket,
          completion_claim: { claimed: true, completion_seq: "21", summary: request.params.arguments.summary },
          report: { accepted: true, state: "reported" },
          check: { state: "pending" },
        };
        const flat = op === "claim" ? claims.claim : { ticket: request.params.arguments.ticket, state: "open" };
        // 실제 lophn-mcp는 {summary, data, next}를 structuredContent로 낸다. report는 그 모양이다.
        const content = op === "report" ? { summary: "report", data: reported, next: [] } : flat;
        await Deno.stdout.write(
          encoder.encode(JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              structuredContent: content,
              content: [{ type: "text", text: JSON.stringify(content) }],
            },
          }) + "\\n"),
        );
        continue;
      }
    }
  `;
}

Deno.test(
  "coding-agent#T20: fake coding agent는 initialize → tools/call 순서로 돌린다",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const script = `${dir}/fake-mcp.ts`;
      await Deno.writeTextFile(script, fakeMcpScript());
      const result = await startFakeCodingAgent({
        command: Deno.execPath(),
        args: ["run", "--allow-all", script],
        steps: [
          { kind: "show", ticket: "tkt_x" },
          { kind: "claim", ticket: "tkt_x", base_revision: "11" },
          {
            kind: "release",
            ticket: "tkt_x",
            claim_seq: "12",
            base_revision: "12",
          },
        ],
      });
      assertEquals(result.steps.length, 3);
      assertEquals(result.claim_seq, "12");
      assertEquals(result.release_state, "open");
      assertEquals(result.report_state, null);
      // 각 step의 응답은 structuredContent를 그대로 가진다.
      const claimResponse = result.steps[1].response as {
        result?: { structuredContent?: { claim_seq?: string } };
      };
      assertEquals(claimResponse.result?.structuredContent?.claim_seq, "12");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "coding-agent#T25: fake coding agent는 report step으로 summary·release를 보내고 완료 주장·접수·확인 상태를 따로 남긴다",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const script = `${dir}/fake-mcp.ts`;
      await Deno.writeTextFile(script, fakeMcpScript());
      const result = await startFakeCodingAgent({
        command: Deno.execPath(),
        args: ["run", "--allow-all", script],
        steps: [
          { kind: "claim", ticket: "tkt_x", base_revision: "11" },
          {
            kind: "report",
            ticket: "tkt_x",
            claim_seq: "12",
            base_revision: "12",
            release: "rel_x",
            summary: "변경 요약",
            verifications: ["vrf_x"],
          },
        ],
      });
      assertEquals(result.claim_seq, "12");
      assertEquals(result.report_state, "reported");
      assertEquals(result.completion_seq, "21");
      assertEquals(result.check_state, "pending");
      // 보낸 인자에는 completion seq가 없고 summary·release가 있다.
      const response = result.steps[1].response as {
        result?: {
          structuredContent?: {
            data?: { completion_claim?: { summary?: string } };
          };
        };
      };
      assertEquals(
        response.result?.structuredContent?.data?.completion_claim?.summary,
        "변경 요약",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);
