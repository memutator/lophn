# @lophn/cap-project

## 목적

앱이 project 목록과 지금 호출의 project를 읽는다. project를 고르는 UI는 shell이
맡고, 앱은 이 client로 읽기만 한다. 추가 permission은 없다.

## 공개 API와 type

```ts
import { currentProject, listProjects } from "@lophn/cap-project";
```

- `listProjects()` — project 목록 `{ id, name, purpose, archived }[]`. 보관한
  project도 싣는다(앱 data는 남는다). 읽을 수 없으면 던진다.
- `currentProject()` — 지금 app-api 호출의 project id. project 범위 app-api가
  아니거나 호출 밖(시작 code 등)이면 `null`이다.
- type: `ProjectSummary`

## 요구 permission

없다.

## peer 의존

정확한 peer는 없다(단독 사용). project 범위 app-api는 blueprint `app_api`의
`project_scope`로 선언한다.

## 예제

```ts
import { currentProject } from "@lophn/cap-project";
import { appApi } from "@lophn/cap-app-api";

appApi("todo.list", () => listFor(currentProject()));
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
