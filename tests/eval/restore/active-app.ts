import { err, ok, type Result } from "../../../packages/base/mod.ts";
import { agentGrantsSet } from "../../../packages/protocol/approvals/mod.ts";
import {
  appConnectSource,
  appCreate,
  appGet,
} from "../../../packages/protocol/apps/mod.ts";
import type { Id } from "../../../packages/protocol/base/mod.ts";
import {
  approveActivation,
  deliverRelease,
  type TestApp,
  waitRunning,
} from "../../support/app/activate.ts";
import { runtimePids } from "../../support/core/process.ts";
import { openSession, settle } from "../../support/core/human.ts";
import { connectGateway } from "../../support/gateway/mod.ts";
import { reportHarness } from "../../support/gateway/shell.ts";
import type { SetupContext } from "../types.ts";
import { git } from "./git.ts";
import { type Material, textOf } from "./manifest.ts";

const TMPL = ".tmpl";
const SOURCE = "source/";

// source/ 아래 file을 `<work>/<slug>`에 풀고 git init·commit한다. 이름 끝의 `.tmpl`만 뗀다.
async function writeSource(
  material: Material,
  dir: string,
): Promise<string> {
  for (const file of material.files) {
    if (!file.path.startsWith(SOURCE) || !file.path.endsWith(TMPL)) continue;
    const path = `${dir}/${file.path.slice(SOURCE.length, -TMPL.length)}`;
    await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await Deno.writeFile(path, file.bytes);
  }
  await git(dir, "init", "-q");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "app");
  return await git(dir, "rev-parse", "HEAD");
}

// `startTestApp`에서 template 대신 재료의 source를 쓰는 것이 다르고 나머지는 같은 제품 길이다.
export async function restoreActiveApp(
  ctx: SetupContext,
  material: Material,
): Promise<Result<void>> {
  const { core, fake } = ctx;
  const spec = JSON.parse(textOf(material, "app.json")) as {
    slug: string;
    name: string;
    description: string;
    goal?: string;
  };
  const id = material.manifest.ids[spec.name] as Id<"app">;
  let gateway: TestApp["gateway"] | undefined;
  try {
    fake.reset();
    await core.call(appCreate, {
      id,
      slug: spec.slug,
      name: spec.name,
      description: spec.description,
    });
    const dir = `${core.run.work}/${spec.slug}`;
    const commit = await writeSource(material, dir);
    // 연결하면 core가 agent runtime child를 새 권한으로 다시 띄운다. 새 child가 ready가 될 때까지 기다린다.
    const before = await runtimePids(core.run.home);
    await core.call(
      appConnectSource,
      { app: id, source_path: dir },
      { base_revision: (await core.call(appGet, { app: id })).app.revision },
    );
    if (before.length > 0) await settle(core, before);
    // 이 grant 줄이 없으면 App Engineer의 call이 not_allowed다.
    await core.call(agentGrantsSet, {
      agent: { role: "app_engineer", app: id },
      entries: [{
        kind: "agent",
        agent: { role: "coding_agent", app: id },
        setting: "never",
      }],
    });
    gateway = await connectGateway(core);
    await reportHarness(core);
    const app: TestApp = {
      app: id,
      slug: spec.slug,
      name: spec.name,
      source: dir,
      commit,
      ae: await openSession(core, { role: "app_engineer", app: id }),
      gateway,
    };
    const { release } = await deliverRelease(core, fake, app, {
      goal: spec.goal ?? "Make the first release of the app",
    });
    // 전제 재료를 만드는 일이라 사람의 승인은 늘 allow다.
    await approveActivation(core, app, "allow");
    await waitRunning(core, app, release);
    ctx.world.apps[spec.name] = id;
    return ok(undefined);
  } catch (error) {
    return err({
      code: "unavailable",
      message: `active app ${spec.name} was not restored: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  } finally {
    // 진짜 driver가 같은 coding_terminal frame을 받으려면 Gateway를 놓아야 한다.
    await gateway?.close();
  }
}
