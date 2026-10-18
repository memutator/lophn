// trial 전에 한 번. Claude Code가 있는지 보고, core의 harness 기본값을 정하고, 사람이 전역 hook·skill을 미리 설치했는지 확인한다.
// 전역 설정은 쓰지 않는다. 없으면 사람이 칠 명령을 적어 던진다.
import type { Clock } from "../../../../packages/base/mod.ts";
import {
  type HarnessDetection,
  harnessDetectionSchema,
  harnessReport,
} from "../../../../packages/protocol/coding-agent/mod.ts";
import { settingsUpdate } from "../../../../packages/protocol/config/mod.ts";
import type { Core } from "../../../support/core/mod.ts";
import { driverEnv } from "./env.ts";
import { CHECKOUT, ensureWrapper } from "./wrapper.ts";

export type PrepareDeps = {
  core: Core;
  root: string;
  hookRoot?: string;
  binDir: string;
  model: string;
  clock: Clock;
  install: "check";
};

async function run(wrapper: string, args: string[]): Promise<unknown> {
  const out = await new Deno.Command(wrapper, {
    args,
    env: driverEnv(Deno.env.toObject()),
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(out.stdout);
  if (out.code !== 0) {
    throw new Error(
      `lophn ${args.join(" ")} 실패(${out.code}): ${
        new TextDecoder().decode(out.stderr).trim()
      } ${text.trim()}`,
    );
  }
  return JSON.parse(text);
}

// `claude --version`의 첫 낱말. model 호출이 없다.
export async function claudeVersion(claude: string): Promise<string> {
  const out = await new Deno.Command(claude, {
    args: ["--version"],
    env: driverEnv(Deno.env.toObject()),
    clearEnv: true,
    stdout: "piped",
    stderr: "null",
  }).output();
  const word = new TextDecoder().decode(out.stdout).trim().split(/\s+/)[0];
  if (out.code !== 0 || !word) throw new Error(`${claude} --version 실패`);
  return word;
}

export async function prepareCodingAgent(
  deps: PrepareDeps,
): Promise<{ wrapper: string; claude: string; version: string }> {
  const hookRoot = deps.hookRoot ?? CHECKOUT;
  const wrapper = await ensureWrapper(deps.binDir, deps.root);
  const hookWrapper = hookRoot === deps.root
    ? wrapper
    : await ensureWrapper(`${hookRoot}/.dev-data/eval/bin`, hookRoot);

  const detections =
    (await run(wrapper, ["harness", "detect", "--json"]) as unknown[])
      .flatMap((item) => {
        const parsed = harnessDetectionSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      });
  const found: HarnessDetection | undefined = detections.find((item) =>
    item.harness_id === "claude" && item.discovery === "detected"
  );
  if (!found?.selected_executable) {
    throw new Error("PATH에 claude가 없다. Claude Code를 설치하고 로그인한다");
  }
  const claude = found.selected_executable;

  // 기본값은 core가 harnessReport를 받는 순간 snapshot으로 쥔다. 설정을 먼저 바꾸고 보고한다.
  const updated = await deps.core.call(settingsUpdate, {
    changes: [
      { key: "coding-agent.default_harness", action: "set", value: "claude" },
      {
        key: "coding-agent.default_model",
        action: "set",
        value: deps.model,
      },
    ],
  });
  if (updated.rejected.length > 0) {
    throw new Error(
      `coding agent 설정이 거절됐다: ${JSON.stringify(updated.rejected)}`,
    );
  }
  await deps.core.call(harnessReport, { detections: [found] });

  const seen = await run(wrapper, [
    "harness",
    "install",
    "--json",
    "--input",
    JSON.stringify({ harness: "claude", dry_run: true, command: hookWrapper }),
  ]) as { skill: string; hook: string; files: string[] };
  if (seen.skill === "missing" || seen.hook === "missing") {
    throw new Error(
      `Claude Code의 전역 hook·skill이 없다(skill ${seen.skill}, hook ${seen.hook}). 놓일 file:\n${
        seen.files.join("\n")
      }\n사람이 한 번 친다:\n${hookWrapper} harness install --input '${
        JSON.stringify({ harness: "claude", command: hookWrapper })
      }'`,
    );
  }

  return { wrapper, claude, version: await claudeVersion(claude) };
}
