# af-annotation-target

core의 annotation 계약과 저장을 "target이 앱 또는 artifact"로 넓힌다. protocol의 `annotations.send` 입력과 읽기 값, ledger 표, 저장 command, 메시지 글, `send`의 갈래를 바꾼다. 받는 session을 정하는 Router 쪽은 wave 2 `af-annotation-receiver`가 하고, 이 task는 앱 target의 동작을 그대로 지킨다. 계약 task라 모양을 아래에 못박는다.

- 단위: artifact-annotation (wave 1)
- 선행: af-artifact-values. 이 task는 `artifactNameSchema`를 import한다.
- 소유(이 task만 고친다):
  - `packages/protocol/apps/annotation.ts`
  - `packages/protocol/lophn-agent/input-tags.ts`
  - `packages/core/apps/annotations/schema.ts`
  - `packages/core/apps/annotations/commands.ts`
  - `packages/core/apps/annotations/store.ts`
  - `packages/core/apps/annotations/reads.ts`
  - `packages/core/apps/annotations/message.ts`
  - `packages/core/apps/annotations/ports.ts`
  - `packages/core/apps/annotations/send.ts`
  - `packages/core/apps/annotations/annotations_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/annotation.md`("지키는 것": 보내기는 사람의 동작이라 Gate가 없고 전달이 실패하면 방금 저장한 묶음을 지운다)
  - 제품 결정: `project-docs/products/roadmap/artifact.md`의 "4. artifact annotation"(target, 받는 쪽, sweep), `project-docs/plan/artifact/README.md`의 "정한 것"
  - 본보기: `packages/core/apps/annotations/send.ts`(전체 흐름), `commands.ts:86`(persist), `reads.ts:22`(`boundApp`), `message.ts`(tag 속성), `packages/protocol/lophn-agent/input-tags.ts:22`(`INPUT_TAG_ATTRIBUTES.annotation`), `packages/core/lophn-agent/prompt-assembly/input-tags.ts:30`(`renderTag`는 선언한 속성만 받는다)
  - 짝: 같은 wave의 `af-artifact-ipc`가 shell main에서 이 입력 모양으로 보낸다. 같이 합친다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`, `protocol`
- 계약(내놓는 것)
  - `packages/protocol/apps/annotation.ts`
    - `annotationTargetSchema`: `{ kind: "app"; app: app_ID }` | `{ kind: "artifact"; project: prj_ID; name: artifactNameSchema | null }` (`name` null은 사람의 폴더에 있는 `.html`)
    - `annotationInputSchema`: `release`는 `releaseIdSchema.nullable()`, `view`는 `{ screen: screenKeySchema.nullable(); path }`
    - `annotationSendInputSchema = { target, session: ses_ID | null, annotations[1..20] }`. 번호 1..N 검사는 그대로. 추가 검사: app target이면 모든 annotation의 `release`와 `view.screen`이 null이 아니고, artifact target이면 모두 null이다.
    - `session`의 뜻: app이면 지금처럼 agent pane에 열린 App Engineer session. artifact이면 "pane에 열려 있는 그 project의 Project Manager session"이고 core가 받는 쪽을 정할 때 쓰는 마지막 후보일 뿐이다(wave 2 receiver가 쓴다).
    - 읽는 쪽 값 `Annotation`·`AnnotationBatch`는 `app` 칸을 `target`으로 바꾼다. `release`는 nullable. `annotationReadSchema`는 그대로 `screenshot_path`를 더한 모양.
  - `INPUT_TAG_ATTRIBUTES.annotation`: 속성을 `["n", "kind", "app", "release", "view", "project", "artifact"]`로 넓힌다(artifact target의 tag가 쓴다).

## 할 일

1. protocol: 위 계약대로 `annotation.ts`를 고친다. 옛 `app` 입력 칸은 남기지 않는다(`target`으로 바꾼다).
2. ledger 표(`schema.ts`의 step `apps.annotations.tables`)를 제자리에서 고친다. migration step을 더하지 않는다(AGENTS.md "호환성": 개발 데이터는 지우고 새로 만든다).
   - 묶음 한 개는 target 하나다. `annotation_batches`에 target 칸을 두고(종류, app, project, artifact 이름. 예: `target_kind`, `app`, `project`, `artifact` — 칸 모양은 이 원칙 안에서 정한다), `annotations`의 `app` 칸은 지운다(묶음에서 읽는다). `annotations.release`는 nullable.
   - 인덱스는 target으로 찾는 조회(받는 쪽 결정, 읽기 범위)가 쓰는 칸에 건다.
3. `commands.ts` persist: 입력이 `target`이다. app이면 지금처럼 앱 존재·보관 검사. artifact이면 존재 검사를 하지 않는다(project 조회 port를 새로 만들지 않는다. 없는 project나 보관 project는 전달 단계에서 session을 열지 못해 실패하고, 그러면 `send`가 방금 저장한 묶음을 지운다).
4. `store.ts`/`reads.ts`: 읽기 값은 묶음의 target을 `target`으로 낸다. `boundApp`으로 묶인 호출자(coding agent, App Engineer)는 `target.kind === "app"`이고 앱이 같은 annotation만 본다. artifact target은 이들에게 없는 것과 같다(`not_found`). 묶이지 않은 호출자(사람)는 모두 본다. 프로젝트 조건으로 거르는 agent 읽기는 wave 2 `af-annotation-read`의 일이다.
5. `message.ts`: app target의 tag는 그대로. artifact target은 `project`·`artifact`(이름, null이면 속성을 뺀다)·`view`(= `view.path`) 속성을 쓰고 `app`·`release`는 뺀다. 본문 줄(Note, Component, Element, Area, Screenshot)은 같다.
6. `ports.ts`: `AnnotationDelivery`에 선택 method를 더한다. 옛 `deliver`(앱)는 그대로 둔다.
   - `deliverArtifact?(input: { project; name: string | null; session: SessionId | null; text; annotations }): Promise<Result<{ session; message }>>`
7. `send.ts`: `target.kind`로 가른다. app은 지금 흐름. artifact는 persist → 메시지 글 → `delivery.deliverArtifact`(없으면 `unavailable`, 이때도 묶음을 지운다) → `annotationAddRefs`. 실패하면 묶음을 지우는 규칙은 그대로다. artifact 갈래는 한 함수로 따로 둔다(domain-place가 같은 file의 앱 받는 쪽을 바꾼다).
8. `annotations_test.ts`를 새 입력 모양에 맞춘다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "App Engineer(앱에 묶인) 자격으로 artifact target annotation을 읽으면 `not_found`이고, 묶이지 않은 사람 자격은 읽는다". 기존 test의 입력만 새 모양으로 바꾸고 그 밖의 새 test는 두지 않는다.
- 남지 않음: `grep -rn "batch\.app\|annotation\.app\|input\.app" packages/core/apps/annotations packages/protocol/apps/annotation.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 옛 `app` 입력 칸
- 정한 것: ledger 표의 target 칸 모양, artifact persist가 존재 검사를 하지 않는 것, tag 속성 이름
- 넘길 줄: `core/apps/annotations/send.ts`와 `ports.ts`는 domain-place도 건드린다(앱 받는 쪽). artifact 갈래를 따로 둔 이유다.
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: `tests/e2e/annotation_test.ts`의 `app:` 호출이 옛 모양이다(이 계획은 e2e를 안 고친다). artifact 전달은 `deliverArtifact`가 없어 `unavailable`이다(wave 2에서 채움).
