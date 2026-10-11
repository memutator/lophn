import { assert, assertEquals } from "@std/assert";
import { t } from "@lophn/wording";
import { act } from "react";
import {
  click,
  focus,
  isFocused,
  pressAsync,
  render,
} from "../../../../packages/design/components/testing.ts";

import { Dock } from "./dock.tsx";
import { ConversationProvider } from "./dock-slot.tsx";
import { DraftStore } from "./drafts.ts";
import { dockPlacement, foldResults } from "./model.ts";
import { Workspace } from "../workspace/workspace.tsx";
import type { WorkspaceSource } from "../workspace/source.ts";
import { LophnSpace } from "../desktop/lophn-space/lophn-space.tsx";
import { fakeSource as fakeLophnSource } from "../desktop/lophn-space/testdata/fake-source.ts";
import {
  AGENT,
  agentMessage,
  fakeSource,
  manualTicks,
  messageId,
  runId,
  sessionId,
} from "./testdata/fake-source.ts";
import type { MessageRow, ResultLink } from "./source.ts";
import {
  type ResizeSource,
  ResizeSourceProvider,
} from "@lophn/design/components";
import {
  barBlock,
  DOC,
  tableBlock,
  VER,
} from "../workspace/visuals/testdata/blocks.ts";
import { MESSAGE_TEXT_MAX_BYTES } from "./delivery-state.ts";

const NOW = Date.parse("2026-10-06T09:00:00Z");

const fixedSize: ResizeSource = {
  observe(_element, onSize) {
    onSize({ width: 360, height: 240 });
    return () => {};
  },
};

async function flush(): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function find(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`no element for ${selector}`);
  return found as HTMLElement;
}

function write(textarea: HTMLElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function composer(root: ParentNode): HTMLTextAreaElement {
  return find(root, "[data-composer-input]") as HTMLTextAreaElement;
}

function workspaceSource(): WorkspaceSource {
  return {
    project: () =>
      Promise.resolve({
        ok: true,
        value: { id: "prj_1", title: "lophn", folders: [] },
      }),
    documents: () =>
      Promise.resolve({
        ok: true,
        value: [{ id: "doc_1", title: "notes" }],
      }),
    files: () => Promise.resolve({ ok: true, value: [] }),
    readLayout: () =>
      Promise.resolve({ ok: true, available: false, reason: "absent" }),
    saveLayout: () => Promise.resolve({ ok: true }),
  };
}

function dockOf(
  fake: ReturnType<typeof fakeSource>,
  drafts = new DraftStore(),
  ticks = manualTicks(),
) {
  return (
    <Dock
      source={fake.source}
      drafts={drafts}
      placement="docked"
      workPlace={{ kind: "global", id: null }}
      onClose={() => {}}
      ticks={ticks.ticks}
      now={() => NOW}
    />
  );
}

Deno.test("shell/desktop#R2: 도크는 오른쪽 400px로 본문을 밀고, 본문 480px를 남길 수 없으면 overlay다", async () => {
  assertEquals(dockPlacement(false, 1200), "hidden");
  assertEquals(dockPlacement(true, 880), "docked");
  assertEquals(dockPlacement(true, 879), "overlay");

  const fake = fakeSource();
  const deps = { source: fake.source, drafts: new DraftStore() };
  for (
    const [bodyWidth, expected] of [[1200, "docked"], [700, "overlay"]] as const
  ) {
    using view = render(
      <ConversationProvider deps={{ ...deps, ticks: manualTicks().ticks }}>
        <Workspace
          projectId="prj_1"
          source={workspaceSource()}
          windowWidth={bodyWidth + 240}
          bodyWidth={bodyWidth}
          onLauncher={() => {}}
          onLophn={() => {}}
        />
      </ConversationProvider>,
    );
    await flush();
    assertEquals(view.container.querySelector("[data-dock]"), null);
    const toggle = find(view.container, "[data-dock-toggle]");
    assertEquals(toggle.textContent, "");
    assertEquals(toggle.getAttribute("aria-label"), "Open conversation");
    click(toggle);
    await flush();
    const dock = find(view.container, "[data-dock]");
    assertEquals(dock.getAttribute("data-dock"), expected);
    assertEquals(dock.style.width, "400px");
    assertEquals(toggle.getAttribute("aria-pressed"), "true");
  }
});

Deno.test("shell/desktop#R29: 도크는 정보 패널 자리를 임시로 쓰고 닫으면 이전 정보 패널 상태로 돌아간다", async () => {
  const fake = fakeSource();
  using view = render(
    <ConversationProvider
      deps={{
        source: fake.source,
        drafts: new DraftStore(),
        ticks: manualTicks().ticks,
      }}
    >
      <Workspace
        projectId="prj_1"
        source={workspaceSource()}
        windowWidth={1600}
        bodyWidth={1360}
        onLauncher={() => {}}
        onLophn={() => {}}
      />
    </ConversationProvider>,
  );
  await flush();
  click(find(view.container, "[data-info-toggle]"));
  assertEquals(
    find(view.container, "[data-info-panel]").getAttribute("data-info-panel"),
    "docked",
  );
  click(find(view.container, "[data-dock-toggle]"));
  await flush();
  // 400px 도크와 320px 정보 패널이 함께 쌓이지 않는다.
  assert(view.container.querySelector("[data-dock='docked']"));
  assertEquals(view.container.querySelector("[data-info-panel]"), null);
  click(find(view.container, "[data-close-dock]"));
  await flush();
  assertEquals(view.container.querySelector("[data-dock]"), null);
  assertEquals(
    find(view.container, "[data-info-panel]").getAttribute("data-info-panel"),
    "docked",
  );
  // 정보 패널이 닫혀 있던 때는 닫힌 채로 돌아간다.
  click(find(view.container, "[data-info-toggle]"));
  click(find(view.container, "[data-dock-toggle]"));
  await flush();
  click(find(view.container, "[data-dock-toggle]"));
  await flush();
  assertEquals(view.container.querySelector("[data-info-panel]"), null);
  assertEquals(view.container.querySelector("[data-dock]"), null);
});

Deno.test("shell/desktop#R1: 도크를 열지 않거나 닫아도 문서 탐색은 그대로이고 lophn 공간에도 같은 토글이 있다", async () => {
  const fake = fakeSource();
  const deps = {
    source: fake.source,
    drafts: new DraftStore(),
    ticks: manualTicks().ticks,
  };
  using view = render(
    <ConversationProvider deps={deps}>
      <Workspace
        projectId="prj_1"
        source={workspaceSource()}
        windowWidth={1600}
        bodyWidth={1360}
        onLauncher={() => {}}
        onLophn={() => {}}
      />
    </ConversationProvider>,
  );
  await flush();
  click(find(view.container, "[data-document]"));
  await flush();
  assert(view.container.querySelector("[data-tab='doc_1']"));
  click(find(view.container, "[data-dock-toggle]"));
  await flush();
  click(find(view.container, "[data-dock-toggle]"));
  await flush();
  assert(view.container.querySelector("[data-tab='doc_1']"));

  const { source } = fakeLophnSource();
  using lophn = render(
    <ConversationProvider deps={deps}>
      <LophnSpace source={source} windowWidth={1440} onLauncher={() => {}} />
    </ConversationProvider>,
  );
  await flush();
  assert(lophn.container.querySelector("[data-screen-body='documents']"));
  click(find(lophn.container, "[data-dock-toggle]"));
  await flush();
  assert(lophn.container.querySelector("[data-dock]"));
  assert(lophn.container.querySelector("[data-screen-body='documents']"));
  // 통로가 없으면 토글도 없다. 대화 없이도 공간은 같다.
  using bare = render(
    <LophnSpace source={source} windowWidth={1440} onLauncher={() => {}} />,
  );
  await flush();
  assertEquals(bare.container.querySelector("[data-dock-toggle]"), null);
});

Deno.test("shell/desktop#R3: 결과 5개 중 처음 3개와 남은 개수를 보이고 나머지 결과도 연다", async () => {
  const links: ResultLink[] = [1, 2, 3, 4, 5].map((n) => ({
    kind: "document",
    document: `doc_${n}`,
  }));
  assertEquals(foldResults(links.slice(0, 3), false).hidden, 0);
  assertEquals(foldResults(links, false).shown.length, 3);
  assertEquals(foldResults(links, true).shown.length, 5);

  const fake = fakeSource({
    messages: { [sessionId(1)]: [agentMessage(1, links)] },
    titles: { doc_1: "Weekly summary", doc_4: "Budget" },
  });
  const opened: string[] = [];
  using view = render(
    <Dock
      source={fake.source}
      drafts={new DraftStore()}
      placement="docked"
      workPlace={{ kind: "global", id: null }}
      onClose={() => {}}
      onOpenResult={(document) => opened.push(document)}
      ticks={manualTicks().ticks}
      now={() => NOW}
    />,
  );
  await flush();
  const answer = find(view.container, "[data-actor='agent']");
  const results = find(answer, "[data-results]");
  assertEquals(
    [...results.querySelectorAll("[data-result]")].map((item) =>
      item.textContent
    ),
    ["Weekly summary", "Document", "Document"],
  );
  const more = find(results, "[data-more-results]");
  assertEquals(more.textContent, "+2 more");
  assertEquals(more.getAttribute("aria-label"), "Show all results");
  click(more);
  await flush();
  const all = [...results.querySelectorAll("[data-result]")];
  assertEquals(all.length, 5);
  assertEquals(all[3]!.textContent, "Budget");
  for (const item of all) click(item);
  assertEquals(opened, ["doc_1", "doc_2", "doc_3", "doc_4", "doc_5"]);
});

Deno.test("shell/workspace#R31 [ctx-I58i]: 답 아래 context 링크는 알려진 이름으로 보이고 누르면 그 context를 연다", async () => {
  const fake = fakeSource({
    messages: {
      [sessionId(1)]: [
        agentMessage(1, [
          { kind: "context", context: "ctx_known" },
          { kind: "context", context: "ctx_unknown" },
          { kind: "document", document: "doc_1" },
        ]),
      ],
    },
    titles: { doc_1: "Weekly summary" },
  });
  const opened: string[] = [];
  using view = render(
    <Dock
      source={fake.source}
      drafts={new DraftStore()}
      placement="docked"
      workPlace={{ kind: "global", id: null }}
      onClose={() => {}}
      contexts={{
        open: (context) => opened.push(context),
        titleOf: (context) => context === "ctx_known" ? "harness" : undefined,
      }}
      ticks={manualTicks().ticks}
      now={() => NOW}
    />,
  );
  await flush();
  const links = [...view.container.querySelectorAll("[data-result-context]")];
  assertEquals(links.map((item) => item.textContent), ["harness", "Context"]);
  click(links[0] as HTMLElement);
  click(links[1] as HTMLElement);
  assertEquals(opened, ["ctx_known", "ctx_unknown"]);
  // 문서 링크는 그대로 문서 이름으로 보인다.
  assertEquals(
    find(view.container, "[data-result]").textContent,
    "Weekly summary",
  );
});

Deno.test("shell/workspace#R31 [ctx-I58i]: 열 길이 없는 대화의 context 링크는 누를 수 없다", async () => {
  const fake = fakeSource({
    messages: {
      [sessionId(1)]: [
        agentMessage(1, [{ kind: "context", context: "ctx_a" }]),
      ],
    },
  });
  using view = render(dockOf(fake));
  await flush();
  assertEquals(
    (find(view.container, "[data-result-context]") as HTMLButtonElement)
      .disabled,
    true,
  );
});

Deno.test("shell/workspace#R30 [ctx-I58j]: 비어 있는 Context Engineer 대화의 입력칸은 첫 안내를 보이고 말이 오가면 안내가 없다", async () => {
  const engineer = { ...AGENT, role: "context_engineer" as const };
  const empty = fakeSource({ agent: engineer });
  using first = render(dockOf(empty));
  await flush();
  assertEquals(
    composer(first.container).placeholder,
    t("conversation.placeholder.new-context"),
  );
  const talked = fakeSource({
    agent: engineer,
    messages: { [sessionId(1)]: [agentMessage(1)] },
  });
  using second = render(dockOf(talked));
  await flush();
  assertEquals(composer(second.container).placeholder, "");
});

Deno.test("shell/workspace#R30 [ctx-I58j]: lophn 대화의 비어 있는 입력칸에는 첫 안내가 없다", async () => {
  using view = render(dockOf(fakeSource()));
  await flush();
  assertEquals(composer(view.container).placeholder, "");
});

Deno.test("shell/desktop#R8: 작성 중 말·커서는 도크를 닫았다 열고 세션을 바꿔도 세션마다 남는다", async () => {
  const fake = fakeSource({
    sessions: [
      { id: sessionId(1), state: "open", stateSeq: "10" },
      { id: sessionId(2), state: "open", stateSeq: "11" },
    ],
  });
  const drafts = new DraftStore();
  const first = render(dockOf(fake, drafts));
  await flush();
  // 최신 세션(2)이 먼저 열린다.
  assertEquals(
    find(first.container, "[data-session-menu]").textContent,
    "Conversation 2",
  );
  write(composer(first.container), "Summarize the meeting notes");
  drafts.save(sessionId(2), { selection: [10, 17] });
  // confirmation window가 떠도 renderer는 그대로다. 도크를 닫았다 다시 연다.
  first.unmount();
  using second = render(dockOf(fake, drafts));
  await flush();
  const input = composer(second.container);
  assertEquals(input.value, "Summarize the meeting notes");
  assertEquals([input.selectionStart, input.selectionEnd], [10, 17]);
  // 다른 세션으로 가면 그 세션의 빈 입력이고, 돌아오면 같은 글이다.
  act(() => drafts.select(sessionId(1)));
  await flush();
  assertEquals(composer(second.container).value, "");
  act(() => drafts.select(sessionId(2)));
  await flush();
  assertEquals(composer(second.container).value, "Summarize the meeting notes");
});

Deno.test("shell/desktop#R8: 결과를 모르는 전달은 입력을 잠그고 다시 보내기보다 접수 조회를 먼저 보인다", async () => {
  const fake = fakeSource({
    replies: [{ ok: false, code: "unavailable" }, {
      ok: false,
      code: "unavailable",
    }],
  });
  const drafts = new DraftStore();
  using view = render(dockOf(fake, drafts));
  await flush();
  write(composer(view.container), "Draft the release note");
  click(find(view.container, "[data-send]"));
  await flush();
  const pending = find(view.container, "[data-provisional]");
  assertEquals(
    find(pending, "[data-delivery]").textContent,
    "Not confirmed",
  );
  assert(pending.querySelector("[data-check-delivery]"));
  assertEquals(pending.querySelector("[data-resend]"), null);
  // 결과를 모르는 동안 글은 그대로 두고 고치지 못한다.
  assertEquals(composer(view.container).value, "Draft the release note");
  assert(composer(view.container).readOnly);
  // 조회해서 못 찾으면 그때 다시 보내기를 연다.
  click(find(pending, "[data-check-delivery]"));
  await flush();
  assert(view.container.querySelector("[data-resend]"));
  click(find(view.container, "[data-resend]"));
  await flush();
  // 두 번째도 모른다. 다시 조회부터다.
  assert(view.container.querySelector("[data-check-delivery]"));
  click(find(view.container, "[data-check-delivery]"));
  await flush();
  click(find(view.container, "[data-resend]"));
  await flush();
  // 다시 보낼 때는 같은 메시지 id와 key다. core가 한 번만 접수한다.
  assertEquals(fake.state.sent.length, 3);
  assertEquals(new Set(fake.state.sent.map((item) => item.id)).size, 1);
  assertEquals(new Set(fake.state.sent.map((item) => item.key)).size, 1);
  // 본문은 글 값이다. hash를 만들지 않고 세 번 모두 같은 값을 싣는다.
  for (const item of fake.state.sent) {
    assertEquals(item.content, {
      schema_version: 1,
      parts: [{ kind: "text", text: "Draft the release note" }],
    });
  }
  assertEquals(view.container.querySelector("[data-provisional]"), null);
  assertEquals(composer(view.container).value, "");
  assertEquals(
    find(view.container, "[data-actor='user'] [data-delivery]").textContent,
    "Received",
  );
  assertEquals(
    find(view.container, "[data-actor='user'] p").textContent,
    "Draft the release note",
  );
});

Deno.test("shell/desktop#R8: 못 보낸 말은 입력칸에 그대로 남아 고쳐 보낸다", async () => {
  const fake = fakeSource({ replies: [{ ok: false, code: "conflict" }] });
  using view = render(dockOf(fake));
  await flush();
  write(composer(view.container), "Rename the weekly file");
  click(find(view.container, "[data-send]"));
  await flush();
  const pending = find(view.container, "[data-provisional]");
  assertEquals(find(pending, "[data-delivery]").textContent, "Not sent");
  const input = composer(view.container);
  assertEquals(input.value, "Rename the weekly file");
  assert(!input.readOnly);
  write(input, "Rename the weekly file to summary");
  click(find(view.container, "[data-send]"));
  await flush();
  assertEquals(fake.state.sent.length, 2);
  assert(fake.state.sent[0]!.id !== fake.state.sent[1]!.id);
  assertEquals(composer(view.container).value, "");
});

Deno.test("shell/desktop#R8: 보내는 중인 말은 임시 표시이고 확정 메시지가 오면 그것으로 바뀌며 접수와 반영을 따로 보인다", async () => {
  let release = () => {};
  const fake = fakeSource({
    gate: new Promise<void>((resolve) => release = resolve),
  });
  const ticks = manualTicks();
  using view = render(dockOf(fake, new DraftStore(), ticks));
  await flush();
  write(composer(view.container), "Check the calendar app");
  click(find(view.container, "[data-send]"));
  await flush();
  const pending = find(view.container, "[data-provisional]");
  assertEquals(find(pending, "[data-delivery]").textContent, "Sending");
  assert(composer(view.container).readOnly);
  release();
  await flush();
  const confirmed = find(view.container, "[data-actor='user']");
  assertEquals(confirmed.getAttribute("data-provisional"), null);
  assertEquals(
    confirmed.getAttribute("data-message"),
    fake.state.sent[0]!.id,
  );
  assertEquals(find(confirmed, "[data-delivery]").textContent, "Received");
  // model 판단에 처음 반영되면 접수와 다른 표시다.
  fake.state.messages[sessionId(1)] = fake.state.messages[sessionId(1)]!.map(
    (message) => ({ ...message, applied: true }),
  );
  ticks.tick();
  await flush();
  assertEquals(
    find(view.container, "[data-actor='user'] [data-delivery]").textContent,
    "Taken into account",
  );
});

Deno.test("lophn-agent/conversation#R5: 현재 일의 수정과 다음 요청을 구별해 보내고 지금 일을 멈춘다(flow steer-agent-work)", async () => {
  const fake = fakeSource({
    runs: [{
      id: runId(1),
      session: sessionId(1),
      state: "running",
      outcome: null,
      stateSeq: "30",
      acceptedSeq: "12",
    }],
  });
  using view = render(dockOf(fake));
  await flush();
  assertEquals(
    find(view.container, "[data-work-status]").textContent,
    "In progress",
  );
  const correction = find(view.container, "[data-mode='correction']");
  assert(!(correction as HTMLButtonElement).disabled);
  assertEquals(
    find(view.container, "[data-composer] label").textContent,
    "New request",
  );
  click(correction);
  assertEquals(
    find(view.container, "[data-composer] label").textContent,
    "Change to the current work",
  );
  write(composer(view.container), "Use the March numbers instead");
  click(find(view.container, "[data-send]"));
  await flush();
  assertEquals(fake.state.sent[0]!.mode, "correction");
  assertEquals(fake.state.sent[0]!.run, runId(1));
  // 다음 요청은 지금 일을 가리키지 않는다.
  click(find(view.container, "[data-mode='request']"));
  write(composer(view.container), "Then make a chart");
  click(find(view.container, "[data-send]"));
  await flush();
  assertEquals(fake.state.sent[1]!.mode, "request");
  assertEquals(fake.state.sent[1]!.run, null);
  // 멈추기는 지금 일에만 간다. 멈춘 뒤에는 수정으로 보낼 수 없다.
  click(find(view.container, "[data-stop]"));
  await flush();
  assertEquals(fake.state.stopped, [runId(1)]);
  assertEquals(
    find(view.container, "[data-work-status]").textContent,
    "Stopped",
  );
  assertEquals(view.container.querySelector("[data-stop]"), null);
  assert(
    (find(view.container, "[data-mode='correction']") as HTMLButtonElement)
      .disabled,
  );
});

Deno.test("shell/desktop#R7: 연결이 끊기면 마지막 대화와 확인 시각을 두고 다시 붙으면 현재 기록으로 한 번에 맞춘다", async () => {
  const fake = fakeSource({
    messages: { [sessionId(1)]: [agentMessage(1)] },
  });
  const ticks = manualTicks();
  using view = render(dockOf(fake, new DraftStore(), ticks));
  await flush();
  assertEquals(view.container.querySelector("[data-stale]"), null);
  write(composer(view.container), "Keep this");
  act(() => fake.connect({ state: "stale", confirmedAt: NOW - 60_000 }));
  fake.state.readsFail = true;
  ticks.tick();
  await flush();
  // 마지막 내용은 그대로이고 빈 결과로 바뀌지 않는다.
  assertEquals(
    view.container.querySelectorAll("[data-actor='agent']").length,
    1,
  );
  assertEquals(
    find(view.container, "[data-stale]").textContent,
    "Couldn't check for new messages. Last checked now.",
  );
  assert((find(view.container, "[data-send]") as HTMLButtonElement).disabled);
  assertEquals(composer(view.container).value, "Keep this");
  // 끊긴 사이 생긴 말 셋을 하나씩 보이지 않고 현재 기록으로 한 번에 맞춘다.
  fake.state.readsFail = false;
  fake.state.messages[sessionId(1)]!.push(
    agentMessage(2),
    agentMessage(3),
    agentMessage(4),
  );
  const before = fake.state.reads;
  act(() => fake.connect({ state: "ready", confirmedAt: NOW }));
  await flush();
  assertEquals(
    view.container.querySelectorAll("[data-actor='agent']").length,
    4,
  );
  assertEquals(view.container.querySelector("[data-stale]"), null);
  assert(fake.state.reads - before <= 8);
  assertEquals(composer(view.container).value, "Keep this");
});

Deno.test("shell/workspace#R13: 새 답과 세션 전환이 사람의 scroll 위치와 입력 focus를 빼앗지 않는다", async () => {
  const fake = fakeSource({
    sessions: [
      { id: sessionId(1), state: "open", stateSeq: "10" },
      { id: sessionId(2), state: "open", stateSeq: "11" },
    ],
    messages: {
      [sessionId(2)]: [agentMessage(1), agentMessage(2)],
    },
  });
  const drafts = new DraftStore();
  const ticks = manualTicks();
  using view = render(dockOf(fake, drafts, ticks));
  await flush();
  const list = find(view.container, "[data-message-list]");
  Object.defineProperty(list, "scrollHeight", {
    configurable: true,
    get: () => 2000,
  });
  Object.defineProperty(list, "clientHeight", {
    configurable: true,
    get: () => 400,
  });
  // 사람이 위로 올려 읽는다.
  act(() => {
    list.scrollTop = 300;
    list.dispatchEvent(new Event("scroll"));
  });
  const input = composer(view.container);
  focus(input);
  fake.state.messages[sessionId(2)]!.push(agentMessage(3));
  ticks.tick();
  await flush();
  assertEquals(
    view.container.querySelectorAll("[data-actor='agent']").length,
    3,
  );
  assertEquals(list.scrollTop, 300);
  assert(isFocused(input), "a new answer moved the focus");
  assertEquals(
    find(view.container, "[data-jump-latest]").getAttribute(
      "data-jump-latest",
    ),
    "1",
  );
  assertEquals(drafts.draft(sessionId(2)).scroll, 300);
  // 사람이 메뉴로 세션을 바꾸면 focus는 그 메뉴에 남고 읽던 위치는 세션마다 남는다.
  const menu = find(view.container, "[data-session-menu]");
  focus(menu);
  await pressAsync(menu, "Enter");
  await pressAsync(document.activeElement!, "ArrowDown");
  await pressAsync(document.activeElement!, "Enter");
  await flush();
  assertEquals(drafts.selected(), sessionId(1));
  assert(isFocused(menu), "switching sessions moved the focus");
  assertEquals(drafts.draft(sessionId(2)).scroll, 300);
});

Deno.test("lophn-agent/conversation#R14: 멈춘 역할에서는 다음 요청을 보존만 하고 수정은 보내지 않는다", async () => {
  const fake = fakeSource({
    agent: {
      id: "asg_01h455vb4pex5v6nkc6gd5fdw1",
      state: "paused",
      revision: 2,
    },
    messages: {
      [sessionId(1)]: [{
        id: messageId(1),
        actor: "user",
        body: "f".repeat(64),
        run: null,
        mode: "request",
        applied: false,
        results: [],
      }],
    },
    bodies: {
      [messageId(1)]: [{ kind: "text", text: "Plan next week's reading list" }],
    },
  });
  using view = render(dockOf(fake));
  await flush();
  assert(view.container.querySelector("[data-paused]"));
  assertEquals(
    find(view.container, "[data-actor='user'] [data-delivery]").textContent,
    "Saved, not started",
  );
  // 다른 창에서 보낸 말도 본문을 읽어 그 글을 보인다.
  assertEquals(
    find(view.container, "[data-actor='user'] [data-body='ready']")
      .textContent,
    "Plan next week's reading list",
  );
  assertEquals(view.container.querySelector("[data-unreadable]"), null);
  assert(
    (find(view.container, "[data-mode='correction']") as HTMLButtonElement)
      .disabled,
  );
});

Deno.test("shell/desktop#R4: 끝난 세션과 대화할 lophn이 없을 때는 입력칸을 두지 않는다", async () => {
  const ended = fakeSource({
    sessions: [{ id: sessionId(1), state: "closed", stateSeq: "40" }],
  });
  using view = render(dockOf(ended));
  await flush();
  assertEquals(view.container.querySelector("[data-composer]"), null);
  assertEquals(
    find(view.container, "[data-session-menu]").textContent,
    "Conversation 1, ended",
  );
  const none = fakeSource({ agent: null });
  using empty = render(dockOf(none));
  await flush();
  assert(empty.container.querySelector("[data-no-agent]"));
  assertEquals(empty.container.querySelector("[data-composer]"), null);
  // 세션이 없으면 새 대화를 지금 공간에서 연다.
  const fresh = fakeSource({ sessions: [] });
  using start = render(dockOf(fresh));
  await flush();
  click(find(start.container, "[data-state='empty'] button"));
  await flush();
  assertEquals(fresh.state.opened.length, 1);
  assertEquals(fresh.state.opened[0]!.workPlace, { kind: "global", id: null });
  assert(start.container.querySelector("[data-composer]"));
});

Deno.test("lophn-agent/conversation#R4: 사람 말·lophn 답·machine 사실의 본문을 ReadMessageBody로 읽어 주체별로 보인다", async () => {
  const user: MessageRow = {
    id: messageId(1),
    actor: "user",
    body: "1".repeat(64),
    run: runId(1),
    mode: "request",
    applied: true,
    results: [],
  };
  const machine: MessageRow = { ...agentMessage(3), actor: "machine" };
  const fake = fakeSource({
    messages: {
      [sessionId(1)]: [user, agentMessage(2), machine, agentMessage(4)],
    },
    bodies: {
      [messageId(1)]: [{ kind: "text", text: "Summarize the budget" }],
      [messageId(2)]: [
        { kind: "text", text: "Here is the summary." },
        { kind: "text", text: "Totals are up\nby 4%." },
      ],
      [messageId(3)]: [{ kind: "text", text: "The budget file was saved." }],
    },
    // 4번 본문 blob은 잠깐 못 읽는다.
    bodyFails: { [messageId(4)]: "unavailable" },
  });
  const ticks = manualTicks();
  using view = render(dockOf(fake, new DraftStore(), ticks));
  await flush();
  const text = (selector: string) =>
    [...view.container.querySelectorAll(`${selector} [data-body='ready'] p`)]
      .map((item) => item.textContent);
  assertEquals(text("[data-actor='user']"), ["Summarize the budget"]);
  assertEquals(text("[data-actor='agent']"), [
    "Here is the summary.",
    "Totals are up\nby 4%.",
  ]);
  assertEquals(text("[data-actor='machine']"), ["The budget file was saved."]);
  assertEquals(
    find(view.container, `[data-message='${messageId(4)}'] [data-unreadable]`)
      .textContent,
    "Couldn't load this message.",
  );
  // 지난 말투의 "아직 보일 수 없음"은 없다.
  assert(!view.container.textContent!.includes("can't be shown here yet"));
  const reads = (n: number) =>
    fake.state.bodyReads.filter((item) => item === messageId(n)).length;
  // 다음 박자에 읽은 본문은 다시 읽지 않고, 못 읽은 것만 다시 읽는다.
  delete fake.state.bodyFails[messageId(4)];
  fake.state.bodies[messageId(4)] = [{ kind: "text", text: "Done." }];
  const failedReads = reads(4);
  ticks.tick();
  await flush();
  assertEquals([reads(1), reads(2), reads(3)], [1, 1, 1]);
  assertEquals(reads(4), failedReads + 1);
  assertEquals(
    find(view.container, `[data-message='${messageId(4)}'] [data-body='ready']`)
      .textContent,
    "Done.",
  );
  // 없거나 범위 밖인 메시지(not_found)는 다시 읽어도 같아 더 묻지 않는다.
  fake.state.messages[sessionId(1)]!.push(agentMessage(5));
  ticks.tick();
  await flush();
  ticks.tick();
  await flush();
  assertEquals(reads(5), 1);
  assert(
    view.container.querySelector(
      `[data-message='${messageId(5)}'] [data-unreadable]`,
    ),
  );
});

Deno.test("lophn-agent/conversation#R2: 이 창이 보낸 말은 접수 뒤 core가 둔 본문으로 바뀌고 다른 창도 같은 글을 읽는다", async () => {
  let release = () => {};
  const fake = fakeSource();
  const drafts = new DraftStore();
  using view = render(dockOf(fake, drafts));
  await flush();
  write(composer(view.container), "Book the room for Friday");
  // 본문 읽기를 미뤄 읽기 전 자리를 본다.
  const body = fake.source.body;
  fake.source.body = async (message) => {
    await new Promise<void>((resolve) => release = resolve);
    return await body(message);
  };
  click(find(view.container, "[data-send]"));
  await flush();
  // 읽기 전에는 이 창이 보낸 글로 자리를 채운다. 빈 말이나 읽는 중 안내가 아니다.
  const mine = find(view.container, "[data-actor='user']");
  assertEquals(mine.getAttribute("data-provisional"), null);
  assertEquals(find(mine, "p").textContent, "Book the room for Friday");
  assertEquals(mine.querySelector("[data-body='loading']"), null);
  // core가 둔 본문이 오면 그것을 보인다(core는 redaction을 거친 값을 둔다).
  const id = fake.state.sent[0]!.id;
  fake.state.bodies[id] = [{
    kind: "text",
    text: "Book the room for [hidden]",
  }];
  release();
  await flush();
  assertEquals(
    find(view.container, "[data-actor='user'] [data-body='ready']")
      .textContent,
    "Book the room for [hidden]",
  );
  fake.source.body = body;
  // 다른 창(다른 대화 메모리)은 보낸 글을 모르지만 같은 본문을 읽는다.
  using other = render(dockOf(fake, new DraftStore()));
  await flush();
  assertEquals(
    find(other.container, "[data-actor='user'] [data-body='ready']")
      .textContent,
    "Book the room for [hidden]",
  );
});

Deno.test("shell/workspace#R12: 답의 시각 블록은 본문 순서대로 블록 renderer가 그리고 agent의 HTML·script를 실행하지 않는다", async () => {
  const title = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const fake = fakeSource({
    messages: { [sessionId(1)]: [agentMessage(1)] },
    bodies: {
      [messageId(1)]: [
        { kind: "text", text: "Here is the chart." },
        { kind: "visual", block: barBlock },
        { kind: "visual", block: { ...tableBlock, title } },
        { kind: "text", text: "<b>not bold</b>" },
      ],
    },
  });
  using view = render(
    <ResizeSourceProvider value={fixedSize}>
      {dockOf(fake)}
    </ResizeSourceProvider>,
  );
  await flush();
  const answer = find(view.container, "[data-actor='agent'] [data-body]");
  // 순서는 본문 그대로다. 글 사이의 블록 자리에 둔다.
  assertEquals(
    [...answer.children].map((item) =>
      item.getAttribute("data-visual") ?? item.textContent
    ),
    ["Here is the chart.", "chart", "unavailable", "<b>not bold</b>"],
  );
  assert(answer.querySelector("svg[data-chart='bar']"));
  // 제목·글의 태그는 요소로 만들어지지 않는다.
  assertEquals(answer.querySelectorAll("img, script, b").length, 0);
});

Deno.test("shell/workspace#R13: 문서로 남기기는 요청을 대화 입력으로 보내고 작성 중 글·focus·읽던 위치를 지키며 저장 뒤 고정 문서 링크를 보인다", async () => {
  const fake = fakeSource({
    messages: { [sessionId(1)]: [agentMessage(1)] },
    bodies: { [messageId(1)]: [{ kind: "visual", block: barBlock }] },
    titles: { [DOC]: "Budget 2026" },
  });
  const drafts = new DraftStore();
  const ticks = manualTicks();
  const opened: [string, string | null][] = [];
  using view = render(
    <ResizeSourceProvider value={fixedSize}>
      <Dock
        source={fake.source}
        drafts={drafts}
        placement="docked"
        workPlace={{ kind: "global", id: null }}
        onClose={() => {}}
        onOpenResult={(document, version) => opened.push([document, version])}
        ticks={ticks.ticks}
        now={() => NOW}
      />
    </ResizeSourceProvider>,
  );
  await flush();
  const list = find(view.container, "[data-message-list]");
  Object.defineProperty(list, "scrollHeight", {
    configurable: true,
    get: () => 2000,
  });
  Object.defineProperty(list, "clientHeight", {
    configurable: true,
    get: () => 400,
  });
  // 사람이 위로 올려 읽는다.
  act(() => {
    list.scrollTop = 120;
    list.dispatchEvent(new Event("scroll"));
  });
  const input = composer(view.container);
  write(input, "half a thought");
  focus(input);
  click(find(view.container, "[data-save-visual='spend']"));
  await flush();
  // 따로 저장 contract를 부르지 않고 대화 입력 하나를 보낸다.
  assertEquals(fake.state.sent.length, 1);
  const sent = fake.state.sent[0]!;
  assertEquals(sent.mode, "request");
  assertEquals(
    sent.content.parts[0].text,
    `Save the visual \u201cMonthly spend\u201d (block spend in message ${
      messageId(1)
    }) as a document.`,
  );
  // 작성 중 글·focus·읽던 위치는 그대로다.
  assertEquals(composer(view.container).value, "half a thought");
  assert(isFocused(input), "saving moved the focus");
  assertEquals(list.scrollTop, 120);
  const save = () => find(view.container, "[data-visual-save]");
  assertEquals(save().getAttribute("data-visual-save"), "requested");
  // 요청을 맡은 run의 lophn 답에 판 결과가 오면 그 블록에 고정 문서 링크를 보인다.
  fake.state.messages[sessionId(1)]!.push({
    ...agentMessage(3, [{ kind: "version", document: DOC, version: VER }]),
    run: runId(9),
  });
  fake.state.bodies[messageId(3)] = [{ kind: "text", text: "Saved it." }];
  ticks.tick();
  await flush();
  assertEquals(save().getAttribute("data-visual-save"), "saved");
  const link = find(save(), `[data-visual-document='${DOC}@${VER}']`);
  assertEquals(link.textContent, "Budget 2026");
  click(link);
  assertEquals(opened, [[DOC, VER]]);
  assert(isFocused(input), "a saved answer moved the focus");
});

Deno.test("shell/workspace#R13: 보내지 못한 문서로 남기기 요청은 그 블록에 실패를 보이고 입력칸을 바꾸지 않는다", async () => {
  const fake = fakeSource({
    messages: { [sessionId(1)]: [agentMessage(1)] },
    bodies: { [messageId(1)]: [{ kind: "visual", block: barBlock }] },
    replies: [{ ok: false, code: "conflict" }],
  });
  const drafts = new DraftStore();
  using view = render(
    <ResizeSourceProvider value={fixedSize}>
      {dockOf(fake, drafts)}
    </ResizeSourceProvider>,
  );
  await flush();
  write(composer(view.container), "keep me");
  click(find(view.container, "[data-save-visual='spend']"));
  await flush();
  assertEquals(
    find(view.container, "[data-visual-save]").getAttribute("data-visual-save"),
    "failed",
  );
  assertEquals(drafts.draft(sessionId(1)).outgoing, null);
  assertEquals(view.container.querySelector("[data-provisional]"), null);
  assertEquals(composer(view.container).value, "keep me");
  assertEquals(
    (find(view.container, "[data-save-visual='spend']") as HTMLButtonElement)
      .disabled,
    false,
  );
});

Deno.test("shell/desktop#R8: 본문 상한을 넘는 글은 보내지 않고 이유를 보이며 글을 그대로 둔다", async () => {
  const fake = fakeSource();
  using view = render(dockOf(fake));
  await flush();
  const long = "a".repeat(MESSAGE_TEXT_MAX_BYTES);
  write(composer(view.container), long);
  await flush();
  assertEquals(
    find(view.container, "[data-too-long]").textContent,
    "This message is too long to send. Shorten it, or split it into parts.",
  );
  const send = find(view.container, "[data-send]") as HTMLButtonElement;
  assert(send.disabled);
  click(send);
  await pressAsync(composer(view.container), "Enter");
  await flush();
  assertEquals(fake.state.sent.length, 0);
  assertEquals(composer(view.container).value, long);
  // 줄이면 이유가 사라지고 보낸다.
  write(composer(view.container), long.slice(0, 1000));
  await flush();
  assertEquals(view.container.querySelector("[data-too-long]"), null);
  click(find(view.container, "[data-send]"));
  await flush();
  assertEquals(fake.state.sent.length, 1);
});
