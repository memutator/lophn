# update-follow

**opus high.** 다른 기계가 폴더로 낸 앱의 새 release를 이 기계가 스스로 따라간다. 이 기계에 들인 앱이고 그 release의 commit이 지금 활성 commit의 자손이면, 폴더의 봉인 bundle을 이 기계의 prepared release로 설치하고(들이기와 같은 길) 지금 activation에 넘긴다. 권한이 늘거나 data 손실 migration이면 지금 activation이 이 기계의 사람에게 동의를 묻고, 아니면 묻지 않고 활성한다. 옛 기계가 낸 옛 release로 내려가지 않고, 갈라진 release는 따라가지 않는다. 설치나 활성이 실패하면 지금 release에 남고 이유를 상태로 둔다.

- 단위: follow (wave 1)
- 선행: 없음. `app-folder-sync`가 main에 land된 뒤다(계획 README 머리)
- 소유(이 task만 고친다):
  - `packages/core/apps/follow/`(새 폴더: `mod.ts`, `order.ts`(고르기의 순수 판정), `follow.ts`(돌기, 상태), `git.ts`(조상 확인. `app-folder-sync`의 source 받기에 git runner가 있으면 그것을 쓰고 이 file은 만들지 않는다), `follow_test.ts`)
- 공유 줄 허락(한 줄씩, 보고의 "넘길 줄"에): `packages/core/main/daemon/wiring/apps.ts` 또는 `folder-surface`가 폴더를 조립한 wiring file(follow를 만들고 계기를 달고 상태를 `update-status`에 넘기는 줄). `takeIn`이 follow에 닿지 않으면 `folder-surface`가 `createFolderApps`를 조립한 곳에서 넘기는 한 줄
- 읽을 것:
  - 계획 `README.md`의 "정한 것"(따라가기, git 조상 순서, 내려가지 않음, 실패, session 없는 activation, SDK가 없으면 lophn을 올리라고 함), "계약 바꾸기 요청"의 `app-folder-sync` 3
  - `project-docs/plan/app-folder-sync/README.md` "다른 계획이 기대는 계약" 1(release 폴더와 `release.json`이 마지막에 쓰인다), 3(앱 기록 `active_release`·`releases`, release 기록의 `code_commit`·`data_schema`), "정한 것"(release의 기계 사이 신분은 bundle hash, 받는 기계는 bundle을 그대로 받는다, SDK 판이 없으면 `conflict`, source는 `refs/remotes/<mch>/*`로 fetch만)과 그 계획의 `tasks/folder-apps.md`(`takeIn`: (b) release 폴더 검사, (c) SDK 판이 없으면 `conflict`, (d) 앱이 없을 때만 만든다, (e) 봉인 사본과 `prepared`, `created_by`)와 그 code
  - architecture: `project-docs/architecture/activation.md` 지키는 것 1·4·6·8·12·13·16, 결정 "이전 release로 돌아가기를 사람에게만 열고 schema가 같을 때만"
  - 지금 코드:
    - activation: `packages/core/apps/control.ts`의 `AppsControl.activation`(`ActivationDriver`), `packages/core/apps/releases/activation/assembly.ts`의 `activate(id)`(prepared가 아니면 `conflict`, 같은 앱에 도는 시도가 있으면 `conflict`, 결과 `active`·`failed`·`waiting_consent`·`running`, 120초까지 기다림), `handler.ts`의 `activate`와 `compare.ts`의 `asksFor`(첫 activation, 늘어난 바깥 자원, 늘어난 다른 앱 tool, loss), `consents.ts`(`ACTIVATION_CONSENT_TOPIC`, `ActivationConsentClosed`의 `outcome`)
    - release 행: `packages/core/apps/releases/{store.ts,schema.ts}`(status `prepared`·`activating`·`active`·`superseded`·`failed`, `bundle_hash`, `code_commit`, `data_schema`, `created_by`), 앱 행 `packages/core/apps/registration/schema.ts`(`active_release`, `status`의 `archived`, `source_path`)
    - `activation.report`(`packages/core/apps/releases/commands.ts`)는 `created_by`가 agent가 아니면 보내지 않는다
    - git 부르기 꼴: `packages/core/apps/registration/source-folder.ts`의 `git()`(사람의 git 설정을 읽지 않는 env)
- 계약:
  - 쓰는 것: `app-folder-sync`의 앱 기록 사본(`folder_records`의 kind `app`: 기계마다 그 앱의 `active_release`), release 폴더(`release.json`이 맞을 때만 "왔다"), `folder-apps`의 `takeIn({app, from, release: bundle_hash})`(이미 들인 앱이면 release만 prepared로 설치한다. 계획 README 계약 바꾸기 요청 3), 폴더 읽기 끝 알림. `ActivationDriver.activate`.
  - 내놓는 것(`update-status`가 기댄다):
    - `FollowState = { state: "current" | "installing" | "activating" | "waiting_consent" | "declined" | "lophn_update" | "install_failed" | "activation_failed" | "diverged", release: <bundle hash> | null, reason: string | null }`. `release`는 따라가려는(또는 막힌) release, `current`면 null.
    - `follow.state(app): FollowState`, `follow.onChange(listener): () => void`, `follow.sweep(app?): Promise<void>`.

## 할 일

1. 고르기(`order.ts`, 순수. git은 함수로 받는다): 앱 하나에 대해 지금 활성 release(`bundle_hash`, `code_commit`, `data_schema`)와 다른 기계들의 `active_release`(앱 기록 사본)에서 후보를 고른다. 후보는 bundle hash가 지금 것과 다르고, 이 기계에 그 bundle hash의 release가 `superseded`나 `failed`로 있지 않고(이 기계가 내려놓았거나 실패한 release는 다시 하지 않는다), `data_schema`가 지금 것 이상이고, commit이 지금 commit의 자손(같은 commit은 후보가 아니다)인 것이다. 후보가 없으면 `current`. 후보 가운데 나머지 모두가 조상(같은 commit 포함)인 하나가 있으면 그것이 목표다(중간 release는 건너뛴다: migration은 누적이다). 같은 commit의 서로 다른 bundle hash가 둘이면 먼저 활성된 쪽(`release.json`의 `created_at`)을 고른다. 하나로 정해지지 않으면 `diverged`(release는 가장 늦게 만든 후보). 자손인지 모르는 후보(commit이 아직 이 저장소에 없다: source bundle이 아직 안 왔다)는 이번에 빼고 다음 계기에 다시 본다.
2. `git.ts`: `isAncestor(sourcePath, ancestor, descendant): Promise<Result<boolean | "missing">>` = `git -C <source> merge-base --is-ancestor <a> <d>`(exit 0이면 true, 1이면 false, commit이 없으면 `"missing"`, 그 밖은 `unavailable`). `source-folder.ts`의 env를 같게 쓴다.
3. 돌기(`follow.ts`): 앱마다 한 번에 하나. 들인 앱이고(폴더로 맞추는 앱) 활성 release가 있고 `archived`가 아닌 앱만(들이기의 첫 activation을 기다리는 앱은 건드리지 않는다. 들이지 않은 앱은 아무것도 하지 않는다).
   - 목표가 정해지고 이 기계에 그 bundle hash의 `prepared` release가 없으면 `installing`으로 두고 `takeIn({app, from: 그 release를 활성한 기계, release: bundle_hash})`로 prepared release를 만든다. `invalid_input`(release 폴더가 아직 다 오지 않았다)이면 상태를 바꾸지 않고 다음 계기에 다시 한다. SDK 판 때문의 `conflict`면 `lophn_update`(reason은 그 판). 그 밖의 실패는 `install_failed`(reason). 둘 다 이 core가 도는 동안 같은 bundle hash를 다시 하지 않는다(다른 목표가 오거나 core가 다시 뜨면 다시 한다).
   - prepared release를 `ActivationDriver.activate(id)`에 넘긴다. 기다리는 동안 `activating`. 결과가 `active`면 `current`, `failed`면 `activation_failed`(reason은 release 실패 기록의 code와 summary), `waiting_consent`면 `waiting_consent`, `running`이면 `activating`으로 두고 release 상태가 바뀔 때 다시 본다. `conflict`(같은 앱의 다른 시도)면 아무것도 바꾸지 않고 다음 계기에 다시 한다.
   - 사람이 동의를 거절하면(`ActivationConsentClosed`의 `reject`) 그 bundle hash를 `declined`로 두고 이 core가 도는 동안 다시 묻지 않는다(다른 목표가 오면 묻는다). 동의를 기다리는 줄이 이미 있으면 `activate`를 다시 부르지 않는다.
   - 앱마다의 상태는 메모리다. 바뀌면 `onChange`.
4. 계기(공유 줄): supervisor가 붙은 뒤 한 번, 폴더 읽기 끝(기록 사본이 바뀐 뒤), 앱의 release 상태 바뀜(`publishStateChanged`의 `releases`), 동의 닫힘. 계기가 겹쳐도 앱마다 하나만 돈다.
5. 위험 test(`follow_test.ts`. `order.ts`의 순수 판정과, activation handler를 실제로 쓴 것):
   - "옛 기계가 낸 release(지금 commit의 조상이거나 data schema가 낮다)와 이 기계가 내려놓은 release는 목표가 되지 않고, 갈라진 두 release가 있으면 아무것도 고르지 않는다"(표로: 일직선, 건너뛰기, 조상, 갈라짐, 낮은 schema, superseded, failed, commit 없음)
   - "따라가려는 release가 이 기계 grant에 없는 바깥 자원을 요구하면 activation이 시작되지 않고 동의 줄만 선다"(`createActivationHandlers`에 실제 `asksFor`와, 줄에 선 release와 시작된 release를 기록하는 작은 가짜 `consents`·`enqueue`를 끼우고 그 기록을 본다)

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 위 5의 둘.
- 남지 않음: 없음(새 module).
- flows catalog: 새 동작(폴더 release 따라가기, 동의 기다림, 거절, lophn을 올리라는 상태, 설치 실패, 갈라짐, 내려가지 않음)의 flow·outcome과 새 test file의 줄을 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 들이기 설치 함수의 실제 이름과 꼴, 설치된 release의 `created_by`, 따라간 activation이 사람에게 남긴 기록(앱 notice)의 글.
