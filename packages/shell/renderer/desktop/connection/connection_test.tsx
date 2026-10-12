// connectionTest: flow work-offline과 install-lophn(실패 갈래) 화면에서 두 끊김 상태의
// 동작(desktop#R7). provider 끊김은 대화만 끊기고 로컬 작업 자리는 남는다. core 끊김은
// 게이트·마지막 확인 시각을 보이며 실패는 다음 행동 하나를 준다.
// bundle 진입은 desktop_test.ts가 이 폴더를 같이 등록한다.
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { click, render } from "../../../../design/components/testing.ts";

import type { ConnectionState, CoreSource } from "./connection.ts";
import {
  ConnectionGate,
  ConnectionNotice,
  ProviderNotice,
  retryConnection,
} from "./connection.tsx";
import { readProviderFacts } from "./provider-state.ts";

function sourceOf(states: ConnectionState[]): {
  source: CoreSource;
  calls: unknown[];
  push(state: ConnectionState): void;
} {
  const listeners = new Set<(state: ConnectionState) => void>();
  const calls: unknown[] = [];
  return {
    calls,
    source: {
      subscribe(listener) {
        listeners.add(listener);
        for (const state of states) listener(state);
        return () => listeners.delete(listener);
      },
      call(input) {
        calls.push(input);
        return Promise.resolve({ ok: true, value: {} });
      },
    },
    push(state) {
      act(() => {
        for (const listener of listeners) listener(state);
      });
    },
  };
}

const clock = (confirmedAt: number) => `at ${confirmedAt}`;
const ready: ConnectionState = { state: "ready", confirmedAt: 1 };
const stale: ConnectionState = {
  state: "stale",
  confirmedAt: 1_700_000_000_000,
};

Deno.test("flow install-lophn 실패 갈래, shell/desktop#R7: core 준비 실패는 자리만 보이고 다음 행동 하나를 준다", () => {
  const failed = sourceOf([{ state: "failed", confirmedAt: null }]);
  using view = render(
    <ConnectionGate
      connection={failed.source.current?.() ?? {
        state: "failed",
        confirmedAt: null,
      }}
      onRetry={() => retryConnection(failed.source)}
    />,
  );
  const gate = view.container.querySelector(
    "[data-connection='failed']",
  ) as HTMLElement;
  assert(gate, "the failed gate is missing");
  assert(gate.textContent?.includes("couldn't get ready"));
  assertEquals(gate.querySelectorAll("button").length, 1);
  const retry = gate.querySelector("button")!;
  click(retry);
  assertEquals(failed.calls, [{
    kind: "read",
    resource: "platform",
    method: "status",
    body: {},
  }]);
});

Deno.test("flow work-offline, shell/desktop#R7: core 끊김은 마지막 확인 시각과 다시 연결을 보인다", () => {
  const states = sourceOf([ready]);
  using view = render(
    <div>
      <ConnectionNotice
        connection={stale}
        onRetry={() => retryConnection(states.source)}
        formatTime={clock}
      />
    </div>,
  );
  const notice = view.container.querySelector(
    "[data-connection='stale']",
  ) as HTMLElement;
  assert(notice, "the stale notice is missing");
  assert(notice.textContent?.includes("can't refresh"));
  assert(
    notice.textContent?.includes("at 1700000000000"),
    "the last checked time is missing",
  );
  const reconnect = notice.querySelector("button")!;
  click(reconnect);
  assertEquals(states.calls, [{
    kind: "read",
    resource: "platform",
    method: "status",
    body: {},
  }]);
});

Deno.test("flow work-offline, shell/desktop#R7: provider 끊김은 대화에만 행동 한 줄을 보인다", () => {
  using view = render(
    <div>
      <ConnectionNotice connection={ready} onRetry={() => {}} />
      <ProviderNotice
        facts={{
          usable: false,
          providers: [{
            name: "ChatGPT",
            state: "rejected",
          }],
        }}
        onSettings={() => {}}
      />
    </div>,
  );
  assertEquals(view.container.querySelector("[data-connection]"), null);
  const notice = view.container.querySelector(
    "[data-provider='unusable']",
  ) as HTMLElement;
  assert(notice, "the provider notice is missing");
  assert(
    notice.textContent?.includes(
      "The agent can't reach its account right now.",
    ),
    `the one-line action is missing: ${notice.textContent}`,
  );
});

Deno.test("flow work-offline, shell/desktop#R7: provider를 아직 못 읽었으면 다시 확인을 준다", async () => {
  let reads = 0;
  using view = render(
    <ProviderNotice
      facts={{ usable: false, providers: null }}
      onRefresh={() => {
        reads += 1;
      }}
    />,
  );
  const notice = view.container.querySelector(
    "[data-provider='unusable']",
  ) as HTMLElement;
  assert(notice, "the provider notice is missing");
  const again = notice.querySelector("button")!;
  click(again);
  assertEquals(reads, 1);
  // 읽어서 쓸 수 있으면 줄이 사라진다.
  const facts = await readProviderFacts({
    subscribe: () => () => {},
    call: () =>
      Promise.resolve({
        ok: true,
        value: {
          providers: [{
            name: "Claude",
            credential: { state: "available" },
          }],
          next_cursor: null,
        },
      }),
  } as unknown as CoreSource);
  view.rerender(
    <ProviderNotice
      facts={facts}
      onRefresh={() => {
        reads += 1;
      }}
    />,
  );
  assertEquals(view.container.querySelector("[data-provider]"), null);
});
