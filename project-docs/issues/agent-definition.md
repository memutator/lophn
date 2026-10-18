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
