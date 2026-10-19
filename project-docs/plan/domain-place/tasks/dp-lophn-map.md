# dp-lophn-map

lophn의 place 정보(prompt)에 project들의 지도를 싣는다. project마다 이름, 목적, 앱의 공개 tool, 설치한 package, 다른 project가 쓰는 공개 tool(사용 관계)이다. 지도는 program이 결정적으로 만든다. lophn은 이 지도로 재사용(공개 tool·package 찾기)과 경계를 넘는 판단을 한다. 다른 role의 place 정보는 바꾸지 않는다.

- 단위: map (wave 3)
- 선행: dp-usage-read. 사용 관계를 `app.usage`에서 읽는다. wave 3은 계획 `domain-tools`의 계약 task(blueprint `public` 칸)가 main에 land한 뒤에 연다. planner(`lophn-7e`)가 알려 준 뒤 띄운다.
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/place/place-data.ts`
  - `packages/core/agent-roles/place/place-info.ts`
  - `packages/core/agent-roles/place/place-info_test.ts`
  - `packages/core/agent-roles/credentials.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`(place 정보는 잘 안 바뀌는 목록만, 같은 재료는 같은 bytes)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > lophn 지도", `project-docs/products/roadmap/domain.md`의 "role"(지도, 사용 관계)
- 계약:
  - 쓰는 것: `app.usage`(`dp-usage-read`), 앱의 `project`(`dp-app-project`), `appAppApi`의 tool 선언과 `public` 칸(`domain-tools` 계약), `packagesList`·`packagesUsage`(`packages/protocol/apps/package-routes.ts`)
  - 내놓는 것: lophn의 place 정보에 project마다 한 덩어리가 있다. 한 덩어리의 칸과 순서는 아래 "할 일 2"가 정한다.

## 할 일

1. `place-data.ts`의 `readPlaceData`(role이 lophn일 때의 project·앱 목록 읽기, 지금 `projectList`·`appItems`)를 지도 재료로 넓힌다. project마다: `projectApi.list`의 이름·목적, 그 project의 앱(`appList`의 `project`)과 그 앱의 활성 release 공개 tool(`appAppApi`의 `public`인 것만: key, 한 줄 설명, effect), 앱이 쓰는 package(`packagesList`로 이름을 얻고 `packagesUsage`로 그 앱이 쓰는 것을 고른다), 다른 project가 쓰는 공개 tool(`app.usage`의 행: tool, 쓰는 project). 활성 release가 없는 앱은 공개 tool 없음으로 둔다. 읽기 오류는 그 덩어리를 비우고 계속한다(지금 `readContext`의 방식).
2. `place-info.ts`: lophn의 지도 글을 만든다. project마다 `Project <name>: <purpose>`, `  App: <name>`, `  Public tools: <key> (<effect>) <한 줄>…`, `  Packages: <name@version>…`, `  Used by other projects: <tool> ← <project>…`. 모든 목록은 이름순으로 정렬해 같은 재료가 같은 bytes가 되게 하고, 길면 prompt 예산(`CONTEXT_TEXT_BUDGET`과 같은 방식)으로 자른다. 지도 글에 앱이 쓴 글(tool 설명 전문)을 그대로 넣지 않는다 — 한 줄로 자르고 줄바꿈을 접는다. 다른 role의 글은 바꾸지 않는다.
3. `credentials.ts`의 `PLACE_READS`에 `appUsage.name`(`app.usage`), `packagesList.name`, `packagesUsage.name`을 더한다(모든 role의 상한에 읽기로만 더하는 목록이다. 근거: 지도 읽기는 turn의 agent 자격으로 한다). `app.usage`의 handler가 lophn session만 받으므로 다른 role에는 읽어도 비어 있다.
4. `place-info_test.ts`에 지도 렌더 사례 하나(정렬과 빈 덩어리)를 더한다. 새 test 파일을 만들지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: 없음

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: 지도 글의 칸과 순서 / 길 때 자르는 방식
- 넘길 줄: `domain-kinds`(kind 글)와 `artifact`(artifact 목록)가 같은 file을 고친다. 지도 줄만 더했다
- 계약 바꾸기 요청
- **무겁게 짠 것**: project·앱·package마다 읽기를 반복한다(lophn turn마다). 줄인다면 `app.usage`처럼 한 route로 모은다
- **알려진 미완 동작**
