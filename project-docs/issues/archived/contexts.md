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
