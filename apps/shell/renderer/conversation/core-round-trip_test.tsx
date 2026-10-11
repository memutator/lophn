// 실제 core 위의 대화 도크. 사람이 쓴 글을 본문 값(content)으로 보내고, core가 둔 본문을
// ReadMessageBody로 다시 읽어 그리는지 본다. 실제 provider는 부르지 않는다(model이 없어 run은
// 시작하지 못한다). core는 temp LOPHN_HOME으로 띄우고 끝나면 그 core만 멈춘다.
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  render,
} from "../../../../packages/design/components/testing.ts";

import { coreConversationSource } from "./core-source.ts";
import { MESSAGE_TEXT_MAX_BYTES, textContent } from "./delivery-state.ts";
import { Dock } from "./dock.tsx";
import { DraftStore } from "./drafts.ts";
import { manualTicks } from "./testdata/fake-source.ts";
import { startRealCore } from "../testdata/real-core.ts";

const WAIT_MS = 20_000;

async function until(
  label: string,
  check: () => boolean,
): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`기다림 초과: ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

function write(textarea: HTMLTextAreaElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

Deno.test("lophn-agent/conversation#R2: 실제 core에서 도크가 글을 content로 보내고 ReadMessageBody로 다시 읽어 그린다", async () => {
  const core = await startRealCore();
  try {
    const source = coreConversationSource(core.source);
    const dock = (drafts: DraftStore) => (
      <Dock
        source={source}
        drafts={drafts}
        placement="docked"
        workPlace={{ kind: "global", id: null }}
        onClose={() => {}}
        ticks={manualTicks().ticks}
      />
    );
    const drafts = new DraftStore();
    using view = render(dock(drafts));
    const root = view.container;
    // 새 데이터 root에도 lophn 담당이 있다. 빈 상태에서 새 대화를 연다.
    await until(
      "새 대화 버튼",
      () => root.querySelector("[data-state='empty'] button") !== null,
    );
    click(root.querySelector("[data-state='empty'] button") as HTMLElement);
    await until(
      "입력칸",
      () => root.querySelector("[data-composer-input]") !== null,
    );
    const text = "Plan the week:\n- read the budget\n- 회의 정리 😀";
    write(
      root.querySelector("[data-composer-input]") as HTMLTextAreaElement,
      text,
    );
    click(root.querySelector("[data-send]") as HTMLElement);
    await until(
      "core가 둔 본문",
      () =>
        root.querySelector("[data-actor='user'] [data-body='ready']") !== null,
    );
    const mine = root.querySelector("[data-actor='user']")!;
    assertEquals(mine.getAttribute("data-provisional"), null);
    assertEquals(
      mine.querySelector("[data-body='ready']")!.textContent,
      text,
    );
    assertEquals(root.querySelector("[data-unreadable]"), null);

    // 다른 창(보낸 글을 모르는 메모리)도 같은 본문을 core에서 읽는다.
    using other = render(dock(new DraftStore()));
    await until(
      "다른 창의 본문",
      () =>
        other.container.querySelector(
          "[data-actor='user'] [data-body='ready']",
        ) !== null,
    );
    assertEquals(
      other.container.querySelector("[data-actor='user'] [data-body='ready']")!
        .textContent,
      text,
    );

    // core 쪽 상한과 지난 모양. 도크는 이 값을 보내지 않지만 core도 같은 선을 지킨다.
    const id = mine.getAttribute("data-message")!;
    const read = await source.body(id);
    assert(read.ok);
    assertEquals(read.value, [{ kind: "text", text }]);
    const agent = await source.agent();
    assert(agent.ok && agent.value !== null);
    const sessions = await source.sessions(agent.value.id);
    assert(sessions.ok);
    const session = sessions.value[0]!;
    const raw = async (n: number, input: Record<string, unknown>) =>
      await core.source.call({
        kind: "command",
        resource: "messages",
        method: "receive",
        body: {
          input: {
            id: `msg_01h455vb4pex5v6nkc6gd5fz0${n}`,
            session: session.id,
            mode: "request",
            ...input,
          },
          idempotency_key: `messages-receive-check-${n}`,
          compare: {
            session_state: "open",
            session_state_seq: session.stateSeq,
            assignment_revision: agent.value!.revision,
            assignment_state: agent.value!.state,
          },
          prepared: [],
        },
      });
    assertEquals(
      (await raw(1, { body: "a".repeat(64) })).error?.code,
      "invalid_input",
    );
    assertEquals(
      (await raw(2, {
        content: textContent("a".repeat(MESSAGE_TEXT_MAX_BYTES)),
      })).error?.code,
      "invalid_input",
    );
    // 같은 비교값의 맞는 본문은 접수된다. 위 거절은 본문 모양 때문이다.
    assertEquals((await raw(3, { content: textContent("ok") })).ok, true);
  } catch (error) {
    throw new Error(`${(error as Error).message}\n--- core ---\n${core.log()}`);
  } finally {
    await core.stop();
  }
});

Deno.test("lophn-agent/conversation#R16 [ctx-I58i]: 실제 core에서 Context Engineer 담당을 물어 이 프로젝트를 작업 자리로 하는 세션을 연다", async () => {
  const core = await startRealCore();
  try {
    const source = coreConversationSource(core.source);
    const lophn = await source.agent();
    const engineer = await source.agent("context_engineer");
    assert(lophn.ok && lophn.value !== null);
    assert(engineer.ok && engineer.value !== null);
    // 새 데이터 root에는 lophn과 Context Engineer의 전역 담당이 각각 있다.
    assert(engineer.value.id !== lophn.value.id);
    assertEquals(engineer.value.role, "context_engineer");
    assertEquals(lophn.value.role, undefined);

    const project = "prj_01h455vb4pex5v6nkc6gd5fz02";
    const folder = await Deno.makeTempDir();
    try {
      const created = await core.source.call({
        kind: "command",
        resource: "projects",
        method: "create",
        body: {
          input: {
            id: project,
            name: "alpha",
            title: "Alpha",
            purpose: "",
            folders: [{ path: folder, description: "a" }],
            tracking: { enabled: false, patterns: [], use_gitignore: false },
          },
          idempotency_key: "create-project",
          compare: {},
          prepared: [],
        },
      });
      assert(created.ok, JSON.stringify(created));
      const opened = await source.openSession({
        id: "ses_01h455vb4pex5v6nkc6gd5fz01",
        agent: engineer.value,
        workPlace: { kind: "project", id: project },
      });
      assert(opened.ok, opened.ok ? "" : opened.code);
      const sessions = await source.sessions(engineer.value.id);
      assert(sessions.ok);
      assertEquals(sessions.value.map((item) => item.id), [opened.value.id]);
      // 다른 역할의 세션 목록에는 보이지 않는다.
      const other = await source.sessions(lophn.value.id);
      assert(other.ok);
      assertEquals(other.value, []);
    } finally {
      await Deno.remove(folder, { recursive: true });
    }
  } catch (error) {
    throw new Error(`${(error as Error).message}\n--- core ---\n${core.log()}`);
  } finally {
    await core.stop();
  }
});
