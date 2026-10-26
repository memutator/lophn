# harness-coverage

- 목표: 터미널의 agent 층([terminal-agent.md](../../architecture/terminal-agent.md))이 다른 harness 관리 도구가 지원하는 coding agent를 같이 알아보게 한다. 탭 icon(foreground process), 상태 점과 알림(hook), 설치 확인과 trust까지 harness마다 맞춘다. Codex·OpenCode처럼 공유 server를 쓰는 harness는 lophn 터미널에서 private server로 띄운다.
- 재료: `reports/coding agent event 추상화 비교.md`, `research_notes/coding agent event 추상화 비교/{orca,emdash,herdr,paseo}.md`, `project-docs/architecture/terminal-agent.md`, `project-docs/architecture/coding-agent.md`, `packages/protocol/coding-agent/{harness-adapter,hook-signal,harnesses,harness-id}.ts`, `packages/coding-agent/harnesses/install.ts`, `packages/shell/renderer/parts/vendor-icon/`.
- 범위 밖: lophn이 coding agent를 띄우는 coding session 경로(막혀 있다)의 첫 prompt·MCP 칸을 새 harness에 채우는 일, 이어 하기(resume) 명령, ACP·app-server protocol로 모는 길.

## 정한 것

- harness 범위는 orca, emdash, herdr 셋 가운데 둘 이상이 지원하는 것이다(25종): claude, codex, opencode, pi, omp, cursor, copilot, kimi, kiro, antigravity, grok, droid, amp, devin, qwen, qoder, hermes, muse, codebuddy, command-code, prime-agent, mimocode, cline, letta, kilo. 한 곳만 지원하는 것(zcode, dsh, jcode, openclaude, qoder-cn, charm, auggie, goose, rovo, continue, codebuff, freebuff, mistral, jules, junie, autohand, zero, mastracode, maki)은 틈새라 넣지 않는다. (사람이 "얘네가 지원하는 대로"를 정했고, 겹치는 기준은 agent)
- Gemini CLI는 지운다. Google이 Antigravity(`agy`)로 옮겼고 emdash도 지웠다. 호환 장치를 남기지 않는다. (사람, 2026-10-26)
- OpenClaw는 지운다. 비교한 도구 어디도 지원하지 않고 lophn에도 hook이 없어 잃는 것이 탭 icon 하나다. (agent)
- hook이 없는 harness는 foreground 감지와 탭 icon만 한다(지금의 Hermes와 같다). 상태는 unknown이다.
- 새 harness의 coding session 칸(`prompt`, `mcp`, `model_flag`)은 채우지 않는다(`prompt: null`). 그 경로는 막혀 있고 미리 만들지 않는다.
- 공유 background server에 붙는 harness는 lophn 터미널의 shell function이 private server 옵션을 붙여 띄운다(Codex `--no-daemon`, OpenCode `--standalone`, orca와 같은 방식). 다른 harness에 같은 꼴이 있으면 같이 넣는다.
- icon은 지금 쓰는 `@lobehub/icons-static-svg`(MIT)에서 고르고 판을 정확히 고정한다. 없으면 제품의 공식 asset을 쓰고 license를 `vendor-icon/LICENSE`에 적는다. Codex icon은 지금 것이 틀렸다(사람) — 지금 Codex의 표지로 바꾼다.

## 단위

1. **조사** (worker 5, 읽기만): harness마다 실행 파일 이름, foreground로 보이는 이름, hook 위치와 꼴, event → 신호 표, payload의 session id·권한 칸, subagent 표지, hook trust 요구, 공유 server와 피하는 옵션, Esc 끊기 때 turn 끝 신호, icon 출처와 license. 근거는 세 도구 소스의 file:line과 공식 문서다. 결과는 `specs/<harness>.md`로 둔다.
2. **표** (worker 1): `HARNESS_IDS`, `HARNESS_ADAPTERS`, `HOOK_EVENT_TABLE`과 신호 해석, shell IPC의 harness 목록, Gemini·OpenClaw 지우기.
3. **설치** (worker 1): 새 hook 꼴(TOML, plugin 폴더, extension 등)의 설치·`dry_run`·사용자 설정 보존, trust 기록이 필요한 harness.
4. **icon** (worker 1): Codex icon 교체와 새 harness icon, `harnessVendorOf`.
5. **private server wrapper** (진행 중인 worker): codex·opencode, 그리고 조사에서 같은 꼴이 나온 harness.
6. **검증**: 아래.

## 순서

- wave 1: 조사 5개 병렬. wrapper는 이미 돌고 있다.
- wave 2: 표, 설치, icon을 병렬(소유가 겹치지 않는다: 표 = `packages/protocol/coding-agent/**`·`packages/shell/ipc/coding.ts`, 설치 = `packages/coding-agent/**`, icon = `packages/shell/renderer/parts/vendor-icon/**`·`packages/shell/renderer/workspace/kinds/terminal.tsx`). 설치는 표의 event 이름을 쓰므로 표의 계약(harness id와 event 이름)을 조사 결과에서 lead가 먼저 고정한다.
- wave 3: 검증, 문서, changelog.

## 검증

- 자동: harness마다 설치를 임시 HOME에 하고 사용자 설정이 보존되는지, `dry_run`이 다시 `unchanged`인지. 설치한 hook command를 그 harness payload 꼴로 실제 launcher로 실행해 앱의 탭 상태가 바뀌는지(Codex 때 한 방식).
- 실제 harness(이 컴퓨터에 있는 것: claude, codex, opencode, omp, agy, grok, devin, hermes, cline): 개발 앱 터미널에서 띄워 탭 icon, 설치 확인 dialog, hook 적재(harness가 보여 주면 그 화면), 짧은 prompt 한 번으로 working 점과 turn 끝. 설치 dialog의 Install은 사람이 누른다(agent가 누르는 것은 권한 분류기가 막는다).
- `deno task check`.

## 상태

| 단위 | 상태 |
|---|---|
| 조사 | 끝: `specs/` 넷 |
| 바탕(lead) | 끝: id 25개, Gemini·OpenClaw 지움, `harness-hooks.ts`로 설치 위치 분리, `harnessOfProcess` 자리, `interrupt_keys` |
| 표 | 진행 중(protocol adapter·신호·process 규칙) |
| 설치 | 진행 중(형식별 설치, stdout 계약, plugin·extension 본문) |
| shell | 진행 중(foreground argv, 다른 harness hook 무시, harness별 끊기 키, kilo·cline wrapper) |
| icon | 끝: 25종, Codex는 OpenAI 매듭(사람) |
| 터미널 오른쪽 여백 | 끝: scrollbar 자리 14px → 6px |
| wrapper | 끝: codex `--no-daemon`, opencode `--standalone`(bash `--init-file`, zsh `ZDOTDIR`, fish `--init-command`) |
| OpenCode 2.x plugin | 끝: `default { id, server, setup }`, 2.x event를 1.x 이름으로 |
| 검증 | 대기 |
