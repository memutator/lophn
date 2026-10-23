// coding agent 실행 계획의 순수 값이다. 실행 파일 경로·시각·process는 인자로 받고 IO는 없다.
// token은 호출자가 env에 넣어 준다. 이 file은 token을 만들지 않는다.
import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import { idSchema } from "../base/ids.ts";
import { absolutePathSchema } from "../projects/values.ts";
import { HARNESS_ADAPTERS } from "./harness-adapter.ts";
import {
  type CodingOptions,
  type HarnessId,
  harnessIdSchema,
} from "./harness-id.ts";

// session 시작 hook을 기다리는 기한이다. 기한이 지나면 첫 prompt는 들어가지 않는다.
export const PASTE_AFTER_HOOK_DEADLINE_MS = 10_000;

const envNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

type CodingLaunchPlan = {
  session: string;
  app: string;
  harness_id: HarnessId;
  // 앱 source 폴더(절대 경로)다.
  cwd: string;
  // shell main이 감지해 core에 알린 절대 경로다.
  executable: string;
  // argv[0]은 실행 파일 이름이다. shell을 거치지 않고 직접 띄운다.
  argv: string[];
  // 안전 overlay(TERM 등)와 호출자가 넣은 값(coding token 포함)이다.
  env: Record<string, string>;
  // 상속된 lophn 식별 환경 변수를 지울 이름이다.
  env_delete: string[];
  first_prompt: string;
  prompt_delivery:
    | { mode: "argv" }
    | { mode: "paste_after_hook"; deadline_ms: number };
  // 터미널 탭 제목이다. 사람이 연 shell 탭과 구별된다.
  title: string;
};

export const codingLaunchPlanSchema: z.ZodType<CodingLaunchPlan> = z
  .strictObject({
    session: idSchema("ses"),
    app: idSchema("app"),
    harness_id: harnessIdSchema,
    cwd: absolutePathSchema,
    executable: absolutePathSchema,
    argv: z.array(z.string()).min(1),
    env: z.record(
      envNameSchema,
      z.string().refine((value) => !/\p{Cc}/u.test(value)),
    ),
    env_delete: z.array(envNameSchema),
    first_prompt: z.string().min(1),
    prompt_delivery: z.discriminatedUnion("mode", [
      z.strictObject({ mode: z.literal("argv") }),
      z.strictObject({
        mode: z.literal("paste_after_hook"),
        deadline_ms: z.literal(PASTE_AFTER_HOOK_DEADLINE_MS),
      }),
    ]),
    title: z.string().min(1),
  });

// TUI process env의 overlay다. TERM 같은 안전 값만 있고 provider auth나 token은 없다.
const ENV_SAFE_OVERLAY: Readonly<Record<string, string>> = {
  TERM: "xterm-256color",
  COLORTERM: "truecolor",
};

// 상속된 다른 terminal·credential 식별 값이다.
const ENV_DELETE: readonly string[] = [
  "LOPHN_TERMINAL_OBSERVE",
  "LOPHN_TOKEN",
  "LOPHN_CREDENTIAL",
  "LOPHN_APP_BROKER_CREDENTIAL",
];

// Windows의 `.cmd`·`.bat` shim은 줄바꿈 prompt를 argv로 넘기지 못한다.
function isBatchShim(executable: string): boolean {
  return /\.(cmd|bat)$/i.test(executable);
}

function executableName(executable: string): string {
  const name = executable.split(/[\\/]/).pop() ?? executable;
  return name.replace(/\.exe$/i, "");
}

// 첫 prompt다. lophn이 붙이는 고정 줄과 `<assignment>`로 싼 맡긴 글이다. token은 싣지 않는다.
export function firstPromptOf(app: string, prompt: string): string {
  return [
    `lophn 앱 ${app}의 일을 맡아 진행해 줘.`,
    "1. 연결된 앱 source에서 작업한다.",
    "2. 선언(`lophn.ts`)이 정본이다. 맡은 일에 필요하면 코드보다 먼저 직접 고치고 `deno.json`의 import map도 같은 정확한 version으로 함께 고친다. 막혔을 때만 `lophn message send`로 알린다.",
    "3. 끝나면 한 일과 남은 일을 `lophn message send`로 알린다.",
    "아래 <assignment>가 App Engineer가 맡긴 일이다.",
    "<assignment>",
    prompt,
    "</assignment>",
  ].join("\n");
}

export function launchPlanOf(input: {
  session: string;
  app: string;
  // 맡긴 글(call 본문)이다.
  prompt: string;
  harness_id: HarnessId;
  executable: string;
  cwd: string;
  options: CodingOptions;
  // 호출자가 token을 넣어 준다.
  env: Record<string, string>;
}): Result<CodingLaunchPlan> {
  const adapter = HARNESS_ADAPTERS[input.harness_id];
  if (adapter === undefined) {
    return err({ code: "invalid_input", message: "알 수 없는 harness다" });
  }
  const { harness, model } = input.options;
  if (harness !== undefined && harness !== input.harness_id) {
    return err({
      code: "invalid_input",
      message: "실행 옵션의 harness가 고른 harness와 다르다",
    });
  }
  if (adapter.prompt === null) {
    return err({
      code: "unavailable",
      message: `${adapter.label}는 첫 prompt를 넘기는 방법이 없어 맡길 수 없다`,
    });
  }
  if (!absolutePathSchema.safeParse(input.executable).success) {
    return err({
      code: "invalid_input",
      message: "실행 파일은 절대 경로여야 한다",
    });
  }
  if (isBatchShim(input.executable)) {
    return err({
      code: "unavailable",
      message:
        "`.cmd` shim은 줄바꿈 prompt를 argv로 넘기지 못해 시작하지 않는다",
    });
  }
  // flag로 읽히지 않게 model 값은 `-`로 시작할 수 없다.
  if (
    model !== undefined &&
    (model.length === 0 || model.startsWith("-") || /\p{Cc}/u.test(model))
  ) {
    return err({ code: "invalid_input", message: "model 값이 올바르지 않다" });
  }

  const prompt = firstPromptOf(input.app, input.prompt);
  const argv = [executableName(input.executable)];
  if (model !== undefined && adapter.model_flag !== null) {
    argv.push(...adapter.model_flag, model);
  }
  let delivery: CodingLaunchPlan["prompt_delivery"];
  if (adapter.prompt.kind === "argv") {
    // prompt는 한 인자다. shell 문자열 조합·quote·escape가 없다.
    if (adapter.prompt.flag !== null) argv.push(adapter.prompt.flag);
    argv.push(prompt);
    delivery = { mode: "argv" };
  } else {
    delivery = {
      mode: "paste_after_hook",
      deadline_ms: PASTE_AFTER_HOOK_DEADLINE_MS,
    };
  }
  const env = { ...ENV_SAFE_OVERLAY, ...input.env };
  const planned = codingLaunchPlanSchema.safeParse({
    session: input.session,
    app: input.app,
    harness_id: input.harness_id,
    cwd: input.cwd,
    executable: input.executable,
    argv,
    env,
    // 호출자가 넣은 값은 지우지 않는다.
    env_delete: ENV_DELETE.filter((name) => !(name in env)),
    first_prompt: prompt,
    prompt_delivery: delivery,
    title: `lophn coding · ${adapter.label}`,
  });
  if (!planned.success) {
    return err({
      code: "invalid_input",
      message: "실행 계획의 값이 올바르지 않다",
    });
  }
  return ok(planned.data);
}
