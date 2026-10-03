import { assert, assertEquals } from "@std/assert";
import { actorPartsSchema, formatActor, parseActor } from "./actor.ts";

const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
const ASG = "asg_01h455vb4pex5v6nkc6gd5fdw1";
const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";

Deno.test(
  "platform/identity#R1: actor는 다섯 종류이고 셋은 자기 ID를 붙인다",
  () => {
    assertEquals(parseActor("user"), { kind: "user" });
    assertEquals(parseActor("machine"), { kind: "machine" });
    assertEquals(parseActor(`coding_agent:${CAC}`), {
      kind: "coding_agent",
      id: CAC,
    });
    assertEquals(parseActor(`agent:${ASG}`), { kind: "agent", id: ASG });
    assertEquals(parseActor(`app:${APP}`), { kind: "app", id: APP });

    for (
      const bad of [
        "User",
        "coding_agent",
        `coding_agent:${ASG}`,
        `agent:${APP}`,
        `app:${CAC}`,
        `user:${APP}`,
        `machine:${APP}`,
        `app:${APP}:extra`,
        "",
      ]
    ) {
      assertEquals(parseActor(bad), undefined, bad);
    }
  },
);

Deno.test("platform/identity#R1: formatActor는 parseActor의 역이다", () => {
  for (
    const value of [
      "user",
      "machine",
      `coding_agent:${CAC}`,
      `agent:${ASG}`,
      `app:${APP}`,
    ]
  ) {
    const parts = parseActor(value);
    assert(parts);
    if (parts) assertEquals(formatActor(parts), value);
  }
  const parts = { kind: "app" as const, id: APP };
  assert(actorPartsSchema.safeParse(parts).success);
  assert(!actorPartsSchema.safeParse({ kind: "app", id: CAC }).success);
  assert(!actorPartsSchema.safeParse({ kind: "user", id: APP }).success);
});
