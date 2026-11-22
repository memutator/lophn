// sidebar의 Agents 묶음이 그리는 줄. source.list가 받은 순서 그대로 옮긴다(lophn이 첫 줄).
// agent가 바뀌면(이 창의 Agents 탭, 다른 창, CLI) core의 변경 알림으로 다시 읽는다.
import { useEffect, useMemo } from "react";

import {
  isLophn,
  lophnIdOf,
} from "../../../../protocol/lophn-agent/workspaces.ts";
import { useFollowedRead } from "../../desktop/connection/core-read.ts";
import type { AvatarLook } from "../../parts/avatar/avatar.tsx";
import { useRemembered } from "../../shell/sidebar-memory.tsx";
import type { SidebarAgent } from "../sidebar/sidebar-agent.ts";
import { codingFaceOf } from "./coding-face.ts";
import { workspaceOf } from "./core-extensions.ts";
import type { AgentListRow, AgentsSource } from "./source.ts";

export function useSidebarAgents(
  source: AgentsSource | undefined,
  project: string | null,
): {
  readonly agents: readonly SidebarAgent[];
  /** 모든 workspace의 lophn 이름(agent id → 이름). 아직 읽지 못했으면 비어 있다. */
  readonly lophnNames: Readonly<Record<string, string>>;
} {
  // workspace를 옮기면 새 목록을 읽기 전까지 창의 마지막 값에서 시작한다(범위 agent는 읽은 뒤 바뀐다). 비면 sidebar의 lophn session 줄이 모두 빠졌다 돌아온다.
  // 남은 lophn 줄은 옛 workspace의 것이라 id만 이 workspace의 lophn으로 바꿔 읽는다.
  const [remembered, setAgents] = useRemembered("agents");
  const mine = lophnIdOf(project === null ? null : workspaceOf(project));
  const agents = useMemo(
    () =>
      remembered.map((agent) =>
        isLophn(agent.assignment) ? { ...agent, assignment: mine } : agent,
      ),
    [remembered, mine],
  );
  const [lophnNames, setLophnNames] = useRemembered("lophnNames");
  // 목록은 avatar 이미지를 미리 받아 두는 source 읽기라 route 하나로 끝나지 않는다.
  const read = useFollowedRead<{
    readonly rows: readonly AgentListRow[];
    readonly names: Readonly<Record<string, string>> | null;
  }>(
    async () => {
      if (source === undefined) return { ok: false as const };
      const [list, names] = await Promise.all([
        source.list(project ?? "home"),
        source.lophnNames(),
      ]);
      return list.ok
        ? {
            ok: true as const,
            value: { rows: list.value, names: names.ok ? names.value : null },
          }
        : { ok: false as const };
    },
    ["agents"],
    `${source === undefined ? "" : "source"}|${project ?? ""}`,
  ).loaded;
  useEffect(() => {
    if (read.state !== "ready" || source === undefined) return;
    const { names } = read.value;
    if (names !== null) setLophnNames(() => ({ ...names }));
    setAgents(() =>
      read.value.rows.map((row) => {
        const avatar: AvatarLook =
          codingFaceOf(row.assignment) ??
          (row.avatar.kind === "character"
            ? row.avatar
            : {
                kind: "image",
                src: source.imageSrc(project, row.assignment, row.avatar.image),
              });
        return {
          assignment: row.assignment,
          name: row.name,
          avatar,
          // 답을 기다리는 session은 conversation 쪽이 알려 줄 때 켠다.
          waiting: false,
        };
      }),
    );
  }, [read, source, project, setAgents, setLophnNames]);
  return { agents, lophnNames };
}
