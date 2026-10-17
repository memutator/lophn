# place-session

agent가 놓이는 place와 session의 열림·끝남·fork·rewind의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/place-session.md`.

## 앱 place의 Operator가 앱 data를 project 폴더에 쓸 길이 없다

```yaml
kind: bug
modules: [packages/core/agent-roles, packages/protocol, packages/shell/renderer]
```

지금: `project-docs/products/AGENT-ROLE.md`의 O2는 "앱 place의 Operator는 앱 data를 사람이 정한 project 폴더에 파일로 쓸 수 있다", O3는 "project 밖에 문서를 쓰게 되면 먼저 어느 project에 둘지 사람에게 묻는다"이다. 코드의 폴더 규칙(`packages/core/agent-roles/place/place-folders.ts`의 `placeScope`)은 앱 place의 Operator에게 앱 source 읽기만 주고 쓰기는 비운다. Operator 정의에도 화면에도 그 project 폴더를 정하는 칸이 없다(`packages/core/agent-roles/tools/operator.ts`의 주석은 "사람이 정한다"고만 한다).

영향: 사람이 앱 Operator에게 앱 data를 정리해 파일로 남기라고 하면 쓸 폴더가 없어 forbidden이다. 정책 문서와 코드가 달라 agent prompt나 다음 계획이 O2를 믿고 짠다.

고치려면:
- 만든다(중간): Operator 정의에 쓸 project 하나를 두고(사람이 화면에서 고름), `placeScope`가 그 project 폴더를 앱 Operator의 쓰기에 더하고, runtime 권한과 rewind도 같은 규칙을 따른다.
- 정책을 줄인다(작음): O2·O3를 AGENT-ROLE.md에서 지우고 `operator.ts` 주석을 고친다. 앱 Operator는 결과를 대화와 app-api로만 남긴다.
- 추천: 줄인다. 실제로 앱 data를 파일로 내보낼 일이 생기면 만든다.

정할 것: 앱 Operator가 project 폴더에 파일을 쓰는 기능을 지금 둘지.
