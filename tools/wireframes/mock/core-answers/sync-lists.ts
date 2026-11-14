// project·앱 목록 화면이 core에서 읽는 route의 gallery 답. 쓰기를 맡는 fake의 화면 값(ProjectItem, AppRow)에서 route 기록을 만든다.
import { appList } from "../../../../packages/protocol/apps/apps.ts";
import { releasesListRecords } from "../../../../packages/protocol/apps/activation/activation.ts";
import { projectApi } from "../../../../packages/protocol/projects/project-api.ts";
import type {
  AppRow,
  AppsSource,
} from "../../../../packages/shell/renderer/apps/source.ts";
import type { CoreSource } from "../../../../packages/shell/renderer/desktop/connection/connection.ts";
import type {
  ProjectItem,
  ProjectsSource,
} from "../../../../packages/shell/renderer/desktop/workspaces/projects/source.ts";

const COMMON = { as_of_seq: "0", next_cursor: null };
const AT = "2026-11-01T09:00:00.000Z";
const HASH = "0".repeat(64);

function projectRecord(item: ProjectItem) {
  return {
    id: item.id,
    name: item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title: item.title,
    purpose: item.purpose,
    revision: item.revision,
    status: item.archived ? ("archived" as const) : ("active" as const),
    folders: item.folders.map((folder) => ({ ...folder })),
  };
}

function appRecord(row: AppRow) {
  return {
    id: row.id,
    slug: row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: row.name,
    description: "",
    planning_version: null,
    source_path: null,
    folders: [],
    active_release: row.release,
    revision: row.revision,
    run_enabled: false,
    status: row.archived ? ("archived" as const) : ("active" as const),
  };
}

function releaseRecord(
  row: AppRow & { release: string; releaseNumber: number },
) {
  return {
    id: row.release,
    app: row.id,
    number: row.releaseNumber,
    code_commit: "0".repeat(40),
    bundle_hash: HASH,
    declaration_hash: HASH,
    data_schema: 0,
    data_changes: [],
    created_by: "user" as const,
    created_at: AT,
    status: "active" as const,
    activation: null,
    activated_at: AT,
    failure: null,
  };
}

const ROUTES = [
  projectApi.list,
  projectApi.get,
  appList,
  releasesListRecords,
] as const;

/**
 * project 목록·한 project, 앱 목록, 켜진 release 번호를 읽기마다 쓰기를 맡는 fake(ProjectsSource, AppsSource)의 지금
 * 값으로 답한다. 그 밖의 call은 감싼 source로 간다. fake의 list를 바꾼 page(빈 Home)도 그대로 따른다.
 */
export function withSyncLists(
  source: CoreSource,
  projects: ProjectsSource,
  apps: AppsSource,
): CoreSource {
  return {
    ...source,
    async call(input) {
      const route = ROUTES.find(
        (one) =>
          one.kind === input.kind &&
          one.resource === input.resource &&
          one.method === input.method,
      );
      if (route === undefined) return source.call(input);
      const [projectRead, appRead] = await Promise.all([
        projects.list(),
        apps.list(),
      ]);
      const projectRecords = (projectRead.ok ? projectRead.value : []).map(
        projectRecord,
      );
      const rows = appRead.ok ? appRead.value : [];
      if (route === projectApi.list) {
        return { ok: true, value: { ...COMMON, projects: projectRecords } };
      }
      if (route === projectApi.get) {
        const wanted = (input.body as { project: string }).project;
        const project = projectRecords.find((one) => one.id === wanted);
        return project === undefined
          ? { ok: false, error: { code: "not_found", message: wanted } }
          : { ok: true, value: { ...COMMON, project } };
      }
      if (route === appList) {
        return { ok: true, value: { ...COMMON, apps: rows.map(appRecord) } };
      }
      return {
        ok: true,
        value: {
          ...COMMON,
          releases: rows.flatMap((row) =>
            row.release === null || row.releaseNumber === null
              ? []
              : [
                  releaseRecord({
                    ...row,
                    release: row.release,
                    releaseNumber: row.releaseNumber,
                  }),
                ],
          ),
        },
      };
    },
  };
}
