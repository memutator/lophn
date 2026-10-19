# agent-definition

agent 정의와 turn 조립(지침, tool, skill, place 정보, cache)에 걸린 열린 이슈. 흐름과 불변 조건은 `project-docs/architecture/agent-definition.md`.

## 파일 읽기가 pdf와 이미지 말고 docx 같은 형식을 못 읽는다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: `packages/core/lophn-agent/tools/file/read.ts`는 UTF-8 텍스트만 읽고, 아니면 pdf/이미지는 각 tool을 안내하고 나머지는 `not a UTF-8 text file`로 거절한다. pdf는 `packages/core/lophn-agent/tools/file/pdf.ts`(`unpdf`), 이미지는 `packages/core/lophn-agent/tools/file/image.ts`뿐이다. docx, xlsx 등의 reader는 없다.

영향: 사람이 place 폴더에 둔 docx 문서를 agent가 읽지 못한다. 사람이 텍스트로 바꿔 줘야 한다.

고치려면: 필요한 형식마다 reader를 더한다(`unpdf`처럼 의존성 하나를 판 고정으로 들이고 쓸 때만 불러온다). 형식을 하나씩 늘리는 것은 비용이 작지만 의존성이 는다. 추천: 쓰는 형식(docx)부터 하나만.

정한 것: 필요해지는 형식 하나씩만 더한다.

## turn 준비가 예외로 끝나면 아무 기록 없이 매 주기 다시 시도한다

```yaml
kind: bug
modules: [packages/core/main, packages/core/lophn-agent]
```

지금:
- agent runtime의 `startTurnPump`(`packages/core/main/agent-runtime/product-driver.ts`)는 `driver.startNext()`가 던진 예외를 `catch {}`로 삼키고 다음 주기에 같은 일을 다시 한다. log도 diagnostic도 남기지 않는다.
- 그래서 turn 준비(`packages/core/lophn-agent/run-loop/prepare.ts`)가 같은 이유로 늘 던지면, 받은 메시지는 영영 turn이 되지 않고 아무 곳에도 이유가 남지 않는다.
- 실제로 그랬다. 계획 `reuse-diagnose`에서 ticket 예시 칸에 JSON Schema로 바뀌지 않는 type을 쓰자, App Engineer와 PM의 모든 turn이 준비 단계에서 던졌다. check와 core 기동은 통과했고 E2E의 turn 기다림 timeout으로만 드러났다. 그 원인은 고쳤고, 모든 내장 tool 입력이 JSON Schema로 바뀌는지 보는 test(`packages/core/main/agent-tools_test.ts`)를 더했다.

영향: 사람은 보낸 메시지에 답이 없는 것만 본다. 오류도 이유도 화면과 Diagnostics 어디에도 없다. 개발자도 log에서 원인을 찾을 수 없다.

고치려면:
- 던진 예외를 diagnostic log에 분류 한 줄로 남긴다(작음). daemon과 runtime의 처리 못한 예외를 남기는 길이 이미 있다(`packages/core/diagnostics`).
- 같은 메시지로 준비가 거듭 실패하면 그 요청을 실패한 turn으로 닫아, 사람이 대화에서 실패를 보게 한다(중간).
- 추천: 첫째를 바로 하고, 둘째는 같은 일이 다시 생길 때 한다.

## 붙인 것(`attached`) 기구가 file 종류만 남았고 아무도 만들지 않는다

```yaml
kind: defect
modules: [packages/protocol, packages/core/lophn-agent, packages/core/agent-roles, packages/shell/renderer]
```

지금: `SendMessage.attached`(`packages/protocol/lophn-agent/inputs.ts`의 `attachedChipSchema`), 본문 part `attached`(`message-content.ts`), 입력 태그 `<lophn-attached>`(`input-tags.ts`의 `ATTACHED_KINDS = ["file"]`, `packages/core/lophn-agent/run-loop/input-text.ts`의 `attachedText`)가 남아 있다. context·위반 chip을 지운 뒤 shell은 늘 `attached: []`를 보낸다(`packages/shell/renderer/conversation/agent-tab-core-source-commands.ts`). 그런데도 role 공통 지침(`packages/core/agent-roles/roles/prompts.ts`)은 turn마다 `<lophn-attached>`를 설명한다.

영향: 모든 turn의 prompt에 오지 않는 태그의 설명 한 줄이 실린다. 쓰는 곳 없는 입력 칸과 본문 part를 shell 대화 표시, router, e2e가 계속 받아 넘긴다.

고치려면: `SendMessage.attached`, 본문 part `attached`, `<lophn-attached>` 태그와 그 지침 줄, shell의 `attached` part 그리기를 지운다(중간: 입력 schema가 바뀌어 router와 e2e 호출(`attached: []`)을 같이 고친다). 남기면 잃는 것은 없다.

정한 것: 지운다. 파일을 붙이는 기능이 다시 필요해지면 그때 만든다(AGENTS.md "속도").

## 같은 이름 skill은 agent의 domain을 거르기 전에 하나로 합쳐져 사라진다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: `discoverSkills`(`packages/core/lophn-agent/extensions/skills.ts`)는 place 하나의 후보를 내장 → 전역 → domain 층 순서로 모아 `mergeSkillLayers`로 이름마다 하나만 남긴다. domain 층은 이름이 앞서는 domain을 나중에 넣어 덮게 한다. 그 뒤에 `skillReceived`가 agent가 일하는 domain의 skill만 받는다. 그래서 합치기에서 진 skill은 agent가 그 domain을 고르지 않아도 돌아오지 않는다.
- 전역 skill `review`와 domain `eval`의 skill `review`가 있으면 전역 것이 사라진다. `eval`을 고르지 않은 Operator는 `review`를 하나도 받지 못한다.
- domain `a`와 `b`에 같은 이름 `x`가 있으면 `a`의 것만 남는다. `b`만 고른 Operator는 `x`를 받지 못한다.
- `skill-read.ts`의 turn skill 읽기도 같은 합친 목록을 쓴다.

영향: domain을 좁힌 Operator가 받아야 할 skill을 조용히 잃는다. prompt의 skill 목록과 `skill.read`에서 둘 다 빠진다.

고치려면:
- domain 층 후보를 domain마다 따로 두고, agent의 domain으로 거른 뒤에 이름을 합친다(중간. 합친 목록을 쓰는 곳은 `register.ts`의 `skills`, `skill-read.ts`, `/` 메뉴다). 추천.
- 같은 그릇 안에서 domain 사이, 그리고 domain과 전역 사이에 같은 이름을 두지 못하게 막고 skipped에 이유를 둔다(작음. 사람이 이름을 바꿔야 한다).
