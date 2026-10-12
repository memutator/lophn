import { z } from "zod";
import { err, ok } from "../../../../base/mod.ts";
import {
  packageNameSchema,
  packagesList,
  packagesUsage,
  packagesVersions,
  packageVersionNameSchema,
} from "../../../../protocol/apps/mod.ts";
import { readCursorSchema } from "../../../../protocol/projects/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { fitJson, PAGE_SIZE } from "../result.ts";
import type { ToolDefinition } from "../registry.ts";
import type { ToolHandler } from "../work.ts";
import {
  type ContractCall,
  defineBuiltin,
  type DefineOptions,
  READ,
} from "./common.ts";
import { bodyOf, pageThrough, scopeOf } from "./paging.ts";

// SDK 안내 묶음(concern harness/tools R7). 설치가 제공하는 SDK Package의 목록·version·사용 예를 읽기로만
// 준다. 이 묶음에는 설치·추가·등록 tool이 없고 호출 뒤 설치 상태가 바뀌지 않는다. 안내 원문(API·type·
// permission·peer)을 읽는 자리는 apps 계약에 아직 없어 그 hash만 보이고 원문은 null이다.

export const SDK_TOOL_REVISION = "2026-10-07";

function define(
  name: string,
  description: string,
  input: z.ZodType,
  contract: string,
): ToolDefinition {
  const options: DefineOptions = { ...READ, scopeCheck: "the installed SDK" };
  return defineBuiltin(
    SDK_TOOL_REVISION,
    name,
    description,
    input,
    contract,
    options,
  );
}

const versionInput = z.strictObject({
  name: packageNameSchema,
  version: packageVersionNameSchema.optional(),
});

export const sdkListTool = define(
  "sdk.list",
  "List the SDK packages the installation provides: name, one-line purpose, kind, and exact versions. This changes nothing and installs nothing.",
  z.strictObject({
    name: packageNameSchema.optional(),
    cursor: readCursorSchema.optional(),
  }),
  packagesList.name,
);
export const sdkContractTool = define(
  "sdk.contract",
  "Read one SDK package at one exact version: its versions and the hashes of the code and the guide. Without a version the newest listed one is read. This changes nothing and installs nothing.",
  versionInput,
  packagesVersions.name,
);
export const sdkExamplesTool = define(
  "sdk.examples",
  "Read where one exact version of an SDK package is used: the apps and releases that pin it. This changes nothing and installs nothing.",
  versionInput,
  packagesUsage.name,
);

export const SDK_TOOL_NAMES: readonly string[] = [
  sdkListTool.name,
  sdkContractTool.name,
  sdkExamplesTool.name,
];

export const SDK_TOOLS: readonly ToolDefinition[] = [
  sdkListTool,
  sdkContractTool,
  sdkExamplesTool,
];

export type SdkToolPorts = ContractCall;

type Version = { version: string; bundle_hash: string; guide_hash: string };

const GUIDE_NOTE =
  "the guide text is not readable through a tool yet; only its hash is";

function fitted(summary: string, value: Record<string, unknown>): ToolResult {
  const limited = fitJson(value, ["usages", "versions"]);
  return {
    status: "success",
    summary,
    content: limited.content as ToolResult["content"],
    complete: limited.complete,
    source: null,
    continuation: null,
    pending: [],
  };
}

export function createSdkToolHandlers(
  ports: SdkToolPorts,
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  handlers.set(sdkListTool.name, (input, credential) => {
    const { cursor, name } = input as { cursor?: string; name?: string };
    return pageThrough(
      ports,
      "sdk packages listed",
      packagesList.name,
      scopeOf(sdkListTool.name, { name: name ?? null }),
      cursor,
      { ...(name === undefined ? {} : { name }), limit: PAGE_SIZE },
      ["packages"],
      credential,
    );
  });

  // 정확한 version을 고르지 않으면 목록의 첫 version이다. 없는 version은 없는 package와 같은 답이다.
  async function pick(
    input: unknown,
    run: string,
  ) {
    const value = input as z.infer<typeof versionInput>;
    const read = await ports.call(packagesVersions.name, {
      name: value.name,
    }, run);
    if (!read.ok) return read;
    const versions = (bodyOf(read.value)["versions"] ?? []) as Version[];
    const chosen = value.version === undefined
      ? versions[0]
      : versions.find((entry) => entry.version === value.version);
    if (chosen === undefined) {
      return err({ code: "not_found" as const, message: "no such version" });
    }
    return ok({ name: value.name, versions, chosen });
  }

  handlers.set(sdkContractTool.name, async (input, credential) => {
    const picked = await pick(input, credential.run);
    if (!picked.ok) return picked;
    const { name, versions, chosen } = picked.value;
    return ok(fitted("sdk package read", {
      name,
      version: chosen.version,
      bundle_hash: chosen.bundle_hash,
      guide_hash: chosen.guide_hash,
      guide: null,
      guide_note: GUIDE_NOTE,
      versions: versions.map((entry) => entry.version),
    }));
  });

  handlers.set(sdkExamplesTool.name, async (input, credential) => {
    const picked = await pick(input, credential.run);
    if (!picked.ok) return picked;
    const { name, chosen } = picked.value;
    const read = await ports.call(packagesUsage.name, {
      name,
      version: chosen.version,
    }, credential.run);
    if (!read.ok) return read;
    return ok(fitted("sdk usage read", {
      name,
      version: chosen.version,
      guide_hash: chosen.guide_hash,
      guide_note: GUIDE_NOTE,
      usages: bodyOf(read.value)["usages"] ?? [],
    }));
  });
  return handlers;
}
