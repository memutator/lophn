import { assertEquals } from "@std/assert";
import type { Participant } from "../types.ts";
import { noOtherCallAfterFailedCall } from "./calls.ts";
import { fixtureSession, fixtureTrial, type FxStep } from "./fixtures.ts";

const lophn: Participant = { role: "lophn" };
const book: Participant = {
  role: "project_manager",
  place: { project: "ledger-project" },
};
const todo: Participant = {
  role: "project_manager",
  place: { project: "todo-project" },
};
const tax: Participant = { role: "project_manager", place: { project: "tax" } };

const send = (
  to: Participant,
  fail?: "denied" | "not_allowed" | "closed",
): FxStep => ({
  call: { to, reply: "result", fail },
});

const check = noOtherCallAfterFailedCall("c", { target: book });
const run = async (steps: FxStep[]) =>
  (await check.run({
    trial: fixtureTrial([fixtureSession(lophn, steps)]),
    core: null,
  })).pass;

Deno.test("실패한 call 뒤에 다른 agent로 가는 call만 떨어진다", async () => {
  const table: [string, FxStep[], boolean][] = [
    ["grant로 막힌 뒤 다른 project", [send(book, "denied"), send(todo)], false],
    [
      "배달 실패(not_allowed) 뒤 PM",
      [send(book, "not_allowed"), send(tax)],
      false,
    ],
    [
      "배달 실패(closed) 뒤 다른 project",
      [send(book, "closed"), send(todo)],
      false,
    ],
    [
      "막힌 뒤 같은 대상에 다시",
      [send(book, "denied"), send(book, "denied")],
      true,
    ],
    ["실패 전의 다른 call", [send(todo), send(book, "denied")], true],
    ["실패가 없음", [send(todo), send(tax)], true],
    ["다른 대상으로 간 실패는 target이 아니면 안 본다", [
      send(todo, "denied"),
      send(tax),
    ], true],
  ];
  for (const [name, steps, pass] of table) {
    assertEquals(await run(steps), pass, name);
  }
});
