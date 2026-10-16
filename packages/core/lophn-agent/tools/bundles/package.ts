import { ok } from "../../../../base/mod.ts";
import {
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
  notFound,
  readBody,
  unavailable,
} from "../domain/result.ts";
import { TEXT_MAX_BYTES } from "../result.ts";
import { defineBuiltin } from "./common.ts";

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

export const PACKAGE_TOOLS: readonly ToolDefinition[] = [
  defineBuiltin({
    name: "package.list",
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
  defineBuiltin({
    name: "package.get",
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
  defineBuiltin({
    name: "package.publish",
    description:
      "Publish a folder of an app's code as a user package (@me/...). Only a passed app test lets a version out.",
    effect: "write",
    // route(`package.publish`)는 version, 설명, 안내, permission, test를 받는데 이 tool 입력에는 없다.
    handler: () =>
      Promise.resolve(
        unavailable("package.publish input does not carry the version"),
      ),
  }),
];
