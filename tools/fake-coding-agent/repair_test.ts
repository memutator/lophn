// 수리 script의 호출 순서(coding-agent#T47). 가짜 lophn-mcp로 claim 응답의
// claim_seq·summary의 problem seq·record_fix seq가 다음 입력에 들어가는지 본다.
// 사람 데이터 root는 열지 않는다.
import { assertEquals } from "@std/assert";
import { REPAIR_STAGES, runRepairScript } from "./repair.ts";

const TICKET = "tkt_01arz3ndektsv4rrffq69g5fav";
const PROBLEM = "prb_01arz3ndektsv4rrffq69g5fav";
const BEFORE = "rel_01arz3ndektsv4rrffq69g5fa1";
const RELEASE = "rel_01arz3ndektsv4rrffq69g5fa2";
const BUNDLE = "b".repeat(64);
const TEST = "9".repeat(64);
const SUMMARY = "변경: leaf redaction\n";

function fakeMcpScript(): string {
  return `
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const deny = Deno.env.get("LOPHN_FAKE_REPAIR") === "deny";
    let pending = "";
    const problem = ${JSON.stringify(PROBLEM)};
    function send(id, result) {
      return Deno.stdout.write(encoder.encode(JSON.stringify({
        jsonrpc: "2.0",
        id,
        result,
      }) + "\\n"));
    }
    function wrapped(data, isError) {
      const body = { summary: isError ? "거절" : "ok", data, next: ["next"] };
      return {
        structuredContent: body,
        content: [{ type: "text", text: JSON.stringify(body) }],
        ...(isError ? { isError: true } : {}),
      };
    }
    for await (const chunk of Deno.stdin.readable) {
      pending += decoder.decode(chunk, { stream: true });
      while (true) {
        const index = pending.indexOf("\\n");
        if (index < 0) break;
        const text = pending.slice(0, index);
        pending = pending.slice(index + 1);
        if (text.trim() === "") continue;
        const request = JSON.parse(text);
        if (request.method === "initialize") {
          await send(request.id, { protocolVersion: "2025-06-18" });
          continue;
        }
        const name = request.params?.name;
        const args = request.params?.arguments ?? {};
        const op = args.op;
        if (op === "claim" && deny) {
          await send(request.id, wrapped({ code: "not_found" }, true));
          continue;
        }
        if (op === "claim") {
          await send(request.id, wrapped({
            ticket: args.ticket,
            connection: "cac_01arz3ndektsv4rrffq69g5fav",
            claim_seq: "12",
            expires_at: "2026-10-09T00:00:00.000Z",
          }, false));
          continue;
        }
        if (name === "lophn_ticket" && op === "show") {
          await send(request.id, wrapped({ ticket: { revision: "12" } }, false));
          continue;
        }
        if (op === "summary") {
          await send(request.id, wrapped({
            summary: { problems: [{ id: problem, seq: "4" }] },
          }, false));
          continue;
        }
        if (op === "bundle") {
          await send(request.id, wrapped({
            context: {
              bytes: 20,
              lines: 4,
              sections: [
                { kind: "target_symptom", more: null },
                {
                  kind: "more",
                  more: [{
                    problem,
                    kind: "log",
                    source: "problem:" + problem,
                    cursor: null,
                  }],
                },
                { kind: "return_method", more: null },
              ],
            },
          }, false));
          continue;
        }
        if (op === "more") {
          await send(request.id, wrapped({
            problem: args.problem,
            kind: args.kind,
            source: args.source,
            missing: { reason: "page" },
          }, false));
          continue;
        }
        if (name === "lophn_problem" && op === "show") {
          await send(request.id, wrapped({ problem: { seq: "4" } }, false));
          continue;
        }
        if (op === "test") {
          await send(request.id, wrapped({
            code: "conflict",
            state: "rejected",
            real_test: false,
          }, true));
          continue;
        }
        if (op === "record_fix") {
          await send(request.id, wrapped({ recorded: true, seq: "30" }, false));
          continue;
        }
        if (op === "release_prepare") {
          await send(request.id, wrapped({
            code: "unavailable",
            prepared_release: false,
          }, true));
          continue;
        }
        if (op === "report") {
          await send(request.id, wrapped({
            report: { accepted: true, state: "reported" },
            completion_claim: { completion_seq: "21" },
            check: { state: "pending" },
          }, false));
          continue;
        }
        await send(request.id, wrapped({ code: "invalid_input", op }, true));
      }
    }
  `;
}

async function run(env?: Record<string, string>) {
  const dir = await Deno.makeTempDir({ prefix: "lophn-fake-repair-" });
  const home = await Deno.makeTempDir({ prefix: "lophn-fake-repair-home-" });
  try {
    const script = `${dir}/fake-mcp.ts`;
    await Deno.writeTextFile(script, fakeMcpScript());
    return await runRepairScript({
      command: Deno.execPath(),
      args: ["run", "--allow-all", script],
      env: {
        PATH: Deno.env.get("PATH") ?? "",
        HOME: home,
        ...(Deno.env.get("DENO_DIR")
          ? { DENO_DIR: Deno.env.get("DENO_DIR")! }
          : {}),
        ...env,
      },
      ticket: TICKET,
      base_revision: "11",
      app: "app_01arz3ndektsv4rrffq69g5fav",
      problem: PROBLEM,
      before: BEFORE,
      release: RELEASE,
      bundle_hash: BUNDLE,
      reports: ["rpt_01arz3ndektsv4rrffq69g5f01"],
      basis_seq: "1",
      test: TEST,
      summary: SUMMARY,
      commit: "a".repeat(40),
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
}

Deno.test(
  "coding-agent/repair-context#R3 coding-agent/tickets#R11 coding-agent/tickets#R15: 수리 script는 claim 다음 summary·bundle·more·reproduction·record_fix·release 준비·report로 현재 claim을 잇는다",
  async () => {
    const result = await run();
    assertEquals(result.stages, [...REPAIR_STAGES]);
    assertEquals(result.halted_before, null);
    assertEquals(result.claim_seq, "12");
    assertEquals(result.problem_seq, "4");
    assertEquals(result.fix_seq, "30");
    assertEquals(result.report_state, "reported");
    assertEquals(result.completion_seq, "21");
    assertEquals(
      result.steps.map((step) => `${step.tool}:${step.op}`),
      [
        "lophn_ticket:claim",
        "lophn_problem:summary",
        "lophn_problem:bundle",
        "lophn_problem:more",
        "lophn_problem:test",
        "lophn_problem:show",
        "lophn_problem:record_fix",
        "lophn_app:release_prepare",
        "lophn_ticket:show",
        "lophn_ticket:report",
      ],
    );
    const reproduction = result.steps[4].input;
    assertEquals(reproduction.ticket, null);
    assertEquals(reproduction.ticket_source, {
      ticket: TICKET,
      claim_seq: "12",
    });
    assertEquals(reproduction.kind, "reproduction");
    assertEquals(result.steps[4].isError, true);
    assertEquals(result.steps[4].data.state, "rejected");
    const fix = result.steps[6].input;
    assertEquals(fix.problem_seq, "4");
    assertEquals(fix.fix, {
      before: BEFORE,
      after: RELEASE,
      verification: [],
      ticket: TICKET,
      claim_seq: "12",
    });
    assertEquals(
      result.steps[7].input.ticket_source,
      { ticket: TICKET, claim_seq: "12" },
    );
    assertEquals(result.steps[7].isError, true);
    assertEquals(result.steps[7].data.prepared_release, false);
    const report = result.steps[9].input;
    assertEquals(report.claim_seq, "12");
    assertEquals(report.base_revision, "12");
    assertEquals(report.release, RELEASE);
    assertEquals(report.fix_records, ["30"]);
    assertEquals(report.verifications, undefined);
    assertEquals(report.summary, SUMMARY);
    assertEquals(result.steps[3].input.kind, "log");
    assertEquals(result.steps[3].input.source, `problem:${PROBLEM}`);
  },
);

Deno.test(
  "coding-agent/tickets#R11 coding-agent/connection#R5: 수리 script는 claim이 없으면 summary·bundle·more 뒤 쓰기 전에 멈춘다",
  async () => {
    const result = await run({ LOPHN_FAKE_REPAIR: "deny" });
    assertEquals(result.stages, ["claim", "summary", "bundle", "more"]);
    assertEquals(result.halted_before, "reproduction");
    assertEquals(result.claim_seq, null);
    assertEquals(result.fix_seq, null);
    assertEquals(result.report_state, null);
    assertEquals(result.steps[0].isError, true);
    assertEquals(result.steps[0].code, "not_found");
    assertEquals(
      result.steps.map((step) => step.op),
      ["claim", "summary", "bundle", "more"],
    );
  },
);
