// `lophn artifact delete`: project 또는 앱의 artifact 폴더를 삭제하고 clean-up 정책에 따라 후속 정리를 인계한다.
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import { cleanUpModeSchema } from "../../protocol/base/follow-ups.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { artifactsDelete } from "../../protocol/projects/artifact-api.ts";
import {
  appIdSchema,
  artifactNameSchema,
  projectIdSchema,
} from "../../protocol/projects/values.ts";
import { defineCommand } from "./types.ts";

const remove = defineCommand({
  name: "artifact.delete",
  summary: "Delete an artifact folder from a project or app",
  description:
    "Delete an artifact folder (`artifacts/<name>`) from a project or app workspace. Omit --project and --app when running inside that project or app workspace. Use --clean-up none|now|later to control semantic reference cleanup (defaults to later for agents when references exist).",
  input: z.strictObject({
    name: artifactNameSchema,
    project: projectIdSchema
      .optional()
      .describe("Project ID (defaults to current project workspace)"),
    app: appIdSchema
      .optional()
      .describe("App ID (defaults to current app workspace)"),
    clean_up: cleanUpModeSchema
      .optional()
      .describe("Semantic cleanup mode: none, now, or later"),
  }),
  positional: ["name"],
  effect: "write",
  routes: [artifactsDelete],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    if (input.project !== undefined && input.app !== undefined) {
      return err({
        code: "invalid_input",
        message: "pass either --project or --app, not both",
      });
    }
    let container: { project: string } | { app: string };
    if (input.project !== undefined) {
      container = { project: input.project };
    } else if (input.app !== undefined) {
      container = { app: input.app };
    } else if (ctx.workspace?.kind === "project") {
      container = { project: ctx.workspace.id };
    } else if (ctx.workspace?.kind === "app") {
      container = { app: ctx.workspace.id };
    } else {
      return err({
        code: "invalid_input",
        message:
          "specify --project or --app when deleting an artifact outside a project or app workspace",
      });
    }
    const done = await ctx.core.read(artifactsDelete, {
      ...container,
      name: input.name,
      ...(input.clean_up === undefined ? {} : { clean_up: input.clean_up }),
    });
    if (!done.ok) return done;
    const count = done.value.follow_ups.length;
    return ok({
      summary:
        count === 0
          ? `deleted artifact ${input.name}`
          : `deleted artifact ${input.name} (${count} follow-up${count === 1 ? "" : "s"} created)`,
      content: done.value,
      arrayKeys: ["follow_ups"],
    });
  },
});

export const ARTIFACT_COMMANDS = [remove];
