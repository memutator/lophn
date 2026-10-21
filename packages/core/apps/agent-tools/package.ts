import { ok } from "../../../base/mod.ts";
import {
  appGet,
  appList,
  packagePublish,
  packagesBuiltin,
  packagesGuideBody,
  packagesList,
  packagesUsage,
  packagesVersions,
} from "../../../protocol/apps/mod.ts";
import {
  countSummary,
  defineTool,
  fitted,
  invalid,
  notFound,
  readBody,
  readOf,
  TEXT_MAX_BYTES,
  type ToolDefinition,
} from "../../lophn-agent/tools/spi.ts";
import { z } from "zod";
import {
  packagePublishInputSchema,
  sourceRelativePathSchema,
} from "../../../protocol/apps/package-routes.ts";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const none = z.strictObject({});

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

// 안내 본문을 tool 결과 상한(TEXT_MAX_BYTES)으로 자른다. 잘린 멀티바이트는 버린다.
function cutBytes(text: string): { text: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= TEXT_MAX_BYTES) return { text, truncated: false };
  const cut = new TextDecoder().decode(bytes.slice(0, TEXT_MAX_BYTES));
  return { text: cut.replace(/\uFFFD$/, ""), truncated: true };
}

// 주인 앱의 id와 이름. 주인이 없으면 null이고 이름을 읽지 못하면 이름 자리에 id를 둔다.
function ownerOf(
  apps: readonly { id: string; name: string }[],
  id: string | null,
): { id: string; name: string } | null {
  if (id === null) return null;
  return { id, name: apps.find((item) => item.id === id)?.name ?? id };
}

export const PACKAGE_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "package.list",
    input: none,
    routes: [packagesList, packagesBuiltin, appList],
    description:
      "List the SDK built into lophn and the user packages (@me) with their versions and owner app.",
    effect: "read",
    handler: async (_input, ctx) => {
      const read = await readOf(ctx.core, packagesList, {});
      if (!read.ok) return read;
      const builtin = await readOf(ctx.core, packagesBuiltin, {});
      if (!builtin.ok) return builtin;
      const apps = await readOf(ctx.core, appList, { limit: 1000 });
      const { body, more } = readBody(read.value);
      return ok(fitted(
        countSummary("packages", body.packages.length, more),
        {
          ...body,
          packages: body.packages.map((pkg) => ({
            ...pkg,
            owner_app: ownerOf(apps.ok ? apps.value.apps : [], pkg.owner_app),
          })),
          builtin: builtin.value.packages,
        },
        ["packages"],
      ));
    },
  }),
  defineTool({
    name: "package.get",
    input: z.strictObject({
      name: nonblank,
      version: nonblank.optional(),
    }),
    routes: [
      packagesVersions,
      packagesUsage,
      packagesGuideBody,
      packagesBuiltin,
      appGet,
    ],
    description:
      "Read one package: its guide (purpose, API and types, examples), required permissions, owner app and the apps that use the version. Without version the newest one. Built-in SDK names start with @lophn/.",
    effect: "read",
    handler: async (input, ctx) => {
      const { name, version } = input;
      if (name.startsWith("@lophn/")) {
        const read = await readOf(ctx.core, packagesBuiltin, { name });
        if (!read.ok) return read;
        const [installed] = read.value.packages;
        if (installed === undefined) return notFound("package not found");
        if (version !== undefined && version !== installed.version) {
          return notFound("package version not found");
        }
        const guide = read.value.guide;
        const cut = guide === null ? null : cutBytes(guide.text);
        return ok(fitted(`package ${name}@${installed.version}`, {
          name,
          version: installed.version,
          builtin: true,
          guide: cut?.text ?? null,
          guide_truncated: (guide?.truncated ?? false) ||
            (cut?.truncated ?? false),
        }));
      }
      const versions = await readOf(ctx.core, packagesVersions, { name });
      if (!versions.ok) return versions;
      const all = versions.value.versions;
      const chosen = version === undefined
        ? [...all].sort((a, b) => newer(a.version, b.version)).at(-1)
        : all.find((entry) => entry.version === version);
      if (chosen === undefined) return notFound("package version not found");
      const owner = versions.value.owner_app;
      const ownerApp = owner === null
        ? null
        : await readOf(ctx.core, appGet, { app: owner });
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
        owner_app: ownerOf(
          ownerApp?.ok ? [ownerApp.value.app] : [],
          owner,
        ),
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
    input: packagePublishInputSchema.omit({
      key: true,
      path: true,
    }).extend({ path: sourceRelativePathSchema }),
    routes: [appGet, packagePublish],
    description:
      "Publish a folder of an app's code as a user package (@me/...). Give the version, a one line description, the guide (purpose, api, examples), and the permissions it needs. The code is the HEAD commit of the app source, so commit the folder first.",
    effect: "write",
    handler: async (input, ctx) => {
      const rest = input;
      const app = await readOf(ctx.core, appGet, { app: rest.app });
      if (!app.ok) return app;
      if (app.value.app.source_path === null) {
        return invalid("the app has no source folder");
      }
      const published = await readOf(ctx.core, packagePublish, {
        ...rest,
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
