# contexts

project의 context(계약 bundle, 초안, 목차, 위반)와 project 검색. architecture 문서는 아직 없다.

## project 검색이 접근 권한을 안 본다

```yaml
kind: bug
modules: [packages/core/projects]
```

지금: `search/mod.ts`의 `projectSearchRead`는 `ApiReadDefinition`이라 `handle(ctx, input)`만 받고 `_ctx`를 버린다. 같은 module의 다른 읽기(`registry/reads.ts`)는 `snapshot.port`로 `authorizeProject`를 부르는데 이 읽기는 port가 없어 그 검사를 못 한다. route는 `actors: ["user"]`라 사람만 부른다.

영향: project id만 알면 접근 권한 검사 없이 등록 폴더의 파일 글을 키워드로 읽는다. 지금은 사람 한 명뿐이라 새지 않지만 접근 scope가 생기면 곧바로 구멍이다.

고치려면:
- A. `ApiReadDefinition.handle`이 port를 받게 넓혀 `authorizeProject`를 부른다. protocol/server 계약을 건드리고 apiReads 쓰는 쪽(apps preview·releases)도 같이 고친다(중간).
- B. `projectSearchRead` deps에 `authorize(ctx, project)`를 register에서 주입한다. 계약은 그대로이고 이 module만 고친다. register가 port를 들고 있는지 확인이 먼저다(작음~중간).

추천: B.

## md가 아닌 context 문서의 목차를 worker가 못 읽는다

```yaml
kind: bug
modules: [packages/core/projects, packages/protocol]
```

지금: outline source는 `outlineSourceSchema.format`이 `OUTLINE_FORMATS = ["markdown"]`뿐이라 pdf·docs를 계약에 선언할 수 없다. `extract/outline.ts`는 markdown이 아니면 `context.storedOutline`을 부르는데 `extractAll`의 두 호출처(`check/runner.ts`, `index/scan.ts`)가 모두 `storedOutline`을 넘기지 않는다. 저장 목차를 쓰는 `outline.set`(`contexts/outlines.ts`)과 agent tool(`lophn-agent/tools/bundles/outline.ts`)은 있으나 결과가 worker에 닿지 않는다.

영향: PM이 pdf·docs 문서의 목차를 적어도 계약이 그걸 쓸 길이 없다. md 아닌 문서는 목차 기반 개체를 만들 수 없다.

고치려면: `format`을 `CONTEXT_OUTLINE_SOURCE_FORMATS`까지 넓히고, context worker 요청에 저장 목차를 실어 `extractAll`에 넘긴다. 계약 둘(contract, worker 요청)을 고치고 snapshot에 목차 파일을 포함해야 한다(중간~큼).

정한 것: 지운다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

## 열린 PM session에 위반 chip이 안 붙는다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/projects]
```

지금: `workspace.tsx`의 `askPm`은 열린 PM session이 있으면 그 탭을 고르고, draft가 비어 있을 때만 위반 줄을 `파일 - 규칙` 글로 채운다. 새 PM 탭은 `openAgent(... chips)`로 chip이 붙는다. toast 쪽 `reactions/project-manager.ts`는 열린 session이 있으면 chip도 글도 없이 탭만 고른다. 열린 PM session 찾는 함수가 두 곳(`openedPmSession`, `openedSession`)에 따로 있다. `composer`는 `session === null`일 때만 chip을 그린다.

영향: 같은 위반이 열린 session에서는 글이고 새 탭에서는 chip이라 PM이 받는 모양이 다르고, draft에 글이 있으면 위반이 아예 안 실린다.

고치려면: `SendMessage.attached`는 이미 `violation` chip을 받으므로 계약은 있다. composer가 열린 session에서도 chip을 그리고 보낼 때 `attached`로 싣는다. chip에 context id가 없어(`ContextChipView.id`는 위반 key) 필드를 더해야 한다. 아래 "새 session 첫 말" 이슈와 같은 고침이다(중간).

## context 초안을 ledger가 아니라 data root 아래 폴더에 두고 제출 때 확정한다

```yaml
kind: defect
modules: [packages/core/projects]
```

지금: `contexts/folders.ts`가 초안을 `<data root>/projects/<project>/contexts/<context>/drafts/<bundle>/bundle.json`에 둔다. `bundle.submit`이 이 파일을 읽어 검사하고 판으로 확정한다. 초안 삭제는 `removed`에 쌓았다가 command 성공 뒤 `flush`한다. 이유(PM이 file tool로 직접 고친다)는 코드 어디에도 없다.

영향: 초안은 ledger 밖이라 ledger rollback·backup에 안 따라온다. 대신 PM이 별도 command 없이 파일로 고친다.

고치려면: 추천: 남긴다. archived로 닫는다(kept). 초안을 ledger로 옮기면 PM용 편집 tool을 새로 만든다(큼).

정한 것: 다이어트 계획에서 줄일지 정한다.

## 저장 목차와 outline kind가 쓰이지 않는다

```yaml
kind: defect
modules: [packages/core/projects, packages/protocol]
```

지금: `contexts/outlines.ts`가 `outlines/<sha256(path)>.json`에 목차를 revision으로 낙관적 잠금해 저장하고 `outline.get`·`set`·`delete` route와 agent tool이 있다. 읽는 쪽인 `extractAll`은 이 목차를 받지 못한다(위 "md가 아닌 context 문서" 이슈).

영향: 쓰는 길은 있고 읽는 길이 없어 죽은 장치다. route 셋, 폴더 port(`outlineFolder`), 테스트 대상이 늘어 있다.

고치려면: 저장 목차 전체를 빼고 md 목차만 둔다(`outlines.ts`, protocol `context-outlines.ts`, agent tool, `outlineFolder` port 삭제, 작음~중간).

정한 것: 지운다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

## `bundle.test_draft`가 worker 유무에 따라 다르게 돈다

```yaml
kind: defect
modules: [packages/core/projects]
```

지금: `contexts/connection.ts`가 `bundle.test_draft` 읽기를 감싸, ledger가 만든 `running` 보고를 dispatcher가 붙어 있으면 `testDraft`로 worker 격리 검사를 돌려 끝난 보고로 바꾸고, 붙기 전(`dispatcher === undefined`)에는 `running`을 그대로 돌려준다.

영향: 경로가 둘이다. 실제로 dispatcher가 없는 때는 기동 직후와 worker 없는 조립(test)뿐이라 이대로 두어도 사람에게 보이는 문제는 없다.

고치려면: 추천: 남긴다. 이유(worker 없는 조립은 결과를 꾸미지 않는다)는 이미 `connection.ts`의 주석에 있으므로 이 절을 지운다.

정한 것: 다이어트 계획에서 줄일지 정한다.
