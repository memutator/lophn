# harness-skill-copies

설정 `coding-agent.shared_apps`에 있는 앱의 public skill을 lophn hook이 설치된 coding agent harness의 skill 폴더에 사본으로 둔다. lophn 기동 때, activation 뒤, 설정이 바뀔 때 맞춘다.

- 단위: coding-agent (wave 2)
- 선행: app-share-request. 설정 key와 바뀜 event를 쓴다.
- 소유(이 task만 고친다):
  - `packages/coding-agent/**`
  - `packages/protocol/coding-agent/**`
  - `packages/cli/commands/harness*.ts`(있으면)
  - `packages/shell/main/terminal/agent/**`
  - `packages/shell/main/desktop/wiring/agent.ts`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/harness-config.md` 단계 8
  - 계획: `project-docs/plan/skill-share/README.md` 정한 것 9, `project-docs/plan/skill-share/facts.md` "coding agent harness"
  - architecture: `project-docs/architecture/coding-agent.md`, `project-docs/architecture/terminal-agent.md`
- 계약:
  - 쓰는 것: `coding-agent.shared_apps`, 바뀜 event, `shared-skills`가 내는 public skill 읽기(같은 wave라 없으면 user token으로 부를 core read를 이 task가 `packages/protocol/coding-agent/`에 두고 보고한다)

## 할 일

1. 맞추기: `lophn harness sync-skills`(user token)가 core에서 공유 대상 앱의 public skill을 읽어, hook이 설치된 harness마다 adapter `skill_dir` 아래 `<name>/`에 SKILL.md와 딸린 file을 쓴다. lophn이 쓴 폴더에는 표시 file(예: `.lophn-shared`, 앱 slug와 release id)을 둔다.
2. 이미 같은 이름의 폴더가 있고 표시 file이 없으면 건드리지 않고 결과에 "건너뜀"으로 적는다. 표시 file이 있는데 대상에서 빠졌으면 그 폴더를 지운다(`remove`가 재귀가 아니면 file마다).
3. shell main이 lophn 기동 때, activation 뒤, 설정 바뀜 event 때 `sync-skills`를 부른다. 실패는 로그만 남긴다.
4. `harness uninstall`은 lophn이 쓴 공유 skill 사본도 지운다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "맞추기는 표시 file이 있는 폴더만 덮고 지우며, 사람이 둔 같은 이름의 skill 폴더는 그대로 남는다"
- 남지 않음: 없음

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `COMMANDS`에 넣을 명령
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
