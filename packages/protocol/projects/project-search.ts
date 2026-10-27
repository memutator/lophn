import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { defineRead } from "../base/route.ts";
import {
  absolutePathSchema,
  projectIdSchema,
  relativePathSchema,
} from "./values.ts";

const projectSearchInputSchema = z.strictObject({
  project: projectIdSchema,
  // 등록 폴더 하나로 좁힌다.
  folder: absolutePathSchema.optional(),
  query: z.string().min(1).max(200),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
});

// start·end는 text 안의 위치다.
const projectSearchMatchSchema = z.object({
  folder_path: absolutePathSchema,
  path: relativePathSchema,
  line: z.number().int().min(1),
  text: z.string(),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
});
export type ProjectSearchMatch = z.infer<typeof projectSearchMatchSchema>;

// core가 apiReads로 등록해 snapshot 없이 async로 파일을 훑는다. 경로 순서, 다음 줄 순서로 내보낸다.
export const projectSearch = defineRead({
  resource: "projects",
  method: "search",
  name: "project.search",
  input: projectSearchInputSchema,
  output: withReadCommon(
    z.object({
      matches: z.array(projectSearchMatchSchema),
      next_cursor: z.string().min(1).nullable(),
    }),
  ),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

export const PROJECT_SEARCH_ROUTES = [projectSearch] as const;
