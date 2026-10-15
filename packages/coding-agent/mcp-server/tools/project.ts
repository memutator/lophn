// lophn_project tool의 실행이다. list·show·current는 읽기 route 하나로만
// 보내고 등록·변경 op가 없다. coding agent에게 위치는 탐색용이라 절대 경로·폴더 목록·
// tracking 규칙은 내지 않는다: core가 이미 agent
// 투영으로 걷어 내지만 이 tool도 허용한 필드만 골라 내서 어떤 응답이 와도 새지 않는다.
// current는 호출자의 경로를 받지 않는다. core가 연결 credential의 고정 근거로 푼다.
import { MCP_CORE_ROUTES } from "../../../protocol/coding-agent/mod.ts";
import type { Route } from "../../../protocol/base/mod.ts";
import type { FlowClient } from "../../connection/mod.ts";
import {
  failureOutput,
  type ToolOutput,
  withContinuation,
  withoutOp,
} from "./output.ts";

export type ProjectToolDeps = { client: Pick<FlowClient, "read"> };

const OPS = ["list", "show", "current"] as const;
type ProjectOp = (typeof OPS)[number];

type ProjectView = {
  id: string;
  name: string;
  title: string;
  purpose: string;
  revision: string;
  status: string;
};

const REGISTRATION_GUIDE =
  "project 등록·변경은 lophn 화면에서 사람이 한다. coding agent와 CLI에는 등록 도구가 없다";

// 모델이 읽을 값만 고른다. 폴더·tracking·초기 제안은 필드째 버린다.
function projectView(raw: unknown): ProjectView {
  const project = raw as ProjectView;
  return {
    id: project.id,
    name: project.name,
    title: project.title,
    purpose: project.purpose,
    revision: project.revision,
    status: project.status,
  };
}

export function createProjectTool(
  deps: ProjectToolDeps,
): (toolName: string, route: Route, input: unknown) => Promise<ToolOutput> {
  const routes = MCP_CORE_ROUTES.lophn_project as unknown as Record<
    ProjectOp,
    Route
  >;
  return async function runProjectTool(_toolName, _route, rawInput) {
    const op = (rawInput as { op?: unknown } | undefined)?.op;
    if (typeof op !== "string" || !(OPS as readonly string[]).includes(op)) {
      // 표에 없는 op는 실행하지 않는다. 등록·보관·연결 op는 이 tool에 없다.
      return failureOutput({
        code: "invalid_input",
        message: "project tool 표에 없는 op다",
        details: { op: typeof op === "string" ? op : null },
      }, ["lophn_project list, show, current만 있다"]);
    }
    const input = withoutOp(rawInput);
    const read = await deps.client.read(routes[op as ProjectOp], input);
    if (!read.ok) {
      if (op === "current" && read.error.code === "not_found") {
        // 어느 등록 폴더에도 속하지 않거나 근거가 없는 위치다. 오류가 아니라 빈 목록이다.
        // 범위 밖 project도 같은 답이라 존재를 새지 않는다.
        return {
          summary:
            "현재 작업 위치는 등록된 project에 속하지 않는다. 일치하는 project가 없다",
          data: { projects: [], guide: REGISTRATION_GUIDE },
          next: [
            "lophn_project list로 읽을 수 있는 project를 읽는다",
            REGISTRATION_GUIDE,
          ],
        };
      }
      return failureOutput(read.error, [
        "lophn_project list로 읽을 수 있는 project를 다시 읽는다",
      ]);
    }
    const value = read.value as Record<string, unknown>;
    if (op === "list") {
      const projects = ((value.projects as unknown[] | undefined) ?? []).map(
        projectView,
      );
      return {
        summary: withContinuation(`project ${projects.length}개`, value),
        data: {
          projects,
          as_of_seq: value.as_of_seq,
          next_cursor: value.next_cursor ?? null,
        },
        next: ["lophn_project show로 목적을 읽는다"],
      };
    }
    if (op === "show") {
      const project = projectView(value.project);
      return {
        summary: `${project.title}(${project.name}): ${
          project.purpose === "" ? "목적 없음" : project.purpose
        }${project.status === "archived" ? " (보관됨)" : ""}`,
        data: { project, as_of_seq: value.as_of_seq },
        next: [],
      };
    }
    // current: 가장 깊은 등록 폴더가 속한 project의 참조 하나다.
    const id = (value as { project: string }).project;
    return {
      summary: `현재 작업 위치의 project: ${id}`,
      data: { projects: [{ project: id }], as_of_seq: value.as_of_seq },
      next: ["lophn_project show로 이 project의 목적을 읽는다"],
    };
  };
}
