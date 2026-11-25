// project commands 상태와 구독.
// - `useProjectCommandsState`: 한 기계·한 project의 정의·실행·설정.
// - `useRemoteProjectCommandGroups`: 같은 `pri_` 정체성을 가진 연결된 다른 컴퓨터 가운데 `can_run === true`인 컴퓨터 묶음.
// - `useSidebarCommandsIndex`: 사이드바의 모든 로컬 project의 실행 수·실패 여부와 목록.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_PROJECT_COMMAND_SETTINGS,
  type ProjectCommand,
  type ProjectCommandRun,
  type ProjectCommandSettings,
} from "../../../../protocol/projects/project-commands.ts";
import type { MachineData } from "../../desktop/machines/data.ts";
import type { MachineListsValue } from "../../shell/use-left-sidebar.ts";
import { createProjectCommandsSource } from "./source.ts";

export interface ProjectCommandGroup {
  /** null이면 이 컴퓨터, string이면 다른 컴퓨터 id. */
  readonly machine: string | null;
  /** 다른 컴퓨터일 때 머리글에 보일 컴퓨터 이름. */
  readonly machineName?: string;
  readonly projectId: string;
  readonly commands: readonly ProjectCommand[];
  readonly runs: ReadonlyMap<string, ProjectCommandRun>;
  readonly canRun: boolean;
}

export interface ProjectCommandsState {
  readonly commands: readonly ProjectCommand[];
  readonly runs: ReadonlyMap<string, ProjectCommandRun>;
  readonly settings: ProjectCommandSettings;
  readonly canRun: boolean;
  readonly loaded: boolean;
  readonly error: string | null;
  reload(): void;
}

export function projectCommandTabKey(
  machine: string | null,
  projectId: string,
  commandId: string,
): string {
  return `project-cmd-${machine ?? "local"}-${projectId}-${commandId}`;
}

export function isCommandActive(run: ProjectCommandRun | undefined): boolean {
  return run?.status === "starting" || run?.status === "running";
}

export function isCommandFailed(run: ProjectCommandRun | undefined): boolean {
  return run?.status === "failed" || run?.status === "timed_out";
}

function applyRunUpdate(
  prev: ReadonlyMap<string, ProjectCommandRun>,
  run: ProjectCommandRun,
): ReadonlyMap<string, ProjectCommandRun> {
  const next = new Map(prev);
  if (run.status === "idle") next.delete(run.command_id);
  else next.set(run.command_id, run);
  return next;
}

export function previewUrlOf(
  cmd: ProjectCommand,
  run: ProjectCommandRun | undefined,
): string | null {
  if (cmd.preview_url !== undefined && cmd.preview_url.length > 0) {
    return cmd.preview_url;
  }
  return run?.detected_urls[0] ?? null;
}

function toRunMap(
  runs: readonly ProjectCommandRun[],
): ReadonlyMap<string, ProjectCommandRun> {
  return new Map(runs.map((one) => [one.command_id, one]));
}

export function useProjectCommandsState(
  data: MachineData | null,
  projectId: string | null,
  options: {
    readonly includeEnv?: boolean;
    readonly onRunEvent?: (
      run: ProjectCommandRun,
      cmd?: ProjectCommand,
    ) => void;
  } = {},
): ProjectCommandsState {
  const [commands, setCommands] = useState<readonly ProjectCommand[]>([]);
  const [runs, setRuns] = useState<ReadonlyMap<string, ProjectCommandRun>>(
    () => new Map(),
  );
  const [settings, setSettings] = useState<ProjectCommandSettings>(
    DEFAULT_PROJECT_COMMAND_SETTINGS,
  );
  const [canRun, setCanRun] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const onRunEventRef = useRef(options.onRunEvent);
  onRunEventRef.current = options.onRunEvent;

  const source = useMemo(
    () => (data === null ? null : createProjectCommandsSource(data.core)),
    [data],
  );
  const includeEnv = options.includeEnv === true;

  const fetchList = useCallback(async () => {
    if (source === null || projectId === null) {
      setCommands([]);
      setRuns(new Map());
      setSettings(DEFAULT_PROJECT_COMMAND_SETTINGS);
      setCanRun(false);
      setLoaded(true);
      setError(null);
      return;
    }
    const res = await source.list(projectId, { includeEnv });
    if (!res.ok) {
      setError(res.error.message);
      setLoaded(true);
      return;
    }
    setCommands(res.value.commands);
    setRuns(toRunMap(res.value.runs));
    setSettings(res.value.settings);
    setCanRun(res.value.can_run);
    setError(null);
    setLoaded(true);
  }, [source, projectId, includeEnv]);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    void (async () => {
      if (!alive) return;
      await fetchList();
    })();
    if (data === null || projectId === null) {
      return () => {
        alive = false;
      };
    }
    const stop = data.events.subscribe(
      { types: ["ProjectCommandsChanged", "ProjectCommandRunChanged"] },
      (message) => {
        if (!alive) return;
        if (message.kind === "ready") {
          void fetchList();
          return;
        }
        if (message.kind !== "event") return;
        const ev = message.event;
        if (
          ev.type === "ProjectCommandsChanged" &&
          ev.payload.project === projectId
        ) {
          void fetchList();
        } else if (
          ev.type === "ProjectCommandRunChanged" &&
          ev.payload.project === projectId
        ) {
          const run = ev.payload.run;
          setRuns((prev) => applyRunUpdate(prev, run));
          const cmd = commandsRef.current.find((c) => c.id === run.command_id);
          onRunEventRef.current?.(run, cmd);
        }
      },
    );
    return () => {
      alive = false;
      stop();
    };
  }, [data, projectId, fetchList]);

  return {
    commands,
    runs,
    settings,
    canRun,
    loaded,
    error,
    reload: () => void fetchList(),
  };
}

interface RemotePeerTarget {
  readonly machine: string;
  readonly machineName: string;
  readonly projectId: string;
}

/**
 * 같은 `pri_` identity를 가진 온라인 다른 컴퓨터들의 project commands 목록.
 * 받는 컴퓨터가 터미널 입력을 허락(`can_run === true`)한 경우에만 묶음에 포함한다.
 */
export function useRemoteProjectCommandGroups(
  identity: string | null,
  machineLists: MachineListsValue,
): readonly ProjectCommandGroup[] {
  const peers = useMemo((): readonly RemotePeerTarget[] => {
    if (identity === null) return [];
    const out: RemotePeerTarget[] = [];
    for (const list of machineLists.lists) {
      if (list.machine === null || !list.live) continue;
      const match = list.projects.find((p) => p.identity === identity);
      if (match === undefined) continue;
      out.push({
        machine: list.machine,
        machineName: list.name,
        projectId: match.id,
      });
    }
    return out;
  }, [identity, machineLists.lists]);

  const peerKey = peers
    .map((p) => `${p.machine}:${p.projectId}:${p.machineName}`)
    .join("|");

  const [groups, setGroups] = useState<
    ReadonlyMap<string, ProjectCommandGroup>
  >(() => new Map());

  useEffect(() => {
    if (peers.length === 0) {
      setGroups(new Map());
      return;
    }
    let alive = true;
    const stops: (() => void)[] = [];

    for (const peer of peers) {
      const data = machineLists.dataOf(peer.machine);
      const source = createProjectCommandsSource(data.core);
      const loadPeer = async () => {
        const res = await source.list(peer.projectId);
        if (!alive) return;
        setGroups((prev) => {
          const next = new Map(prev);
          if (!res.ok || !res.value.can_run) {
            next.delete(peer.machine);
          } else {
            next.set(peer.machine, {
              machine: peer.machine,
              machineName: peer.machineName,
              projectId: peer.projectId,
              commands: res.value.commands,
              runs: toRunMap(res.value.runs),
              canRun: true,
            });
          }
          return next;
        });
      };

      void loadPeer();
      const stop = data.events.subscribe(
        { types: ["ProjectCommandsChanged", "ProjectCommandRunChanged"] },
        (message) => {
          if (!alive) return;
          if (message.kind === "ready") {
            void loadPeer();
            return;
          }
          if (message.kind === "disconnected") {
            setGroups((prev) => {
              if (!prev.has(peer.machine)) return prev;
              const next = new Map(prev);
              next.delete(peer.machine);
              return next;
            });
            return;
          }
          const ev = message.event;
          if (
            ev.type === "ProjectCommandsChanged" &&
            ev.payload.project === peer.projectId
          ) {
            void loadPeer();
          } else if (
            ev.type === "ProjectCommandRunChanged" &&
            ev.payload.project === peer.projectId
          ) {
            setGroups((prev) => {
              const existing = prev.get(peer.machine);
              if (existing === undefined) return prev;
              const nextRuns = applyRunUpdate(existing.runs, ev.payload.run);
              const next = new Map(prev);
              next.set(peer.machine, { ...existing, runs: nextRuns });
              return next;
            });
          }
        },
      );
      stops.push(stop);
    }

    return () => {
      alive = false;
      for (const stop of stops) stop();
    };
  }, [peerKey, machineLists.dataOf]);

  return useMemo(
    () =>
      peers.flatMap((peer) => {
        const group = groups.get(peer.machine);
        return group === undefined || group.commands.length === 0
          ? []
          : [group];
      }),
    [peers, groups],
  );
}

export interface SidebarProjectCommandsEntry {
  readonly projectId: string;
  readonly commands: readonly ProjectCommand[];
  readonly runs: ReadonlyMap<string, ProjectCommandRun>;
  readonly runningCount: number;
  readonly hasFailed: boolean;
}

/** 사이드바의 모든 로컬 project의 명령과 실행 상태(표시 점·카운트 및 + hover 공용 목록용). */
export function useSidebarCommandsIndex(
  machineLists: MachineListsValue,
): ReadonlyMap<string, SidebarProjectCommandsEntry> {
  const localList = machineLists.lists.find((one) => one.machine === null);
  const projectIds = useMemo(
    () => (localList?.projects ?? []).map((p) => p.id),
    [localList?.projects],
  );
  const idsKey = projectIds.join(",");
  const here = machineLists.dataOf(null);
  const [byProject, setByProject] = useState<
    ReadonlyMap<string, SidebarProjectCommandsEntry>
  >(() => new Map());

  const makeEntry = (
    projectId: string,
    commands: readonly ProjectCommand[],
    runs: ReadonlyMap<string, ProjectCommandRun>,
  ): SidebarProjectCommandsEntry => {
    let runningCount = 0;
    let hasFailed = false;
    for (const cmd of commands) {
      const run = runs.get(cmd.id);
      if (isCommandActive(run)) runningCount++;
      else if (isCommandFailed(run)) hasFailed = true;
    }
    return { projectId, commands, runs, runningCount, hasFailed };
  };

  useEffect(() => {
    if (projectIds.length === 0) {
      setByProject(new Map());
      return;
    }
    let alive = true;
    const source = createProjectCommandsSource(here.core);
    const loadOne = async (projectId: string) => {
      const res = await source.list(projectId);
      if (!alive || !res.ok) return;
      setByProject((prev) => {
        const next = new Map(prev);
        next.set(
          projectId,
          makeEntry(projectId, res.value.commands, toRunMap(res.value.runs)),
        );
        return next;
      });
    };
    const loadAll = () => {
      for (const projectId of projectIds) void loadOne(projectId);
    };
    loadAll();

    const idSet = new Set(projectIds);
    const stop = here.events.subscribe(
      { types: ["ProjectCommandsChanged", "ProjectCommandRunChanged"] },
      (message) => {
        if (!alive) return;
        if (message.kind === "ready") {
          loadAll();
          return;
        }
        if (message.kind !== "event") return;
        const ev = message.event;
        if (ev.type === "ProjectCommandsChanged") {
          if (idSet.has(ev.payload.project)) void loadOne(ev.payload.project);
        } else if (ev.type === "ProjectCommandRunChanged") {
          const { project, run } = ev.payload;
          if (!idSet.has(project)) return;
          setByProject((prev) => {
            const current = prev.get(project);
            if (current === undefined) {
              void loadOne(project);
              return prev;
            }
            const nextRuns = applyRunUpdate(current.runs, run);
            const next = new Map(prev);
            next.set(project, makeEntry(project, current.commands, nextRuns));
            return next;
          });
        }
      },
    );
    return () => {
      alive = false;
      stop();
    };
  }, [idsKey, here]);

  return byProject;
}
