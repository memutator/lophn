// agent-I33b: 실제 core 위의 Agent view source. fake core는 응답 모양을 잘못 흉내 내도 통과하므로 temp
// LOPHN_HOME core에 프로젝트를 만들고 session 열기 → 보내기 → thread에 메시지가 보임 → 본문 읽기 →
// rename·archive·unarchive·fork까지 source로 해 본다. 실제 provider는 부르지 않는다(model이 없어 run은
// 시작하지 못한다).
import { assert, assertEquals } from "@std/assert";

import { newId } from "../desktop/lophn-space/model.ts";
import { coreLauncherSource } from "../desktop/launcher/core-source.ts";
import { startRealCore } from "../testdata/real-core.ts";
import { coreAgentViewSourceFactory } from "./agent-core-source.ts";

Deno.test("lophn-agent/conversation#R1 lophn-agent/conversation#R2 lophn-agent/conversation#R18 shell/desktop#R38 [agent-I33b]: 실제 core: session을 열고 글을 보내면 thread에 내 메시지가 보이고 본문을 다시 읽으며, rename·archive·unarchive·fork가 목록에 반영된다", async () => {
  const folder = await Deno.makeTempDir({ prefix: "lophn-agent-view-" });
  const core = await startRealCore();
  try {
    const project = newId("prj");
    const registered = await coreLauncherSource(core.source, undefined)
      .register({
        id: project,
        name: "agent-view",
        title: "Agent view",
        purpose: "Agent core source.",
        folders: [{ path: folder, description: "Docs" }],
      });
    assert(registered.ok, JSON.stringify(registered));

    // 새 데이터 root에도 lophn의 전역 담당이 있다.
    const assignments = await core.source.call({
      kind: "read",
      resource: "assignments",
      method: "list",
      body: { role: "lophn" },
    });
    assert(assignments.ok, core.log());
    const lophn = (assignments.value as { assignments: { id: string }[] })
      .assignments[0]!.id;

    const source = coreAgentViewSourceFactory(core.source)({
      assignment: lophn,
      place: { kind: "project", id: project },
    });

    const face = await source.agent();
    assert(face.ok, JSON.stringify(face));
    assertEquals(
      [face.value.name, face.value.role, face.value.state],
      ["lophn", "lophn", "enabled"],
    );
    assertEquals(face.value.place, { kind: "project", name: "Agent view" });

    const empty = await source.sessions();
    assertEquals(empty, { ok: true, value: [] });

    // `/` 목록은 session 없이도 전역 명령을 낸다. 연결된 provider가 없으니 provider 끊김을 알린다.
    const commands = await source.commands(null, "");
    assert(commands.ok, JSON.stringify(commands));
    assert(
      commands.value.flatMap((group) => group.entries).some((entry) =>
        entry.name === "new"
      ),
    );
    const notices = await source.notices(null);
    assertEquals(notices, { ok: true, value: [{ kind: "provider-lost" }] });
    const model = await source.model(null, "");
    assert(model.ok, JSON.stringify(model));

    const session = newId("ses");
    const opened = await source.openSession({ id: session, contexts: [] });
    assert(opened.ok, JSON.stringify(opened));
    const first = await source.sessions();
    assert(first.ok);
    assertEquals(first.value.map((item) => item.id), [session]);
    assertEquals(first.value[0]!.title, null);
    assertEquals(first.value[0]!.status, "idle");

    const text = "Plan the week:\n- read the budget\n- 회의 정리 😀";
    const message = newId("msg");
    const sent = await source.send({
      session,
      id: message,
      key: `messages-receive-${message}`,
      text,
      mode: "request",
      run: null,
    });
    assert(sent.ok, JSON.stringify(sent));
    // 같은 id·key로 다시 보내도 메시지는 하나다.
    const again = await source.send({
      session,
      id: message,
      key: `messages-receive-${message}`,
      text,
      mode: "request",
      run: null,
    });
    assert(again.ok, JSON.stringify(again));

    const thread = await source.thread(session);
    assert(thread.ok, JSON.stringify(thread));
    const mine = thread.value.entries.filter((entry) =>
      entry.kind === "message"
    );
    assertEquals(mine.map((entry) => [entry.id, entry.actor]), [[
      message,
      "user",
    ]]);
    const body = await source.body(message);
    assertEquals(body, { ok: true, value: [{ kind: "text", text }] });

    // 다른 창(새 source)도 같은 기록을 읽는다.
    const other = coreAgentViewSourceFactory(core.source)({
      assignment: lophn,
      place: { kind: "project", id: project },
    });
    const seen = await other.thread(session);
    assert(seen.ok);
    assertEquals(
      seen.value.entries.filter((entry) => entry.kind === "message").length,
      1,
    );

    assertEquals(await source.renameSession(session, "Week 41"), {
      ok: true,
      value: undefined,
    });
    const renamed = await source.sessions();
    assert(renamed.ok);
    assertEquals(renamed.value[0]!.title, "Week 41");

    assertEquals(await source.archiveSession(session), {
      ok: true,
      value: undefined,
    });
    const archived = await source.sessions();
    assert(archived.ok);
    assertEquals(archived.value[0]!.archived, true);
    assertEquals(await source.unarchiveSession(session), {
      ok: true,
      value: undefined,
    });
    const restored = await source.sessions();
    assert(restored.ok);
    assertEquals(restored.value[0]!.archived, false);

    // Fork는 마지막 확정 메시지까지 복사한 새 session이다.
    const fork = newId("ses");
    assertEquals(
      await source.forkSession({ id: fork, session, through: null }),
      { ok: true, value: undefined },
    );
    const copy = await source.thread(fork);
    assert(copy.ok, JSON.stringify(copy));
    assertEquals(
      copy.value.entries.filter((entry) => entry.kind === "message").length,
      1,
    );
    const both = await source.sessions();
    assert(both.ok);
    assertEquals(both.value.length, 2);

    // 없는 session은 not_found다.
    const missing = await source.thread(newId("ses"));
    assertEquals(missing, { ok: false, code: "not_found" });
  } catch (error) {
    throw new Error(`${(error as Error).message}\n--- core ---\n${core.log()}`);
  } finally {
    await core.stop();
    await Deno.remove(folder, { recursive: true });
  }
});
