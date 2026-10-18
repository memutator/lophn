# ev-restore

재료를 새 data root에 제품 route로 되살린다. 종류마다 되살리는 길(`app_source`, `project`, `operator_grant`는 사람 자격 route, `context`는 fake PM 대본)을 만들고, 이 계획에서 쓰지 않는 종류(`active_app`, `app_data`, `package`)는 같은 모양의 자리에서 `unavailable`로 멈춘다.

- 단위: ev (wave 3)
- 선행: ev-material, ev-steps, ev-provider
- 소유(이 task만 고친다):
  - `tests/eval/material/{restore,restore-app,restore-project,restore-operator,restore-context}.ts`
- 읽을 것:
  - 계획: `project-docs/products/roadmap/eval.md`의 "재료"(종류와 되살리는 길 표, "다시 만들어야 하고 담을 수 없는 것"), `project-docs/plan/eval-base/README.md`(정한 것 4)
  - 조사: `project-docs/plan/eval-base/research/reuse-and-materials.md` 2.0(root 복사를 하지 않는 이유), 2.3(project), 2.4(context는 agent만 적용할 수 있다. PM의 `context_draft` → `file_write` → `context_test` → `context_submit`), 2.6(Operator, grant), 2.7(id를 못 고정하는 것)
  - 본보기:
    - 앱 등록: `packages/core/apps/registration/commands.ts:105-110`(사람 자격만 `id`를 미리 줄 수 있다), `tests/support/app/activate.ts`의 `startTestApp` 앞부분
    - project: `tests/support/core/human.ts`의 `openProject`(`projectApi.register`, 폴더를 더하면 runtime child가 다시 떠서 `settle`). `openProject`는 id를 고르지 못하므로 같은 route를 `id`를 주고 직접 부른다(`packages/protocol/projects/project-api.ts`의 `projectRegisterInputSchema`)
    - context: `tests/e2e/pm-context_test.ts`의 `bundle`, `runRow`, `afterDraft`, `draftOf`(대본 3개로 `bundle.json`을 적용하는 길)
    - Operator, grant: `tests/e2e/operator_test.ts:48-75`(`operatorCreate`, `agentGrantsSet`)
  - 계약: `tests/eval/types.ts`(`Manifest`, 각 `*Recipe`, `WorldIds`, `SetupCtx`), `tests/eval/material/*.ts`(ev-material), `tests/eval/steps.ts`(`refOf`, `callAgentOf`, `archiveQuiet`)
- 계약:
  - 쓰는 것: 위 module들. `tests/support/core`(`bootCore` 결과인 `Core`, `openProject` 대신 쓰는 `settle`·`openSession`·`say`·`waitTurnEnd`, `provider.ts`의 `changeModel`), `tests/support/fake-server`
  - 내놓는 것: `restoreWorld(ctx: RestoreCtx, refs: MaterialRef[]): Promise<{ ids: WorldIds; world: { name: string; n: number; content_hash: string }[] }>`. `RestoreCtx`는 `restore.ts`가 정의하고 `{ core: Core; run: Run; fake: FakeServer; restoreModel: ModelChoice; root?: string }`다(`SetupCtx`에서 `ids`를 뺀 것). 이름으로 앞 재료의 id를 풀 수 있도록 `WorldIds`를 재료마다 채워 간다.

## 할 일

1. `restore.ts`: `restoreWorld`. ① 모든 ref를 `verifyMaterial`(hash 확인)부터 한다. 하나라도 다르면 core를 건드리기 전에 던진다. ② `orderWorld`로 순서를 정한다. ③ 재료마다 `kind`로 restorer를 불러 `WorldIds`에 더한다. 종류별 restorer 표는 이 file에 둔다. `active_app`·`app_data`·`package`는 `throw new Error("<kind> restore is not built in eval-base")`로 둔다(다음 계획 `eval-coding`의 몫이다. 모양만 같다).
2. `restore-app.ts`(`app_source`): 앱마다 `appCreate({ id, slug, name, description })`(id는 recipe의 고정 id). `source`가 null이 아니면 `unavailable`로 던진다(source 파일 복원은 이 계획의 case가 안 쓴다). 앱 등록은 App Engineer 정의도 같이 만든다.
3. `restore-project.ts`(`project`): `files/<folder>`를 `run.work/<폴더 이름>`에 복사하고(`LOPHN.md` 같은 파일 포함, git init은 하지 않는다. `pm-context_test.ts`가 하지 않는다) `projectApi.register`를 recipe의 고정 id, `name`(slug), `title`, `purpose`, 폴더 하나로 부른다. 부르기 전의 `runtimePids`를 읽어 두고 부른 뒤 `settle(core, before)`로 기다린다.
4. `restore-context.ts`(`context`): project name은 `ids.projects`로 푼다. 아래 순서로 한다.
   1. `ctx.fake.reset()`, PM session을 `openSession`, `changeModel(core, session, ctx.restoreModel)`.
   2. 대본(`pm-context_test.ts`의 `runRow`와 같은 3 step): `context_draft({name, purpose})` → `file_write({path: <초안 폴더>/bundle.json, content: <files의 bundle 파일 글 그대로>})` + `context_test` + `context_submit` → text. 초안 폴더와 id는 `context_draft` 결과에서 `ReplyFn`으로 읽는다.
   3. `say`, `waitTurnEnd`(제한 120초)로 끝낸다. 적용 확인: `contextGetRoute`의 `applied`가 있다. 없으면 `contextBundlesRoute`의 check findings를 담아 던진다. 되살린 context id는 `ids.contexts[name]`에 둔다.
   4. PM session을 `archiveQuiet`로 닫는다. 되살리기가 열어 둔 session이 world에 남으면 안 된다(lophn의 call 대상 목록이 바뀐다).
5. `restore-operator.ts`(`operator_grant`): Operator마다 `operatorCreate({ id, place: {kind, id}, definition: { name, body, contexts: [ctx id…] } })`(place와 contexts는 이름 → id). 그 뒤 `grants`마다 `agentGrantsSet`(`refOf`, `callAgentOf`로 푼 ref와 entries). recipe의 `grants`가 비면 `agentGrantsSet`을 부르지 않는다(기본 grant를 건드리지 않는다).
6. 확인(진짜 provider 없이): 재료 데이터는 ev-world가 만든다. 이 task는 임시 root(`Deno.makeTempDir`)에 최소 재료를 직접 만들어(`app_source` 앱 둘, `project` 하나에 `notes/alpha.md`·`notes/beta.md`, `context` 하나(`pm-context_test.ts`의 `bundle(["alpha","beta"])`와 문서 꼴), `operator_grant` 하나) `pack` 뒤 `restoreWorld`를 scratch(`.dev-data/ev-restore/check.ts`, commit하지 않는다)에서 돌린다. 본다: 앱·project id가 recipe의 고정 id와 같다 / `contextSearchRoute`가 문서를 돌려준다 / Operator 정의에 context id가 있다 / 되살린 뒤 열린 session이 없다(`agentSessionList`가 모든 agent에서 비었다) / hash를 틀리게 하면 core를 띄우기 전에 던진다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 이 코드는 `createRun`의 새 root에만 쓰고 사람의 data root를 건드릴 길이 없다. hash 확인은 `verifyMaterial` 호출로 core를 건드리기 전에 끝난다.
- 남지 않음: scratch를 commit하지 않았다. `/tmp/lophn-e2e-*`와 core process가 남지 않았다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 정한 것: PM 대본의 timeout, project 폴더 복사 위치, 문서에 답이 없어 정한 것
- 계약 바꾸기 요청: `Recipe` 칸을 바꿔야 하면 여기 적는다
- **무겁게 짠 것**: 없음이면 "없음"
- **알려진 미완 동작**: 켜진 앱, 앱 data, package, source 있는 앱의 복원이 없다는 것(다음 계획 `eval-coding`이 만든다)
