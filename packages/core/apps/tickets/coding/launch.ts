// session을 새로 띄운다. 실행 옵션을 정하고, token을 만들고, 실행 계획을 짜 `open` 터미널 요청을 commit 뒤로 보낸다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  canLaunch,
  HARNESS_ADAPTERS,
} from "../../../../protocol/coding-agent/harness-adapter.ts";
import type {
  CodingOptions,
  HarnessId,
} from "../../../../protocol/coding-agent/harness-id.ts";
import {
  launchPlanOf,
  PASTE_AFTER_HOOK_DEADLINE_MS,
} from "../../../../protocol/coding-agent/launch-plan.ts";
import {
  CODING_TOKEN_ENV,
  CodingTokens,
} from "../../../../protocol/coding-agent/token.ts";
import type { CodingStartFailure } from "../../../../protocol/coding-agent/transport.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";
import { sendTerminal } from "./events.ts";
import type { CodingMemory } from "./memory.ts";
import { insertSession, type LineRow } from "./store.ts";

export function startFailure(
  reason: CodingStartFailure,
  message: string,
): Result<never> {
  return err({ code: "unavailable", message, details: { reason } });
}

type Launchable = {
  harness: HarnessId;
  executable: string;
  cwd: string;
  options: CodingOptions;
};

// call의 options에서 빠진 칸은 Settings 기본으로 채운다.
export function resolveLaunch(
  tx: Tx,
  memory: CodingMemory,
  app: string,
  options: CodingOptions,
): Result<Launchable> {
  const harness = options.harness ?? memory.defaults.harness;
  if (harness === undefined) {
    return startFailure("not_connected", "no harness is chosen");
  }
  const detection = memory.detections.get(harness);
  if (
    detection === undefined || detection.discovery !== "detected" ||
    detection.selected_executable === null
  ) {
    return startFailure("not_connected", `${harness} is not connected`);
  }
  if (!canLaunch(harness)) {
    return startFailure("cannot_launch", `${harness} cannot be launched`);
  }
  const source = tx.sql.get("SELECT source_path FROM apps WHERE id = ?", [app]);
  if (source === undefined || source.source_path === null) {
    return startFailure("no_source_folder", "the app has no source folder");
  }
  const model = options.model ?? memory.defaults.model;
  return ok({
    harness,
    executable: detection.selected_executable,
    cwd: String(source.source_path),
    options: model === undefined ? { harness } : { harness, model },
  });
}

// 그 앱에 끝나지 않은 session이 없을 때만 부른다.
export function openSession(
  tx: Tx,
  memory: CodingMemory,
  line: LineRow,
): Result<{ session: string }> {
  const launch = resolveLaunch(tx, memory, line.app, line.options);
  if (!launch.ok) return launch;
  const session = tx.newId("ses");
  let tokens: CodingTokens;
  try {
    tokens = tx.port(CodingTokens);
  } catch {
    return err({
      code: "unavailable",
      message: "coding tokens are not available",
    });
  }
  const issued = tokens.issue({ session, app: line.app } as never);
  if (!issued.ok) return issued;
  // token 원문은 plan의 env에만 담긴다. 표와 오류와 log에는 넣지 않는다.
  const plan = launchPlanOf({
    session,
    app: line.app,
    ticket: line.ticket,
    harness_id: launch.value.harness,
    executable: launch.value.executable,
    cwd: launch.value.cwd,
    options: launch.value.options,
    env: { [CODING_TOKEN_ENV]: issued.value.token },
  });
  if (!plan.ok) {
    tokens.revoke(session);
    return plan;
  }
  const pastes = HARNESS_ADAPTERS[launch.value.harness].prompt?.kind ===
    "paste_after_hook";
  insertSession(tx.sql, {
    session,
    app: line.app,
    ticket: line.ticket,
    call: line.call,
    harness: launch.value.harness,
    ended: false,
    started: false,
    heard: false,
    running: false,
    turn: null,
    permissions: [],
    inflight: false,
    external_session: null,
    prompt_pending: false,
    paste_until: pastes
      ? new Date(Date.parse(tx.now()) + PASTE_AFTER_HOOK_DEADLINE_MS)
        .toISOString()
      : null,
  });
  const request = memory.request({ kind: "open", session });
  sendTerminal(tx, { kind: "open", request, plan: plan.value } as never);
  return ok({ session });
}
