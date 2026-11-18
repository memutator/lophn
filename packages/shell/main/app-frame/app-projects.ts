// 앱 view의 project 읽기 main service. 앱이 project를 따로 만들지 않고 lophn project를 기준으로 쓰게 한다.
// agent 길처럼 사람 자격(`coreInternal`)으로 core에 간다. 앱 code(AI가 만든 code일 수 있다)에는 이름과
// 상태, 기계를 넘는 id만 주고 폴더 path는 주지 않는다. 폴더는 지금 열린 project의 것만 `place.workspace`로 간다.
import type { AppProject } from "../../../protocol/shell/app-bridge-types.ts";
import type { CallOutcome } from "./app-call.ts";
import type { CoreCaller } from "./app-connection.ts";

interface AppProjectsDeps {
  call: CoreCaller;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function projectOf(value: unknown): AppProject | undefined {
  const row = record(value);
  if (
    typeof row?.id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.title !== "string" ||
    typeof row.purpose !== "string" ||
    (row.status !== "active" && row.status !== "archived")
  ) {
    return undefined;
  }
  return {
    id: row.id,
    identity: typeof row.identity === "string" ? row.identity : null,
    name: row.name,
    title: row.title,
    purpose: row.purpose,
    status: row.status,
  };
}

export function createAppProjects(deps: AppProjectsDeps) {
  return {
    /** 모든 project(보관 포함). 페이지를 끝까지 읽는다. 읽는 사이 목록이 바뀌면 conflict라 앱이 다시 읽는다. */
    async list(): Promise<CallOutcome<{ projects: AppProject[] }>> {
      const projects: AppProject[] = [];
      let cursor: string | undefined;
      do {
        const reply = await deps.call("read", "projects", "list", {
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!reply.ok) {
          return reply.error.code === "conflict"
            ? {
                ok: false,
                error: { code: "conflict", message: "projects changed" },
              }
            : {
                ok: false,
                error: {
                  code: "unavailable",
                  message: "core is not available",
                },
              };
        }
        const value = record(reply.value);
        const rows = Array.isArray(value?.projects) ? value.projects : [];
        for (const row of rows) {
          const project = projectOf(row);
          if (project !== undefined) projects.push(project);
        }
        cursor =
          typeof value?.next_cursor === "string"
            ? value.next_cursor
            : undefined;
      } while (cursor !== undefined);
      return { ok: true, value: { projects } };
    },
  };
}
