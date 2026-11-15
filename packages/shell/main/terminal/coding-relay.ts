// 터미널 탭의 GUI handle을 core에 잇는다(폰의 coding session). handle마다 연결(`/host-link`)로 snapshot을 먼저, 이어서 창과 같은
// 20 ms 묶음의 update를 올리고, 닫히면 알린다. core는 이것을 사본으로 접어 `acp/snapshot`·`AcpUpdated`로 폰에 낸다. 연결이 없을
// 때는 쌓지 않는다: 연결이 (다시) 열릴 때마다 모든 handle의 snapshot을 처음부터 다시 보낸다(core가 다시 떴어도 같다).
// core가 넘긴 폰의 입력(`coding_input`)과 view 바꾸기(`coding_switch`)를 handle과 탭 toggle에 넘긴다.
// test가 돌도록 Electron을 import하지 않는다.
import {
  type AcpState,
  type AcpUpdate,
  acpInputSchema,
} from "../../../protocol/acp/mod.ts";
import { guiSessionId } from "../../../protocol/lophn-agent/session-tag.ts";
import { attachBatched, type TabGui, type TabHandle } from "./gui.ts";

// `ctx.hostLink`(`desktop/core/host-link.ts`) 중 이 relay가 쓰는 만큼이다. host-link·host-queue protocol을 import하면 이 file이 속한
// tsconfig(`noUncheckedIndexedAccess`)가 protocol 전체를 다시 보므로 모양만 둔다. wiring이 `ctx.hostLink`에 잇는다.
export type CodingFrame =
  | {
      type: "coding_sync";
      session: string;
      snapshot?: AcpState;
      updates?: AcpUpdate[];
    }
  | { type: "coding_closed"; session: string };
export type CodingOutput =
  | { content: { type: "text"; text: string }[] }
  | {
      error: {
        code: "invalid_input" | "not_found" | "conflict" | "unavailable";
        message: string;
        details?: { reason: string };
      };
    };
export type CodingLink = {
  /** 연결이 열려 있으면 보내고 true다. 없으면 버린다. */
  send(frame: CodingFrame): boolean;
  /** 연결이 (다시) 열릴 때마다 부른다. */
  onOpen(handler: () => void): void;
  /** host 요청 `coding_input`의 처리기. */
  onInput(
    handler: (payload: {
      session: string;
      input: Record<string, unknown>;
    }) => Promise<CodingOutput>,
  ): void;
  /** host 요청 `coding_switch`의 처리기. */
  onSwitch(
    handler: (payload: {
      terminal_ref: string;
      to: "gui" | "tui";
    }) => Promise<CodingOutput>,
  ): void;
};

const OK: CodingOutput = { content: [{ type: "text", text: "ok" }] };

function failed(
  code: "invalid_input" | "not_found" | "conflict" | "unavailable",
  message: string,
  reason?: string,
): CodingOutput {
  return {
    error: {
      code,
      message,
      ...(reason === undefined ? {} : { details: { reason } }),
    },
  };
}

export function createCodingRelay(deps: {
  gui: Pick<TabGui, "onHandle" | "input" | "toggle" | "current">;
  link: CodingLink;
  after(ms: number, run: () => void): () => void;
  /** 그 터미널이 살아 있다. */
  alive(terminalRef: string): boolean;
  platform: string;
}): { stop(): void } {
  const { gui, link } = deps;
  // ACP session(`ses_<터미널 ULID>`)마다 지금 handle. 한 터미널에 handle은 하나다.
  const live = new Map<string, { handle: TabHandle; stop: () => void }>();
  let stopped = false;

  function attach(session: string, entry: { handle: TabHandle }): () => void {
    return attachBatched(entry.handle, deps.after, {
      snapshot: (snapshot) =>
        void link.send({ type: "coding_sync", session, snapshot }),
      updates: (updates) =>
        void link.send({ type: "coding_sync", session, updates }),
      closed() {
        // toggle로 새 handle이 먼저 들어왔으면 그 session은 새 handle의 것이다.
        if (live.get(session) !== entry) return;
        live.delete(session);
        link.send({ type: "coding_closed", session });
      },
    });
  }

  const offHandle = gui.onHandle((handle) => {
    if (stopped) return;
    const session = guiSessionId(handle.terminal);
    const entry = { handle, stop: () => {} };
    live.set(session, entry);
    entry.stop = attach(session, entry);
  });

  // 다시 붙으면 처음부터 보낸다. 다시 attach하면 handle이 지금 상태를 snapshot으로 먼저 준다.
  link.onOpen(() => {
    if (stopped) return;
    for (const [session, entry] of live) {
      entry.stop();
      entry.stop = attach(session, entry);
    }
  });

  link.onInput(async ({ session, input }) => {
    // protocol은 입력을 record로만 본다(host-link가 acp를 import하면 cycle이다). handle에 넘기기 전에 여기서 본다.
    const parsed = acpInputSchema.safeParse(input);
    if (!parsed.success) {
      return failed("invalid_input", "The ACP input is not valid.");
    }
    const entry = live.get(session);
    if (entry === undefined || !gui.input(entry.handle.id, parsed.data)) {
      return failed("not_found", "No chat view is open for this session.");
    }
    return OK;
  });

  link.onSwitch(async ({ terminal_ref: terminalRef, to }) => {
    // terminal-host가 foreground를 모른다(harness-gui 비목표).
    if (deps.platform === "win32") {
      return failed(
        "unavailable",
        "Switching between chat and terminal is not available on Windows.",
        "unsupported_os",
      );
    }
    if (!deps.alive(terminalRef)) {
      return failed("not_found", "The terminal is gone.");
    }
    if ((gui.current(terminalRef)?.view ?? "tui") === to) {
      return failed("conflict", `The terminal is already in ${to} view.`);
    }
    const reply = await gui.toggle({ terminal_ref: terminalRef, to }, "phone");
    if (reply.ok) return OK;
    switch (reply.reason) {
      case "no_session":
      case "not_running":
        return failed("invalid_input", reply.message, reply.reason);
      default:
        return failed("unavailable", reply.message, reply.reason);
    }
  });

  return {
    stop() {
      stopped = true;
      offHandle();
      for (const entry of live.values()) entry.stop();
      live.clear();
    },
  };
}
