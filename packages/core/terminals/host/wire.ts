// PTY host와 core(supervisor) 사이 줄 모양이다. core가 stdin에 요청을 한 줄씩 쓰고(`id`를 붙인다), host는 stdout에 답, 묶은 출력,
// 끝난 process의 runtime, foreground 바뀜을 한 줄씩 쓴다. 이 module 밖은 이 모양을 모른다(`ports.ts`의 `Terminals`로 닿는다).
import type {
  TerminalFailure,
  TerminalOutput,
  TerminalRuntime,
} from "../../../protocol/coding-agent/terminals.ts";
import type { TerminalScreen } from "../ports.ts";

type FolderRecord = { folder_ref: string; path: string };

export type HostRequest =
  | {
      type: "open";
      project: string;
      folder_ref?: string;
      /** core가 등록 폴더 안으로 확인한 시작 폴더. 없으면 folder_ref의 폴더다. */
      cwd?: string;
      folders: readonly FolderRecord[];
      columns: number;
      rows: number;
      /** shell env에 더할 값. 다시 시작해도 같은 값을 쓴다. */
      env?: Record<string, string>;
      /** 지정하면 대화형 셸이 아니라 명령 전용 PTY(`shell -lc <exec>` 등)로 바로 실행한다. */
      exec?: string;
      /** 지정하면 해당 터미널 참조를 재사용해 generation을 올려 다시 띄운다. */
      terminal_ref?: string;
      /** project command 전용 PTY 표시. */
      dedicated?: true;
    }
  | {
      type: "input";
      terminal_ref: string;
      generation: number;
      text: string;
    }
  | {
      type: "resize";
      terminal_ref: string;
      generation: number;
      columns: number;
      rows: number;
      /** 폰이 잡은 크기다. 없으면 desktop 탭이 잡은 것이고 폰의 크기를 놓는다. */
      remote?: true;
    }
  /** 폰이 잡은 크기를 놓는다(크기는 그대로). desktop 탭이 칸에 다시 맞춘다. */
  | { type: "release"; terminal_ref: string; generation: number }
  | {
      type: "signal";
      terminal_ref: string;
      generation: number;
      /** foreground process group에 보낸다. SIGKILL은 없다(대화 기록을 덜 쓴 채 끊지 않는다). */
      signal: "SIGINT" | "SIGTERM";
    }
  | { type: "close"; terminal_ref: string; generation: number }
  | { type: "restart"; terminal_ref: string; generation: number }
  | { type: "snapshot"; terminal_ref: string; after_seq?: number }
  /** 지금 화면을 서식 run의 줄로 읽는다(폰의 터미널 보기). tail은 viewport 위 scrollback 줄 수다. */
  | {
      type: "screen";
      terminal_ref: string;
      tail: number;
      /** 이전에 읽은 화면의 기준. 같으면 host가 화면을 다시 직렬화하지 않고 `unchanged: true`만 답한다. */
      after_seq?: number;
      generation?: number;
      columns?: number;
      rows?: number;
      /** 이전에 받은 scrollback key. 같으면 host가 scrollback 줄을 생략한다. */
      scrollback_key?: string;
    };

export type HostReject = {
  ok: false;
  reason: TerminalFailure;
  message: string;
};
export type HostReply = { ok: true; runtime: TerminalRuntime } | HostReject;

/**
 * host가 들고 있는 화면을 다시 읽은 결과. after_seq 뒤 출력이 있으면 output은 지금 화면을 직렬화한 chunk 하나이고 seq는 그 화면이
 * 담은 마지막 출력이다. 없으면 비어 있다.
 */
export type HostSnapshotReply = {
  ok: true;
  runtime: TerminalRuntime;
  output: TerminalOutput[];
};

export type HostScreenPayload = Omit<TerminalScreen, "scrollback"> & {
  scrollback?: TerminalScreen["scrollback"];
  scrollback_key: string;
};

export type HostScreenReply =
  | {
      ok: true;
      runtime: TerminalRuntime;
      unchanged: true;
    }
  | {
      ok: true;
      runtime: TerminalRuntime;
      screen: HostScreenPayload;
    };

export type ForegroundChange = {
  terminal_ref: string;
  generation: number;
  argv: string[] | null;
};

export type ClipboardWrite = {
  terminal_ref: string;
  generation: number;
  bytes: number;
};

/** host가 stdout에 쓰는 줄 하나. 요청의 답은 id와 reply(와 runtime)를 싣는다. */
export type HostLine = {
  id?: string;
  reply?: HostReply | HostSnapshotReply | HostScreenReply;
  runtime?: TerminalRuntime;
  output?: TerminalOutput[];
  foreground?: ForegroundChange;
  clipboard?: ClipboardWrite;
};
