import { err, ok, type Result } from "../../../packages/base/mod.ts";
import { releasesListRecords } from "../../../packages/protocol/apps/activation/activation.ts";
import { packagesVersions } from "../../../packages/protocol/apps/mod.ts";
import { approvalsPending } from "../../../packages/protocol/approvals/mod.ts";
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

// 낸 앱의 Project Manager가 `package.publish`를 부른다. 앱은 켜져 있어야 한다(app test를 통과한 release가 있다).
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
  const { releases } = await core.call(releasesListRecords, {
    app,
    status: "active",
  });
  const tests = releases[0]?.tests;
  if (tests === undefined) {
    return err({
      code: "invalid_input",
      message: `package ${spec.name}: app ${appName} has no active release`,
    });
  }

  fake.reset();
  fake.script([
    { reply: tool("t_publish", "package_publish", { app, ...spec, tests }) },
    { reply: { kind: "text", text: "published" } },
  ], {
    name: `pkg-${app}`,
    match: (request: JournalEntry) =>
      toolNames(request).includes("package_publish") &&
      JSON.stringify(request.body).includes(`App ${app}:`),
  });
  const pm = await openSession(core, { role: "app_engineer", app });
  await say(core, pm, `App ${app}: publish ${spec.name}`);
  const reason = async () => {
    const last = fake.journal().map((entry) => lastToolResult(entry)).filter((
      text,
    ) => text !== undefined).at(-1);
    const { requests } = await core.call(approvalsPending, {});
    return `${last ?? "no tool result"}${
      requests.length > 0
        ? ` (pending approval requests: ${requests.length})`
        : ""
    }`;
  };
  try {
    await waitTurnEnd(core, pm);
  } catch (error) {
    return err({
      code: "unavailable",
      message: `package ${spec.name} was not published: ${
        error instanceof Error ? error.message : String(error)
      }: ${await reason()}`,
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
        `package ${spec.name}@${spec.version} was not published: ${await reason()}`,
    });
  }
  return ok(undefined);
}
