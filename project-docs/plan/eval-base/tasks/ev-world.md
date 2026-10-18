# ev-world

17개 case가 쓰는 재료 여섯을 `tests/eval/materials/`에 만들고 hash를 채운 뒤, 새 root에 되살려 본다: `apps-home`, `project-tax`, `project-hr`, `context-receipt`, `operator-ledger`, `operator-tax`. 모두 `@1`이다.

- 단위: ev (wave 4)
- 선행: ev-restore, ev-material
- 소유(이 task만 고친다):
  - `tests/eval/materials/`
- 읽을 것:
  - 계획: `project-docs/products/roadmap/eval.md`의 "재료"(버전과 조립), "책임에 따른 call: 작은 판단 case" 표의 setup 열
  - 계약: `tests/eval/types.ts`(`Manifest`, `AppSourceRecipe`, `ProjectRecipe`, `ContextRecipe`, `OperatorGrantRecipe`), `tests/eval/material/{manifest,hash,pack}.ts`, `tests/eval/material/restore*.ts`
  - 본보기: `tests/e2e/pm-context_test.ts`의 `bundle`(계약과 검색 모양), `tests/e2e/operator_test.ts:48-75`(Operator 정의)
  - 코드: `packages/core/agent-roles/place/place-info.ts:122-129`(lophn가 보는 project·앱 목록은 `- <name>: <purpose>` 한 줄이다. Korean `title`은 보이지 않는다), `packages/protocol/base/ids.ts`(`idSchema`는 `<접두>_<ULID>`), `packages/protocol/lophn-agent/agent-values.ts`(`agentNameSchema`)
- 계약:
  - 쓰는 것: 위 module들
  - 내놓는 것: 아래 재료 여섯. case 파일은 `world: ["apps-home@1", …]`처럼 부른다.

| 재료 | kind | needs | 내용 |
|---|---|---|---|
| `apps-home@1` | `app_source` | 없음 | 앱 둘: name `가계부`(slug `ledger`), name `할일`(slug `todo`). `source: null`(등록만). description은 한 줄씩 |
| `project-tax@1` | `project` | 없음 | project name `tax`, title `세무`, purpose는 `세무(tax): …`로 시작해 lophn가 "세무"를 `tax`로 풀 수 있게 한다. 폴더 `files/tax/`에 문서 다섯쯤: `receipts/*.md`(frontmatter `slug`, `date`, `amount`, `category`) 셋과 `deductions/limits.md`(공제 한도 자료), `LOPHN.md` 없음 |
| `project-hr@1` | `project` | 없음 | project name `hr`, title `인사`, purpose `인사(hr): …`. 폴더 `files/hr/`에 문서 둘 |
| `context-receipt@1` | `context` | `project-tax@1` | project `tax`에 context name `receipts`. bundle: type `Receipt`(`receipts/*.md`, key `slug`, 필드는 `slug`·`date`·`amount`·`category` 넷뿐이다. **'공급자'(supplier) 필드를 두지 않는다.** case O6의 전제다), 검색 `receipts` 하나, example `expect_keys`는 `tax`의 영수증 slug들과 정확히 같다 |
| `operator-ledger@1` | `operator_grant` | `apps-home@1` | 앱 `가계부`의 Operator 하나(name은 `agentNameSchema`를 통과하는 이름, 예 `ledger-close`), 짧은 영어 body, `contexts: []`, `grants: []` |
| `operator-tax@1` | `operator_grant` | `context-receipt@1` | project `tax`의 Operator 하나(예 `receipt-clerk`), `contexts: ["receipts"]`, `grants: []` |

## 할 일

1. 폴더를 만든다: `tests/eval/materials/<이름>/1/{material.json,files/…}`. `files/`가 필요 없는 재료(`apps-home`, `operator-*`)는 `files/`를 만들지 않는다(`readFiles`가 빈 목록을 돌려주는지 확인).
2. 고정 id는 `idSchema(접두)`를 통과하는 손으로 정한 ULID로 쓴다(앱 `app_`, project `prj_`, Operator `agt_`). 같은 id를 다른 재료에서 다시 쓰지 않는다. `recipe`는 `types.ts`의 `*Recipe` 모양 그대로다. `parent: null`, `produced_by: null`, `content_hash`는 `pack`이 채운다.
3. 문서는 한국어 짧은 글이어도 좋지만 `context-receipt`의 bundle이 `tax`의 영수증과 정확히 맞아야 한다(example이 안 맞으면 PM의 `context_test`가 `example_mismatch`로 막는다). bundle 모양은 `pm-context_test.ts`의 `bundle()`을 본뜬다.
4. 여섯 재료에 `deno run -A tests/eval/material/pack.ts <이름>@1`을 돌려 hash를 채운다.
5. 확인(진짜 provider 없이): scratch(`.dev-data/ev-world/check.ts`, commit하지 않는다)에서 `bootCore` + `startFakeServer` + `connectFakeProvider(core, fake, {default:false})`로 새 root를 띄우고 `restoreWorld(ctx, ["operator-ledger@1", "operator-tax@1"])`(needs로 나머지 넷이 따라온다)를 돌린다. 본다: 앱 둘·project 둘이 recipe의 id로 있다 / `receipts` context가 적용되어 `contextSearchRoute`가 영수증 slug들을 돌려준다 / Operator 둘의 정의가 있고 `receipt-clerk`에 context id가 있다 / 열린 session이 없다. 그리고 `apps-home@1`만, `project-tax@1`+`project-hr@1`만 각각 새 root에 되살려 본다(case가 world를 이렇게 고른다). 마지막으로 `deno run -A tests/eval/run.ts --check`가 hash 확인을 통과한다(`run.ts`가 아직 없으면 `verifyMaterial`을 직접 부른다).
6. 이 재료의 `deno fmt`/lint는 lead가 `materials`를 제외한다(보고의 등록할 것). 그 전에 `deno task check`가 이 폴더 때문에 실패하면 `deno.json`을 고치지 말고 보고에 적는다.

## 끝남

- `deno task check`가 통과한다(위 6번의 제외가 아직 안 들어가 실패하면 그 이유가 이 폴더의 fmt뿐인지 보고에 적는다).
- 위험 test: 없음.
- 남지 않음: scratch를 commit하지 않았다. `/tmp/lophn-e2e-*`와 core process가 남지 않았다.

## 보고

- 바꾼 file(재료 폴더 목록과 hash 앞 12자)
- 통과한 check
- 등록할 것: `deno.json` `exclude`와 `tools/check.ts` `DENO_EXCLUDED`에 `tests/eval/materials`
- 정한 것: 문서 내용, Operator 이름, id
- 계약 바꾸기 요청: `Recipe`를 바꿔야 하면 여기 적는다
- **무겁게 짠 것**: 없음이면 "없음"
- **알려진 미완 동작**: 없음이면 "없음"
