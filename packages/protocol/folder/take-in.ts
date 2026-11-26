// 다른 기계가 폴더에 내놓은 앱을 이 기계에 들인다. 앱 id는 기계 사이 같고 release의 신분은 code_commit이다.
// 다른 기계의 source git bundle에서 commit을 받아 이 기계에서 release를 준비해 `prepared`로 둔다:
// 활성화와 동의, grant는 이 기계에서 지금처럼 사람에게 묻는다.
// `conflict`의 `details.reason`: `sdk_missing`(`details.packages`), `slug_in_use`(`details.app`), `dependency_missing`
// (`details.packages`). `invalid_input`의 `details.reason`은 `source_incomplete`다.
import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineCommand } from "../base/route.ts";
import { commitSchema } from "./records.ts";

export const TAKE_IN_CONFLICTS = [
  "sdk_missing",
  "slug_in_use",
  "dependency_missing",
] as const;
export type TakeInConflict = (typeof TAKE_IN_CONFLICTS)[number];

export const takeInInputSchema = z.strictObject({
  app: z.string().min(1),
  // 없으면 그 앱의 `app.json`이 가장 최근인 기계.
  from: idSchema("mch").optional(),
  // 없으면 그 기계의 활성 release의 code_commit.
  release: commitSchema.optional(),
});
export type TakeInInput = z.infer<typeof takeInInputSchema>;

export const takeInOutputSchema = z.object({
  app: idSchema("app"),
  release: idSchema("rel"),
  // 이 기계의 source 저장소.
  source_path: z.string().nullable(),
  // app_and_release: 앱을 만들고 release를 준비했다. release: 이미 있던 앱에 release만 준비했다(앱 행은 그대로).
  // existing: 같은 commit의 release가 이미 있다.
  installed: z.enum(["app_and_release", "release", "existing"]),
});
export type TakeInOutput = z.infer<typeof takeInOutputSchema>;

export const appTakeIn = defineCommand({
  resource: "apps",
  method: "take_in",
  name: "app.take_in",
  changes: [
    { name: "apps", id: (input) => input.app },
    { name: "releases", id: (input) => input.app },
  ],
  input: takeInInputSchema,
  output: takeInOutputSchema,
  actors: ["user", "agent"],
  errors: ["not_found", "invalid_input", "conflict", "unavailable"],
});
