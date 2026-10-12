// Agent 화면 test가 함께 쓰는 틀. 화면을 fake source와 함께 세우고, host 쪽 callback을 기록하고,
// 비동기 읽기가 끝나기를 기다리고, 입력칸에 글을 넣는 일을 모은다.
import { act, useState } from "react";
import {
  type ResizeSource,
  ResizeSourceProvider,
} from "@lophn/design/components";
import {
  render,
  type Rendered,
} from "../../../../../packages/design/components/testing.ts";

import { AgentView, type AgentViewHost } from "../agent-view.tsx";
import type { ContextChipView } from "../composer/agent-composer.tsx";
import { DraftStore } from "../drafts.ts";
import type { ContextLinks } from "../result-links.tsx";
import { type FakeAgent, manualTicks, NOW } from "./fake-agent-source.ts";

// 차트 블록이 크기를 재는 자리. happy-dom은 크기를 모른다.
const fixedSize: ResizeSource = {
  observe(_element, onSize) {
    onSize({ width: 360, height: 240 });
    return () => {};
  },
};

export interface HostCalls {
  results: [document: string, version: string | null][];
  permissions: number;
  settings: string[];
  forked: string[];
  usage: number;
  closed: number;
  attached: number;
  connections: number;
}

export function hostSpy(
  over: Partial<AgentViewHost> = {},
): { host: AgentViewHost; calls: HostCalls } {
  const calls: HostCalls = {
    results: [],
    permissions: 0,
    settings: [],
    forked: [],
    usage: 0,
    closed: 0,
    attached: 0,
    connections: 0,
  };
  const host: AgentViewHost = {
    openResult: (document, version) => calls.results.push([document, version]),
    openPermissions: () => calls.permissions += 1,
    openAgentSettings: (target) => calls.settings.push(target),
    openForked: (session) => calls.forked.push(session),
    showUsage: () => calls.usage += 1,
    closeTab: () => calls.closed += 1,
    attach: () => calls.attached += 1,
    openConnections: () => calls.connections += 1,
    ...over,
  };
  return { host, calls };
}

export interface MountOptions {
  fake: FakeAgent;
  /** 처음 보는 session. null은 아직 만들지 않은 새 session이다. */
  session?: string | null;
  drafts?: DraftStore;
  contextChips?: readonly ContextChipView[];
  hint?: string;
  contexts?: ContextLinks;
  host?: Partial<AgentViewHost>;
}

export interface Mounted {
  view: Rendered;
  fake: FakeAgent;
  drafts: DraftStore;
  ticks: ReturnType<typeof manualTicks>;
  host: HostCalls;
  /** onSessionChange로 받은 session들. */
  changes: (string | null)[];
}

/** 화면이 보는 session을 쥐는 쪽(탭). 화면은 onSessionChange로 바꾸자고 말하기만 한다. */
function Tab(
  props: MountOptions & {
    host: AgentViewHost;
    ticks: ReturnType<typeof manualTicks>;
    drafts: DraftStore;
    changes: (string | null)[];
  },
) {
  const [session, setSession] = useState<string | null>(props.session ?? null);
  return (
    <AgentView
      source={props.fake.source}
      drafts={props.drafts}
      session={session}
      onSessionChange={(next) => {
        props.changes.push(next);
        setSession(next);
      }}
      host={props.host}
      {...(props.contextChips === undefined
        ? {}
        : { contextChips: props.contextChips })}
      {...(props.hint === undefined ? {} : { hint: props.hint })}
      ticks={props.ticks.ticks}
      now={() => NOW}
    />
  );
}

export async function mount(options: MountOptions): Promise<Mounted> {
  const { host, calls } = hostSpy({
    ...(options.contexts === undefined ? {} : { contexts: options.contexts }),
    ...options.host,
  });
  const ticks = manualTicks();
  const drafts = options.drafts ?? new DraftStore();
  const changes: (string | null)[] = [];
  const view = render(
    <ResizeSourceProvider value={fixedSize}>
      <Tab
        {...options}
        host={host}
        ticks={ticks}
        drafts={drafts}
        changes={changes}
      />
    </ResizeSourceProvider>,
  );
  await flush();
  return { view, fake: options.fake, drafts, ticks, host: calls, changes };
}

/** 비동기 읽기와 그 뒤의 다시 그리기가 끝나기를 기다린다. */
export async function flush(): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** main이 민 연결 상태가 바뀐다. */
export async function connect(
  mounted: Mounted,
  state: Parameters<Mounted["fake"]["connect"]>[0],
): Promise<void> {
  act(() => mounted.fake.connect(state));
  await flush();
}

/** 다시 읽기 박자를 한 번 울리고 기다린다. */
export async function tick(mounted: Mounted): Promise<void> {
  mounted.ticks.tick();
  await flush();
}

export function text(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function find(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`no element for ${selector}`);
  return found as HTMLElement;
}

export function all(root: ParentNode, selector: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(selector)];
}

export function buttonNamed(root: ParentNode, name: string): HTMLElement {
  const found = [...root.querySelectorAll("button")].find((button) =>
    button.getAttribute("aria-label") === name ||
    (button.textContent ?? "").trim() === name
  );
  if (!found) throw new Error(`no button named ${name}`);
  return found;
}

export function composerInput(root: ParentNode): HTMLTextAreaElement {
  return find(root, "[data-composer-input]") as HTMLTextAreaElement;
}

/** 입력칸의 글을 바꾼다. 사람이 친 것처럼 input 사건을 낸다. */
export function write(textarea: HTMLElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export function before(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}
