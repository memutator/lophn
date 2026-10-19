# domain: context와 앱을 책임 경계 하나로 합친다

상태: 로드맵. 2026-10-19 사람과 planner가 방향을 정했고, 사람이 정할 것은 모두 정했다.
배경 문서: `project-docs/PRODUCT.md` 2절(사용자의 도메인과 lophn의 도메인)·3절(책임 분배), `project-docs/products/AGENT-ROLE.md`, `project-docs/architecture/place-session.md`, `project-docs/architecture/app-call.md`, `project-docs/issues/contexts.md`.
이 문서에 걸린 roadmap: `artifact.md`(agent가 쓴 결과 문서), `app-preview.md`(만드는 중인 앱을 fixture로 돌려 보기). 둘은 이 문서의 단계에 맞춰 다시 쓴다.

## 왜

- **context가 모호하다.** 이름 하나에 다섯 가지 일이 섞여 있다. 그래서 사람도 harness도 언제 무엇에 쓰는지 모른다.
  - agent에게 주는 문서 지도
  - 문서 위의 entity DB와 query DSL(type, relation, follow, board, saved view)
  - 문서 lint(rule, 위반)
  - 용어집
  - 앱 data 끌어오기(`app-data` source, 선언만 있고 쓰이지 않는다)
- **같은 일을 앱과 context가 따로 한다.**

  | | 앱 | context |
  |---|---|---|
  | 판 | release | bundle |
  | test | ticket `examples` | bundle `examples`와 `context.test` |
  | 관측 | `reportProblem`과 problem | 위반 |
  | 실행 | app runtime | context worker |
  | 보기 | 앱 화면 | search tab, board |

  artifact roadmap은 view를 세 번째로 따로 만들려 한다.
- **place 두 종류가 암묵적으로 다시 엮인다.** project와 앱의 관계가 모델에 없고, 아래 셋으로 그때그때 이어 붙인다.
  - 폴더 경로(`source_path`가 project 폴더 안에 있나)
  - 호출 인자(project 범위 app-api)
  - 앱 코드의 관례(`currentProject()`로 data 나누기)
- **PM은 계약의 모양을 모른다.** `bundle.json`의 key 이름이 prompt, skill, guide 어디에도 없다. PM은 `context.test` 오류로 맞혀 간다.

## 지금 코드

사실 조사 원문은 planner session의 worker 보고다. 여기에는 결정에 걸리는 것만 옮긴다.

### context

- 줄 수(test 제외):

  | 위치 | 줄 |
  |---|---|
  | core `packages/core/projects/contexts` | 12,651 (115 file) |
  | protocol `packages/protocol/projects/context-*.ts` | 1,984 |
  | shell `renderer/workspace/contexts` | 6,514 + css 1,185 |
  | tab kind | 약 510 |
  | agent tool | 631 |
  | wording | 390 |
  | built-in skill `context-init`, `context-update` | 141 |
  | e2e `tests/e2e/pm-context_test.ts`, `pm-tools_test.ts` | 467 |

- **ledger 표:** `contexts`, `context_bundles`, `context_checks`, `context_violation_keys`, `context_app_data`, `saved_views`, `glossary_entries`(`contexts/ledger/schema.ts`). derived index는 `<data>/derived/contexts.sqlite`다.
- **prompt:** `place-data.ts`의 `readContext`가 `buildContextText`로 글을 만든다(`lophn-agent/prompt-assembly/context-text.ts`). 예산은 `CONTEXT_TEXT_BUDGET = 12000`자다.
- **보이는 범위:**
  - Operator는 정의의 `contexts` 가운데 active인 것을 받는다.
  - PM은 자기 project의 active context 전부를 받는다(`agent-roles/agents/role-table.ts:31`).
  - App Engineer는 아무것도 받지 않는다.
- **위반:** `ContextViolationFound` event가 PM session을 연다(`core/events/reactor/session-opening.ts:84`). shell은 toast를 띄운다.
- **`app-data` source:** 추출 호출 지점 넷이 모두 `appData: () => undefined`를 넘긴다(`work-check.ts:45`, `check/draft.ts:59`, `preview/job.ts:37`, `index/scan.ts:113`).

### place

- **모양:** `Place = {kind: "project"} | {kind: "app"}`이다(`protocol/lophn-agent/places.ts:14`). `"project"` kind로 갈라지는 곳은 약 100줄이다(agent-roles 24, lophn-agent 21, shell 약 35).
- **place가 정하는 것:**
  - file 범위: `placeScope`(`agent-roles/place/place-folders.ts:19`)
  - `LOPHN.md` 층: project에만 있다.
  - skill과 MCP의 place 층: project에만 있다.
  - project 층 model
  - Operator 정의의 `contexts`: project Operator에만 있다.
- **앱과 project의 연결:**
  - 앱의 `source_path`가 project 폴더 안에 있는지로만 이어진다(`tools/context/visible.ts` `projectOfApp`).
  - project record에는 앱 목록이 없다.
  - project record의 `tracking`은 protocol에만 있고 어디서도 쓰지 않는다.

### 앱과 app-api

- **선언:** blueprint의 `AppApiDeclaration`은 `{key, label, description, effect: read|write|external, input, project_scope}`이다(`protocol/apps/blueprint/types.ts:50`).
- **호출:** `app.call_api` 하나로 간다. 부르는 쪽은 사람(화면 bridge), agent(`app__<app>__<api>` tool), 앱(SDK broker) 셋이다.
  - core가 Gate를 판정하고, write에 앱별 queue를 걸고, invocation 기록과 changeset을 남긴다. 이것으로 rewind가 된다(`core/apps/calls/service.ts`).
- **data:** 앱마다 sqlite 하나다(`<data>/apps/<app>/data/app.sqlite`).
  - core는 project별로 나누지 않는다. invocation 행에 project를 적을 뿐이다.
  - project별로 나누는 것은 앱 코드가 지킨다.
- **ticket `examples` 검사:** test bundle의 control socket으로 바로 보낸다(`core/problems/tests/work/app-driver.ts:537`). Gate, invocation, rewind를 거치지 않는다.
- **줄 수:**

  | 위치 | 줄 |
  |---|---|
  | core apps | 29,524 |
  | protocol apps | 5,259 |
  | SDK | 2,786 |
  | shell app-frame | main 4,924 + renderer 6,933 |
  | app supervisor | 2,149 |

### MCP

- **lophn은 MCP client뿐이다.** server 코드가 없고 MCP SDK도 없다.
- **transport:** 직접 짠 JSON-RPC다(`lophn-agent/extensions/adapters/mcp-http.ts` 169줄, `mcp-stdio.ts` 179줄). protocol 판은 `2025-06-18`이다.
- **한 turn의 tool 목록:** role tool, app-api tool, MCP tool을 이어 붙여 만든다(`lophn-agent/run-loop/prepare.ts:301-355`).
- **MCP 호출이 받는 대우:**
  - Gate는 거친다(intent `mcp_tool`).
  - invocation 기록과 rewind는 없다. session rewind는 MCP 호출을 되돌릴 수 없는 외부 효과로만 보인다(`session/rewind/preview.ts:180`).

## 모양

### domain

domain은 **책임 경계**다. 경계를 나누는 이유는 책임과 최소 context다.
- agent는 자기 domain과 다른 domain의 공개 면만 알고 일한다.
- 모든 것을 알아야 동작한다면 경계를 잘못 그은 것이다.

### project와 domain (2026-10-19 다시 정함)

project와 domain은 다른 것이고 **1:N**이다. project 하나에 domain이 여럿 있고, domain은 한 project에 속한다. 다른 project에서 그 domain이 필요하면 **참조**한다. 다른 domain을 쓰는 것과 같은 길이고, 공개 tool과 grant로 쓴다.

| | project | domain |
|---|---|---|
| 무엇 | 물리적인 작업 공간. 사람이 등록한 폴더 묶음(저장소 하나 같은 것) | 논리적인 책임 경계 |
| 가진 것 | 폴더 root, 창(workspace), file explorer, terminal, coding agent, project 지침(`LOPHN.md`), 그 안의 domain들 | agent(Domain Engineer, Operator), kind 파일, 글, 앱(domain의 코드), skill, artifact, grant |
| 경계인가 | 아니다. 파일이 놓이는 그릇이다 | 그렇다. 책임 경계는 domain 하나뿐이다 |

- **예: lophn 저장소를 lophn으로 관리한다.**
  - project는 lophn 저장소 하나다.
  - domain은 eval, product, plan이다. 코딩은 lophn agent의 일이 아니니 source(`packages/`)는 어느 domain에도 속하지 않아도 된다. coding agent는 project에서 일한다.
  - 다른 저장소(project)가 eval이 필요하면 lophn의 eval domain을 참조한다. 그 domain의 공개 tool을 grant 받아 쓴다. eval domain을 그 project에 또 만들지 않는다.
- **domain은 자기 project 하나에 속한다.**
  - domain을 만들 때 project를 고른다. 사람이 정한다. 그 domain agent가 그 project의 폴더를 읽고 쓰게 되므로 권한 결정이다. lophn과 Domain Engineer는 제안만 한다.
  - 사람의 폴더가 없는 domain(앱 data만 있는 것)도 project에 속한다. project는 폴더 0개여도 된다.
- **file 범위와 문서**
  - domain agent의 file 범위는 그 project의 폴더다(폴더 단위).
  - domain마다 재료 path 목록은 두지 않는다. 그 domain의 문서가 무엇인지는 kind 파일(program)과 글(agent)이 말한다. kind glob은 지금처럼 project 폴더 기준이다.
  - 최소 context는 file 권한이 아니라 prompt에 무엇을 싣느냐로 지킨다. prompt에는 그 domain의 글, kind, skill만 싣는다. 같은 project 안의 다른 파일을 읽을 수 있는 것은 막을 대상이 아니다. 사람은 공격자가 아니고, 막을 것은 agent의 실수다. 폴더 경계와 rewind가 그것을 막는다.
- **지침의 층:** 전역 → project의 `LOPHN.md` → domain 글 → agent 정의 본문.
  - domain 글은 lophn의 자리 `<data>/domains/<domain>/DOMAIN.md`다.
  - `LOPHN.md`는 그 project에서 일하는 누구나 읽는 project 지침으로 남는다. 이 저장소의 `AGENTS.md`와 `.claude/skills/eval-*`의 관계와 같다.

domain 하나는 아래를 가진다.

| 층 | 무엇 | 지금 어디 있나 |
|---|---|---|
| 재료 | 파일(등록한 폴더)과 구조화된 저장소(sqlite) | project 폴더, 앱 data |
| tool | 재료를 읽고 쓰는 결정적 program. 출처는 내장, package, domain 셋이다 | app-api 구현, context search·check |
| interface | tool 가운데 공개한 것과 그 선언. 모양은 MCP tool이고, 바깥 client에는 core가 MCP로 내놓는다 | blueprint, `app-tools.ts`, grant |
| 앱 | domain의 software. 화면, domain tool, data를 갖고 release를 거친다. 사람이 열어 쓰고 agent는 그 tool을 부른다 | 지금 앱 |
| artifact | agent가 파일로 쓴 결과 문서(HTML과 data 파일). 앱이 아니라 결과다 | 계획 `artifact` |
| 글 | 뜻, 쓰는 법, program이 검사하지 못하는 규칙. agent가 읽는다 | `LOPHN.md`, context glossary |
| skill | domain 안의 일 하나의 절차. tool, 글, 앱, artifact를 엮는다. domain 책임의 하위 단위가 될 수 있다 | project 층 skill 폴더, Operator 정의의 `skills_off` |

tool은 출처가 셋이다.
- **내장 tool:** lophn이 모든 domain에 준다. item 목록과 조회(조건, 정렬, 집계), 형식 검사다. domain은 kind 파일(`kinds.yaml`)만 적는다. 코드도 process도 release도 없다(아래 "재료 schema"와 "내장 tool").
- **package tool:** package를 설치하면 생긴다. 코드는 package 쪽이 짜고 유지한다.
- **domain tool:** 그 domain을 위해 coding agent가 짠 코드다. Domain Engineer가 ticket을 쓰고, release, check, 관측, rewind를 거친다. 지금 앱의 app-api handler(SDK `appApi(key, handle)`)가 이 자리다.
- 지금 context DSL 같은 **중간 지대는 두지 않는다.** 선언은 작게 두고, 모자라면 코드를 쓴다.

예: 세금 domain

- kind: `receipt`(`receipts/**/*.md`, `imports/card/*.yaml`), `vendor`(`vendors/*.md`)
- 내장 tool: `list`(예: 2026년 2월 카드 영수증), `check`
- domain tool: `deductible_total(year)`. 카드와 현금을 나누고 공제 한도를 적용하는 그 사람의 세금 규칙이다
- 공개: `deductible_total`
- artifact: `artifacts/spending/`(지출 그래프). 사람이 매일 쓰는 화면이 필요해지면 그것은 Domain Engineer가 ticket으로 만드는 앱이다.
- 글: "공제"의 뜻, "10만 원 넘는 지출에는 영수증이 있어야 한다"는 규칙
- 쓰는 다른 domain: 가계 domain의 공개 `expenses.list`. 세금 domain은 가계 domain의 다른 것을 모른다.
- skill:
  - `receipt-intake`: 받은 영수증을 schema대로 `receipts/`에 쓰고 `check`한다.
  - `year-end`: `deductible_total`을 부르고, 가계 domain의 `expenses.list`와 맞춰 영수증이 빠진 지출을 사람에게 묻고, `artifacts/spending/`을 갱신한다.
- Operator "세금 도우미": skill `receipt-intake`, `year-end`와 그 tool의 grant다.

### 재료 schema: kind와 item

지금 context의 contract를 대신한다. 이름은 이렇게 나눈다.
- **재료:** domain의 파일과 data 전체(층 이름)
- **kind:** schema 안의 종류 하나. 예: `receipt`, `vendor`
- **item:** kind에 걸린 문서 하나. 예: `receipts/2026/cafe-0302.md`
- context의 type과 entity에 해당한다. type은 칸의 `type`과 부딪혀 kind로 쓴다.

```yaml
kinds:
  - name: receipt
    summary: 공제받을 지출 하나의 영수증
    files: [receipts/**/*.md, imports/card/*.yaml]
    key: slug
    fields:
      slug:   { type: string, required: true, pattern: "^[a-z0-9-]+$" }
      store:  { type: string, required: true }
      amount: { type: number, required: true }
      date:   { type: date, required: true }
      method: { type: enum, values: [card, cash], required: true }
      year:   { type: number, from: path, capture: "receipts/{year}/*.md" }
      vendor: { type: ref, to: vendor }
  - name: vendor
    summary: 자주 가는 가게
    files: [vendors/*.md]
    key: file
    fields:
      name: { type: string, required: true, unique: true }
  - name: receipt_scan
    summary: 종이 영수증 스캔
    files: [scans/**/*.pdf, scans/**/*.jpg]
    key: file
    fields:
      year: { type: number, from: path, capture: "scans/{year}/*" }
```

- **item 하나는 파일 하나다.** `files`는 glob 목록이다. 한 파일이 두 kind의 glob에 걸리면 kind 파일 오류다.
- **값을 읽는 곳은 둘이다.**
  - 문서 data: md는 frontmatter, `.yaml`·`.json`은 최상위 map이다.
  - `from: path`: 경로에서 뽑는다.
  - md 본문은 칸이 아니다. agent가 파일을 읽는다.
  - 그 밖의 형식(pdf, 이미지, docx)은 문서 data가 없고 path에서 뽑은 값만 있다. 그 안의 값이 필요하면 사람이 청할 때 agent가 옆에 md를 쓰거나 domain tool로 뽑는다. program이 결정적으로 뽑지 못하기 때문이다(PRODUCT 3절의 pdf 목차 예).
- **모든 item에 늘 있는 칸:** `path`(project 기준 경로)와 `file`(확장자를 뺀 파일 이름)이다. `key`는 칸 하나를 가리키고 kind 안에서 유일하다.
- **type:** `string`, `number`, `boolean`, `date`, `enum`(`values`), `ref`(`to`)다. 각각 `list: true`로 목록이 된다.
- **칸 속성:** `required`, `unique`, `values`, `pattern`, `to`다. context의 rule 가운데 결정적으로 볼 것이 여기로 온다. 따로 rule 목록, id, message를 두지 않는다.
- **`ref`는 같은 domain의 kind만 가리킨다.**
- **kind 하나는 모양 하나다.** 위치마다 칸 이름을 맞춰 주는 기능은 두지 않는다. 그 기능이 context의 source 7종을 만들었다. 모양이 다르면 Domain Engineer가 사람에게 물어 한쪽으로 맞추거나 kind를 나눈다.
- **series를 따로 두지 않는다.**
  - 번호는 path에서 뽑는 칸이다(`n: { type: number, from: path, capture: "exp-{n}.md" }`).
  - 순서는 `list`의 정렬이고, 중복은 `unique`로 막는다. 다음 번호는 `max(n)` + 1이다.
  - "차례로 쌓이는 기록"이라는 뜻은 summary와 글에 쓴다.
  - 잃는 것은 번호의 0 채우기(agent가 기존 파일 이름을 보고 맞춘다)와 빠진 번호 검사(필요해지면 domain tool로 붙인다)다.

누가 무엇을 하나:

| 무엇 | 누가 |
|---|---|
| 뜻(영수증에 무엇이 드나, "공제"의 뜻) | 사람이 정한다. Domain Engineer가 `ask`로 묻는다 |
| 그 뜻을 kind, glob, 칸, 속성으로 옮기기 | Domain Engineer |
| item(문서) 쓰기 | 사람과 Operator |
| schema와 문서가 맞는지 검사 | program |
| 위반이 나면 schema를 고칠지, 사람에게 문서를 고쳐 달라고 할지 | Domain Engineer |

- **kind 파일은 lophn의 자리 `kinds.yaml`에 두고 release를 거치지 않는다.**
  - Domain Engineer가 `file.write`로 고친다. 고친 것은 rewind된다.
  - 파일이 바뀌면 program이 검사한다. 맞으면 바로 그것을 쓴다. 틀리면(잘못된 glob, 없는 `ref` 대상, 두 kind가 겹치는 glob) problem을 올리고 앞의 맞던 kind 파일을 계속 쓴다.
  - 근거: 판(draft, test, submit)이 하던 일은 검사와 되돌리기다. 검사는 바뀔 때 program이 하고, 되돌리기는 rewind가 한다. 문서만 있는 domain을 코드 release 장치에 묶지 않는다(AGENTS.md "속도").
- **manifest(tool, 화면, permission, 의존 package)는 domain의 source 폴더에 두고 release를 거친다.** 지금 앱의 blueprint와 source 폴더 자리다. coding agent가 같은 폴더에 domain tool 코드를 쓴다.

파싱과 indexing은 program이 한다. agent는 파싱하지 않는다.

```
release 또는 파일 변경(watch)
  → kind별 glob으로 파일 찾기
  → 형식별로 값 읽기(md frontmatter, yaml·json map, path capture)
  → 칸 schema대로 type 맞추고 검사(필수, 허용 값, 유일, ref 대상 있음, pattern)
  → 통과한 item은 index(derived sqlite)에, 위반은 problem으로
  → list는 index에 query한다
```

- 같은 파일과 같은 kind 파일이면 같은 index다.
- watch는 사람이 모르고 형식을 깨는 것을 잡는다(PRODUCT 3절).
- **context worker의 pipeline을 줄여 남긴다.**

  | 남기는 것 | 지금 위치 |
  |---|---|
  | frontmatter·yaml 읽기, path capture | `contexts/extract/document.ts`, `extract/fields/frontmatter.ts`, `path-capture.ts` |
  | 칸 검사 | `contexts/checks/`, `validate/fields.ts` |
  | index | `contexts/index/` |
  | watch | `contexts/watch/` |
  | 조건과 정렬 | `contexts/search/where.ts`, `sort-page.ts` |
  | worker process | `contexts/worker/` |

  지우는 것은 `section`·`outline`·`series`·`index`·`links`·`app-data` 추출기, relation 따라가기, 선언 search, result view, saved view, draft·bundle 판 상태다. 남기는 쪽은 2~3천 줄로 본다. 1단계를 열 때 다시 센다.

### 내장 tool

**`list`:** 지금 선언 search를 대신한다.
- 지금은 PM이 search(이름, 입력, query, result view, example)를 미리 선언한다. agent는 `context.search(search 이름, 입력)`으로 선언된 것만 부른다. 새 조건이 필요하면 PM이 새 판을 내야 한다.
- 이제는 agent가 prompt의 kind schema를 보고 부를 때 query를 짠다.

```json
list {
  "kind": "receipt",
  "where": { "all": [
    { "field": "date",   "op": "gte", "value": "2026-02-01" },
    { "field": "date",   "op": "lt",  "value": "2026-03-01" },
    { "field": "method", "op": "eq",  "value": "card" }
  ]},
  "sort": [{ "field": "date", "dir": "asc" }],
  "fields": ["slug", "store", "amount", "date"],
  "limit": 50
}
```

```json
{
  "items": [{ "key": "cafe-0302", "path": "receipts/2026/cafe-0302.md",
              "fields": { "store": "...", "amount": 4500, "date": "2026-02-03" } }],
  "total": 23,
  "next_cursor": null,
  "skipped": { "count": 1, "reason": "형식 위반 문서는 빼고 셌다" }
}
```

- 조건은 지금 엔진(`contexts/search/where.ts`)의 `eq`, `ne`, `in`, `lt`, `lte`, `gt`, `gte`, `contains`, `exists`와 `all`, `any`, `not`이다. `follow`, 선언 입력 참조, result view는 없다.
- `skipped`를 꼭 돌려준다. 빠진 것을 모르면 agent가 결과를 전부로 믿는다.
- relation은 두 번 부른다. 예: "Blue Bottle 영수증"은 먼저 `list vendor where name = Blue Bottle`로 key를 얻고, 그 key로 `list receipt where vendor = <key>`를 부른다.
- query 엔진은 lophn 코드라 한 번 test해 두면 된다. domain마다 search example을 쓰지 않는다.
- 잃는 것은 사람이 쓰던 search tab(입력 form)과 board, relation을 따라가는 한 번짜리 query다. 사람이 보고 싶으면 artifact나 앱으로 만든다.

**`check`:** 그 domain의 형식 검사를 지금 돌려 위반 목록을 돌려준다. watch와 release가 쓰는 것과 같은 검사다.

### outline

- **outline은 kind schema에서 빼고 file tool로 옮긴다.** 긴 문서를 통째로 읽지 않고 필요한 절만 읽게 돕는 도구라서, domain 모델이 아니라 어느 domain에서나 같은 읽기 도구다.
- **`file.outline {path}`:** md 파일의 제목 tree와 각 절의 줄 범위를 돌려준다. agent는 그 범위로 `file.read {path, offset, limit}`를 부른다.
  - md 제목 parser는 이미 있다(`packages/protocol/projects/outline-markdown.ts`의 `parseOutline`, 413줄). 지금 context 추출과 editor(`shell/renderer/editor/model.ts`의 `outlineOf`)가 쓴다.
- **pdf의 목차는 program이 뽑지 않는다.** 사람이 청하면 agent가 목차 md를 옆에 쓴다(PRODUCT 3절의 예와 같다). 그 md에 `file.outline`을 쓴다.
- **절을 item으로 다뤄야 하면 domain tool로 짠다.** 예: 규정 문서의 조항마다 칸을 붙여 조회하는 경우다.

### artifact

- **artifact는 kind도 앱도 아니다.** kind는 그 domain의 사실(영수증)이고 program이 파싱하고 검사한다. 앱은 domain의 software다(화면, tool, data, release). artifact는 agent가 파일로 쓴 결과 문서다.
- **artifact 하나는 둘로 나뉜다.**

  | 부분 | 층 |
  |---|---|
  | `artifacts/<이름>/index.html`(template) | 결과 문서 |
  | `artifacts/<이름>/data/*.json` | 재료. 보통 agent가 tool(예: `list`의 집계)을 불러 만든다 |

- **data 파일은 기본으로 kind가 아니다.** template이 기대하는 모양이 자주 깨지면, 그때 Domain Engineer가 `data/*.json`을 kind로 선언해 program이 검사하게 한다.
- **앱과 다르다.** artifact는 role agent가 파일로 쓰고 release를 거치지 않는다(rewind로 되돌린다). 앱은 coding agent가 짜고 release를 거친다. 같은 내용을 사람이 매일 쓰는 화면으로 만들어야 하면 Domain Engineer가 ticket으로 앱을 만든다. artifact와 앱을 한 장치로 합치지 않는다.
- **자리:** lophn의 자리 `<data>/domains/<domain>/artifacts/<이름>/`이다("폴더"). 사람의 폴더가 없는 domain도 artifact를 둘 수 있다.
- **찾는 법:** artifact는 `artifacts/*/index.html` 관례 자리로 찾는다. 그래서 program이 domain의 artifact 목록을 결정적으로 만든다. 무엇을 보이는 artifact인지는 domain 글에 적는다.
- **artifact 전용 tool을 두지 않는다.** `artifact.show`(대화 card)도 `artifact.publish`(만들기)도 두지 않는다.
  - 만들기와 고치기는 `file.write`로 한다. 관례 자리에 `index.html`이 생기면 그게 artifact다. 탭은 파일이 바뀌면 다시 load한다.
  - 사람에게 알리는 것은 agent가 말로 한다. agent는 prompt에 실린 그 domain의 artifact 목록과 domain 글로 어떤 artifact를 다루는지 안다.
  - 대화 글에 나온 artifact path는 renderer가 열 수 있는 link로 그린다. program이 artifact 목록을 알아서 결정적이다.
- **annotation을 받는 쪽:** 그 artifact 폴더에 마지막으로 쓴 session이다. 지금 rewind 기록(`rewind_files`, checkpoint의 session)에서 결정적으로 뽑는다. 기록이 없으면 그 domain의 Domain Engineer가 받는다. 기록이 없는 경우는 사람이나 terminal이 쓴 artifact, 또는 rewind 기록 상한으로 지워진 경우다.

### skill

- **책임의 기본 단위는 domain 경계다.** skill은 그 안의 하위 단위가 될 수 있다. Operator는 domain에 놓이고, 맡을 일을 skill로 좁힐 수 있다.
- **Operator 정의는 skill을 고를 수 있다.** 고르지 않으면 그 domain의 skill을 다 받고, 고르면 고른 것만 받는다. prompt의 skill 목록에는 받은 skill만 싣는다. 지금의 `skills_off`(빼기)는 이 고르기로 바꾼다.
- **skill은 정형화하지 않은 agent용 지침이라 program이 파싱하지 않는다.** skill과 tool, grant가 맞는지는 Domain Engineer가 판단한다. program은 판단할 때를 결정적으로 알린다.
  - release가 tool을 바꾸거나 지우면 그 domain의 Domain Engineer를 부른다. 공개 tool이면 그것을 쓰는 domain(grant, invocation 기록)의 Domain Engineer도 부른다. 부름을 받은 쪽은 skill을 다시 본다.
  - Operator에게 skill을 붙이거나 좁힐 때 필요한 grant는 Domain Engineer가 판단해 사람에게 제안한다. grant는 사람이 준다.
- **skill은 Domain Engineer가 쓰고 고친다.** skill은 글이라 lophn의 자리 `skills/`에 둔 파일이고, release를 거치지 않는다. 고치면 rewind된다.
- **skill은 공개하지 않는다.** 다른 domain에 내놓을 절차는 tool로 만든다. MCP `prompts`로 내놓지 않는다.
- **전역 skill과 내장 skill은 그대로 둔다.** lophn 사용법이나 Domain Engineer가 kind 파일을 쓰는 법처럼 domain과 무관한 것이다.

### core가 아는 한 가지 모양

core는 domain이 무슨 뜻인지 모른다. 아래 모양으로 들어온 것만 처리한다(PRODUCT 2절의 "lophn의 도메인"). 그 모양을 누가 채우는지는 core의 관심 밖이다. domain tool과 package tool의 코드는 SDK로 채우고, 문서만 있는 domain은 내장 검사가 같은 모양으로 낸다.

| 모양 | 하는 일 |
|---|---|
| kind 파일 | 재료의 kind schema(`kinds.yaml`)다. 판 없이 바뀔 때 검사해 쓴다 |
| domain manifest | blueprint를 넓힌 것이다. tool(effect, input, output schema, 공개 여부), view, permission, 의존 package를 담는다 |
| release | manifest와 코드와 앱 화면의 판이다. 코드가 없는 domain은 release가 없다 |
| check | release 전 test다. tool 호출 예시와 기대값, 재료 형식 검사다. 통과해야 activate한다 |
| problem | 관측이다. 코드의 `reportProblem`과 내장 형식 검사의 위반이 같은 목록에 오른다. domain 주인을 깨우고 사람에게 알린다 |
| invocation | tool 호출마다 Gate, 기록, changeset, rewind를 거친다. 지금 app-api가 받는 대우를 MCP 호출로 옮긴다 |

### MCP server와 경계, 여러 domain을 쓰는 agent

- **경계는 core가 지킨다. MCP server가 경계는 아니다.** 세 가지를 나눈다.

  | 무엇 | 어떻게 | 물리적으로 |
  |---|---|---|
  | 경계 | 누가 어떤 재료, tool, 글을 보나. file 범위, tool 목록 거르기, Gate, 저장소 위치로 지킨다 | core의 data와 검사. 지금 `placeScope`와 grant가 하는 일이다 |
  | 실행 격리 | 코드(domain tool, package tool)를 sandbox에서 돌린다 | 코드가 있는 domain만 Deno process를 띄운다. 지금 앱 process와 같다. 문서만 있는 domain은 process가 없다 |
  | interface 모양 | tool 선언(name, description, input·output schema, annotation)을 MCP tool 꼴로 쓴다 | lophn 안의 agent에게는 core가 tool 정의를 바로 준다. 지금 app-api tool과 같은 길이다. 실제 MCP transport는 바깥 client(terminal의 coding agent 등)가 붙는 endpoint 하나뿐이다 |

  - domain마다 MCP server process를 띄우지 않는다. 그렇게 하면 경계를 거르는 일과 기록을 server 코드(AI가 쓴 코드)가 지키게 된다. 지금 앱 data를 앱 코드가 project별로 나누는 관례와 같은 문제다.
  - core의 MCP endpoint는 하나이고, 붙은 client의 자격으로 보일 tool을 거른다. 같은 domain의 agent는 모든 tool을 본다. 다른 domain의 agent는 공개 tool 가운데 grant 받은 것만 본다.
- **agent는 home domain 하나에 놓인다.** home domain은 지금 말로 그 agent의 place다. Domain Engineer는 자기 domain, Operator는 만들어진 domain이 home이고, lophn은 home이 없다. agent 정의에 적혀 있고, session을 열 때 고정된다. 다른 domain은 공개 tool과 grant로만 쓴다. home이 둘인 Operator는 두지 않는다. 두면 그 Operator를 누가 유지하는지, 어느 `LOPHN.md`를 읽는지, file 범위를 어디까지 열지가 흐려진다.
- **조립:** program이 home domain과 grant에서 결정적으로 만든다.

  | 무엇 | 어디서 |
  |---|---|
  | prompt의 글과 skill | home domain |
  | tool | home domain의 모든 tool과, 다른 domain에서 grant 받은 공개 tool |
  | file 범위 | home domain의 재료 |

- **유지보수:** home domain은 다른 domain의 공개 tool에만 기댄다.
  - 공개 tool은 제공하는 쪽 Domain Engineer가 약속한 것이다.
  - 그 tool을 바꾸거나 지우면 program이 사용 관계(invocation 기록, grant)로 기대는 domain을 찾아 막거나 알린다.
  - Operator 정의는 home domain의 Domain Engineer가 유지한다.
- **두 domain의 내부가 다 필요한 일이면 경계 신호다.** 풀 길은 셋이다.
  - 제공하는 쪽이 필요한 tool을 공개한다(export).
  - 다른 domain의 Operator에게 `call`로 맡긴다.
  - lophn이 경계를 다시 자르자고 제안하고 사람이 정한다.

### context에서 무엇이 어디로 가나

| context | domain | 이유 |
|---|---|---|
| contract `types`, entity | **kind 파일**(`kinds.yaml`)과 item("재료 schema: kind와 item") | 모양을 줄여 새로 쓴다 |
| source 7종 | glob 목록. 파일 하나가 item 하나다 | `folder`·`docs`는 glob으로 된다 |
| `series` | 지운다. 번호는 path에서 뽑는 칸이고, 순서는 정렬, 중복은 `unique`, 다음 번호는 `max` + 1이다 | 따로 kind 종류를 둘 일이 없다 |
| `section`, `index` | 지운다. 문서 일부를 item으로 쪼개야 하면 domain tool로 짠다 | DSL을 복잡하게 만든 주범이다 |
| `outline` | 내장 file tool `file.outline`으로 옮긴다("outline") | 문서를 읽는 도구이지 domain 모델이 아니다 |
| `app-data` | 지운다 | 쓰이지 않는다(추출이 모두 `undefined`). 다른 domain의 data는 공개 tool로 쓴다 |
| field `from` 8종 | frontmatter(`.yaml`이면 key 경로)와 path에서 뽑기만 둔다 | `section`·`links`·`outline`·`item`·`title`은 위와 같은 이유로 지운다 |
| `relations` | 참조 칸: 값이 다른 재료의 key인 칸. 하나 또는 목록이다 | 있는지 확인은 program이 싸고 정확하다. 따라가기(`follow`)는 지운다 |
| `rules` 6종 | 칸의 속성이 된다: 필수, 값 type, 허용 값, key 유일, 참조 있음, pattern. `count_range`는 지운다 | 따로 rule 목록과 id를 두지 않는다 |
| type·field `visibility` | 지운다 | 다른 domain은 재료를 보지 않고 공개 tool만 쓴다 |
| 선언한 `searches` | 대부분 내장 `list`(부를 때 조건, 정렬)가 된다. 그 domain만의 계산이 든 것만 domain tool로 짠다 | 미리 선언하고 example까지 쓰던 일이 사라진다 |
| result view(`table`, `board`) | 사람이 보고 싶으면 artifact나 앱으로 만든다 | |
| `saved_views` | 지운다. 자주 보는 것은 view나 skill로 둔다 | |
| bundle `examples` | kind schema는 지금 파일로 형식 검사를 한다. domain tool은 호출 예시와 기대값으로 check한다 | |
| `glossary` | domain 글(`LOPHN.md`) | 글은 agent가 읽는다 |
| draft·test·submit, `context_bundles`·`context_checks` | domain release와 check | 앱 release와 합친다 |
| 위반, `ContextViolationFound` | problem | 앱 problem과 한 목록이다 |
| worker, index(`derived/contexts.sqlite`), watch | 내장 `list`·`check`의 구현으로 다시 쓸 수 있으면 쓴다. frontmatter·yaml 추출, path capture, watch가 그 후보다 | 모델이 아니라 구현이라 1단계에서 정한다 |
| `context.*` tool, 화면(search tab, board, contract diagram) | 지운다 | |

### 폴더

domain의 저장 자리는 둘이다.

| 자리 | 무엇 | 누가 정하나 |
|---|---|---|
| 사람의 폴더 | 사람의 문서가 이미 있는 곳. project가 가진다. 예: `~/docs/tax` | 사람이 project를 등록하고 domain에 잇는다(`project.create`·`update`·`relink_folder`의 actor는 `user`뿐이다). file 범위가 곧 권한 경계라 agent가 자기 범위를 넓히지 않는다. Domain Engineer와 lophn은 제안만 한다 |
| lophn의 자리 | `<data>/domains/<domain>/` 아래 `kinds.yaml`, `source/`(manifest, domain tool 코드, 앱 화면), `data/`(sqlite), `skills/`, `artifacts/`, `agents/`(agent 정의) | core가 domain을 만들 때 정한다 |

project끼리 폴더가 겹쳐도, 여러 domain이 한 project에 이어져도 막지 않는다. 지금도 project끼리는 겹칠 수 있다(`projects/lookups.ts:40`의 `innermostProjectOfPath`). 잇는 것은 사람이 자기 파일을 그 domain에 맡긴다는 결정이다. core가 막는 것은 agent의 실수와 AI가 쓴 코드다. 사람의 결정은 막지 않는다(AGENTS.md "속도"). 겹쳐도 prompt에는 home domain의 글만 실리므로 최소 context는 그대로다.

- **나누는 규칙: 사람의 문서는 사람의 폴더에, lophn이 만들고 agent가 쓰는 것은 lophn의 자리에 둔다.** 사람의 폴더가 없는 domain(앱 data만 있는 domain)도 lophn의 자리는 늘 있다. 그래서 skill과 artifact가 갈 곳이 늘 하나로 정해진다.
- **lophn의 자리를 file tool로 쓸 수 있게 연다.**
  - Domain Engineer는 `kinds.yaml`, `skills/`, `artifacts/`와 source 폴더의 manifest를 쓴다(지금 App Engineer가 blueprint를 쓰는 것과 같다, AGENT-ROLE A4). Operator는 `artifacts/`를 쓴다. 코드는 coding agent가 쓴다.
  - 지금 skill과 agent 정의는 lophn data에 있어 file tool이 닿지 않는다(`agent-roles/hooks.ts:7`).
  - PM이 lophn data 안의 초안 폴더를 file tool로 쓰고 rewind하는 선례가 있다(`architecture/place-session.md`).
- **`LOPHN.md`는 지금처럼 사람의 첫 폴더에 둔다.** 쓰기는 지금처럼 설정 고치기로 Gate에 묻는다(`agent-roles/hooks.ts` `FILE_HOOKS.writeGate`). 사람의 폴더가 없는 domain은 lophn의 자리에 둔다.

### role

| role | 몇 | 하는 일 |
|---|---|---|
| lophn | 전체에 하나 | 경계를 넘는 판단을 한다: 새 domain, 나누기와 합치기의 제안, 재사용, package로 빼기. domain들의 **지도**(이름, 목적, 공개 tool, 설치한 package, 사용 관계)만 본다. 그 밖에 안내(L6)와 상태 확인(L7)을 한다 |
| Domain Engineer | domain마다 하나 | 사람 옆에서 domain을 모델링한다. 글과 manifest를 쓰고, tool과 앱 화면을 기획하고, ticket을 coding agent에게 맡기고, check와 problem에 대응한다. 코드는 짜지 않는다. 지금의 PM과 App Engineer를 합친 자리다 |
| Operator | domain마다 여럿 | domain 안에서 tool로 일상 업무를 한다. 맡을 일을 skill로 좁힐 수 있다. 범위는 사람이 grant로 정한다 |
| coding agent | ticket마다 | 바깥 harness다. domain tool과 앱 화면 코드를 짠다 |

경계를 넘는 판단에서 각자 맡는 것:

| 판단 | 누가 |
|---|---|
| 재사용 | lophn이 지도에서 공개 tool이나 package를 찾는다. 다른 domain의 tool을 쓰는 grant는 사람이 준다 |
| export(공개) | 공개는 약속이라 그것을 유지할, 제공하는 쪽 Domain Engineer가 받아들인다 |
| package로 빼기 | lophn이 정한다. 두 번째 domain이 원할 때 뺀다. 미리 빼지 않는다 |
| 경계 자르기 | lophn이 이유를 붙여 제안하고 사람이 정한다. 되돌리기 비싼 일이다 |

이 판단들에서 program이 맡는 것:
- **지도 조립:** 각 domain의 공개 면에서 결정적으로 만들어 lophn의 prompt에 싣는다.
- **사용 관계:** invocation 기록에서 "어느 domain이 어느 공개 tool을 쓰나"를 뽑는다.
  - 다른 domain이 쓰는 공개 tool을 지우거나 바꾸면 막거나 알린다.
  - 같은 package나 tool을 쓰는 domain이 둘 이상이면 lophn에게 알린다.
- **크기 신호:** domain 글이 prompt 예산을 넘거나 tool 수가 기준을 넘으면 나눌 후보로 lophn에게 알린다.

## 정한 것 (사람)

- context를 domain으로 바꾼다. 이름만이 아니라 모델을 바꾼다.
- domain은 책임과 최소 context를 위한 경계다. 전역 지식으로 동작하게 만들지 않는다.
- program의 책임을 0으로 만들지 않는다. 정형화 비용을 줄이려고 LLM에 맡기면 비결정성 위험이 생긴다. 결정적으로 더 정확하고 싼 일은 program이 한다.
- project와 앱을 나누지 않고 한 domain 모델로 다룬다.
- domain operation을 추상화한 interface는 MCP server다. app-api 형식은 쓰지 않는다.
- core는 관측과 test 같은 것을 자기가 아는 형식으로 받아 처리한다. 앱과 context가 하던 일을 한 가지 모양으로 합친다.
- lophn agent는 FDE 같은 자리다. domain 안의 일은 domain마다 하나인 Domain Engineer가 한다.
- skill은 정형화하지 않은 agent용 지침이다. program이 파싱하지 않고, 판단이 필요하면 Domain Engineer에게 맡긴다.
- 앱 place를 두지 않는다. place는 domain 하나다. 여러 domain이 다시 쓰는 것은 data 없는 package(화면 template과 tool 코드)이고, 어느 domain과도 상관없는 앱은 작은 domain 하나다. 앱 place를 두면 쓰는 domain의 data가 앱 저장소에 쌓여 경계를 core가 지키지 못한다.
- artifact는 lophn의 자리(`<data>/domains/<domain>/artifacts/`)에 둔다.
- 사람의 폴더가 없는 domain(folder 0개)도 등록할 수 있다. 앱 data만 있는 domain을 위한 것이다(2026-10-19). project와 domain을 나눈 뒤에는 폴더 0개인 project에 속한 domain이다.
- project와 domain은 다른 것이고 1:N이다(2026-10-19). project는 폴더·창·terminal·coding agent의 자리이고, domain은 agent·kind·앱·skill·artifact·grant가 붙는 책임 경계다. domain은 한 project에 속하고, 다른 project는 그 domain을 참조한다(공개 tool과 grant). domain마다 재료 path 목록은 두지 않는다("project와 domain").
- 화면 말: domain은 "Domain", role은 "Domain Engineer", project는 "Project", 앱은 "App" 그대로다.
- role agent가 artifact(정적 HTML)를 직접 쓴다. PRODUCT 3절 "lophn agent는 코드를 짜지 않는다"를 "앱 코드(domain tool, 앱 화면)는 짜지 않는다. 정적 view는 결과 문서라 직접 쓴다"로 고친다.
- 경계를 넘는 판단(경계 자르기, 재사용, export)은 lophn이 한다. 따로 Architect role을 두지 않는다.
- Operator의 skill을 domain이 다룬다. 책임의 기본 단위는 domain 경계이고, skill은 그 하위 단위가 될 수 있다.

## 정한 것 (agent, 초안)

- **정형화는 program이 쓰는 칸만 한다.** 재료 위치, 칸 schema(type, 필수, 허용 값, key 유일, 다른 개념을 가리키는 참조), 공개 여부, tool 선언이다.
  - 뜻, 쓰는 법, 문서와 앱을 가로지르는 규칙은 글로 둔다.
  - 근거: PRODUCT 3절. program은 결정적으로 할 수 있는 일을 맡고, 의미 판단은 agent가 한다.
- **context의 query DSL과 그 주변은 옮기지 않고 지운다.** 무엇이 어디로 가는지는 "context에서 무엇이 어디로 가나" 표에 있다.
  - 결정적 조회는 내장 tool(조건과 정렬)이 맡는다. agent가 부를 때 조건을 준다.
  - PM이 search를 미리 선언하던 일이 사라진다.
- **domain 글은 `<data>/domains/<domain>/DOMAIN.md`다.** `LOPHN.md`는 project 지침으로 남는다("project와 domain"). 다른 domain에 보이는 글은 domain 목적과 공개 tool의 설명뿐이다.
- **판은 코드 release 하나다.** context bundle의 draft/test/submit은 지운다. kind 파일은 판 없이 바뀔 때 검사해 쓴다("재료 schema"의 근거).
- **tool 호출은 지금 app-api 호출이 받는 대우를 받는다.** Gate, write queue, invocation 기록, changeset, rewind다. test mode 호출(check)도 같은 tool 호출 꼴로 보낸다.
- **Domain Engineer에게 kind 파일 모양을 준다.** 내장 skill에 kind 파일의 칸과 짧은 예시를 넣는다. PM이 `bundle.json`의 key를 짐작하던 구멍을 막는다.
- **호환 장치를 두지 않는다**(AGENTS.md "호환성").
  - context 표, route, event, 화면, tab kind, wording, e2e, eval 자료를 지운다.
  - 개발 data는 새로 만든다.
  - 쓰이지 않는 `tracking`(project record)과 `app_reads`(agent 정의 schema)도 같이 지운다.
- **MCP는 core가 host한다.** domain 코드는 SDK로 tool handler만 정의한다. 근거는 "MCP server와 경계"의 경계 원칙이다. domain process가 독립된 server가 되면 Gate, invocation, rewind가 우회된다.
- **바깥 MCP client는 처음에 lophn terminal의 coding agent만 붙인다.** Claude Desktop 같은 lophn 밖 client는 연결 인증과 grant 화면을 따로 설계한 뒤 연다. 근거: AGENTS.md "속도", 미리 만들지 않는다.
- **재료를 MCP `resources`로 내놓지 않는다.** agent는 파일 tool과 내장 `list`로 충분하다. 다른 domain에 재료를 열면 경계가 샌다. 근거: 쓰는 곳이 없다.
- **`list`에 집계를 넣는다.** `count`, `sum`, `min`, `max`와 칸 하나 기준 group이다. rows를 받아 agent가 수십 개를 더하면 틀린다. 근거: PRODUCT 3절, 싸고 정확한 일은 program이 한다.
- **문서 위반은 아무것도 막지 않는다.** kind 파일 자체의 오류(잘못된 glob, 없는 `ref` 대상, 두 kind가 겹치는 glob)만 그 kind 파일을 쓰지 않게 한다. 문서 위반은 problem으로 올리고 Domain Engineer가 schema와 문서 가운데 무엇을 고칠지 판단한다. 근거: 문서는 사람의 것이라, 막으면 schema를 바꿀 때마다 일이 멈춘다.
- **`ref`는 같은 domain의 kind만 가리킨다.** 다른 domain과 이을 값은 문자열로 두고, 확인이 필요하면 domain tool이 그 domain의 공개 tool로 확인한다. 근거: 다른 domain의 재료는 보이지 않는다.
- **package의 주인은 처음 publish한 domain의 Domain Engineer다.** 다른 domain에서 난 problem은 그에게 call로 넘어간다. 근거: Operator가 앱 bug를 App Engineer에게 넘기는 지금 꼴(AGENT-ROLE O4)과 같다.

## 단계

계획 다섯으로 나눈다. 앞의 넷은 같이 돌고, 마지막 하나는 넷이 land한 뒤 돈다. 같이 도는 동안 코드 이름은 지금 것(project, `project_manager`, app)을 쓰고, 이름 바꾸기는 마지막 계획이 한 번에 한다. 그래서 계획끼리 선행이 없다. 겹치는 file은 `status.py ready`가 running끼리 가르고, land의 rebase에서 lead가 푼다.

| 계획 | 하는 일 | 같이 도나 |
|---|---|---|
| `domain-kinds` | context를 지우고 kind 파일, pipeline, 내장 tool(`list`, `check`), `file.outline`, 문서 위반 problem을 둔다 | 처음부터 |
| `domain-tools` | app-api를 MCP tool 모양 선언으로 바꾸고 SDK, bridge(`callTool`), agent tool, ticket examples를 맞춘다. `project_scope`를 지운다. core가 coding agent용 MCP endpoint를 연다 | 처음부터 |
| `domain-place` | 앱을 project 안의 코드로 묶는다(1:1). 앱 place와 App Engineer를 없애 PM 하나로 합친다. Operator skill 고르기, project skill 자리, lophn 지도, 사용 관계 신호를 둔다 | 처음부터 |
| `artifact` | `artifact.md`를 만든다 | 처음부터 |
| `domain-split` | 지금 project entity를 domain으로 바꾸고, 가벼운 project를 새로 두고, domain을 project 하나에 속하게 한다(1:N). `project_manager`를 Domain Engineer로 바꾼다. 문서를 모은다(2026-10-19 "project와 domain"에 따라 `domain-rename`을 바꿈) | 넷이 land한 뒤 |

- e2e는 이 다섯 계획에서 돌리지도 고치지도 않는다. land는 `LOPHN_LAND_SKIP_E2E=1`로 돈다. 지운 기능의 e2e file은 그 기능을 지우는 task가 지운다. 나머지는 `domain-split` 뒤 따로 다시 쓴다.
- 앱과 artifact를 한 장치로 합치지 않는다. 앱은 앱이고, artifact는 agent가 쓴 결과 문서다(2026-10-19 사람). "live view"라는 말은 쓰지 않는다.

test(AGENTS.md "속도", `write-test` skill):
- agent의 file 범위가 자기 domain의 재료 밖으로 나가지 않는다. 다른 domain의 비공개 tool이 agent tool 목록과 MCP `tools/list`에 나오지 않는다. 권한 경계다.
- write tool 호출이 invocation과 changeset을 남기고 rewind된다. 사용자 data다.
- 다른 domain이 쓰는 공개 tool을 지운 release가 막힌다.

계획 끝에 고칠 것:
- `project-docs/architecture/domain.md`를 새로 쓴다.
- `architecture/place-session.md`, `app-call.md`, `agent-definition.md`, `annotation.md`를 고친다.
- PRODUCT 2절, 3절(artifact를 role agent가 쓴다), 6절과 AGENT-ROLE 전체(role 표, L, A, C, O 줄)를 고친다.
- `boundary-catalog.yaml`(`projects`, `contexts`, `apps` 경계)과 `module-catalog.yaml`을 고친다.
- `issues/contexts.md`를 닫는다.

## 끝남 기준

- 사람이 lophn에게 "연말정산 준비를 도와줘"라고 말한다.
  - lophn이 지도를 보고 세금 domain을 제안하고, 사람이 정한다.
  - 세금 domain의 Domain Engineer가 사람과 이야기해 영수증 kind 파일과 글을 쓴다. release 없이 바로 쓰인다.
- 영수증 파일에 `amount`가 빠지면 problem이 올라오고 Domain Engineer와 사람이 안다.
- 세금 domain의 Operator가 `list receipts where date in 2026-02`로 표를 받는다. 파일 tool로 한 개씩 읽지 않는다.
- 사람이 Operator "세금 도우미"에 skill `year-end`를 붙여 달라고 하면 Domain Engineer가 필요한 grant(`deductible_total`, `가계/expenses.list`)를 제안한다. skill을 고른 Operator의 prompt에는 고른 skill만 있다.
- 가계 domain이 `expenses.list`를 바꾼 release를 내면 세금 domain의 Domain Engineer가 불려 `year-end`를 다시 본다.
- Domain Engineer가 `deductible_total`을 ticket으로 coding agent에게 맡긴다. check가 통과하면 activate되고, Operator의 tool 목록에 나온다.
- 세금 domain의 Operator는 가계 domain의 공개 `expenses.list`만 보인다. 가계 domain의 파일과 비공개 tool은 보이지 않는다.
- Operator가 부른 domain write tool을 session rewind에서 되돌릴 수 있다.
- lophn terminal의 coding agent가 MCP로 세금 domain의 tool을 불러 확인한다.

## 하지 않는 것

- **lophn 밖 MCP client의 연결:** 연결 인증과 grant 화면을 설계한 뒤 연다.
- **MCP `resources`와 `prompts`:** 쓰는 곳이 생기면 붙인다.
- **domain을 저절로 나누거나 합치기:** program은 신호만 내고, 제안은 lophn이, 결정은 사람이 한다.
- **context에서 domain으로 data를 옮기기:** MVP 이전이다. 개발 data는 새로 만든다.
- **pdf에서 값이나 목차를 program이 뽑기:** 결정적으로 뽑을 수 없다. 사람이 청하면 agent가 옆에 md를 쓴다(PRODUCT 3절). `issues/contexts.md`의 "md가 아닌 문서" 이슈는 이 계획에서 닫는다.
