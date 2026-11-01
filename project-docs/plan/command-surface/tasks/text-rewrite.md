# text-rewrite

model이 읽는 글과 eval에서 옛 tool 이름(`release.prepare`, `job.create`, `tool.load`, `<domain>_<tool>` 같은 것)을 명령 꼴(`lophn release prepare`, `lophn <domain> <command>`)로 고친다.

- 단위: text (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-places/prompts/**`
  - `packages/core/agent-places/skills/**`
  - `packages/core/lophn-agent/prompt-assembly/skill-list.ts`
  - `packages/core/lophn-agent/run-loop/input-text.ts`
  - `packages/sdk/declaration/guide.md`
  - `packages/sdk/flow/guide.md`
  - `tests/eval/**`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/command-surface.md`
  - 명령 표: `packages/cli/commands/`(실제 명령 이름과 help), `lophn help`의 출력
  - eval: `.claude/skills/eval-run/SKILL.md`(registry가 hash로 판을 고정하는 방식)
- 계약:
  - 쓰는 것: 명령 표(wave 1, 2가 만든 것)

## 할 일

1. place prompt(`home.md`, `project.md`, `app.md`, `prompts.ts`)와 내장 skill 8개의 tool 이름을 명령 꼴로 고친다. 남은 native tool(`ask`, `visual.show`, `skill.read`, file·web·`shell.run`)은 이름 그대로다. 앱 바깥 명령은 `lophn <domain> <command>`이고 `lophn <domain> --help`로 본다고 쓴다.
2. "built-in skill + 명령"이 맞물리게 한다: skill은 일의 순서와 판단을 말하고, 명령의 칸은 `lophn <command> --help`가 말한다. skill에 명령 칸을 베끼지 않는다.
3. eval: scenario와 check가 tool 이름으로 세던 것(`toolCount({tool: "app.create"})`, `collect/read.ts`의 `call`, `versions/components.ts`의 `skill.read`)을 기록 이름(명령 이름)으로 맞춘다. registry(`tests/eval/registry/`)는 새 hash 판을 더한다. 옛 판을 고치지 않는다. 지운 tool(`tool.load` 등)의 기록이 무엇을 남겨야 하는지는 registry 규칙을 따른다.
4. `grep -rn "\b\(app\|release\|preview\|package\|declaration\|job\|workflow\|domain\|kind\|settings\|agent\|session\)\.[a-z_]\+\b" packages/core/agent-places tests/eval`로 남은 옛 이름을 찾는다.

## 끝남

- `npm run check:full`이 통과하고 `boot.sh`가 두 번 `exit 0`이다.
- 위험 test: 없음(글이다)
- 남지 않음: 4의 grep에 내장 tool이던 이름이 0줄이다(명령 이름으로 쓴 `lophn release prepare` 꼴은 남는다).

## 보고

- 바꾼 file, 통과한 check
- 등록할 것
- 정한 것, 넘길 줄
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

## lead가 더함 (wave 1 보고에서 모은 것)

- 옛 이름이 남은 곳으로 보고된 것: `packages/core/agent-places/prompts/prompts.ts`(`workflow.report`), `packages/core/lophn-agent/run-loop/input-text.ts`(step 입력 글의 `workflow.report`), `packages/core/agent-places/skills/write-workflow/SKILL.md`, `packages/sdk/flow/guide.md`, `packages/core/agent-places/skills/make-domain/SKILL.md`("Every tool an app declares names the domain" → 앱 command).
- `lophn workflow get`은 `--lines N`으로 최근 줄만 읽는다. 지침에는 `--lines 20`처럼 쓰게 한다. `lophn workflow edit`의 `add_step`은 `--new-step <json>`이다.
- eval registry에서 낡은 것: `tests/eval/registry/tool/`의 job·workflow tool JSON, 지침 snapshot(`operator.json`, `app_engineer.json` 등).
