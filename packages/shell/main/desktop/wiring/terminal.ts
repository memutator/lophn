// 터미널 탭이 shell main에 오는 짧은 통로와 터미널의 OS 쪽 일. 터미널은 core가 갖고 화면은 `terminals/*` route로 붙는다.
// 여기 남는 것: 사람의 입력·다시 시작(그 창이 그 터미널에 focus를 가졌는지 본 뒤)과 질의 응답(그 창이 그 터미널을 보이는지 본
// 뒤)에 shell capability를 실어 core에 넘기기, focus와 보이는 터미널 표, clipboard, link를 어디에서 열지, 진단 기록, 그리고 core의 `TerminalAgentSignaled`로 띄우는 알림.
import { basename, join } from "node:path";
import { clipboard, shell } from "electron";

import { HARNESS_ADAPTERS } from "../../../../protocol/coding-agent/harness-adapter.ts";
import { DIAGNOSTICS_TRACE_SETTING_KEY } from "../../../../protocol/diagnostics/trace.ts";
import {
  TERMINAL_COPY_CHANNEL,
  TERMINAL_FOCUS_CHANNEL,
  TERMINAL_INPUT_CHANNEL,
  TERMINAL_LINK_CHANNEL,
  TERMINAL_PASTE_CHANNEL,
  TERMINAL_PASTE_IMAGE_CHANNEL,
  TERMINAL_RESPONSE_CHANNEL,
  TERMINAL_RESTART_CHANNEL,
  TERMINAL_SHOWN_CHANNEL,
  TERMINAL_TRACE_CHANNEL,
  type TerminalLinkWhere,
  terminalCopySchema,
  terminalFocusSchema,
  terminalInputSchema,
  terminalLinkSchema,
  terminalPasteImageSchema,
  terminalRestartSchema,
  terminalShownSchema,
  terminalTraceSchema,
} from "../../../ipc/terminal.ts";
import { checkExternalUrl } from "../../app-frame/external-link.ts";
import { excerpt } from "../../notice/excerpt.ts";
import { checkCaller, checkInput, type IpcEvent } from "../ipc-guard.ts";
import { copyTerminalText, pasteTerminalText } from "../terminal-clipboard.ts";
import { mayCall, TerminalFocusTable } from "../terminal-focus.ts";
import { LINK_SETTING_KEY_LIST, linkWhere } from "../terminal-link.ts";
import { createTraceFile } from "../terminal-trace.ts";
import {
  type CallResult,
  changedIds,
  type Registered,
  type ShellContext,
} from "./context.ts";
import { type AppSessions, createNoticeWiring } from "./notice.ts";

type Runtime = {
  terminal_ref: string;
  project: string;
  generation: number;
  state: string;
  cwd_at_start: string;
};

export type Terminals = Registered & {
  /** 지금 core에 살아 있는(starting·running) 터미널. 읽지 못하면 빈 목록이다. */
  running(): Promise<{ terminal: string; generation: number }[]>;
  /** 그 터미널들을 닫는다. 실패한 것은 그대로 둔다. */
  close(terminals: { terminal: string; generation: number }[]): Promise<void>;
};

const NOT_FOCUSED = {
  ok: false as const,
  error: { code: "forbidden", message: "terminal is not focused" },
};
const NOT_SHOWN = {
  ok: false as const,
  error: { code: "forbidden", message: "terminal is not shown in this window" },
};

const reply = (result: CallResult) =>
  result.ok ? { ok: true as const, value: null } : result;

export function register(
  ctx: ShellContext,
  appSessions: AppSessions,
): Terminals {
  const { ipc, overlays } = ctx;
  const registry = overlays.overlayRegistry();
  const focus = new TerminalFocusTable();

  // core가 알린 터미널. 알림의 제목(폴더)과 누른 뒤 그 project를 고르는 데 쓴다. Gateway가 다시 붙으면 목록을 다시 읽는다.
  const runtimes = new Map<string, Runtime>();
  const listTerminals = async (): Promise<Runtime[] | null> => {
    const listed = await ctx.coreInternal("read", "terminals", "list", {});
    return listed.ok
      ? (listed.value as { terminals: Runtime[] }).terminals
      : null;
  };
  const live = (runtime: Runtime) =>
    runtime.state === "starting" || runtime.state === "running";
  const note = (runtime: Runtime) => {
    if (live(runtime)) runtimes.set(runtime.terminal_ref, runtime);
    else {
      runtimes.delete(runtime.terminal_ref);
      ctx.terminalWorkspaces.delete(runtime.terminal_ref);
    }
  };

  const notice = createNoticeWiring(
    ctx,
    focus,
    appSessions,
    (ref) => ctx.terminalWorkspaces.get(ref) ?? runtimes.get(ref)?.project,
    () => [...runtimes.keys()],
  );

  ctx.relay.conditions.push({
    types: ["TerminalRuntimeChanged", "TerminalAgentSignaled"],
  });
  ctx.relay.ready.push(() => {
    void listTerminals().then((list) => {
      if (list === null) return;
      runtimes.clear();
      for (const runtime of list) note(runtime);
    });
  });
  ctx.relay.events.push((event) => {
    if (event.type === "TerminalRuntimeChanged") {
      note(event.payload.runtime);
      return;
    }
    if (event.type !== "TerminalAgentSignaled") return;
    const signal = event.payload;
    const label =
      signal.harness in HARNESS_ADAPTERS
        ? HARNESS_ADAPTERS[signal.harness as keyof typeof HARNESS_ADAPTERS]
            .label
        : signal.harness;
    const folder = basename(runtimes.get(signal.terminal)?.cwd_at_start ?? "");
    notice.show({
      kind: signal.kind === "waiting" ? "permission" : signal.kind,
      agent: signal.name ?? label,
      workspace: folder === "" ? undefined : folder,
      body: excerpt(signal.body),
      lead: { kind: "harness", harness: signal.harness },
      target: { kind: "terminal", terminal_ref: signal.terminal },
    });
  });

  // 터미널 진단 기록. 간헐적인 mouse·화면 문제는 재현이 어려워, Settings › Diagnostics의 trace를 켰을 때만 남긴다.
  // 켬 여부는 처음 쓸 때 읽어 두고, 설정이 바뀌었다는 알림이 오면 다시 읽는다. core를 읽지 못하면 꺼진 것으로 본다.
  const traceFile = createTraceFile(join(ctx.dataRoot, "logs"));
  let traceOn: boolean | undefined;
  ctx.relay.events.push((event) => {
    if (
      changedIds(event, "settings").some(
        (key) => key === null || key === DIAGNOSTICS_TRACE_SETTING_KEY,
      )
    ) {
      traceOn = undefined;
    }
  });
  const readTrace = async (): Promise<boolean> => {
    if (traceOn !== undefined) return traceOn;
    const listed = await ctx.coreInternal("memory", "settings", "list", {
      keys: [DIAGNOSTICS_TRACE_SETTING_KEY],
    });
    if (!listed.ok) return false;
    const entry = (
      listed.value as {
        settings?: { key: string; default?: unknown; chosen?: unknown }[];
      }
    ).settings?.find((one) => one.key === DIAGNOSTICS_TRACE_SETTING_KEY);
    traceOn =
      (entry && "chosen" in entry ? entry.chosen : entry?.default) === true;
    return traceOn;
  };

  const handle = (
    channel: string,
    run: (event: IpcEvent, input: unknown) => Promise<unknown>,
  ) =>
    ipc.handle(channel, (event: IpcEvent, input: unknown) => {
      const caller = checkCaller(registry, event);
      return caller.ok ? run(event, input) : caller;
    });

  handle(TERMINAL_INPUT_CHANNEL, async (event, input) => {
    const parsed = checkInput(terminalInputSchema, input);
    if (!parsed.ok) return parsed;
    if (!mayCall(focus, "input", event.sender.id, parsed.value)) {
      return NOT_FOCUSED;
    }
    return reply(await ctx.core.terminalCall("input", parsed.value));
  });
  // 숨거나 focus가 없는 터미널도 새 질의에 답해야 harness가 멎지 않는다. 사람 입력으로 세지 않는다.
  handle(TERMINAL_RESPONSE_CHANNEL, async (event, input) => {
    const parsed = checkInput(terminalInputSchema, input);
    if (!parsed.ok) return parsed;
    if (!mayCall(focus, "response", event.sender.id, parsed.value)) {
      return NOT_SHOWN;
    }
    return reply(
      await ctx.core.terminalCall("input", { ...parsed.value, respond: true }),
    );
  });
  handle(TERMINAL_RESTART_CHANNEL, async (event, input) => {
    const parsed = checkInput(terminalRestartSchema, input);
    if (!parsed.ok) return parsed;
    if (!mayCall(focus, "restart", event.sender.id, parsed.value)) {
      return NOT_FOCUSED;
    }
    return reply(await ctx.core.terminalCall("restart", parsed.value));
  });
  handle(TERMINAL_FOCUS_CHANNEL, async (event, input) => {
    const parsed = checkInput(terminalFocusSchema, input);
    if (!parsed.ok) return parsed;
    const { terminal, generation, focused } = parsed.value;
    if (focused) focus.focus(event.sender.id, terminal, generation);
    else focus.blur(event.sender.id, terminal);
    notice.terminalFocusChanged();
    return { ok: true, value: null };
  });
  handle(TERMINAL_SHOWN_CHANNEL, async (event, input) => {
    const parsed = checkInput(terminalShownSchema, input);
    if (!parsed.ok) return parsed;
    const { terminal, shown } = parsed.value;
    if (shown) focus.show(event.sender.id, terminal);
    else focus.hide(event.sender.id, terminal);
    return { ok: true, value: null };
  });
  handle(TERMINAL_LINK_CHANNEL, async (_event, input) => {
    const parsed = checkInput(terminalLinkSchema, input);
    if (!parsed.ok) return parsed;
    const url = checkExternalUrl(parsed.value.url);
    if (url === undefined) {
      return { ok: true, value: "none" satisfies TerminalLinkWhere };
    }
    const listed = await ctx.coreInternal("memory", "settings", "list", {
      keys: LINK_SETTING_KEY_LIST,
    });
    if (linkWhere(url, listed.ok ? listed.value : null) === "browser_tab") {
      return { ok: true, value: "tab" satisfies TerminalLinkWhere };
    }
    // headless 확인은 사람 화면에 browser를 띄우지 않는다.
    if (!ctx.headless.headless) {
      shell
        .openExternal(url)
        .catch(() => ctx.log("cannot hand the link to the OS"));
    }
    return { ok: true, value: "os" satisfies TerminalLinkWhere };
  });
  // headless 확인은 사람 장치의 clipboard를 건드리지 않는다.
  handle(TERMINAL_COPY_CHANNEL, async (_event, input) => {
    const parsed = checkInput(terminalCopySchema, input);
    if (!parsed.ok) return parsed;
    return await copyTerminalText(
      clipboard,
      parsed.value.text,
      ctx.headless.headless,
    );
  });
  handle(
    TERMINAL_PASTE_CHANNEL,
    async () => await pasteTerminalText(clipboard, ctx.headless.headless),
  );
  handle(TERMINAL_PASTE_IMAGE_CHANNEL, async (event, input) => {
    const parsed = checkInput(terminalPasteImageSchema, input);
    if (!parsed.ok) return parsed;
    if (!mayCall(focus, "input", event.sender.id, parsed.value)) {
      return NOT_FOCUSED;
    }
    return reply(await ctx.core.terminalCall("paste_image", parsed.value));
  });
  handle(TERMINAL_TRACE_CHANNEL, async (event, input) => {
    const parsed = checkInput(terminalTraceSchema, input);
    if (!parsed.ok) return parsed;
    if (!(await readTrace())) return { ok: true, value: false };
    traceFile.append(
      parsed.value.events
        .map((one) => `${JSON.stringify({ win: event.sender.id, ...one })}\n`)
        .join(""),
    );
    return { ok: true, value: true };
  });

  ctx.windowHooks.closed.push((window) => focus.forget(window.contentsId));

  const channels = [
    TERMINAL_INPUT_CHANNEL,
    TERMINAL_RESPONSE_CHANNEL,
    TERMINAL_RESTART_CHANNEL,
    TERMINAL_FOCUS_CHANNEL,
    TERMINAL_SHOWN_CHANNEL,
    TERMINAL_LINK_CHANNEL,
    TERMINAL_COPY_CHANNEL,
    TERMINAL_PASTE_CHANNEL,
    TERMINAL_PASTE_IMAGE_CHANNEL,
    TERMINAL_TRACE_CHANNEL,
  ];
  return {
    async running() {
      const list = (await listTerminals()) ?? [];
      return list.filter(live).map((runtime) => ({
        terminal: runtime.terminal_ref,
        generation: runtime.generation,
      }));
    },
    async close(terminals) {
      await Promise.all(
        terminals.map((one) =>
          ctx.coreInternal("memory", "terminals", "close", one),
        ),
      );
    },
    stop() {
      for (const channel of channels) ipc.removeHandler(channel);
      notice.stop();
    },
  };
}
