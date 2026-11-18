// "Finished" 줄: 사람이 보지 않는 사이 turn이 끝난 탭. 터미널 탭의 coding agent와 lophn Agent session 두 곳의
// 못 본 끝(정본은 core의 `unseen`)을 그대로 읽어 만든다. 탭을 보면 core가 끄니 줄도 저절로 빠진다.
// core는 session 참조만 가지므로 이름·얼굴·제목은 이 창이 아는 값이다: 터미널은 runtime의 harness와 탭 이름,
// lophn session은 session store의 agent로 그 정의와 session 이름을 읽는다.
import { useEffect, useMemo, useState } from "react";
import { HARNESS_ADAPTERS } from "../../../../../protocol/coding-agent/harness-adapter.ts";
import type { HarnessId } from "../../../../../protocol/coding-agent/harness-id.ts";
import { terminalSessionId } from "../../../../../protocol/lophn-agent/session-tag.ts";
import { agentRead } from "../../../../../protocol/lophn-agent/agent-definitions.ts";
import { workspaceSessionRead } from "../../../../../protocol/lophn-agent/agent-sessions.ts";
import {
  type AgentId,
  isLophn,
} from "../../../../../protocol/lophn-agent/workspaces.ts";
import { t } from "@lophn/i18n";
import type { NoticeTarget } from "../../../../ipc/notice.ts";
import type { AvatarFace } from "../../../../ipc/overlay.ts";
import type { CoreSource } from "../connection.ts";
import { followRead, readRoute, readsOf } from "../core-read.ts";
import type { SessionEntry } from "../events/sessions-store.ts";
import { type FinishedTerminal, inboxKey } from "../events/waiting-store.ts";
import type { Inbox, InboxSource } from "./inbox.ts";

export interface FinishedRow {
  readonly id: string;
  /** 누르면 이 탭을 고른다. 다른 기계의 줄은 그 기계(`target.machine`)의 session이다. */
  readonly target: NoticeTarget;
  /** 이 컴퓨터가 아닌 기계의 이름(꼬리표). */
  readonly machineName?: string | undefined;
  /** 아이콘. 터미널은 harness의 vendor 아이콘, lophn agent는 그 agent의 profile이다. */
  readonly face:
    | { readonly kind: "vendor"; readonly harness: string }
    | { readonly kind: "avatar"; readonly profile: AvatarFace };
  readonly label: string;
  readonly title: string;
}

/** lophn session 줄의 누가와 어디서. 읽기 전이거나 읽지 못하면 없다. */
export interface SessionWho {
  readonly agent: string;
  readonly profile: AvatarFace;
  readonly title: string | null;
}

// 굵은 윗줄은 그 탭·session의 이름이고, 작은 아랫줄이 누가(coding agent 제품, lophn agent) 끝냈는지다.
export function finishedRows(
  terminals: readonly FinishedTerminal[],
  sessions: readonly SessionEntry[],
  who: ReadonlyMap<string, SessionWho>,
  /** 이 컴퓨터가 아닌 기계의 줄이면 그 기계와 이름. */
  on?: { readonly machine: string; readonly name: string },
): FinishedRow[] {
  const at = on === undefined ? {} : { machine: on.machine };
  const tag = on === undefined ? {} : { machineName: on.name };
  const idOf = (id: string) =>
    on === undefined ? id : inboxKey(on.machine, id);
  const rows: FinishedRow[] = terminals.map((terminal) => ({
    id: idOf(`terminal:${terminal.terminalRef}`),
    target: { kind: "terminal", terminal_ref: terminal.terminalRef, ...at },
    ...tag,
    face: { kind: "vendor", harness: terminal.harness },
    label: terminal.title,
    title:
      terminal.harness in HARNESS_ADAPTERS
        ? HARNESS_ADAPTERS[terminal.harness as HarnessId].label
        : terminal.harness,
  }));
  for (const entry of sessions) {
    // 못 본 끝이 없는 session은 줄이 없다.
    if (!entry.unseen) continue;
    const known = who.get(entry.session) ?? fallbackWho(entry.agent);
    rows.push({
      id: idOf(`session:${entry.session}`),
      target: { kind: "session", session: entry.session, ...at },
      ...tag,
      face: { kind: "avatar", profile: known.profile },
      label: known.title ?? t("conversation.label.session-untitled"),
      title: known.agent,
    });
  }
  return rows;
}

// 정의를 읽지 못하면 이름 대신 lophn과 그 밖의 agent만 가른다.
function agentName(agent: AgentId | null): string {
  return t(
    agent === null || isLophn(agent)
      ? "waiting.label.agent-lophn"
      : "waiting.label.agent-unnamed",
  );
}

// 올린 이미지는 이름 첫 글자로 갈음한다(Agent 화면 머리와 같다).
function faceOf(name: string, profile: unknown): AvatarFace {
  return (profile as { kind?: string } | undefined)?.kind === "character"
    ? (profile as AvatarFace)
    : { kind: "initial", text: [...name][0] ?? "?" };
}

function fallbackWho(agent: AgentId | null): SessionWho {
  const name = agentName(agent);
  return { agent: name, profile: faceOf(name, undefined), title: null };
}

// 못 본 끝이 있는 lophn session의 agent 정의와 session 이름. agent 이름·profile과 session 이름은 사람이 바꿀 수 있어
// 바뀜에 다시 읽는다. 기계마다 그 기계의 core를 읽고 따라간다.
async function readWho(
  core: CoreSource,
  pairs: readonly { session: string; agent: AgentId }[],
) {
  const found = await Promise.all(
    pairs.map(async ({ session, agent }) => {
      const [definition, record] = await Promise.all([
        readRoute(core, agentRead, { agent }),
        readRoute(core, workspaceSessionRead, { session }),
      ]);
      const name = definition.ok
        ? definition.value.effective.name.value
        : agentName(agent);
      const who: SessionWho = {
        agent: name,
        profile: faceOf(
          name,
          definition.ok ? definition.value.effective.profile.value : null,
        ),
        title: record.ok ? record.value.session.title : null,
      };
      return [session, who] as const;
    }),
  );
  return { ok: true as const, value: new Map(found) };
}

const NO_WHO: ReadonlyMap<string, ReadonlyMap<string, SessionWho>> = new Map();

// key는 기계(`inboxKey(machine, "")`)다.
function useSessionWho(
  sources: readonly InboxSource[],
): ReadonlyMap<string, ReadonlyMap<string, SessionWho>> {
  const asks = sources.map((source) => ({
    source,
    pairs: source.sessions
      .filter((entry) => entry.unseen && entry.agent !== null)
      .map((entry) => ({ session: entry.session, agent: entry.agent! })),
  }));
  const key = JSON.stringify(
    asks.map(({ source, pairs }) => [source.machine, pairs]),
  );
  const [found, setFound] = useState(NO_WHO);
  useEffect(() => {
    const per = new Map<string, ReadonlyMap<string, SessionWho>>();
    const stops = asks
      .filter(({ pairs }) => pairs.length > 0)
      .map(({ source, pairs }) =>
        followRead(
          source.client,
          (core) => readWho(core, pairs),
          pairs.flatMap(({ session, agent }) => [
            ...readsOf(agentRead, { agent }),
            ...readsOf(workspaceSessionRead, { session }),
          ]),
          (loaded) => {
            if (loaded.state !== "ready") return;
            per.set(inboxKey(source.machine, ""), loaded.value);
            setFound(new Map(per));
          },
          () => new Date(),
        ),
      );
    return () => stops.forEach((stop) => stop.stop());
    // asks는 key의 내용이다.
  }, [key]);
  return found;
}

/** 줄 값은 기계마다 지어 합친다. `override`는 gallery가 정해진 줄로 시작할 때만 준다. */
export function useFinished(
  inbox: Inbox,
  override?: readonly FinishedRow[],
): readonly FinishedRow[] {
  const who = useSessionWho(inbox.sources);
  return useMemo(
    () =>
      override ??
      inbox.sources.flatMap((source) =>
        finishedRows(
          source.waiting.finished,
          source.sessions,
          who.get(inboxKey(source.machine, "")) ?? NO_SESSION_WHO,
          source.machine === null
            ? undefined
            : { machine: source.machine, name: source.name ?? "" },
        ),
      ),
    [override, inbox.sources, who],
  );
}

const NO_SESSION_WHO: ReadonlyMap<string, SessionWho> = new Map();

/** 줄이 가리키는 기계. null이 이 컴퓨터다. */
export function targetMachine(target: NoticeTarget): string | null {
  return "machine" in target ? (target.machine ?? null) : null;
}

/** 줄이 가리키는 core의 session 참조(`unseen`의 key). */
export function unseenRefOf(target: NoticeTarget): string | null {
  return target.kind === "terminal"
    ? terminalSessionId(target.terminal_ref)
    : target.kind === "session"
      ? target.session
      : null;
}
