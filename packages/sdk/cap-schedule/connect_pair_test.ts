// SDK client가 실제 broker endpoint, 실제 연결 준비·core 서명, 실제 앱 자식 프로세스와 이어질 때
// (apps/sdk#R40). 앱 사실은 시험이 쥔 메모리 출처이고 앱 자식은 temp 폴더의 실제 프로세스다.
import { assert, assertEquals } from "@std/assert";
import {
  openPairWorld,
  PARENT,
} from "../../core/apps/connections/world_test.ts";
import { connectAppCommands, runWith } from "./mod.ts";

Deno.test("apps/sdk#R40: 허락된 command만 B의 같은 handler로 호출되고 미허락 연결과 caller 위조는 거절된다", async () => {
  const world = await openPairWorld();
  try {
    const a = await world.addPeer(1);
    const b = await world.addPeer(2, { child: true });
    const c = await world.addPeer(3, { child: true });
    world.declare(a, b, ["usage.read", "usage.save", "usage.admin"]);
    world.grant(a, b, ["usage.read", "usage.save"]);
    const bridge = world.bridge(a);
    // A가 직접 시작한 호출 안에서 부른다. 시작 사실이 알려진 호출만 부모가 된다.
    await bridge.start(PARENT, { kind: "direct" });
    const context = {
      app: a.app,
      release: a.release,
      mode: "live" as const,
      invocation: PARENT,
    };

    await runWith(context, async () => {
      const connected = await connectAppCommands(b.app, [
        "usage.read",
        "usage.save",
      ]);
      assert(connected.ok, JSON.stringify(connected));
      assertEquals(connected.value.commands, ["usage.read", "usage.save"]);
      const read = await connected.value.call("usage.read");
      assert(read.ok);
      assertEquals(read.value, {
        kind: "result",
        result: { command: "usage.read", input: null },
      });
      const saved = await connected.value.call("usage.save");
      assert(saved.ok && saved.value.kind === "result");
      assert(typeof saved.value.invocation === "string");
      // 연결 범위 밖 command는 SDK가 보내지 않는다.
      const outside = await connected.value.call("usage.admin");
      assert(!outside.ok);
      assertEquals(outside.error.code, "forbidden");

      // 선언은 했지만 허락하지 않은 command는 연결 자체가 거절된다(permission 이름과 scope 포함).
      const denied = await connectAppCommands(b.app, ["usage.admin"]);
      assert(!denied.ok);
      assertEquals(denied.error.code, "forbidden");
      assertEquals(denied.error.details?.["permission"], "app.call");
      // 선언·허락 없는 앱은 없는 앱과 같다.
      const absent = await connectAppCommands(c.app, ["usage.read"]);
      const missing = await connectAppCommands(
        "app_01h455vb4pex5v6nkc6gd5fd99",
        ["usage.read"],
      );
      assert(!absent.ok && !missing.ok);
      assertEquals(absent.error, missing.error);
      assertEquals(absent.error.code, "not_found");
    });
    // 이 client는 앱 신원·caller를 보내지 않는다. 준비 요청에는 대상·command·부모뿐이다.
    assertEquals(
      bridge.posts.filter((path) => path.endsWith("/apps/connect"))
        .length,
      4,
    );
  } finally {
    await world.close();
  }
});
