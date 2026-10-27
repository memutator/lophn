// "Finished" 줄: 사람이 보지 않는 사이 turn이 끝난 탭. 터미널 탭의 coding agent와 lophn Agent session 두 곳의
// unseen 상태(정본은 main)를 그대로 읽어 만든다. 탭을 보면 main이 지우니 줄도 저절로 빠진다.
import { useMemo } from "react";
import { HARNESS_ADAPTERS } from "../../../../../protocol/coding-agent/harness-adapter.ts";
import type { HarnessId } from "../../../../../protocol/coding-agent/harness-id.ts";
import { t } from "@lophn/wording";
import type { NoticeTarget } from "../../../../ipc/notice.ts";
import type { AvatarFace } from "../../../../ipc/overlay.ts";
import { useSessions, useWaiting } from "../events/hooks.tsx";
import type { SessionEntry } from "../events/sessions-store.ts";
import type { FinishedTerminal } from "../events/waiting-store.ts";

export interface FinishedRow {
  readonly id: string;
  /** 누르면 이 탭을 고른다. */
  readonly target: NoticeTarget;
  /** 아이콘. 터미널은 harness의 vendor 아이콘, lophn agent는 그 agent의 profile이다. */
  readonly face:
    | { readonly kind: "vendor"; readonly harness: string }
    | { readonly kind: "avatar"; readonly profile: AvatarFace };
  readonly label: string;
  readonly title: string;
}

export function finishedRows(
  terminals: readonly FinishedTerminal[],
  sessions: readonly SessionEntry[],
): FinishedRow[] {
  const rows: FinishedRow[] = terminals.map((terminal) => ({
    id: `terminal:${terminal.terminalRef}`,
    target: { kind: "terminal", terminal_ref: terminal.terminalRef },
    face: { kind: "vendor", harness: terminal.harness },
    label:
      terminal.harness in HARNESS_ADAPTERS
        ? HARNESS_ADAPTERS[terminal.harness as HarnessId].label
        : terminal.harness,
    title: terminal.title,
  }));
  for (const entry of sessions) {
    // coding agent session은 터미널 쪽이 알린다. main의 unseen에도 들지 않는다.
    if (entry.unseen === null) continue;
    rows.push({
      id: `session:${entry.session}`,
      target: { kind: "session", session: entry.session },
      face: { kind: "avatar", profile: entry.unseen.profile },
      label: entry.unseen.agent,
      title: entry.unseen.title ?? t("conversation.label.session-untitled"),
    });
  }
  return rows;
}

/** `override`는 gallery가 정해진 줄로 시작할 때만 준다. */
export function useFinished(
  override?: readonly FinishedRow[],
): readonly FinishedRow[] {
  const { finished } = useWaiting();
  const { sessions } = useSessions();
  return useMemo(
    () => override ?? finishedRows(finished, sessions),
    [override, finished, sessions],
  );
}
