# instr-claude-fallback

전역과 project 지침 층이 그 자리에 `LOPHN.md`가 없으면 `CLAUDE.md`를 읽는다. prompt의 지침 제목은 실제로 읽은 파일 이름을 보인다.

- 단위: agent (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/instructions/**`
  - `packages/core/lophn-agent/prompt-assembly/turn-prompt.ts`
  - `packages/core/lophn-agent/prompt-assembly/turn-prompt_test.ts`
  - `packages/protocol/lophn-agent/instructions.ts`
  - `packages/core/main/daemon/wiring/instructions-registration.ts`
  - `tests/e2e/prompt-notice_test.ts`
  - `tests/e2e/prompt-blocked_test.ts`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/harness-config.md` 단계 1과 "정한 것"
  - 계획: `project-docs/plan/skill-share/README.md` 정한 것 1, `project-docs/plan/skill-share/facts.md` "지침 층"
  - architecture: `project-docs/architecture/agent-definition.md`(지침 층, cache, notice)
- 계약:
  - 쓰는 것: `PROMPT_INSTRUCTION_LAYERS`
  - 내놓는 것: 지침 층 값에 읽은 파일 이름(`LOPHN.md` 또는 `CLAUDE.md`)

## 할 일

1. `instructions/files.ts`: 전역(`<root>`)과 project(첫 폴더, 없으면 `<data>/projects/<prj>/`) 자리마다 `LOPHN.md`를 먼저 열고, 없으면(ENOENT) 같은 자리의 `CLAUDE.md`를 연다. 둘 다 없으면 지금처럼 없는 층이다. `LOPHN.md`가 있으면 `CLAUDE.md`는 보지 않는다. domain·agent 층은 그대로다.
2. 읽은 파일 이름을 층 값에 싣고 `turn-prompt.ts`의 제목이 그 이름을 쓰게 한다(`Project instructions (CLAUDE.md)`). 32 KiB 상한, 못 읽는 층의 turn 막기, notice와 cache 규칙은 그대로다.
3. 바뀐 층 감지(다음 turn의 system 재조립과 notice)가 `CLAUDE.md`를 읽은 층에도 같은 규칙으로 돈다.
4. 편집 화면(`LOPHN.md`만 쓴다)은 고치지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음
- 남지 않음: 없음

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
