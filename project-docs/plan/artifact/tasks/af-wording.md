# af-wording

artifact 계획이 더한 화면 문구를 한 번 점검하고 고친다: key 규칙, 안쪽 말 노출, 쓰이지 않는 key, 같은 뜻의 중복, 문구의 일관성. 문구 외의 코드는 건드리지 않는다.

- 단위: artifact-wording (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/design/wording/catalog/artifact.ts`
  - `packages/design/wording/catalog/artifact.placeholders.ts`
- 읽을 것:
  - 스킬: `.claude/skills/wording/SKILL.md`(key 이름, 마침표 규칙, "key를 지우기 전에": template literal로 만드는 key는 앞부분으로 grep한다), `.claude/skills/ui-design/SKILL.md`("모든 화면의 규칙")
  - 제품 결정: `project-docs/products/roadmap/artifact.md`의 "5. shell"(문구는 wording skill을 따른다)
  - 본보기: `packages/design/wording/catalog/browser.ts`(한 기능 영역의 catalog), `tools/check-wording.ts`
  - 확인할 곳: wave 1·2가 `t("artifact.…")`로 쓴 곳 전부(`grep -rn "artifact\." packages/shell/renderer tools/wireframes`), `catalog/project.ts`의 `project-workspace.label.sidebar-tab-artifact`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 점검을 마친 `catalog/artifact.ts`(key 이름은 바꾸지 않는다. 쓰는 곳이 key를 문자열로 가진다)

## 할 일

1. `deno run --allow-read tools/check-wording.ts`를 돌려 `artifact.*`와 관련된 warning과 오류를 모두 본다.
2. key마다 쓰는 곳이 있는지 `grep`한다(template 호출은 앞부분으로). 쓰이지 않는 key는 지운다. `common.*`에 같은 뜻이 있으면 그쪽으로 바꾼다(key를 바꾸면 쓰는 곳도 같이 고쳐야 하는데 그 file은 소유가 아니므로, 이 경우는 지우지 말고 보고에 "중복 후보"로 적는다).
3. 값을 읽고 고친다: 완성된 문장 하나, 마침표 규칙, 안쪽 말(`ledger`, `release`, `session` 등) 없음, 단추는 동사로, 영어 catalog(en)에 맞는 문장으로 쓴다. 같은 대상을 다른 말로 부르지 않는다(artifact / tab / page 구분을 일관되게).
4. `deno task wording`으로 `artifact.placeholders.ts`를 다시 만든다(손으로 고치지 않는다).

## 끝남

- `deno task check`가 통과한다.
- `deno run --allow-read tools/check-wording.ts`에서 `artifact.*` 관련 오류가 0이다.
- 위험 test: 없음(문구).
- 남지 않음: 쓰이지 않는 `artifact.*` key가 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 지운 key 목록
- 정한 것: 문구를 바꾼 곳과 이유
- 넘길 줄: `common.*`와의 중복 후보(쓰는 곳 file은 소유 밖)
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
