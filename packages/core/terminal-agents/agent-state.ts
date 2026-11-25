// 터미널 하나의 coding agent 상태(GUI handle과 PTY tracker)를 한 값으로 합치고, 제목 우선순위와 비파괴 규칙을 지킨다.
import { HARNESS_ADAPTERS } from "../../protocol/coding-agent/harness-adapter.ts";
import type { TerminalAgent } from "../../protocol/coding-agent/terminals.ts";
import type { GuiTabSession } from "./gui.ts";

export function harnessDefaultLabel(harness: string): string | null {
  return (
    (HARNESS_ADAPTERS as Record<string, { label: string } | undefined>)[harness]
      ?.label ?? null
  );
}

/**
 * 저장·표시에 쓸 수 있는 의미 있는 제목만 남긴다.
 * null, 빈 문자열/공백, harness 기본 라벨("Antigravity", "Claude Code" 등)은 null로 돌려 기존 제목을 덮지 못하게 한다.
 */
export function cleanAgentTitle(
  value: string | null | undefined,
  harness?: string,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (harness !== undefined) {
    const label = harnessDefaultLabel(harness);
    if (label !== null && trimmed === label) return null;
  }
  return trimmed;
}

export type SavedAgentTitle = {
  harness: string;
  session: string;
  title: string | null;
  name: string | null;
  pinned: boolean;
};

/**
 * 터미널 하나의 단일 `TerminalAgent`를 계산한다.
 * - GUI handle이 열려 있고 `view === "gui"`면 handle 상태(`source: "gui"`)가 진실이다(hook 불필요).
 * - 제목 우선순위: `user_pinned > session_title (ACP / 요약 DB) > first_prompt > harness_label`.
 * - 아니면 PTY tracker 결과(`source: "pty"`)를 낸다.
 */
export function resolveTerminalAgent(input: {
  tab: GuiTabSession | undefined;
  trackerAgent: TerminalAgent | undefined;
  saved: SavedAgentTitle | undefined;
}): TerminalAgent | null {
  const { tab, trackerAgent, saved } = input;
  if (tab !== undefined && tab.view === "gui") {
    const session = tab.cli_session ?? trackerAgent?.session ?? null;
    const sameTrackerSession =
      trackerAgent !== undefined &&
      (session === null ||
        trackerAgent.session === undefined ||
        trackerAgent.session === session);
    const savedMatches =
      saved !== undefined &&
      saved.harness === tab.harness &&
      session !== null &&
      saved.session === session;

    const guiSessionTitle = cleanAgentTitle(tab.title, tab.harness);
    const pinnedName =
      savedMatches && saved.pinned ? cleanAgentTitle(saved.name) : null;
    const savedName = savedMatches
      ? cleanAgentTitle(saved.name, tab.harness)
      : null;
    const trackerName = sameTrackerSession
      ? cleanAgentTitle(trackerAgent?.name, tab.harness)
      : null;

    const name = pinnedName ?? guiSessionTitle ?? savedName ?? trackerName;

    const savedPrompt = savedMatches
      ? cleanAgentTitle(saved.title, tab.harness)
      : null;
    const trackerPrompt = sameTrackerSession
      ? cleanAgentTitle(trackerAgent?.title, tab.harness)
      : null;
    const title = savedPrompt ?? trackerPrompt;

    return {
      harness: tab.harness,
      source: "gui",
      state: tab.state,
      hooked: trackerAgent?.hooked ?? false,
      ...(session === null ? {} : { session }),
      ...(title === null ? {} : { title }),
      ...(name === null ? {} : { name }),
    };
  }

  if (trackerAgent === undefined) return null;
  return {
    ...trackerAgent,
    source: "pty",
  };
}
