// agent-I33b: 실제 core 위의 Agent view source. fake core는 응답 모양을 잘못 흉내 내도 통과하므로 temp
// LOPHN_HOME core에 프로젝트를 만들고 session 열기 → 보내기 → thread에 메시지가 보임 → 본문 읽기 →
// rename·archive·unarchive·fork까지 source로 해 본다. 실제 provider는 부르지 않는다(model이 없어 run은
// 시작하지 못한다).
import { assert, assertEquals } from "@std/assert";

import { newId } from "../desktop/lophn-space/model.ts";
import { coreLauncherSource } from "../desktop/launcher/core-source.ts";
import { startRealCore } from "../testdata/real-core.ts";
import {
  REWIND_FIRST,
  REWIND_FIRST_TEXT,
  REWIND_PROJECT,
  REWIND_REVERT,
  REWIND_SECOND,
  REWIND_SESSION,
} from "../testdata/rewind-seed.ts";
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

    // 모델이 없어 run은 시작하지 못하고 접수된 채로 있다. 일이 끝나지 않은 session은 Fork할 수 없다(R9).
    const working = await source.thread(session);
    assert(working.ok && working.value.run !== null);
    assertEquals(working.value.run.phase, "working");
    const fork = newId("ses");
    assertEquals(
      await source.forkSession({ id: fork, session, through: null }),
      { ok: false, code: "conflict" },
    );
    assertEquals(await source.stop(working.value.run.id, newId("stop")), {
      ok: true,
      value: undefined,
    });
    const stopped = await source.thread(session);
    assert(stopped.ok);
    assertEquals(stopped.value.run?.phase, "ended");
    assertEquals(
      stopped.value.entries.map((entry) => entry.kind),
      ["message", "run-end"],
    );

    // Fork는 마지막 확정 메시지까지 복사한 새 session이다.
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

const REWIND_CORE = "apps/shell/renderer/testdata/rewind-core.ts";

async function rewoundSource(core: Awaited<ReturnType<typeof startRealCore>>) {
  const assignments = await core.source.call({
    kind: "read",
    resource: "assignments",
    method: "list",
    body: { role: "lophn" },
  });
  assert(assignments.ok, core.log());
  const lophn = (assignments.value as { assignments: { id: string }[] })
    .assignments[0]!.id;
  return coreAgentViewSourceFactory(core.source)({
    assignment: lophn,
    place: { kind: "project", id: REWIND_PROJECT },
  });
}

Deno.test("lophn-agent/revert#R16 lophn-agent/conversation#R25 [agent-RW3e]: 실제 core: Restore messages only로 되돌린 session은 둘째 메시지부터 한 줄로 접혀 Redo를 보이고 menu에는 숨기지 않은 메시지만 있으며, 다음 메시지를 보내면 redo가 닫혀 Redo가 사라지고 접힌 줄은 그대로 남는다", async () => {
  const core = await startRealCore({ entry: REWIND_CORE });
  try {
    const source = await rewoundSource(core);
    const before = await source.thread(REWIND_SESSION);
    assert(before.ok, JSON.stringify(before) + core.log());
    assertEquals(
      before.value.entries.map((entry) => entry.kind),
      ["message", "run-end", "hidden"],
    );
    const hidden = before.value.entries[2]!;
    assert(hidden.kind === "hidden");
    assertEquals(hidden.revert, REWIND_REVERT);
    assertEquals(hidden.checkpoint, REWIND_SECOND);
    assertEquals(hidden.choice, "messages_only");
    assertEquals(hidden.redo, true);
    assertEquals(
      hidden.entries.filter((entry) => entry.kind === "message").map((entry) =>
        entry.id
      ),
      [REWIND_SECOND],
    );
    // 숨기지 않은 첫 메시지만 시점으로 고를 수 있다.
    const menu = await source.rewindMenu(REWIND_SESSION);
    assert(menu.ok, JSON.stringify(menu));
    assertEquals(menu.value, {
      running: false,
      points: [{ message: REWIND_FIRST, blocked: {} }],
    });
    // 첫 메시지로 요약 preview를 읽을 수 있다(바뀌는 것 없이).
    const preview = await source.rewindPreview(
      REWIND_SESSION,
      REWIND_FIRST,
      "messages_only",
    );
    assert(preview.ok, JSON.stringify(preview));
    assertEquals(preview.value.restore, []);
    assertEquals(preview.value.redo, true);
    // 숨긴 메시지를 시점으로 고른 preview는 거절된다.
    const refused = await source.rewindPreview(
      REWIND_SESSION,
      REWIND_SECOND,
      "messages_only",
    );
    assertEquals(refused.ok, false);

    // 다음 사람 메시지를 보내면 같은 transaction에서 redo가 닫힌다.
    const next = newId("msg");
    const sent = await source.send({
      session: REWIND_SESSION,
      id: next,
      key: `messages-receive-${next}`,
      text: "Write it again, shorter.",
      mode: "request",
      run: null,
    });
    assert(sent.ok, JSON.stringify(sent) + core.log());
    const after = await source.thread(REWIND_SESSION);
    assert(after.ok);
    const folded = after.value.entries.find((entry) => entry.kind === "hidden");
    assert(folded?.kind === "hidden", "the hidden range stays folded");
    assertEquals(folded.redo, false);
    // 숨김은 되돌린 순간 있던 메시지까지라 새 메시지는 숨기지 않는다.
    assertEquals(
      after.value.entries.some((entry) =>
        entry.kind === "message" && entry.id === next
      ),
      true,
    );
    // 닫힌 redo는 다시 열리지 않는다.
    assertEquals(await source.redoRewind(REWIND_SESSION, REWIND_REVERT), {
      ok: false,
      code: "conflict",
    });
  } catch (error) {
    throw new Error(`${(error as Error).message}\n--- core ---\n${core.log()}`);
  } finally {
    await core.stop();
  }
});

Deno.test("lophn-agent/revert#R16 [agent-RW3e]: 실제 core: 다음 메시지 전에 Redo하면 숨긴 줄이 풀려 메시지가 다시 보이고 같은 Redo를 다시 보내도 한 번만 적용된다", async () => {
  const core = await startRealCore({ entry: REWIND_CORE });
  try {
    const source = await rewoundSource(core);
    assertEquals(await source.redoRewind(REWIND_SESSION, REWIND_REVERT), {
      ok: true,
      value: undefined,
    });
    const after = await source.thread(REWIND_SESSION);
    assert(after.ok, JSON.stringify(after));
    assertEquals(
      after.value.entries.filter((entry) => entry.kind === "message").map((
        entry,
      ) => entry.id),
      [REWIND_FIRST, REWIND_SECOND],
    );
    assertEquals(
      after.value.entries.some((entry) => entry.kind === "hidden"),
      false,
    );
    // 같은 Redo를 다시 보내도 한 번만 적용된다(저장된 결과를 돌려준다).
    assertEquals(await source.redoRewind(REWIND_SESSION, REWIND_REVERT), {
      ok: true,
      value: undefined,
    });
    const again = await source.thread(REWIND_SESSION);
    assert(again.ok);
    assertEquals(again.value.entries.length, after.value.entries.length);
    // 되돌리기 전의 입력 원문도 그대로 읽힌다.
    const body = await source.body(REWIND_FIRST);
    assertEquals(body, {
      ok: true,
      value: [{ kind: "text", text: REWIND_FIRST_TEXT }],
    });
  } catch (error) {
    throw new Error(`${(error as Error).message}\n--- core ---\n${core.log()}`);
  } finally {
    await core.stop();
  }
});
