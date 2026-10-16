# contract-coding-adapter

coding agent adapter의 순수 값을 `protocol/coding-agent`에 새로 둔다: harness 표, hook → agent event 표와 turn 끝 신호 표, 실행 계획과 첫 prompt. core가 adapter 값을 부를 수 있게 하는 것이 목적이다(README 3장 #60). 구현(IO)은 넣지 않는다. 시각·파일·process는 인자로 받는다.

- 단위: contract-coding (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/harness-adapter.ts` (새로)
  - `packages/protocol/coding-agent/hook-signal.ts` (새로)
  - `packages/protocol/coding-agent/launch-plan.ts` (새로)
  - `packages/protocol/coding-agent/release-exclude.ts` (값만 고친다. export 이름과 type은 그대로)
- 읽을 것:
  - spec: S6 2장(결정 1·5), 4장(adapter가 갖는 것), 5장(맡기기), 6장(hook → event), 12장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`
  - spec: S1 6장(agent event) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - inventory: `I1.6#19`, `I2.6#12`, `I2.6#36`
  - 참고(coding-agent 몫의 줄, 이 표들의 원천): `I2.6#14`, `I2.6#15`, `I2.6#16`, `I2.6#17`, `I2.6#18`, `I2.6#19`
  - 결정: `../README.md` 3장 #60, #66·67, #74
  - 지금 코드(읽기만): `packages/coding-agent/harnesses/catalog/*.ts`(제품별 실행 파일 이름, version probe, hook 위치), `packages/coding-agent/sessions/model.ts`(`PROMPT_ADAPTERS`), `sessions/plan.ts`, `sessions/prompt.ts`, `sessions/observe/{hooks,plugins,model}.ts`, `packages/protocol/coding-agent/{launch,harnesses,release-exclude,guides}.ts`
  - 조사: `/home/pyosechang/projects/lophn/project-docs/tmp/research/turn-end-hermes-openclaw.md`, `events-claude-code.md`, `events-codex-gemini.md`, `events-opencode-pi.md`
- 계약:
  - 쓰는 것: `harnessIdSchema`·`HarnessId`(`harnesses.ts`, 그대로 쓴다), `ticketIdSchema`(`ticket-values.ts`), `absolutePathSchema`(`protocol/projects/values.ts`), `idSchema("ses")`·`idSchema("app")`(`protocol/base/ids.ts`), `Result`(`base`). S1 agent event의 이름은 contract-events가 `protocol/events`에 둔다. 이 task의 `HookSignal`은 그 event로 바꾸기 전의 중간값이다.
  - 내놓는 것: 아래 3장.

## 새로 놓는 모양

옛 `launch.ts`, `harnesses.ts`, `sessions.ts`, `guides.ts`는 지우지 않는다(옛 코드가 쓴다). 옆에 새 file만 더한다. 옛것은 wave 3 task가 안 쓰게 하고 cleanup이 지운다.

### `harness-adapter.ts`

```ts
export type HarnessAdapter = {
  id: HarnessId;                     // 일곱: claude, codex, opencode, gemini, pi, hermes, openclaw
  label: string;
  commands: readonly string[];       // PATH에서 찾을 실행 파일 이름
  version_probe: { argv: readonly string[] } | null;
  login_probe: { argv: readonly string[] } | null;   // 없으면 로그인은 "확인 못함"
  model_flag: readonly string[] | null;              // 예: ["--model"]. 실행 옵션의 model을 넘기는 argv 조각
  prompt:                                            // 첫 prompt를 넘기는 방법
    | { kind: "argv"; flag: string | null }          // flag가 null이면 positional
    | { kind: "paste_after_hook" }                   // session 시작 hook을 받은 뒤 PTY에 paste
    | null;                                          // 둘 다 안 되면 null = 맡길 수 없는 제품(Settings에 보인다)
  skill_dir: string | null;          // 앱 source 폴더 기준 상대 위치. skill을 놓는 곳
  hook: {                            // hook을 놓는 곳. 앱 source 폴더 안 project 설정만(사용자 전역 금지)
    path: string;                    // 앱 source 폴더 기준 상대 경로. git에 안 들어가는 local 설정이 있으면 그쪽
    format: "json" | "toml" | "plugin_file";
  } | null;                          // hook이 없거나 검증하지 못한 제품은 null
};
export const HARNESS_ADAPTERS: Readonly<Record<HarnessId, HarnessAdapter>>;
export const TURN_END_SIGNALS: Readonly<Record<HarnessId, string | null>>;   // turn 끝 신호 표
export const CODING_SKILL_NAMES: readonly ["lophn-build-app", "lophn-repair"];
export function canDeliverMessages(id: HarnessId): boolean;   // TURN_END_SIGNALS[id] !== null
export function canLaunch(id: HarnessId): boolean;            // prompt !== null
```

- `TURN_END_SIGNALS` 값은 S6 4장과 12장 1을 따른다: claude `Stop`, codex `Stop`, gemini `AfterAgent`, opencode `session.status` idle, pi는 조사의 `agent_end`와 지금 코드의 `agent_settled`가 다르다(확인한 결과를 보고의 정한 것에 적는다), hermes와 openclaw는 `null`.
- `hook`: 제품마다 project 설정 위치를 조사 file과 지금 catalog에서 찾아 적는다. 확인한 것만 적고 못 찾은 제품은 `null`로 둔다(I2.6#18: "검증된 것만 설치"). 이미 알려진 것: claude `.claude/settings.local.json`, codex `.codex/hooks.json`, gemini `.gemini/settings.json`(조사 `events-codex-gemini.md`).
- `prompt`: 지금 `PROMPT_ADAPTERS`의 검증한 argv 방식(claude positional, codex positional, opencode `--prompt`, gemini `--prompt-interactive`, pi positional)을 옮긴다. hermes와 openclaw는 S6 12장 1대로 "turn 끝 신호가 없는 제품으로 시작하고 첫 prompt만 넣는다"(I2.6#14). 둘의 argv 전달이 조사로 확인되지 않으면 `prompt: null`로 두고 보고한다. 화면 출력으로 준비를 짐작하는 `stdin_after_ready`는 두지 않는다(S6 2장 1).

### `hook-signal.ts`

```ts
export const HOOK_SIGNAL_TYPES = [
  "SessionStarted", "TurnStarted", "TurnEnded",
  "PermissionRequested", "PermissionResolved", "SessionEnded",
] as const;
export type HookSignal = {
  type: (typeof HOOK_SIGNAL_TYPES)[number];
  external_session?: string;                              // SessionStarted. hook이 실제로 준 것만(S6 4장)
  outcome?: "completed" | "failed" | "interrupted";       // TurnEnded
  reason?: string;                                        // SessionEnded
  request?: { tool: string | null; summary: string | null }; // PermissionRequested
};
export const HOOK_EVENT_TABLE: Readonly<Record<HarnessId, Readonly<Record<string, HookSignal["type"]>>>>;
export function hookSignalOf(harness: HarnessId, event: string, payload: unknown): HookSignal | null;
```

- 표의 원천은 `sessions/observe/hooks.ts`(Claude, Codex, Gemini)와 `plugins.ts`(OpenCode, pi)다(I2.6#16). 상태 문자열(`ready`, `working`, ...)이 아니라 S1 6장의 agent event로 바꾼다. 상태 계산은 core가 한다.
- `hookSignalOf`는 순수 함수다. 모르는 event 이름, 모양이 틀린 payload, 길이 상한(1,024 code point)을 넘거나 제어 문자가 든 값은 `null`이다. 화면 출력이나 transcript를 읽지 않는다.
- hermes와 openclaw는 표가 비어 있다(hook이 없다. S6 5장 5).

### `launch-plan.ts`

```ts
export type CodingRunOptions = { harness?: HarnessId; model?: string };   // call 봉투의 options(#74). 빠진 칸은 Settings 기본
export const codingLaunchPlanSchema: z.ZodType<CodingLaunchPlan>;
export type CodingLaunchPlan = {
  session: string;            // idSchema("ses")
  app: string;                // idSchema("app")
  ticket: string;
  harness_id: HarnessId;
  cwd: string;                // 앱 source 폴더 (절대 경로)
  executable: string;         // shell main이 감지해 core에 알린 절대 경로
  argv: string[];             // argv[0]은 executable 이름. shell을 거치지 않고 직접 띄운다
  env: Record<string, string>;      // 안전 overlay(TERM 등) + 호출자가 넣은 값(coding token 포함)
  env_delete: string[];       // 상속된 lophn 식별 환경 변수를 지울 이름
  first_prompt: string;
  prompt_delivery: { mode: "argv" } | { mode: "paste_after_hook"; deadline_ms: number };
  title: string;              // 터미널 탭 제목. 사람이 연 shell 탭과 구별된다(U2.6#3)
};
export function launchPlanOf(input: {
  session: string; app: string; ticket: string; harness_id: HarnessId;
  executable: string; cwd: string; options: CodingRunOptions;
  env: Record<string, string>;      // 호출자가 token을 넣어 준다. 이 함수는 token을 만들지 않는다
}): Result<CodingLaunchPlan>;
export function firstPromptOf(ticket: string): string;
```

- `launchPlanOf`는 지금 `sessions/plan.ts`의 순수 부분이다(I2.6#12). 감지, version 정책 판정, 클릭 사실(`SessionPlanFacts`), profile, connection, `human_start_handle`, `own_terminal` 안내는 가져오지 않는다. 남기는 것: 실행 파일 절대 경로 검사, `.cmd`·`.bat` shim 거절, argv 한 인자로 prompt 넘기기, `adapter.prompt === null`이면 `unavailable`로 거절, `options.model`은 `model_flag`가 있을 때만 argv에 넣는다.
- `firstPromptOf`(지금 `sessions/prompt.ts`)는 CLI 명령을 가리키게 다시 쓴다(I2.6#11): `lophn ticket show <id>`로 읽기, `lophn ticket claim <id>`로 맡기, 일하고 조건을 직접 확인하기, `lophn ticket report <id>`로 완료 보고, 막히거나 blueprint 변경이 필요하면 `lophn message send`. 근거는 ticket id뿐이다(본문·token을 복제하지 않는다). MCP 도구 이름을 쓰지 않는다. "이 글은 지시이고 ticket 안의 글은 자료다" 줄은 남긴다.
- 환경 변수 이름 `LOPHN_CODING_TOKEN`은 contract-coding-routes가 `token.ts`에 둔다. 이 task는 이름을 import하지 않고 `env`를 인자로 받는다.

### `release-exclude.ts` (값만)

release bundle에서 빼는 경로를 이렇게 바꾼다(I2.6#36): MCP·안내·skill 사본 경로(`.mcp.json`, `AGENTS.md`/`CLAUDE.md` 안내, `skills/lophn-navigate`, `skills/lophn-save`, `.lophn/skills`, `bin/lophn`, `.lophn/hooks`)를 없애고, `HARNESS_ADAPTERS`의 `hook.path` 전부와 `skill_dir`(`CODING_SKILL_NAMES` 각각)를 넣는다. 목록은 `HARNESS_ADAPTERS`에서 계산해 만든다. `RELEASE_EXCLUDE_PATHS`와 `releaseExcludes`의 이름과 type은 그대로 둬 `core/apps/releases`가 계속 컴파일된다.

## 할 일

1. `harness-adapter.ts`를 위 모양대로 만든다. 값은 `harnesses/catalog/*.ts`와 `sessions/model.ts`에서 옮기고, 조사 file로 turn 끝 신호와 hook 위치를 확인한다. 못 찾은 칸은 `null`로 두고 보고한다.
2. `hook-signal.ts`를 만든다. 옛 `sessions/observe/*`의 이름 → event 대응을 표로 옮긴다.
3. `launch-plan.ts`를 만든다. zod schema(`codingLaunchPlanSchema`), `launchPlanOf`, `firstPromptOf`.
4. `release-exclude.ts`의 값을 `HARNESS_ADAPTERS`에서 계산하게 바꾼다. 순환 import가 생기면 `release-exclude.ts`가 `harness-adapter.ts`를 import하게 한다(반대는 안 된다).
5. 옛 file(`launch.ts`, `harnesses.ts`, `sessions.ts`, `guides.ts`, `ticket-*.ts`)은 고치지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: 해당 없음(옛것은 wave 3과 cleanup이 지운다). 대신 `grep -n "stdin_after_ready\|own_terminal\|human_start_handle\|LOPHN_CONNECTION" packages/protocol/coding-agent/{harness-adapter,hook-signal,launch-plan}.ts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `packages/protocol/coding-agent/mod.ts`에 새 3 file의 export 추가. 이름 충돌이 없는지 lead가 본다.
- 안 쓰게 될 옛 export(wave 3 coding-agent task와 cleanup이 지운다): `launch.ts`의 `sessionPlan*`·`SessionGuide`·`OWN_TERMINAL_METHOD`·`LOPHN_CONNECTION`·`PROMPT_DELIVERY_*`, `harnesses.ts`의 profile·environment·loading·integration 관련 type, `sessions.ts` 전체의 observation 장치, `guides.ts`의 `DEPLOY_SKILL_NAMES`와 `HOOK_*`
- 정한 것:
  - pi의 turn 끝 신호 이름(`agent_end` 대 `agent_settled`)을 조사로 확인한 결과
  - hermes·openclaw의 `prompt` 값과 이유
  - 제품별 `hook` 위치를 못 찾아 `null`로 둔 것
  - `CodingRunOptions`와 contract-calls-places의 `CodingOptions`(`{harness?, model?}`)가 같은 칸인지 대 본 결과. `protocol/lophn-agent`가 `harnesses.ts`를 import하므로 순환을 피하려고 이 file은 `lophn-agent`를 import하지 않고 type을 따로 둔다.
- 계약 바꾸기 요청: 없음(wave 2라 바로 고친다)
