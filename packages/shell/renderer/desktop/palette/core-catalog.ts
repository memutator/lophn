// CatalogSource는 project 목록과 앱 목록에서 보관하지 않은 것의 이름만 모은다. 팔레트의 project·앱 행이 쓴다.
// core를 따로 부르지 않고 런처의 통로를 그대로 쓴다. project는 목록(sidebar)과 같은 규칙(`mergeWorkspaces`)으로 기계를 건너
// 합친다: 같은 project(같은 id)는 한 행이고, 이 컴퓨터에 없는 project는 그 기계의 이름을 단 행이다.
import type { AppsSource } from "../../apps/source.ts";
import { homeName } from "../../shell/left-sidebar-workspaces.ts";
import type { MachineHub } from "../machines/data.ts";
import type { MachinesSource } from "../machines/source.ts";
import {
  type ListedProject,
  mergeWorkspaces,
} from "../workspaces/projects/merged.ts";
import type {
  ProjectItem,
  ProjectsSource,
} from "../workspaces/projects/source.ts";
import type { CatalogSource } from "./catalog.ts";

/** 연결된 다른 기계의 project 통로. */
export type OtherProjects = () => readonly {
  readonly machine: string;
  readonly name: string;
  readonly projects: ProjectsSource;
}[];

export function connectedProjects(
  hub: MachineHub,
  machines: MachinesSource | null,
): OtherProjects {
  return () => {
    const view = machines?.get();
    const here = view?.thisComputer?.id;
    return (view?.machines ?? [])
      .filter((one) => one.status === "connected" && one.id !== here)
      .map((one) => ({
        machine: one.id,
        name: one.name,
        projects: hub.get(one.id).projects,
      }));
  };
}

// 팔레트는 clone 주소를 쓰지 않는다.
const listed = (rows: readonly ProjectItem[]): ListedProject[] =>
  rows.map((row) => ({
    id: row.id,
    title: row.title,
    archived: row.archived,
    identity: row.identity,
    repo: row.repo,
    remote: null,
  }));

export function catalogSource(
  projects: ProjectsSource,
  apps: AppsSource,
  others: OtherProjects = () => [],
): CatalogSource {
  return {
    async catalog() {
      const more = others();
      const [projectRows, appRows, moreRows] = await Promise.all([
        projects.list(),
        apps.list(),
        Promise.all(more.map((one) => one.projects.list())),
      ]);
      if (!projectRows.ok) return projectRows;
      if (!appRows.ok) return appRows;
      // 읽지 못한 기계는 팔레트에서 빠진다.
      const lists = [
        {
          machine: null,
          name: "",
          live: true,
          apps: [],
          projects: listed(projectRows.value),
        },
        ...more.flatMap((one, at) => {
          const rows = moreRows[at];
          return rows?.ok === true
            ? [
                {
                  machine: one.machine,
                  name: one.name,
                  live: true,
                  apps: [],
                  projects: listed(rows.value),
                },
              ]
            : [];
        }),
      ];
      const names = new Map(more.map((one) => [one.machine, one.name]));
      return {
        ok: true,
        value: {
          projects: mergeWorkspaces(lists, homeName).flatMap((row) =>
            row.ref.kind !== "project"
              ? []
              : [
                  {
                    id: row.ref.id,
                    title: row.name,
                    ...(row.ref.machine === undefined
                      ? {}
                      : {
                          machine: row.ref.machine,
                          machineName: names.get(row.ref.machine) ?? "",
                        }),
                  },
                ],
          ),
          apps: appRows.value
            .filter((row) => !row.archived)
            .map((row) => ({
              id: row.id,
              title: row.name,
            })),
        },
      };
    },
  };
}
