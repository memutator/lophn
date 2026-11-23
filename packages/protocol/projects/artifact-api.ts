// 다른 컴퓨터의 창이 이 컴퓨터의 artifact를 읽는 route. project나 앱의 `artifacts/<name>/` 폴더 안만 내주고(읽기 전용),
// 그 밖의 file과 symlink로 나가는 path는 내주지 않는다. 열기·sealed partition 규칙은 shell main의 것이고 여기는 byte만 준다.
import { z } from "zod";
import { cleanUpModeSchema, followUpItemSchema } from "../base/follow-ups.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema } from "../base/values.ts";
import { defineFile, defineMemory } from "../base/route.ts";
import {
  appIdSchema,
  artifactNameSchema,
  projectIdSchema,
  relativePathSchema,
} from "./values.ts";

// project와 앱 가운데 하나다(그릇 칸).
const containerSchema = z.union([
  z.strictObject({ project: projectIdSchema }),
  z.strictObject({ app: appIdSchema }),
]);

export const artifactsList = defineMemory({
  resource: "artifacts",
  method: "list",
  name: "artifacts.list",
  input: containerSchema,
  output: z.strictObject({
    artifacts: z.array(
      z.strictObject({
        name: artifactNameSchema,
        title: z.string(),
        description: z.string(),
        modified: atSchema,
      }),
    ),
  }),
  actors: ["user"],
  errors: ["invalid_input", "unavailable"],
});

// path는 그 artifact 폴더 기준이다. `data/_entries.json`은 가상 file(data/ 목록)이다.
export const artifactsFile = defineFile({
  resource: "artifacts",
  method: "file",
  name: "artifacts.file",
  input: z.union([
    z.strictObject({
      project: projectIdSchema,
      name: artifactNameSchema,
      path: relativePathSchema,
    }),
    z.strictObject({
      app: appIdSchema,
      name: artifactNameSchema,
      path: relativePathSchema,
    }),
  ]),
  // 실제 Content-Type은 file 형식이다. 선언은 fallback이다.
  contentType: "application/octet-stream",
  actors: ["user"],
  errors: ["invalid_input", "not_found", "unavailable"],
});

export const artifactsDelete = defineMemory({
  resource: "artifacts",
  method: "delete",
  name: "artifacts.delete",
  changes: ["artifacts", "follow_ups", "sessions"],
  input: z.union([
    z.strictObject({
      project: projectIdSchema,
      name: artifactNameSchema,
      clean_up: cleanUpModeSchema.optional(),
    }),
    z.strictObject({
      app: appIdSchema,
      name: artifactNameSchema,
      clean_up: cleanUpModeSchema.optional(),
    }),
  ]),
  output: z.strictObject({
    deleted: z.literal(true),
    follow_ups: z.array(followUpItemSchema),
    handoff_session: idSchema("ses").nullable(),
  }),
  actors: ["user", "agent"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

export const ARTIFACT_MEMORY_ROUTES = [artifactsList, artifactsDelete] as const;
export const ARTIFACT_FILE_ROUTES = [artifactsFile] as const;
