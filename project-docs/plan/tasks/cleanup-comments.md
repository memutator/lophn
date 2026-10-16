# cleanup-comments

코드 주석과 이름에 남은 옛 문서 가리킴, 요구 ID, 작업 번호를 지운다. 약 250줄이다. 주석의 "왜"는 남기고 가리킴만 뺀다.

- 단위: cleanup (wave 4)
- 선행: cleanup-names (지워질 코드의 주석을 고치지 않으려고 마지막에 한다)
- 소유(이 task만 고친다):
  - `packages/` 전체, `tools/` 전체 (저장소 전체. cleanup은 혼자 돈다)
  - 고치지 않는 것: `deno.json`, `deno.lock`, 각 package의 `deno.json`, `AGENTS.md`, `project-docs/`
- 읽을 것:
  - dev: `/home/pyosechang/projects/lophn/project-docs/dev/code.md` "주석과 죽은 코드"(주석은 "왜"만 쓴다. 주석과 test 이름에 요구 ID·결정 번호·작업 번호를 넣지 않는다), "이름"(이름과 경로에 판·단계·작업 번호를 넣지 않는다)
  - AGENTS.md "말"(번역어를 새로 만들지 않는다)
  - inventory: 없음
  - 지금 코드: `packages/`, `tools/`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음 (주석과 안내문만 고친다. 실행되는 코드를 바꾸지 않는다)

## 할 일

1. **기준선**: `deno task check:full`이 통과하는지 본다.
2. **다음 grep으로 줄을 모은다.** 대상은 `packages/`와 `tools/`의 `.ts`, `.tsx`, `.md`(SDK `guide.md` 포함), `.css`, `.json`이다. `node_modules/`, `dist/`, `deno.lock`, `package-lock.json`, 생성 bundle은 뺀다.

   표의 grep 씨앗에서 `\|`는 markdown 표 때문에 이스케이프한 `|`(또는)다. `grep -E`에는 `|`로 넣는다.

   | 꼴 | grep (대략의 개수) |
   |---|---|
   | 옛 문서 이름 + 절 | `\((architecture\|requirements\|ui-ux\|domain-model\|PRODUCT\|AGENT-ROLE\|code-map)[^)]*\)` (90줄), `architecture [0-9]` (40줄), `§` (40줄) |
   | 슬래시 없는 `domain-model` | `(^\|[^/A-Za-z-])domain-model` (125줄. 대부분 위와 겹친다) |
   | 조사 번호 | `\(조사[^)]*\)` (70줄), `(조사\|결정\|요구) ?[0-9]+(\.[0-9]+)?` (45줄) |
   | concern#R번호 | `[A-Za-z/-]+#R[0-9]+` (50줄. SDK `guide.md`에 많다. `(apps/sdk#R16)`, `(shell/wording#R7)`) |
   | 옛 docs 경로 | `docs/(dev\|domain-model\|requirements\|architecture\|ui-ux\|plan)` |
   | spec·계획 가리킴 | `\bS[1-9] ?[0-9]*장`, `implementation-inventory`, `ui-inventory`, `project-docs`, `docs-review` |
   | 작업 번호 | `\bv2\b` (이름·경로), `milestone`, `\bw[0-9]{2}\b`(식별자일 때), `\b[mw][0-9]{1,2}\b`가 작업 번호일 때, `I[0-9]+\.[0-9]+#[0-9]+`, `U[0-9]+\.[0-9]+#[0-9]+` |

3. **줄마다 고친다.**
   - 가리킴이 괄호 하나이고 문장은 뜻이 통하면 괄호만 뺀다: `// 시각은 호출자가 준다(architecture).` → `// 시각은 호출자가 준다.`
   - 주석 전체가 가리킴뿐이면(예: `// (조사 9.1)`) 주석을 지운다.
   - 가리킴 때문에 "왜"를 말하지 못하는 주석이면 코드를 보고 그 이유를 한 줄로 다시 쓴다. 알 수 없으면 주석을 지운다.
   - `guide.md`의 `(apps/sdk#R16)` 같은 꼴은 괄호를 뺀다. 앞 문장이 가리킴만으로 이루어졌으면 문장째 뺀다.
   - 이름(변수, 함수, type, 파일, test 이름)에 작업 번호가 있으면 뜻 있는 이름으로 바꾼다 (`deno task check`가 호출을 따라가게 한다). 파일 이름은 `tools/check-deps.ts`가 이미 `v2`, `milestone`, `w07`, `new-`, `old-`, `legacy-`, `-next`를 막는다.
   - **고치지 않는 것**: 문자열 값(test data의 예시 경로 `docs/reports/2026-w38.md`, 사용자에게 보이는 문구), 외부 문서나 표준을 가리키는 것(`cgroup v2`, RFC, Claude Code·Hermes 같은 다른 harness 이름), 실행 코드 자체의 값.
4. **같은 grep을 다시 돌려 남은 줄을 확인한다.** 남긴 줄은 이유를 적는다.
5. 한 묶음(폴더 하나 또는 grep 한 꼴)마다 `deno fmt`와 `deno task check`를 돌리고 commit한다 (메시지: `Remove references to old docs from <대상>`).

- (lead가 더함) `tools/wireframes/pages.ts` 375줄 근처 설명문이 "확인 표시를 선언의 confirm에 따른다"고 말한다. 앱 호출에 확인이 없어졌다.

## 끝남

- `deno task check:full`이 통과한다.
- 위험 test: 없음 (주석과 안내문만 고친다)
- 남지 않음 (위 "고치지 않는 것"으로 남긴 줄은 이유를 보고에 쓴다):
  - `grep -rnE "\((architecture|requirements|ui-ux|domain-model|PRODUCT|AGENT-ROLE|code-map)[^)]*\)|architecture [0-9]|§" packages tools --include=*.ts --include=*.tsx --include=*.md --include=*.css`가 0줄이다.
  - `grep -rnE "(^|[^/A-Za-z-])domain-model|\(조사[^)]*\)|#R[0-9]+" packages tools --include=*.ts --include=*.tsx --include=*.md --include=*.css`가 0줄이다.
  - `grep -rnE "implementation-inventory|ui-inventory|project-docs|docs-review" packages tools`가 0줄이다.

## 보고

- 바꾼 file 수와 지운 줄 수
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 가리킴 때문에 주석을 다시 쓴 곳의 수, 지우기만 한 곳의 수, 남긴 줄과 이유
