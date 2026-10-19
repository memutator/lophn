# contexts (닫음)

## 위반 키 집합 비교용 표 `context_violation_keys`

```yaml
kind: defect
modules: [packages/core/projects]
closed: kept
guard: 없음
```

지금: `ledger/rows-violations.ts`가 context마다 JSON 한 행에 위반 키 `[kind, rule, path, section]` 배열을 둔다. `api/commands-violations.ts`의 `recordViolations`가 이전에 없던 키가 생길 때만 `ContextViolationFound`를 낸다. 같은 위반으로 PM을 반복해서 깨우지 않으려는 규칙이다.

영향: 표 하나와 load·save 코드가 늘었다. 이 표가 없으면 위반 하나를 고치고 다른 하나가 생긴 경우를 개수만으로는 못 가린다.

고치려면: 위반 수가 늘 때만 event를 내고 새 표를 뺀다(`violation_mark` 열만 사용, 작음). 그러면 "하나 고치고 하나 새로 생김"에는 event가 안 난다.

닫음: 남긴다. event는 상태가 바뀔 때만 내고(architecture/event.md), 같은 것은 다시 만들지 않는다(architecture/approval.md의 pending 중복 규칙과 같은 꼴). 위반 키 표가 그 상태다.

## 저장 목차와 outline kind가 쓰이지 않는다

```yaml
kind: defect
modules: [packages/core/projects, packages/protocol]
closed: fixed
guard: 없음
```

지금: `contexts/outlines.ts`가 `outlines/<sha256(path)>.json`에 목차를 revision으로 낙관적 잠금해 저장하고 `outline.get`·`set`·`delete` route와 agent tool이 있다. 읽는 쪽인 `extractAll`은 이 목차를 받지 못한다(위 "md가 아닌 context 문서" 이슈).

영향: 쓰는 길은 있고 읽는 길이 없어 죽은 장치다. route 셋, 폴더 port(`outlineFolder`), 테스트 대상이 늘어 있다.

고치려면: 저장 목차 전체를 빼고 md 목차만 둔다(`outlines.ts`, protocol `context-outlines.ts`, agent tool, `outlineFolder` port 삭제, 작음~중간).

정한 것: 지운다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

닫음: 저장 목차(`context-outlines.ts`, `contexts/outlines.ts`, `outlineFolder`, `storedOutline`), outline tool 셋(`outline.get/set/delete`), `CONTEXT_OUTLINE_SOURCE_FORMATS`를 지웠다. outline kind는 md 제목에서만 목차를 만든다. 값이 `"markdown"` 하나뿐인 `outlineSourceSchema.format`은 남아 있고 마지막 cleanup이 지운다.

## context 초안을 ledger가 아니라 data root 아래 폴더에 두고 제출 때 확정한다

```yaml
kind: defect
modules: [packages/core/projects]
closed: kept
guard: 없음
```

지금: `contexts/folders.ts`가 초안을 `<data root>/projects/<project>/contexts/<context>/drafts/<bundle>/bundle.json`에 둔다. `bundle.submit`이 이 파일을 읽어 검사하고 판으로 확정한다. 초안 삭제는 `removed`에 쌓았다가 command 성공 뒤 `flush`한다. 이유(PM이 file tool로 직접 고친다)는 코드 어디에도 없다.

영향: 초안은 ledger 밖이라 ledger rollback·backup에 안 따라온다. 대신 PM이 별도 command 없이 파일로 고친다.

고치려면: 추천: 남긴다. 초안을 ledger로 옮기면 PM용 편집 tool을 새로 만든다(큼).

닫음: 초안을 ledger로 옮기면 PM이 file tool로 직접 고치는 길 대신 편집 tool을 새로 만들어야 한다(큼). 초안이 ledger rollback·backup에 안 따라오는 것은 받아들인다.

## `bundle.test_draft`가 worker 유무에 따라 다르게 돈다

```yaml
kind: defect
modules: [packages/core/projects]
closed: kept
guard: 없음
```

지금: `contexts/connection.ts`가 `bundle.test_draft` 읽기를 감싸, ledger가 만든 `running` 보고를 dispatcher가 붙어 있으면 `testDraft`로 worker 격리 검사를 돌려 끝난 보고로 바꾸고, 붙기 전(`dispatcher === undefined`)에는 `running`을 그대로 돌려준다.

영향: 경로가 둘이다. 실제로 dispatcher가 없는 때는 기동 직후와 worker 없는 조립(test)뿐이라 이대로 두어도 사람에게 보이는 문제는 없다.

고치려면: 추천: 남긴다. 이유(worker 없는 조립은 결과를 꾸미지 않는다)는 이미 `connection.ts`의 주석에 있다.

닫음: dispatcher가 없는 때는 기동 직후와 worker 없는 조립(test)뿐이라 사람에게 보이는 문제가 없다. 이유는 `connection.ts` 주석에 있다.

## md가 아닌 문서는 context로 쓸 수 없다

```yaml
kind: bug
modules: [packages/core/projects, packages/protocol]
closed: fixed
guard: 없음
```

지금: context 계약의 목차는 markdown 제목에서만 나온다(`protocol/projects/context-contract.ts`의 outline source). pdf·docs 같은 문서는 목차 기반 개체를 만들 수 없어 context로 쓸 수 없다. 예전에 PM이 목차를 직접 적어 두는 저장 목차(`outline.set` route, agent tool, `outlines/` 폴더)를 만들었지만 읽는 쪽(계약 형식, context worker 요청)이 없어 지웠다.

영향: 사람이 pdf·docs로 가진 규정이나 문서를 PM이 context로 관리하지 못한다. md로 바꿔 넣어야 한다.

고치려면: 실제로 md 아닌 문서를 context로 써야 할 때 계약부터 다시 설계한다. 목차를 누가 만드는지(PM이 적기, 문서에서 뽑기), 계약의 형식 칸, context worker 요청과 snapshot에 목차를 싣는 길을 같이 정한다. 지운 저장 목차를 되살리지 않는다.

정한 것: 지금 만들지 않는다. 필요해지면 위대로 다시 만든다.

닫음: context를 지우고 kind 파일로 바꿨다(`project-docs/architecture/kinds.md`). kind의 `files` glob은 형식을 가리지 않아 pdf·이미지도 item이 되고, 그 값은 `from: path`로 경로에서 뽑는다. 목차는 kind 모델에서 빠져 md용 file tool `file.outline`이 되었고, pdf의 목차가 필요하면 사람이 청할 때 agent가 옆에 md를 쓴다(roadmap `domain.md` "outline").
