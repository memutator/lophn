// project 목록 대역. preview는 운영 project를 보지 못하므로 언제나 빈 목록으로 답한다.
import { ok } from "../../../../base/mod.ts";
import { brokerProjectsListInputSchema } from "../../../../protocol/apps/mod.ts";
import type { ProjectsListService } from "../../permissions/mod.ts";
import { invalid } from "./refusal.ts";

export function createPreviewProjectsService(): ProjectsListService {
  return {
    list(_child, body) {
      if (!brokerProjectsListInputSchema.safeParse(body).success) {
        return Promise.resolve(invalid("projects list input is invalid"));
      }
      return Promise.resolve(ok({ projects: [] }));
    },
  };
}
