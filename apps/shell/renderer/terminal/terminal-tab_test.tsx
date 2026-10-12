import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { render } from "../../../../packages/design/components/testing.ts";

import type {
  TerminalApi,
  TerminalCall,
  TerminalOutput,
  TerminalReply,
  TerminalRuntime,
} from "../../ipc/terminal.ts";
import { closeTerminalTab, type TerminalDeps } from "./deps.ts";
import { TerminalStore } from "./store.ts";
import { TerminalTab } from "./terminal-tab.tsx";
import {
  createXtermView,
  SWALLOWED_OSC,
  type TerminalView,
  type XtermParts,
} from "./xterm-view.ts";
import { Workspace } from "../workspace/workspace.tsx";
import type { WorkspaceSource } from "../workspace/source.ts";

function runtime(patch: Partial<TerminalRuntime> = {}): TerminalRuntime {
  return {
    terminal_ref: "term_1",
    project: "prj_1",
    folder_ref: "prj_1_0",
    cwd_at_start: "/work/app",
    program_path: "/bin/bash",
    launch_kind: "shell",
    state: "running",
    generation: 1,
    columns: 80,
    rows: 24,
    exit_code: null,
    failure_reason: null,
    output_seq: 0,
    dropped_output: false,
    ...patch,
  };
}

/** host 하나를 흉내 낸다. 출력과 runtime은 테스트가 바꾼다. */
class FakeHost {
  calls: { method: string; input: unknown }[] = [];
  runtime: TerminalRuntime | null = null;
  output: TerminalOutput[] = [];
  openReply: TerminalReply | null = null;
  snapshotFails = false;

  push(text: string, dropped = false): void {
    const current = this.runtime!;
    this.output.push({
      terminal_ref: current.terminal_ref,
      generation: current.generation,
      seq: this.output.length + 1,
      chunk: text,
      dropped_output: dropped,
    });
  }

  of(method: string): unknown[] {
    return this.calls.filter((call) => call.method === method).map((call) =>
      call.input
    );
  }

  api(): TerminalApi {
    const ok = <T,>(value: T): Promise<TerminalCall<T>> =>
      Promise.resolve({ ok: true, value });
    const record = (method: string, input: unknown) =>
      this.calls.push({ method, input });
    return {
      open: (input) => {
        record("open", input);
        if (this.openReply) return ok(this.openReply);
        this.runtime = runtime({
          folder_ref: input.folder_ref ?? "prj_1_0",
        });
        this.output = [];
        return ok({ ok: true, runtime: this.runtime });
      },
      input: (input) => {
        record("input", input);
        return ok({ ok: true, runtime: this.runtime! });
      },
      resize: (input) => {
        record("resize", input);
        return ok({ ok: true, runtime: this.runtime! });
      },
      close: (input) => {
        record("close", input);
        this.runtime = { ...this.runtime!, state: "exited", exit_code: null };
        return ok({ ok: true, runtime: this.runtime });
      },
      restart: (input) => {
        record("restart", input);
        this.runtime = runtime({
          generation: this.runtime!.generation + 1,
        });
        this.output = [];
        return ok({ ok: true, runtime: this.runtime });
      },
      snapshot: (input) => {
        record("snapshot", input);
        if (this.snapshotFails || !this.runtime) {
          return ok({ ok: false, reason: "host_lost", message: "gone" });
        }
        const after = input.after_seq ?? 0;
        return ok({
          ok: true,
          runtime: this.runtime,
          output: this.output.filter((item) => item.seq > after),
        });
      },
      focus: (input) => {
        record("focus", input);
        return ok(null);
      },
    };
  }
}

class FakeView implements TerminalView {
  static made: FakeView[] = [];
  writes: string[] = [];
  resets = 0;
  focused = 0;
  disposed = false;
  listener: ((text: string) => void) | null = null;
  constructor() {
    FakeView.made.push(this);
  }
  write(text: string) {
    this.writes.push(text);
  }
  reset() {
    this.resets += 1;
    this.writes = [];
  }
  focus() {
    this.focused += 1;
  }
  fit() {
    return { columns: 100, rows: 30 };
  }
  onData(listener: (text: string) => void) {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }
  dispose() {
    this.disposed = true;
  }
  type(text: string) {
    act(() => this.listener?.(text));
  }
}

function setup(
  host = new FakeHost(),
  options: { confirm?: boolean; store?: TerminalStore } = {},
) {
  FakeView.made = [];
  const store = options.store ?? new TerminalStore(null);
  const deps: TerminalDeps = {
    bridge: host.api(),
    store,
    createView: () => new FakeView(),
    confirmClose: () => Promise.resolve(options.confirm ?? false),
    pollMs: 1,
  };
  return { host, store, deps };
}

async function flush(rounds = 4): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

function tab(
  deps: TerminalDeps,
  props: { active?: boolean; folderRef?: string | null; key?: string } = {},
) {
  return (
    <TerminalTab
      tabKey={props.key ?? "terminal-a"}
      project="prj_1"
      folderRef={props.folderRef ?? null}
      active={props.active ?? true}
      deps={deps}
    />
  );
}

Deno.test("shell/terminal#R1: 등록 폴더가 하나면 사람이 연 탭에서 바로 시작하고 출력을 보인다", async () => {
  const { host, store, deps } = setup();
  store.request("terminal-a");
  using view = render(tab(deps));
  await flush();
  assertEquals(host.of("open"), [{ project: "prj_1" }]);
  host.push("hello\r\n");
  await flush();
  assertEquals(FakeView.made[0]!.writes.join(""), "hello\r\n");
  assertEquals(
    view.container.querySelector("[data-terminal-tab]")?.getAttribute(
      "data-phase",
    ),
    "live",
  );
});

Deno.test("shell/terminal#R1: 여러 등록 폴더면 고르기 전에는 시작하지 않고 고른 폴더로 연다", async () => {
  const host = new FakeHost();
  host.openReply = {
    ok: false,
    reason: "choose_folder",
    message: "choose",
    folders: [
      { folder_ref: "prj_1_0", path: "/work/site" },
      { folder_ref: "prj_1_1", path: "/work/api" },
    ],
  };
  const { store, deps } = setup(host);
  store.request("terminal-a");
  using view = render(tab(deps));
  await flush();
  const choice = view.container.querySelector("[data-folder-choice]");
  assert(choice, "폴더 고르기 화면이 없다");
  assertEquals(
    view.container.querySelector("[data-terminal-screen]")?.hasAttribute(
      "hidden",
    ),
    true,
  );
  assert(choice.textContent?.includes("/work/api"), "정확한 경로가 없다");
  host.openReply = null;
  const rows = choice.querySelectorAll("button");
  act(() => (rows[1] as HTMLButtonElement).click());
  await flush();
  assertEquals(host.of("open").at(-1), {
    project: "prj_1",
    folder_ref: "prj_1_1",
  });
  assertEquals(store.get("terminal-a")?.folderRef, "prj_1_1");
});

Deno.test("shell/terminal#R2: 쓸 수 없는 시작 폴더는 이유를 보이고 다른 폴더로 시작하지 않는다", async () => {
  const host = new FakeHost();
  host.openReply = { ok: false, reason: "not_directory", message: "x" };
  const { store, deps } = setup(host);
  store.request("terminal-a");
  using view = render(tab(deps));
  await flush();
  const banner = view.container.querySelector("[data-exit-banner]");
  assertEquals(banner?.getAttribute("data-exit-banner"), "refused");
  assert(banner?.textContent?.includes("isn't a folder anymore"));
  assertEquals(host.of("open").length, 1);
});

Deno.test("shell/terminal#R6: 첫 열기 안내는 OS 사용자 권한과 시작 위치를 다른 문장으로 보인다", async () => {
  const { store, deps } = setup();
  store.request("terminal-a");
  using view = render(tab(deps));
  await flush();
  const account = view.container.querySelector('[data-notice="account"]');
  const folder = view.container.querySelector('[data-notice="folder"]');
  assert(account?.textContent?.includes("computer account"));
  assert(account?.textContent?.includes("isn't an app sandbox"));
  assert(folder?.textContent?.includes("starts in the project folder"));
  assert(!folder?.textContent?.includes("sandbox"));
});

Deno.test("shell/terminal#R3: 고른 탭일 때만 focus를 알리고 입력을 보낸다", async () => {
  const { host, store, deps } = setup();
  store.request("terminal-a");
  using view = render(tab(deps, { active: false }));
  await flush();
  FakeView.made[0]!.type("ls\r");
  assertEquals(host.of("input"), []);
  assertEquals(host.of("focus"), []);
  view.rerender(tab(deps, { active: true }));
  await flush();
  assertEquals(host.of("focus"), [{
    terminal_ref: "term_1",
    generation: 1,
    focused: true,
  }]);
  FakeView.made[0]!.type("ls\r");
  await flush();
  assertEquals(host.of("input"), [{
    terminal_ref: "term_1",
    generation: 1,
    text: "ls\r",
  }]);
  assertEquals(host.of("resize").length, 1);
  view.rerender(tab(deps, { active: false }));
  await flush();
  assertEquals(host.of("focus").at(-1), {
    terminal_ref: "term_1",
    generation: 1,
    focused: false,
  });
});

Deno.test("shell/terminal#R9: 종료 상태와 exit code를 출력 옆에 두고 다시 시작은 누를 때만 새 shell이다", async () => {
  const { host, store, deps } = setup();
  store.request("terminal-a");
  using view = render(tab(deps));
  await flush();
  FakeView.made[0]!.type("make\r");
  host.runtime = { ...host.runtime!, state: "exited", exit_code: 2 };
  await flush();
  const banner = view.container.querySelector("[data-exit-banner]");
  assertEquals(banner?.getAttribute("data-exit-banner"), "exited");
  assert(banner?.textContent?.includes("exit code 2"));
  assertEquals(
    view.container.querySelector("[data-terminal-screen]")?.hasAttribute(
      "hidden",
    ),
    false,
  );
  await flush();
  assertEquals(host.of("restart"), []);
  const inputs = host.of("input").length;
  const resets = FakeView.made[0]!.resets;
  act(() =>
    (view.container.querySelector("[data-restart]") as HTMLButtonElement)
      .click()
  );
  await flush();
  assertEquals(host.of("restart"), [{ terminal_ref: "term_1", generation: 1 }]);
  assertEquals(store.get("terminal-a")?.generation, 2);
  assertEquals(FakeView.made[0]!.resets, resets + 1);
  // 옛 입력을 다시 보내지 않는다.
  assertEquals(host.of("input").length, inputs);
  assertEquals(view.container.querySelector("[data-exit-banner]"), null);
});

Deno.test("shell/terminal#R9: host를 잃은 터미널은 결과 불명이고 시작 실패와 다르게 보인다", async () => {
  const { host, store, deps } = setup();
  store.request("terminal-a");
  using view = render(tab(deps));
  await flush();
  host.snapshotFails = true;
  await flush();
  const banner = view.container.querySelector("[data-exit-banner]");
  assertEquals(banner?.getAttribute("data-exit-banner"), "unknown");
  assert(banner?.textContent?.includes("unknown"));

  const failed = setup();
  failed.host.openReply = {
    ok: true,
    runtime: runtime({ state: "exited", failure_reason: "spawn_failed" }),
  };
  failed.store.request("terminal-b");
  using other = render(tab(failed.deps, { key: "terminal-b" }));
  await flush();
  const start = other.container.querySelector("[data-exit-banner]");
  assertEquals(start?.getAttribute("data-exit-banner"), "start_failed");
  assert(start?.textContent?.includes("couldn't start"));
});

Deno.test("shell/terminal#R7: 탭을 숨겼다 다시 그려도 shell을 닫지 않고 같은 출력을 다시 보인다", async () => {
  const { host, store, deps } = setup();
  store.request("terminal-a");
  const first = render(tab(deps));
  await flush();
  host.push("one\r\n");
  await flush();
  first.unmount();
  host.push("two\r\n");
  assertEquals(host.of("close"), []);
  using second = render(tab(deps));
  await flush();
  assertEquals(host.of("open").length, 1);
  assertEquals(FakeView.made.at(-1)!.writes.join(""), "one\r\ntwo\r\n");
  assertEquals(
    second.container.querySelector("[data-output-missing]"),
    null,
  );
});

Deno.test("shell/terminal#R7: 상한으로 빠진 출력은 출력 일부 없음으로 표시한다", async () => {
  const { host, store, deps } = setup();
  store.request("terminal-a");
  using view = render(tab(deps));
  await flush();
  host.push("old\r\n");
  host.push("new\r\n", true);
  host.output.shift();
  await flush();
  assert(view.container.querySelector("[data-output-missing]"));
});

Deno.test("shell/terminal#R8: renderer를 다시 만들면 sessionStorage의 참조로 살아 있는 host buffer만 다시 읽는다", async () => {
  const host = new FakeHost();
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => void saved.set(key, value),
  };
  const before = setup(host, { store: new TerminalStore(storage) });
  before.store.request("terminal-a");
  const first = render(tab(before.deps));
  await flush();
  host.push("kept\r\n");
  await flush();
  first.unmount();
  assert(!JSON.stringify([...saved.values()]).includes("kept"));

  const after = setup(host, { store: new TerminalStore(storage) });
  using view = render(tab(after.deps));
  await flush();
  assertEquals(host.of("open").length, 1);
  assertEquals(FakeView.made.at(-1)!.writes.join(""), "kept\r\n");
  assertEquals(
    view.container.querySelector("[data-terminal-tab]")?.getAttribute(
      "data-phase",
    ),
    "live",
  );
});

Deno.test("shell/workspace#R7: 복원한 터미널 탭은 종료 자리표시이고 누를 때만 시작한다", async () => {
  const { host, deps } = setup();
  using view = render(tab(deps, { folderRef: "prj_1_1" }));
  await flush();
  assertEquals(host.of("open"), []);
  const banner = view.container.querySelector("[data-exit-banner]");
  assertEquals(banner?.getAttribute("data-exit-banner"), "not_started");
  act(() =>
    (view.container.querySelector("[data-restart]") as HTMLButtonElement)
      .click()
  );
  await flush();
  assertEquals(host.of("open"), [{ project: "prj_1", folder_ref: "prj_1_1" }]);
});

Deno.test("shell/terminal#R10: 살아 있는 터미널 닫기는 확인을 받고 취소하면 유지한다", async () => {
  const kept = setup(new FakeHost(), { confirm: false });
  kept.store.request("terminal-a");
  const first = render(tab(kept.deps));
  await flush();
  first.unmount();
  let removed = false;
  await act(async () => {
    removed = await closeTerminalTab(kept.deps, "terminal-a");
  });
  assertEquals(removed, false);
  assertEquals(kept.host.of("close"), []);
  assert(kept.store.get("terminal-a")?.terminalRef);

  const closed = setup(new FakeHost(), { confirm: true });
  closed.store.request("terminal-a");
  const second = render(tab(closed.deps));
  await flush();
  second.unmount();
  await act(async () => {
    removed = await closeTerminalTab(closed.deps, "terminal-a");
  });
  assertEquals(removed, true);
  assertEquals(closed.host.of("close"), [{
    terminal_ref: "term_1",
    generation: 1,
  }]);
  assertEquals(closed.store.get("terminal-a"), undefined);
});

Deno.test("shell/terminal#R10: 끝난 터미널은 묻지 않고 닫는다", async () => {
  const { host, store, deps } = setup(new FakeHost(), { confirm: false });
  store.request("terminal-a");
  const view = render(tab(deps));
  await flush();
  host.runtime = { ...host.runtime!, state: "exited", exit_code: 0 };
  await flush();
  view.unmount();
  let removed = false;
  await act(async () => {
    removed = await closeTerminalTab(deps, "terminal-a");
  });
  assertEquals(removed, true);
  assertEquals(host.of("close"), []);
});

Deno.test("shell/terminal#R11: xterm에는 clipboard·링크 escape를 먹는 parser만 걸고 동작 handler는 없다", () => {
  const options: Record<string, unknown>[] = [];
  const osc: number[] = [];
  const addons: unknown[] = [];
  let handled: ((data: string) => boolean) | undefined;
  const parts: XtermParts = {
    Terminal: class {
      cols = 80;
      rows = 24;
      parser = {
        registerOscHandler(ident: number, callback: (data: string) => boolean) {
          osc.push(ident);
          handled = callback;
          return { dispose() {} };
        },
      };
      constructor(value: Record<string, unknown>) {
        options.push(value);
      }
      open() {}
      loadAddon(addon: unknown) {
        addons.push(addon);
      }
      write() {}
      reset() {}
      focus() {}
      onData() {
        return { dispose() {} };
      }
      dispose() {}
    },
    FitAddon: class {
      fit() {}
    },
  };
  const host = document.createElement("div");
  document.body.append(host);
  const view = createXtermView(host, parts);
  assertEquals(osc, [...SWALLOWED_OSC]);
  assertEquals(handled?.("c;aGVsbG8="), true);
  assertEquals(addons.length, 1);
  const given = options[0]!;
  assertEquals("linkHandler" in given, false);
  assertEquals(
    Object.keys(given).some((key) => /^link|clipboard/i.test(key)),
    false,
  );
  view.dispose();
  host.remove();
});

function workspaceSource(): WorkspaceSource {
  return {
    project: () =>
      Promise.resolve({
        ok: true,
        value: { id: "prj_1", title: "site", folders: [{ path: "/work" }] },
      }),
    documents: () => Promise.resolve({ ok: true, value: [] }),
    files: () => Promise.resolve({ ok: true, value: [] }),
    readLayout: () =>
      Promise.resolve({ ok: true, available: false, reason: "absent" }),
    saveLayout: () => Promise.resolve({ ok: true }),
  };
}

Deno.test("shell/workspace#R1: 작업대의 터미널 열기는 같은 탭 줄에 터미널 탭을 만든다", async () => {
  const { host, deps } = setup();
  using view = render(
    <Workspace
      projectId="prj_1"
      source={workspaceSource()}
      windowWidth={1600}
      bodyWidth={1200}
      onLauncher={() => {}}
      onLophn={() => {}}
      terminal={deps}
    />,
  );
  await flush();
  const button = view.container.querySelector(
    "[data-open-terminal]",
  ) as HTMLButtonElement;
  assertEquals(button.getAttribute("aria-label"), "Open terminal");
  assertEquals(button.textContent, "");
  act(() => button.click());
  await flush();
  const created = view.container.querySelector('[data-kind="terminal"]');
  assert(created, "터미널 탭이 없다");
  assertEquals(
    created.querySelector("[data-kind-label]")?.textContent,
    "Terminal",
  );
  assertEquals(host.of("open"), [{ project: "prj_1" }]);
  // 시작 폴더 이름이 탭 제목이 된다.
  assert(created.textContent?.includes("app"));
});

Deno.test("shell/terminal#R10: 작업대에서 살아 있는 터미널 탭 닫기를 취소하면 탭과 shell이 남는다", async () => {
  const { host, deps } = setup(new FakeHost(), { confirm: false });
  using view = render(
    <Workspace
      projectId="prj_1"
      source={workspaceSource()}
      windowWidth={1600}
      bodyWidth={1200}
      onLauncher={() => {}}
      onLophn={() => {}}
      terminal={deps}
    />,
  );
  await flush();
  act(() =>
    (view.container.querySelector("[data-open-terminal]") as HTMLButtonElement)
      .click()
  );
  await flush();
  act(() =>
    (view.container.querySelector(
      '[data-kind="terminal"] [data-close]',
    ) as HTMLButtonElement).click()
  );
  await flush();
  assert(view.container.querySelector('[data-kind="terminal"]'));
  assertEquals(host.of("close"), []);
});
