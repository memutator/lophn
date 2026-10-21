import { err, ok, type Result } from "../../../packages/base/mod.ts";
import { packagesVersions } from "../../../packages/protocol/apps/mod.ts";
import { tool } from "../../support/app/activate.ts";
import { openSession, say, waitTurnEnd } from "../../support/core/human.ts";
import type { JournalEntry } from "../../support/fake-server/mod.ts";
import { lastToolResult, toolNames } from "../../support/fake-server/probe.ts";
import type { SetupContext } from "../types.ts";
import { type Material, textOf } from "./manifest.ts";

type Publish = {
  app: string;
  name: string;
  version: string;
  description: string;
  path: string;
  permissions: string[];
  guide: { purpose: string; api: string; examples: string };
  exports?: string[]; // 재사용 확인(checks/app/reuse.ts)이 읽는다. tool 입력이 아니다
};

// package는 그 앱 source HEAD commit의 폴더다. 앱 재료가 먼저 되살아나야 한다. 낸 앱의 App Engineer가 `package.publish`를 부른다.
export async function restorePackage(
  ctx: SetupContext,
  material: Material,
): Promise<Result<void>> {
  const { core, fake } = ctx;
  const { app: appName, exports: _exports, ...spec } = JSON.parse(
    textOf(material, "publish.json"),
  ) as Publish;
  const app = ctx.world.apps[appName];
  if (app === undefined) {
    return err({
      code: "invalid_input",
      message: `package ${spec.name}: app ${appName} not restored`,
    });
  }
  fake.reset();
  fake.script([
    { reply: tool("t_publish", "package_publish", { app, ...spec }) },
    { reply: { kind: "text", text: "published" } },
  ], {
    name: `pkg-${app}`,
    match: (request: JournalEntry) =>
      toolNames(request).includes("package_publish") &&
      JSON.stringify(request.body).includes(`App ${app}:`),
  });
  const ae = await openSession(core, { role: "app_engineer", app });
  await say(core, ae, `App ${app}: publish ${spec.name}`);
  const reason = () =>
    fake.journal().map((entry) => lastToolResult(entry)).filter((text) =>
      text !== undefined
    ).at(-1) ?? "no tool result";
  try {
    await waitTurnEnd(core, ae);
  } catch (error) {
    return err({
      code: "unavailable",
      message: `package ${spec.name} was not published: ${
        error instanceof Error ? error.message : String(error)
      }: ${reason()}`,
    });
  }
  const read = await core.tryCall(packagesVersions, { name: spec.name });
  if (
    !read.ok ||
    !read.value.versions.some((item) => item.version === spec.version)
  ) {
    return err({
      code: "unavailable",
      message:
        `package ${spec.name}@${spec.version} was not published: ${reason()}`,
    });
  }
  return ok(undefined);
}
