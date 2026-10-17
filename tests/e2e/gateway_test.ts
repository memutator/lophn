// 세 질문
// - contract: boundary `event-stream`(Gateway는 ready 뒤 snapshot을 읽는 계약이고 replay·ack가 없다), `core-api`(Gateway frame과 snapshot read).
// - 현실적 회귀: ready 전에 event를 흘려 늦게 붙은 화면이 옛 요청을 두 번 보는 것, snapshot에 대기 요청이 안 실려 화면이 허락 요청을 못 보고 turn이 영영 멈추는 것.
// - 왜 지금 test로 못 잡나: Gateway는 socket이 필요해 unit이 없고, 다른 E2E는 route poll(`waitPermission`)로만 본다. `events` unit은 조건 매칭만 본다.
import { assertEquals } from "@std/assert";
import { sessionSnapshotsList } from "../../packages/protocol/events/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  decide,
  openProject,
  openSession,
  say,
  turnsOf,
} from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";
import { connectGateway, type Gateway } from "../support/gateway/mod.ts";

Deno.test("E2E Gateway에 늦게 붙은 화면은 snapshot으로 대기 중인 허락을 보고 결정 뒤 turn 끝을 받는다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  const gateways: Gateway[] = [];
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const folder = `${run.work}/proj`;
    await Deno.mkdir(folder);
    const { project } = await openProject(core, folder);
    const session = await openSession(core, {
      role: "project_manager",
      project,
    });
    fake.script([
      {
        reply: {
          kind: "tool",
          calls: [{
            id: "t1",
            name: "file_write",
            arguments: JSON.stringify({ path: "LOPHN.md", content: "rules" }),
          }],
        },
      },
      { reply: { kind: "text", text: "done" } },
    ]);

    const a = await connectGateway(core, { conditions: [{ session }] });
    gateways.push(a);
    await say(core, session, "write the rules");
    const asked = await a.next(
      "event",
      (frame) => frame.event.type === "PermissionRequested",
    );
    const b = await connectGateway(core, { conditions: [{ session }] });
    gateways.push(b);
    const { snapshots } = await core.call(sessionSnapshotsList, {
      sessions: [session],
    });
    await decide(
      core,
      session,
      snapshots[0].permission_requests[0].id,
      "allow",
    );
    const ended = (gateway: Gateway) =>
      gateway.next("event", (frame) => frame.event.type === "TurnEnded");
    await Promise.all([ended(a), ended(b)]);

    const permissionEvents = (gateway: Gateway) =>
      gateway.frames().filter((frame) =>
        frame.type === "event" && frame.event.type === "PermissionRequested"
      );
    // event
    assertEquals(permissionEvents(a), [asked]);
    assertEquals(permissionEvents(b), []);
    // route
    assertEquals(snapshots[0].permission_requests.length, 1);
    assertEquals((await turnsOf(core, session)).map((t) => t.state), [
      "finished",
    ]);
    // disk
    assertEquals(await Deno.readTextFile(`${folder}/LOPHN.md`), "rules");
  } finally {
    for (const gateway of gateways) await gateway.close();
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
