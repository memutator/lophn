// 다른 컴퓨터가 내놓은 앱을 이 컴퓨터에 들이는 길. sidebar 줄의 menu와 Settings › Sync가 같이 쓴다.
// 들일 수 있는 앱은 `machine/environment`의 `available`이 말하고, 그 목록에 없으면 그 앱이 private workspace에 있거나 아직 오지 않은 것이다.
import type { Id } from "../../../protocol/base/ids.ts";
import { appTakeIn } from "../../../protocol/folder/take-in.ts";
import type { MachineEnvironment } from "../../../protocol/folder/mod.ts";
import { commandBody } from "../command-call.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import type { SourceResult } from "./source.ts";

/** 다른 컴퓨터가 내놓았고 이 컴퓨터에 아직 없는 앱. */
export interface AvailableApp {
  readonly app: string;
  readonly name: string;
  /** 앱을 내놓은 컴퓨터. */
  readonly machine: string;
}

export type TakeInOutcome =
  | {
      readonly ok: true;
      readonly app: string;
      /** 준비만 된 release. 켜는 것은 앱 workspace의 lophn이 하고, 사람은 그때 동의 카드를 본다. */
      readonly release: string;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "sync_off"
        | "sdk_missing"
        | "slug_in_use"
        | "dependency_missing"
        | "source_incomplete"
        | "failed";
    };

export async function readAvailable(
  core: CoreSource,
): Promise<SourceResult<readonly AvailableApp[]>> {
  let reply;
  try {
    reply = await core.call({
      kind: "read",
      resource: "machine",
      method: "environment",
      body: {},
    });
  } catch {
    return { ok: false, code: "unavailable" };
  }
  if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
  const { available } = reply.value as MachineEnvironment;
  return {
    ok: true,
    value: available.map((one) => ({
      app: one.app,
      name: one.name,
      machine: one.machine,
    })),
  };
}

export async function takeInApp(
  core: CoreSource,
  app: string,
): Promise<TakeInOutcome> {
  const read = await readAvailable(core);
  if (!read.ok) return { ok: false, reason: "failed" };
  const offered = read.value.find((one) => one.app === app);
  if (offered === undefined) return { ok: false, reason: "sync_off" };
  let reply;
  try {
    reply = await core.call({
      kind: "command",
      resource: appTakeIn.resource,
      method: appTakeIn.method,
      body: commandBody(appTakeIn, {
        input: {
          app: offered.app as Id<"app">,
          from: offered.machine as Id<"mch">,
        },
        compare: {},
        key: `apps-take-in-${crypto.randomUUID()}`,
      }),
    });
  } catch {
    return { ok: false, reason: "failed" };
  }
  if (reply.ok) {
    const value = reply.value as { app: string; release: string };
    return { ok: true, app: value.app, release: value.release };
  }
  const reason = reply.error?.details?.["reason"];
  return {
    ok: false,
    reason:
      reason === "sdk_missing" ||
      reason === "slug_in_use" ||
      reason === "dependency_missing" ||
      reason === "source_incomplete"
        ? reason
        : "failed",
  };
}
