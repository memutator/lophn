// broker `/_lophn/broker/projects/list`. 앱이 project 목록을 읽는다. 앱 data는 project 범위일 수
// 있어서 목록은 core가 준다. 신원은 자식 연결이 정한다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  brokerProjectsListInputSchema,
  brokerProjectsListOutputSchema,
  type ProjectSummary,
} from "../../../../protocol/apps/calls/mod.ts";
import { invalid } from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

// core의 `app.projects`를 그 자식의 app credential로 읽는 포트다. 조립이 잇는다.
export interface ProjectsPort {
  list(child: BrokerChild): Promise<Result<readonly ProjectSummary[]>>;
}

export type ProjectsListService = {
  list(
    child: BrokerChild,
    body: unknown,
  ): Promise<Result<{ projects: ProjectSummary[] }>>;
};

export function createProjectsListService(deps: {
  core: ProjectsPort;
}): ProjectsListService {
  return {
    async list(child, body) {
      if (!brokerProjectsListInputSchema.safeParse(body).success) {
        return invalid("projects list input is invalid");
      }
      const listed = await deps.core.list(child);
      if (!listed.ok) return listed;
      const output = brokerProjectsListOutputSchema.safeParse({
        projects: listed.value,
      });
      return output.success ? ok(output.data) : err({
        code: "internal",
        message: "core answered the project list badly",
      });
    },
  };
}
