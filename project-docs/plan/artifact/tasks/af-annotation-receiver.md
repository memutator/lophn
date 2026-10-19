# af-annotation-receiver

artifact annotation의 받는 쪽을 정하고 전달한다: 그 artifact 폴더에 마지막으로 쓴 session(rewind 기록에서 뽑는다), 없으면 그 project의 PM. 사람의 폴더에 있는 `.html`의 annotation도 PM이 받는다. 사람 메시지 하나로 넣고 받은 session을 답에 싣는다.

- 단위: artifact-annotation (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/session/rewind/artifact-writer.ts`
  - `packages/core/lophn-agent/session/rewind/artifact-writer_test.ts`
  - `packages/core/lophn-agent/session/rewind/mod.ts`
  - `packages/core/main/daemon/wiring/router.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/place-session.md`(session을 여는 길, 보관한 place에는 열지 않는다, rewind 기록), `project-docs/architecture/annotation.md`("받는 session은 사람이 보고 있는 대화여야 한다"), `project-docs/architecture/layers.md`
  - 제품 결정: `project-docs/products/roadmap/artifact.md`의 "4. artifact annotation"(받는 쪽), `project-docs/products/roadmap/domain.md`의 "view와 artifact"의 마지막 항목, `project-docs/plan/artifact/README.md`의 "정한 것"(annotation을 받는 쪽)
  - 본보기: `main/daemon/wiring/router.ts:219`(앱의 `deliver`: session 열기·검사·`sendMessage`), `lophn-agent/session/rewind/schema.ts`(`rewind_files(root, path, checkpoint, seq, reverted_by)`, `checkpoints(message, session)`), `rewind/record.ts`(기록이 어떻게 남는가), `rewind/write-routes.ts:49`(`openRoot`: rewind의 `root`는 허용 폴더의 realpath다), `rewind/files.ts`(`ledgerSnapshot`), `rewind/rewind_test.ts`(in-memory SQLite + 실제 schema step으로 표를 만드는 test 꼴), `core/lophn-agent/session/model.ts`(`sessions` 표: `lifecycle`, `role`, `place_kind`, `place_id`)
  - 계약: `AnnotationDelivery.deliverArtifact?`(`packages/core/apps/annotations/ports.ts`, af-annotation-target), `artifactsFolder(root, project)`(`packages/core/agent-roles/place/data-folder.ts`, af-file-scope)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `lophn-agent`, `router`, `core`
- 계약:
  - 쓰는 것: `deliverArtifact` 시그니처(`{ project; name: string | null; session: SessionId | null; text; annotations }` → `Result<{ session; message }>`), `artifactsFolder`
  - 내놓는 것: `rewind/artifact-writer.ts`의 `lastArtifactWriter(sql, input: { root: string; name: string }): { session: string } | null`(`root`는 artifacts 폴더의 realpath)

## 할 일

1. `artifact-writer.ts`: 한 질의로 마지막으로 쓴 session을 구한다.
   - `rewind_files`에서 `root = <root>`이고 `path`가 `<name>/`로 시작하며 `reverted_by is null`인 행 가운데 `seq`가 가장 큰 것의 checkpoint → `checkpoints.session`. 되돌려진(reverted) 쓰기는 "마지막으로 쓴" 것이 아니다.
   - 그 session이 `sessions`에서 `lifecycle = 'open'`이고 `role`이 `project_manager` 또는 `operator`이며 `place_kind = 'project'`인 것만 받는다(project id까지는 root가 이미 정한다). 아니면 null이다. 이름 비교는 `path` 접두사만(`substr`), `like`의 특수 문자를 쓰지 않는다.
   - 기록이 없으면(사람이나 terminal이 쓴 artifact, 또는 rewind 기록 한도로 지워진 경우) null이다.
   - `rewind/mod.ts`에서 export.
2. `router.ts`: `AnnotationDelivery`에 `deliverArtifact`를 채운다. 앱의 `deliver`는 건드리지 않고 함수를 따로 둔다.
   - 후보를 차례로 본다. (a) `name`이 있으면: `realpath(artifactsFolder(ctx.root.path, project))`로 root를 구하고 `ledgerSnapshot(ctx.ledgerPath, …lastArtifactWriter…)`. 찾으면 그 session에 보낸다. 입력의 `session`은 이때 쓰지 않는다. (b) 없으면 PM: 입력 `session`이 있으면 `agentSessionRead`로 읽어 `role = project_manager`이고 `project`가 같고 `lifecycle = open`일 때만 쓴다. 아니면 `conflict`로 거절한다(다른 project의 session으로 가지 않는다). `session`이 null이면 `openAgentSession`으로 그 project의 PM 새 session을 연다.
   - 사람의 `.html`(`name = null`)은 (b)만 탄다.
   - 보내기는 앱 쪽과 같다: `sendMessage`의 `content`는 text part 하나, `delivery: "next_turn"`, `refs`는 annotation들. 보관한 project나 없는 project는 `openAgentSession`이 거절하고 그 거절을 그대로 돌려준다(`send`가 저장한 묶음을 지운다).
   - 반환 `{ session, message }`.
3. 위험 test(`artifact-writer_test.ts`)는 아래 "끝남".

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`artifact-writer_test.ts`, in-memory SQLite + 실제 schema step, `rewind_test.ts` 꼴, 표로): "artifact annotation의 받는 쪽 결정이 다른 project의 session을 고르지 않는다. 같은 이름의 artifact가 두 project에 있어도 그 project의 root에 쓴 session만 나오고, 되돌려진 쓰기·닫힌 session·다른 role의 session은 건너뛰며 기록이 없으면 null이다".
- `router.ts`의 PM 후보 검사(`conflict`)는 같은 질문(다른 project의 session으로 가지 않는다)이지만 SQL이 아니라 Router 연결이라 이 test에 넣지 않는다. 보고에 어떻게 확인했는지 적는다.
- 남지 않음: 새 갈래라 옛 이름이 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`deliverArtifact`는 같은 `annotationDelivery` 객체에 들어간다)
- 안 쓰게 된 export: 없음
- 정한 것: 후보 순서, 입력 `session`이 틀렸을 때 `conflict`로 거절하는 것
- 넘길 줄: `main/daemon/wiring/router.ts`는 domain-place(앱 annotation 받는 쪽을 PM으로)도 `deliver`를 고친다. 함수를 따로 둔 이유다.
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 실제 전달(끝에서 끝)은 lead가 `deliver` 뒤 `deno task dev`로 본다
