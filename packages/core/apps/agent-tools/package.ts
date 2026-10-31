import { z } from "zod";
import { ok, type Result } from "../../../base/mod.ts";
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
  packagePublishInputSchema,
  sourceRelativePathSchema,
} from "../../../protocol/apps/package-routes.ts";
import type { ToolResult } from "../../../protocol/lophn-agent/tool-values.ts";
import {
  continuation,
  countSummary,
  defineTool,
  fitted,
  invalid,
  jsonBytes,
  notFound,
  readBody,
  readOf,
  TEXT_MAX_BYTES,
  type ToolContext,
  type ToolDefinition,
  unavailable,
} from "../../lophn-agent/tools/spi.ts";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});

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

// 안내 본문 한 창. package.read 결과 JSON 전체가 TEXT_MAX_BYTES 안에 들어오도록 창을 고르고, 더 남았으면
// 이어 받을 byte 위치를 준다. 본문을 잘라 버리지 않고 나눠 받는다.
type GuidePage = {
  content: Record<string, unknown>;
  end: number;
  more: boolean;
};

const encoder = new TextEncoder();

// `rest`는 안내 본문의 `offset`부터다. `size`는 본문 전체 byte 수다. `moreBeyond`는 `rest` 뒤에 아직 본문이 있다는
// 호출자의 판정이다(blob 창이 요청보다 짧게 온 경우). `sourceCut`은 안내 원본 자체가 이미 잘려 있다는 판정이다
// (`packages.builtin`의 256 KiB 상한). 마지막 창에서도 `guide_truncated`가 서야 한다.
// content의 JSON이 상한을 넘으면 넘친 만큼 창을 줄여 다시 잰다.
function pageGuide(
  base: Record<string, unknown>,
  rest: Uint8Array,
  offset: number,
  size: number,
  moreBeyond: boolean,
  sourceCut: boolean,
): GuidePage {
  let limit = Math.min(rest.byteLength, TEXT_MAX_BYTES);
  for (;;) {
    const decoded = new TextDecoder().decode(rest.subarray(0, limit));
    // 창 끝에서 잘린 멀티바이트는 교체 문자로 남는다. 버린다.
    const kept = decoded.endsWith("\uFFFD") ? decoded.slice(0, -1) : decoded;
    const keptBytes = encoder.encode(kept).byteLength;
    const end = offset + keptBytes;
    const more = keptBytes < rest.byteLength || moreBeyond;
    const content = {
      ...base,
      guide: kept,
      guide_truncated: more || sourceCut,
      guide_offset_bytes: offset,
      guide_size_bytes: size,
    };
    const over = jsonBytes(content) - TEXT_MAX_BYTES;
    if (over <= 0 || keptBytes === 0) return { content, end, more };
    // JSON escape로 늘어난 몫까지 함께 줄인다. 0.8배가 아니라 넘친 양의 두 배로 줄여 몇 번 안에 맞는다.
    limit = Math.max(0, keptBytes - Math.max(1, over * 2));
  }
}

// 주인 앱의 id와 이름. 주인이 없으면 null이고 이름을 읽지 못하면 이름 자리에 id를 둔다.
function ownerOf(
  apps: readonly { id: string; name: string }[],
  id: string | null,
): { id: string; name: string } | null {
  if (id === null) return null;
  return { id, name: apps.find((item) => item.id === id)?.name ?? id };
}

// 목록: 사용자 package(@me)와 내장 SDK, 주인 앱 이름.
async function packageList(ctx: ToolContext) {
  const read = await readOf(ctx.core, packagesList, {});
  if (!read.ok) return read;
  const builtin = await readOf(ctx.core, packagesBuiltin, {});
  if (!builtin.ok) return builtin;
  const apps = await readOf(ctx.core, appList, { limit: 1000 });
  const { body, more } = readBody(read.value);
  return ok(
    fitted(
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
    ),
  );
}

// 상세: 안내·권한·주인 앱·쓰는 앱. version이 없으면 가장 높은 판이다. 내장 SDK(@lophn/)는 설치 사본에서 읽는다.
// 안내가 결과 상한보다 길면 창을 나눠 주고 `continuation`에 다음 창의 byte 위치를 싣는다.
async function packageDetail(
  name: string,
  version: string | undefined,
  input: { offset_bytes?: number },
  ctx: ToolContext,
): Promise<Result<ToolResult>> {
  if (name.startsWith("@lophn/")) {
    const read = await readOf(ctx.core, packagesBuiltin, { name });
    if (!read.ok) return read;
    const [installed] = read.value.packages;
    if (installed === undefined) return notFound("package not found");
    if (version !== undefined && version !== installed.version) {
      return notFound("package version not found");
    }
    const base = {
      name,
      version: installed.version,
      builtin: true,
    };
    const guide = read.value.guide;
    if (guide === null) {
      return ok({
        status: "success",
        summary: `package ${name}@${installed.version}`,
        content: { ...base, guide: null, guide_truncated: false },
        complete: true,
        source: null,
        continuation: null,
        pending: [],
      });
    }
    const text = encoder.encode(guide.text);
    const offset = input.offset_bytes ?? 0;
    if (offset > text.byteLength) {
      return invalid("offset_bytes is past the end of the guide");
    }
    const page = pageGuide(
      base,
      text.subarray(offset),
      offset,
      text.byteLength,
      false,
      guide.truncated,
    );
    return ok({
      status: "success",
      summary: `package ${name}@${installed.version}`,
      content: page.content as ToolResult["content"],
      complete: !page.more,
      source: null,
      continuation: continuation(page.more ? `offset_bytes=${page.end}` : null),
      pending: [],
    });
  }
  const versions = await readOf(ctx.core, packagesVersions, { name });
  if (!versions.ok) return versions;
  const all = versions.value.versions;
  const chosen =
    version === undefined
      ? [...all].sort((a, b) => newer(a.version, b.version)).at(-1)
      : all.find((entry) => entry.version === version);
  if (chosen === undefined) return notFound("package version not found");
  const owner = versions.value.owner_app;
  const ownerApp =
    owner === null ? null : await readOf(ctx.core, appGet, { app: owner });
  const usage = await readOf(ctx.core, packagesUsage, {
    name,
    version: chosen.version,
  });
  if (!usage.ok) return usage;
  const guide = await readOf(ctx.core, packagesGuideBody, {
    name,
    version: chosen.version,
    offset_bytes: input.offset_bytes ?? 0,
    length_bytes: TEXT_MAX_BYTES,
  });
  if (!guide.ok) return guide;
  const summary = `package ${name}@${chosen.version}`;
  const base = {
    name,
    version: chosen.version,
    owner_app: ownerOf(ownerApp?.ok ? [ownerApp.value.app] : [], owner),
    permissions: chosen.permissions ?? [],
    other_versions: all.map((entry) => entry.version),
    used_by: usage.value.usages,
  };
  if (guide.value.status !== "available") {
    return ok(
      fitted(summary, {
        ...base,
        guide: null,
        guide_truncated: false,
      }),
    );
  }
  const rest = Uint8Array.from(atob(guide.value.bytes), (c) => c.charCodeAt(0));
  // blob 창이 요청보다 짧게 온 경우에도 남은 본문이 있는지는 전체 크기로 안다.
  const moreBeyond =
    guide.value.offset_bytes + rest.byteLength < guide.value.size_bytes;
  let page = pageGuide(
    base,
    rest,
    guide.value.offset_bytes,
    guide.value.size_bytes,
    moreBeyond,
    false,
  );
  // used_by가 상한을 다 써 창 자리가 없는 경우다. 덜어 낼 수 있는 유일한 배열을 비우면 창이 선다.
  if (page.end === guide.value.offset_bytes && page.more) {
    page = pageGuide(
      { ...base, used_by: [] },
      rest,
      guide.value.offset_bytes,
      guide.value.size_bytes,
      moreBeyond,
      false,
    );
    // 한 글자도 못 넣으면 다음 창의 위치가 같은 곳이라 agent가 제자리를 돈다. 그럴 때는 숨기지 않고 알린다.
    if (page.end === guide.value.offset_bytes && page.more) {
      return unavailable("the guide does not fit in one tool result");
    }
  }
  return ok({
    status: "success",
    summary,
    content: page.content as ToolResult["content"],
    complete: !page.more,
    source: null,
    continuation: continuation(page.more ? `offset_bytes=${page.end}` : null),
    pending: [],
  });
}

export const PACKAGE_TOOLS: readonly ToolDefinition[] = [
  // name이 없으면 목록, 있으면 그 package다. version만 주면 고를 package가 없어 거절한다(목록으로 바꾸지 않는다).
  defineTool({
    name: "package.read",
    input: z.strictObject({
      name: nonblank.optional(),
      version: nonblank.optional(),
      // 안내 본문의 byte 위치. continuation.read_next가 주는 값을 그대로 넣는다.
      offset_bytes: z.number().int().nonnegative().optional(),
    }),
    routes: [
      packagesList,
      packagesBuiltin,
      appList,
      packagesVersions,
      packagesUsage,
      packagesGuideBody,
      appGet,
    ],
    description:
      "List the SDK built into lophn and the user packages (@me) with their versions and owner app, or read one package by name: its guide (purpose, API and types, examples), required permissions, owner app and the apps that use the version. version needs name; without version the newest one. Built-in SDK names start with @lophn/. A guide longer than one result is paged: when continuation.read_next is set, call again with that offset_bytes to read the next part.",
    effect: "read",
    handler: (input, ctx) => {
      if (input.name !== undefined) {
        return packageDetail(input.name, input.version, input, ctx);
      }
      if (input.version !== undefined) {
        return Promise.resolve(invalid("version needs name"));
      }
      if (input.offset_bytes !== undefined) {
        return Promise.resolve(invalid("offset_bytes needs name"));
      }
      return packageList(ctx);
    },
  }),
  defineTool({
    name: "package.publish",
    input: packagePublishInputSchema
      .omit({
        key: true,
        path: true,
      })
      .extend({ path: sourceRelativePathSchema }),
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
      return ok(
        fitted(`published ${rest.name}@${rest.version}`, published.value),
      );
    },
  }),
];
