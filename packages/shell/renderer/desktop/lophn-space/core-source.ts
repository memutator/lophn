// LophnSource를 main의 core 통로로 만든다. token·port는 main에 있고 이 쪽은 route 이름과
// 입력만 보낸다. 응답은 main의 contract client가 route output schema로 이미 검사했다.
// 아래 응답 모양은 그 schema(outline.root, search.query, projects.get·list·update)에서
// 이 화면이 읽는 field만 옮긴 것이다.
import type { CoreCall } from "../../../ipc/core.ts";
import type { CoreSource } from "../connection/connection.ts";
import { searchBody } from "./model.ts";
import type {
  Catalog,
  Coverage,
  LophnSource,
  Named,
  ProjectRow,
  SearchHit,
  SourceResult,
} from "./source.ts";

interface RootPage {
  entries: (
    | { kind: "project" | "app"; id: string; title: string }
    | { kind: "unplaced" }
  )[];
  complete: boolean;
  next_cursor: string | null;
}

interface CoverageValue {
  lagging: boolean;
  rebuilding: boolean;
  omissions: unknown[];
}

interface SearchValue {
  results: {
    document: string;
    version: string;
    latest_version: string;
    format: { name: string };
    section: string | null;
    title: string;
    snippet: string;
    match_source: "original" | "summary" | "topic";
  }[];
  coverage: CoverageValue;
  next_cursor: string | null;
}

interface ProjectValue {
  id: string;
  name: string;
  title: string;
  purpose: string;
  revision: string;
  status: "active" | "archived";
}

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 20;

async function call<T>(
  core: CoreSource,
  kind: CoreCall["kind"],
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  const reply = await core.call({ kind, resource, method, body });
  if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
  return { ok: true, value: reply.value as T };
}

function command<T>(
  core: CoreSource,
  resource: string,
  method: string,
  input: unknown,
  revision: string,
): Promise<SourceResult<T>> {
  return call<T>(core, "command", resource, method, {
    input,
    idempotency_key: `${resource}-${method}-${crypto.randomUUID()}`,
    compare: { base_revision: revision },
    prepared: [],
  });
}

function coverageOf(value: CoverageValue): Coverage {
  return {
    lagging: value.lagging,
    rebuilding: value.rebuilding,
    omissions: value.omissions.length,
  };
}

function projectOf(value: ProjectValue): ProjectRow {
  return {
    id: value.id,
    name: value.name,
    title: value.title,
    purpose: value.purpose,
    revision: value.revision,
    archived: value.status === "archived",
  };
}

export function coreLophnSource(core: CoreSource): LophnSource {
  async function project(id: string): Promise<SourceResult<ProjectRow>> {
    const read = await call<{ project: ProjectValue }>(
      core,
      "read",
      "projects",
      "get",
      { project: id },
    );
    return read.ok ? { ok: true, value: projectOf(read.value.project) } : read;
  }

  return {
    async catalog() {
      const projects: Named[] = [];
      const apps: Named[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const result: SourceResult<RootPage> = await call<RootPage>(
          core,
          "read",
          "outline",
          "root",
          cursor === undefined ? {} : { cursor },
        );
        if (!result.ok) return result;
        for (const entry of result.value.entries) {
          if (entry.kind === "unplaced") continue;
          const item = { id: entry.id, title: entry.title };
          if (entry.kind === "project") projects.push(item);
          else apps.push(item);
        }
        if (result.value.complete || result.value.next_cursor === null) break;
        cursor = result.value.next_cursor;
      }
      const catalog: Catalog = { projects, apps };
      return { ok: true, value: catalog };
    },

    async search(conditions, cursor) {
      const result = await call<SearchValue>(
        core,
        "worker",
        "search",
        "query",
        searchBody(conditions, cursor),
      );
      if (!result.ok) return result;
      const hits: SearchHit[] = result.value.results.map((item) => ({
        document: item.document,
        version: item.version,
        latestVersion: item.latest_version,
        section: item.section,
        title: item.title,
        snippet: item.snippet,
        format: item.format.name,
        fromSummary: item.match_source !== "original",
      }));
      return {
        ok: true,
        value: {
          hits,
          coverage: coverageOf(result.value.coverage),
          nextCursor: result.value.next_cursor,
        },
      };
    },

    async projects() {
      const rows: ProjectRow[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const read: SourceResult<
          { projects: ProjectValue[]; next_cursor: string | null }
        > = await call(core, "read", "projects", "list", {
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!read.ok) return read;
        rows.push(...read.value.projects.map(projectOf));
        if (read.value.next_cursor === null) break;
        cursor = read.value.next_cursor;
      }
      return { ok: true, value: rows };
    },

    async updateProject(row, change) {
      const result = await command<ProjectValue>(
        core,
        "projects",
        "update",
        { project: row.id, ...change },
        row.revision,
      );
      return result.ok ? await project(row.id) : result;
    },

    async setProjectArchived(row, archived) {
      const result = await command<ProjectValue>(
        core,
        "projects",
        archived ? "archive" : "unarchive",
        { project: row.id },
        row.revision,
      );
      return result.ok ? await project(row.id) : result;
    },
  };
}
