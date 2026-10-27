// test용 앱을 제품의 길로 activate하는 준비다: `app.create`(core가 source 폴더를 깔고 앱에 잇는다) → 견본·patch commit →
// App Engineer session → 가짜 model이 App Engineer로 `release_prepare` →
// `release_activate` → 사람의 `activation.consent` → running. data root에 release를 직접 깔지 않는다.
//
// App Engineer의 fake 대답은 session 하나의 줄(lane)로 건다. 줄은 요청의 tool 목록에 `release_prepare`가 있고 본문에
// 이 앱의 사람 메시지(`App <id>:`)가 있는 요청이 받는다. 앱 id만으로 가르면 다른 앱의 id를 싣는 prompt와 섞인다.
import { releasesListRecords } from "../../../packages/protocol/apps/activation/activation.ts";
import {
  type ActivationConsent,
  activationConsent,
  activationConsents,
} from "../../../packages/protocol/apps/activation/consent.ts";
import {
  appCreate,
  appRuntime,
  releaseActivate,
  type ReleaseActivateOutput,
  releasePrepare,
  type ReleasePrepareOutput,
  type RuntimeObservation,
} from "../../../packages/protocol/apps/mod.ts";
import type { Core } from "../core/mod.ts";
import {
  openProject,
  openSession,
  say,
  type Turn,
  turnsOf,
  until,
} from "../core/human.ts";
import type { FakeServer, JournalEntry, Step } from "../fake-server/mod.ts";
import { lastToolResult, toolNames } from "../fake-server/probe.ts";
import { type AppPatch, createAppSource } from "./source.ts";

export type TestApp = {
  app: string;
  slug: string;
  name: string;
  source: string;
  commit: string;
  ae: string; // App Engineer session. e2e가 이 이름으로 읽는다
};

// App Engineer turn 하나가 기다리는 상한: release 준비 360초 + activation 기다림 120초. lophn-agent에는 tool 호출 하나의
// 시간 한도가 없고(한도 timer는 model 호출만 끊는다) 실제 상한은 core 쪽이라, test 쪽 기다림만 이보다 길면 된다.
const AE_TURN_WAIT_MS = 480_000;
// 첫 activation은 앱 process를 처음 띄우고, drain은 5초 읽기를 기다린다.
const RUNNING_WAIT_MS = 120_000;

// 기다리다 실패하면 무엇을 기다렸는지에 더해 그때의 release·runtime 상태를 담는다.
async function explaining<T>(
  describe: () => Promise<string>,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message} [${await describe().catch(() => "상태를 읽지 못함")}]`,
    );
  }
}

async function appStateOf(core: Core, app: string): Promise<string> {
  const releases = await core.call(releasesListRecords, { app });
  const runtime = await core.call(appRuntime, { app });
  return `release: ${
    releases.releases.map((item) => item.status).join(",") || "없음"
  }, runtime: ${runtime.state.state}`;
}

// 앱의 project 이름이다. Project Manager를 이름으로 가리키는 쪽(eval 시나리오)이 같은 규칙을 쓴다.
export const appProjectName = (slug: string) => `${slug}-project`;

// 앱은 project 하나에 묶이므로 사람이 먼저 project를 등록한다. 폴더는 run의 work 아래 `<slug>-project` 하나다.
export async function openAppProject(
  core: Core,
  slug: string,
): Promise<string> {
  const name = appProjectName(slug);
  const folder = `${core.run.work}/${name}`;
  await Deno.mkdir(folder, { recursive: true });
  return (await openProject(core, folder, name)).project;
}

export async function startTestApp(
  core: Core,
  _fake: FakeServer,
  options: {
    name: string;
    slug: string;
    patch?: AppPatch;
    id?: string;
    description?: string;
    sample?: boolean;
  },
): Promise<TestApp> {
  const created = await core.call(appCreate, {
    ...(options.id === undefined ? {} : { id: options.id }),
    slug: options.slug,
    name: options.name,
    description: options.description ?? `E2E app ${options.slug}`,
  });
  if (created.source_path === null) {
    throw new Error(
      `app.create가 source 폴더를 잇지 못했다(core log: ${core.logPath})`,
    );
  }
  const source = await createAppSource(core, {
    app: created.id,
    slug: options.slug,
    title: options.name,
    ...(options.patch === undefined ? {} : { patch: options.patch }),
    ...(options.sample === undefined ? {} : { sample: options.sample }),
  });
  const ae = await openSession(core, {
    role: "app_engineer",
    app: created.id,
  });
  return {
    app: created.id,
    slug: options.slug,
    name: options.name,
    source: source.dir,
    commit: source.commit,
    ae,
  };
}

export function aeLane(app: TestApp) {
  return {
    name: `ae-${app.app}`,
    match: (request: JournalEntry) =>
      toolNames(request).includes("release_prepare") &&
      JSON.stringify(request.body).includes(`App ${app.app}:`),
  };
}

export const tool = (id: string, name: string, args: unknown) => ({
  kind: "tool" as const,
  calls: [{ id, name, arguments: JSON.stringify(args) }],
});

// 이 turn에 aeLane이 받은 요청들(say 직전 journal 길이 뒤의 것)이다.
export type AeTurn = { turn: Turn; requests: JournalEntry[] };

// steps를 aeLane(app)에 걸고 `App <app.app>: <text>`를 말한 뒤 그 turn이 끝날 때까지 기다린다.
// index는 이 turn의 순번(0부터)이고 같은 session에서 tool call id가 겹치지 않게 id에 붙인다.
export async function aeTurn(
  core: Core,
  fake: FakeServer,
  app: TestApp,
  text: string,
  steps: (index: number) => Step[],
): Promise<AeTurn> {
  const lane = aeLane(app);
  const index = (await turnsOf(core, app.ae)).length;
  fake.script(steps(index), lane);
  const from = fake.journal().length;
  await say(core, app.ae, `App ${app.app}: ${text}`);
  const requestsOf = () =>
    fake.journal().slice(from).filter((entry) => entry.lane === lane.name);
  const turn = await explaining(
    async () => {
      const requests = requestsOf();
      const missed = requests.filter((entry) => entry.mismatch !== null).map((
        entry,
      ) => entry.mismatch).join(" / ");
      return `turn ${index}: ${
        (await turnsOf(core, app.ae))[index]?.state ?? "없음"
      }, lane 요청 ${requests.length}개${
        missed === "" ? "" : `, mismatch: ${missed}`
      }, ${await appStateOf(core, app.app)}`;
    },
    () =>
      until(`App Engineer turn ${index}이 끝남`, async () => {
        const found = (await turnsOf(core, app.ae))[index];
        return found?.state === "finished" ? found : undefined;
      }, AE_TURN_WAIT_MS),
  );
  return { turn, requests: requestsOf() };
}

// 그 turn에서 tool call id의 결과(tool_result 글의 JSON)다.
export type AeToolResult = {
  status: "success" | "failure" | "uncertain" | "not_executed";
  code: string;
  summary: string;
  content: unknown;
};

export function aeToolResult(turn: AeTurn, id: string): AeToolResult {
  for (const request of turn.requests.toReversed()) {
    const text = lastToolResult(request, id);
    if (text !== undefined) return JSON.parse(text) as AeToolResult;
  }
  throw new Error(
    `tool call ${id}의 결과가 없다 (turn outcome ${
      JSON.stringify(turn.turn.outcome)
    })`,
  );
}

function succeeded(name: string, result: AeToolResult): unknown {
  if (result.status !== "success") {
    throw new Error(`${name}: ${result.code} ${result.summary}`);
  }
  return result.content;
}

const text = (value: string) => ({
  reply: { kind: "text" as const, text: value },
});

export async function prepareRelease(
  core: Core,
  fake: FakeServer,
  app: TestApp,
  options: { goal?: string } = {},
): Promise<ReleasePrepareOutput> {
  const id = (n: number) => `tc_prepare_${n}`;
  let index = 0;
  const turn = await aeTurn(
    core,
    fake,
    app,
    options.goal ?? "Prepare a release",
    (n) => {
      index = n;
      return [
        { reply: tool(id(n), "release_prepare", { app: app.app }) },
        text("prepared"),
      ];
    },
  );
  return releasePrepare.output.parse(
    succeeded("release_prepare", aeToolResult(turn, id(index))),
  );
}

export async function activateRelease(
  core: Core,
  fake: FakeServer,
  app: TestApp,
  release: string,
): Promise<ReleaseActivateOutput> {
  const id = (n: number) => `tc_activate_${n}`;
  let index = 0;
  const turn = await aeTurn(core, fake, app, `Activate ${release}`, (n) => {
    index = n;
    return [
      { reply: tool(id(n), "release_activate", { release }) },
      text("activated"),
    ];
  });
  return releaseActivate.output.parse(
    succeeded("release_activate", aeToolResult(turn, id(index))),
  );
}

// turn 하나에서 prepare → activate.
export async function deliverRelease(
  core: Core,
  fake: FakeServer,
  app: TestApp,
  options: { goal: string },
): Promise<{ release: string; activated: ReleaseActivateOutput }> {
  let index = 0;
  const prepareId = (n: number) => `tc_prepare_${n}`;
  const activateId = (n: number) => `tc_activate_${n}`;
  const turn = await aeTurn(core, fake, app, options.goal, (n) => {
    index = n;
    return [
      { reply: tool(prepareId(n), "release_prepare", { app: app.app }) },
      {
        // 여기서 던지면 fake가 400으로 답해 turn이 실패하므로 값으로만 가른다.
        reply: (request: JournalEntry) => {
          const result = lastToolResult(request, prepareId(n));
          const out = result === undefined
            ? undefined
            : (JSON.parse(result) as AeToolResult).content as {
              status?: string;
              release?: { id: string };
            };
          return out?.status === "prepared"
            ? tool(activateId(n), "release_activate", {
              release: out.release!.id,
            })
            : { kind: "text" as const, text: "preparation failed" };
        },
      },
      text("done"),
    ];
  });
  const prepared = releasePrepare.output.parse(
    succeeded("release_prepare", aeToolResult(turn, prepareId(index))),
  );
  if (prepared.status !== "prepared") {
    throw new Error(
      `release 준비가 ${prepared.stage}에서 떨어졌다: ${prepared.reason}`,
    );
  }
  const activated = releaseActivate.output.parse(
    succeeded("release_activate", aeToolResult(turn, activateId(index))),
  );
  return { release: prepared.release.id, activated };
}

// 첫 activation은 항상 사람에게 묻는다. 대기가 오지 않으면 제한 시간 뒤 실패한다.
// 줄이 여럿이면 requested_at이 가장 늦은 줄에 답한다.
export async function approveActivation(
  core: Core,
  app: TestApp,
  choice: "allow" | "reject" = "allow",
): Promise<ActivationConsent> {
  const line = await explaining(
    () => appStateOf(core, app.app),
    () =>
      until("activation 동의 대기가 옴", async () => {
        const { consents } = await core.call(activationConsents, {
          app: app.app,
        });
        return consents.at(-1);
      }),
  );
  await core.call(
    activationConsent,
    { release: line.release, choice },
    { requested_at: line.requested_at },
  );
  return line;
}

export async function waitRunning(
  core: Core,
  app: TestApp,
  release?: string,
): Promise<RuntimeObservation> {
  return await explaining(
    () => appStateOf(core, app.app),
    () =>
      until("앱 process가 running·ready·accepting이 됨", async () => {
        const now = await core.call(appRuntime, { app: app.app });
        const seen = now.observation;
        return now.state.state === "running" && seen !== null && seen.ready &&
            seen.accepting &&
            (release === undefined || seen.release === release)
          ? seen
          : undefined;
      }, RUNNING_WAIT_MS),
  );
}

export async function activateTestApp(
  core: Core,
  fake: FakeServer,
  options: { name: string; slug: string; patch?: AppPatch },
): Promise<TestApp> {
  const app = await startTestApp(core, fake, options);
  const { release, activated } = await deliverRelease(core, fake, app, {
    goal: "Make the first release of the app",
  });
  if (activated.status !== "waiting_consent") {
    throw new Error(
      `첫 activation이 waiting_consent가 아니다: ${JSON.stringify(activated)}`,
    );
  }
  await approveActivation(core, app, "allow");
  await waitRunning(core, app, release);
  return app;
}
