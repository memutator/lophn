# harness-skill

harness agent가 자기 shell에서 `lophn` CLI로 답하고 다른 agent를 부르는 법을 skill 하나로 배운다. extension `harness`가 켜져 있으면 harness skill 폴더에 둔다(사람, 2026-11-04).

- 단위: harness (wave 4)
- 선행: harness-reply.
- 소유(이 task만 고친다):
  - `packages/coding-agent/local/harness-run.ts`(`runHarnessSyncSkills`), `packages/coding-agent/harnesses/skill-copies.ts`(+test)
  - 새 skill 원본 한 곳(예: `packages/coding-agent/skills/lophn-agent/SKILL.md`나 그것을 담은 `.ts`)
  - `packages/shell/main/terminal/agent/skill-sync.ts`, `packages/shell/main/desktop/wiring/agent.ts`(sync를 부르는 때)
- 읽을 것:
  - architecture: `project-docs/architecture/coding-agent.md`("coding agent에게 가는 skill", "사본에는 표시 file이 있고", "harness agent")
  - 사실: `packages/cli/commands/call.ts`(call send·reply 사용법), `packages/protocol/coding-agent/headless/env.ts`(turn 자격 env 이름)
  - 제품 결정: 계획 README 정한 것 6
- 계약:
  - 쓰는 것: `lophn harness sync-skills`, 설정 `extensions.harness.enabled`, 표시 file `.lophn-shared`
  - 내놓는 것: 없음

## 할 일

1. skill 하나(이름 `lophn-agent`): lophn이 띄운 harness turn(env에 turn 자격이 있을 때)에서 받은 call에 `lophn call reply`로 답하기, `lophn call send`로 다른 agent에게 맡기기, `lophn session list`·`lophn agent card`로 상대 알기. 자격이 없으면(사람 터미널) 쓰지 않는다고 적는다. 명령 사용법은 CLI help와 같은 말을 쓴다.
2. `sync-skills`가 설정 `extensions.harness.enabled`를 읽어(이미 `settings.list`를 읽는다) 켜졌으면 이 skill을 Claude Code, Codex, OpenCode의 `skill_dir`에 두고, 꺼졌으면 lophn이 쓴 이 사본만 지운다. hook 설치 여부와 상관없다(켜기가 사람의 허락이다). 앱 공유 skill의 규칙(hook이 놓인 harness만)은 그대로다.
3. shell main은 `SettingsChanged`의 keys에 `extensions.harness.enabled`가 있을 때도 sync를 부른다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "harness extension이 꺼지면 lophn-agent skill 사본만 지우고 사람의 같은 이름 폴더는 건드리지 않는다"
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
