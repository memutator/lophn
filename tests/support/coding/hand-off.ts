// Project Manager가 ticket을 만들거나 coding agent에게 맡기는 준비다. `handOff`(터미널이 열리는 데까지)는
// `tests/support/app/activate.ts`가 내놓고, 여기에는 그것이 못 하는 두 가지만 둔다: ticket만 만들기, 줄에 서는 맡기기.
//
// Project Manager의 fake 대답은 session 하나의 줄(lane)로 건다. 줄 이름과 match는 activate.ts의 `aeLane`이라, 같은 앱의
// 앞 맡기기가 건 줄의 queue를 대체한다. tool call id는 맡기기마다 다르게 둔다: 같은 session에서 id가 겹치면 `call`의
// dedup(보낸 session + tool call id)과 `ticket_create`의 idempotency key에 걸려 새 일이 안 생긴다.
import type { HarnessId } from "../../../packages/protocol/coding-agent/mod.ts";
import type { Core } from "../core/mod.ts";
import { say, turnsOf, waitTurnEnd } from "../core/human.ts";
import type { FakeServer } from "../fake-server/mod.ts";
import { idIn, lastToolResult } from "../fake-server/probe.ts";
import { aeLane, type TestApp, tool } from "../app/activate.ts";

export type Queued = { ticket: string; call: string; turn: number };

// 앞 tool 결과는 뒤 요청에서 줄여 실리므로 줄이 받은 모든 요청의 그 tool 결과를 이어 읽는다.
function resultId(
  fake: FakeServer,
  app: TestApp,
  toolCall: string,
  prefix: string,
): string {
  const text = fake.journal().filter((entry) => entry.lane === aeLane(app).name)
    .map((entry) => lastToolResult(entry, toolCall) ?? "").join(" ");
  const id = idIn(text, prefix);
  if (id === undefined) {
    throw new Error(`${toolCall} 결과에 ${prefix} id가 없다`);
  }
  return id;
}

const slug = (app: TestApp, turn: number) => `${app.slug}-${turn}`;

// ticket만 만든다(다른 앱의 ticket이 필요한 행). 돌려주는 값은 ticket id다.
export async function createTicket(
  core: Core,
  fake: FakeServer,
  app: TestApp,
  options: { goal?: string } = {},
): Promise<string> {
  const goal = options.goal ?? "Add a short note to the app";
  const turn = (await turnsOf(core, app.ae)).length;
  const id = `${slug(app, turn)}-ticket`;
  fake.script([
    {
      reply: tool(id, "ticket_create", {
        app: app.app,
        goal,
        check: { kind: "text", text: "the work is done" },
      }),
    },
    { reply: { kind: "text", text: "created" } },
  ], aeLane(app));
  await say(core, app.ae, `App ${app.app}: ${goal}`);
  await waitTurnEnd(core, app.ae, turn);
  return resultId(fake, app, id, "tkt");
}

// 앱에 끝나지 않은 coding session이 이미 있어 call이 줄에 서는 경우다. `coding_terminal` frame을 기다리지 않는다.
export async function handOffQueued(
  core: Core,
  fake: FakeServer,
  app: TestApp,
  options: { goal?: string; harness?: HarnessId } = {},
): Promise<Queued> {
  const goal = options.goal ?? "Add a short note to the app";
  const turn = (await turnsOf(core, app.ae)).length;
  const ticketId = `${slug(app, turn)}-ticket`;
  const callId = `${slug(app, turn)}-call`;
  fake.script([
    {
      reply: tool(ticketId, "ticket_create", {
        app: app.app,
        goal,
        check: { kind: "text", text: "the work is done" },
      }),
    },
    {
      reply: (request) => {
        const ticket = idIn(lastToolResult(request) ?? "", "tkt");
        if (ticket === undefined) {
          throw new Error("ticket_create 결과에 ticket id가 없다");
        }
        return tool(callId, "call", {
          to: { role: "coding_agent", place: { app: app.name } },
          reply: "conversation",
          body: goal,
          refs: [{ kind: "ticket", ticket }],
          options: { harness: options.harness ?? "claude" },
        });
      },
    },
    { reply: { kind: "text", text: "handed over" } },
  ], aeLane(app));
  await say(core, app.ae, `App ${app.app}: ${goal}`);
  await waitTurnEnd(core, app.ae, turn);
  return {
    ticket: resultId(fake, app, ticketId, "tkt"),
    call: resultId(fake, app, callId, "cal"),
    turn,
  };
}
