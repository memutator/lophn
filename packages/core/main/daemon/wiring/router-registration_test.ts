import { assertEquals } from "@std/assert";
import { callGate } from "./router-registration.ts";

const SENDER = "ses_0000000000000000000000000a";
const LOPHN = { role: "lophn" } as const;
const TARGET = {
  role: "project_manager",
  project: "prj_0000000000000000000000000a",
} as never;

function gateWith(grant: "ask" | "none") {
  const entries = JSON.stringify(
    grant === "ask" ? [{ kind: "agent", agent: TARGET, setting: "ask" }] : [],
  );
  const sql = { get: () => ({ entries }) } as never;
  return callGate(sql, () => LOPHN as never);
}

// ToolGate가 허락한 표시는 묻는 grant만 연다. deny grant는 표시가 있어도 막힌다.
Deno.test("gate_allowed opens only an asking grant", () => {
  const from = { kind: "agent", session: SENDER } as never;
  assertEquals(gateWith("ask").authorize(from, TARGET, false).ok, false);
  assertEquals(gateWith("ask").authorize(from, TARGET, true).ok, true);
  assertEquals(gateWith("none").authorize(from, TARGET, true).ok, false);
});
