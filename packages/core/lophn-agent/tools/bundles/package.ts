import { ok } from "../../../../base/mod.ts";
import {
  appGet,
  packagePublish,
  packagesGuideBody,
  packagesList,
  packagesUsage,
  packagesVersions,
} from "../../../../protocol/apps/mod.ts";
import { readOf } from "../../run-loop/core-call.ts";
import type { ToolDefinition } from "../registry.ts";
import type { ToolInput } from "../domain/input.ts";
import {
  countSummary,
  fitted,
  invalid,
  notFound,
  readBody,
  unavailable,
} from "../domain/result.ts";
import { TEXT_MAX_BYTES } from "../result.ts";
import { defineTool } from "../define.ts";
import { TOOL_INPUTS } from "../../../../protocol/lophn-agent/tool-catalog.ts";

// 가장 높은 version. 숫자 부분을 비교하고 같으면 문자열 순서다.
function newer(a: string, b: string): number {
  const left = a.split(/[.+-]/).map(Number);
  const right = b.split(/[.+-]/).map(Number);
  for (let at = 0; at < 3; at += 1) {
    const diff = (left[at] ?? 0) - (right[at] ?? 0);
    if (diff !== 0) return diff;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

// 앱 source의 HEAD commit. git이 못 읽으면 null이다.
async function headOf(source: string): Promise<string | null> {
  try {
    const out = await new Deno.Command("git", {
      args: ["-C", source, "rev-parse", "HEAD"],
      stdout: "piped",
      stderr: "null",
    }).output();
    const head = new TextDecoder().decode(out.stdout).trim();
    return out.code === 0 && /^[0-9a-f]{40}$/.test(head) ? head : null;
  } catch {
    return null;
  }
}

export const PACKAGE_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "package.list",
    input: TOOL_INPUTS["package.list"],
    routes: [packagesList],
    description:
      "List the SDK and user packages with their description and versions.",
    effect: "read",
    handler: async (_input, ctx) => {
      const read = await readOf(ctx.core, packagesList, {});
      if (!read.ok) return read;
      const { body, more } = readBody(read.value);
      return ok(fitted(
        countSummary("packages", body.packages.length, more),
        body,
        ["packages"],
      ));
    },
  }),
  defineTool({
    name: "package.get",
    input: TOOL_INPUTS["package.get"],
    routes: [packagesVersions, packagesUsage, packagesGuideBody],
    description:
      "Read one package: its guide (purpose, API and types, examples), required permissions and the apps that use the version. Without version the newest one.",
    effect: "read",
    handler: async (input, ctx) => {
      const { name, version } = input as ToolInput<"package.get">;
      const versions = await readOf(ctx.core, packagesVersions, { name });
      if (!versions.ok) return versions;
      const all = versions.value.versions;
      const chosen = version === undefined
        ? [...all].sort((a, b) => newer(a.version, b.version)).at(-1)
        : all.find((entry) => entry.version === version);
      if (chosen === undefined) return notFound("package version not found");
      const usage = await readOf(ctx.core, packagesUsage, {
        name,
        version: chosen.version,
      });
      if (!usage.ok) return usage;
      const guide = await readOf(ctx.core, packagesGuideBody, {
        name,
        version: chosen.version,
        offset_bytes: 0,
        length_bytes: TEXT_MAX_BYTES,
      });
      if (!guide.ok) return guide;
      const text = guide.value.status === "available"
        ? new TextDecoder().decode(
          Uint8Array.from(atob(guide.value.bytes), (c) => c.charCodeAt(0)),
        )
        : null;
      return ok(fitted(`package ${name}@${chosen.version}`, {
        name,
        version: chosen.version,
        permissions: chosen.permissions ?? [],
        other_versions: all.map((entry) => entry.version),
        used_by: usage.value.usages,
        guide: text,
        guide_truncated: guide.value.status === "available" &&
          guide.value.truncated,
      }, ["used_by"]));
    },
  }),
  defineTool({
    name: "package.publish",
    input: TOOL_INPUTS["package.publish"],
    routes: [appGet, packagePublish],
    description:
      "Publish a folder of an app's code as a user package (@me/...). Give the version, a one line description, the guide (purpose, api, examples), the permissions it needs and tests (ids of passed app tests of this app). The code is the HEAD commit of the app source, so commit the folder first.",
    effect: "write",
    handler: async (input, ctx) => {
      const rest = input as ToolInput<"package.publish">;
      const app = await readOf(ctx.core, appGet, { app: rest.app });
      if (!app.ok) return app;
      const source = app.value.app.source_path;
      if (source === null) return invalid("the app has no source folder");
      const commit = await headOf(source);
      if (commit === null) return unavailable("the app source has no commit");
      const published = await readOf(ctx.core, packagePublish, {
        ...rest,
        commit,
        key: ctx.tool_call,
      });
      if (!published.ok) return published;
      return ok(fitted(
        `published ${rest.name}@${rest.version}`,
        published.value,
      ));
    },
  }),
];
