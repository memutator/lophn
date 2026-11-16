# machine-update: 판이 다른 기계 사이에서 잃는 것도 말없이 틀리는 것도 없다

**이 계획의 task는 `app-folder-sync`가 main에 land되기 전에 띄우지 않는다.** brief는 그 계획의 README(2026-11-16, task가 아직 todo)의 "다른 계획이 기대는 계약"으로 썼다. land 뒤 lead가 실제 code의 이름과 path로 brief를 맞춘다.

- 목표: 한 사람의 기계들이 다른 lophn 판과 같은 앱의 다른 release를 돌려도 data를 잃지 않고 말없이 틀리지 않는다. lophn 판은 범위 안이면 계속 주고받고 범위 밖이면 멈춰 누가 올려야 하는지 보인다. 앱의 새 release는 그 앱을 들인 기계에서 스스로 따라가고 권한이 늘면 그 기계에서 묻는다. 새 release의 변경은 그 기계가 올라올 때까지 두었다가 차례로 적용하고, 옛 release에서 한 변경은 그 기계가 올라온 뒤의 snapshot으로 온다.
- 재료: `reports/multi-machine/program.md`(경계, 정책 9~12), `project-docs/products/roadmap/multi-machine.md`, `reports/multi-machine/code-survey.md`(D, E, A, 끝의 표), `project-docs/plan/machine-identity/README.md`, `project-docs/plan/app-folder-sync/README.md`, `project-docs/architecture/{app-sync,activation,remote}.md`, `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 13·14절과 같은 폴더 `t3code.md` §10.3, `open-code.md` §3.2, `herdr.md` §10.3·§10.8, `codex.md` §12.
- 범위 밖: updater와 packaging, lophn 내리기, 폴더로 옮기기와 file 꼴(`app-folder-sync`), 폰의 release 바뀜(있다), 설정·agent 정의·skill 맞추기, desktop이 다른 기계를 보는 화면(`desktop-remote`. 이 계획은 연결 오류의 꼴만 정한다), 모든 기계를 올리는 단추.

## 정한 것

- lophn 판은 범위로 본다: 보는 쪽 연결은 hello의 `version`·`min_version`, 폴더는 꼴 판 `[FOLDER_FORMAT_MIN, FOLDER_FORMAT]`. 제품 판 글은 보이기만 한다: 같은 build를 요구하면 한 기계를 올릴 때 나머지가 멈춘다(OpenCode) (사람·planner, 정책 11).
- 범위 안에서는 모르는 칸을 버리고 계속 주고받고, 꼴 판은 옛 판이 읽으면 틀리는 바꿈에만 올린다: 칸 하나 더할 때마다 모든 기계가 멈추면 안 된다 (planner, 조사 13.2).
- 범위 밖이면 그 기계의 data file을 열지도 복사하지도 지우지도 않고 cursor도 그대로다. 올려야 하는 기계는 "Update lophn on this computer", 다른 기계는 "<이름> runs an older lophn"을 보인다: 고칠 수 있는 곳에서 고칠 것을 말한다 (planner).
- 다른 기계의 판은 폴더의 기계 기록(`lophn.version`, `lophn.folder`)으로, 보는 쪽은 hello로 안다 (planner, program 경계).
- 판이 범위 밖이어도 core는 자기 hello를 보낸 뒤 닫는다: 그래야 붙는 쪽이 어느 쪽이 낡았는지 안다 (planner).
- 새 판이 쓴 data root를 옛 판이 열지 않는 규칙은 있다: 모르는 schema·data step id가 있으면 기동을 거절하고 desktop이 "This data is from a newer lophn"과 "Update lophn to the newer version, then start it again."을 보인다. 폴더에는 ledger가 없어 더 짓지 않는다 (planner, 코드).
- 새 release는 그 앱을 들인 기계에서 스스로 따라가고, 판정은 지금 activation 그대로다(늘어난 바깥 자원·다른 앱 tool·`-- loss:`면 그 기계의 사람에게 묻는다). 들이지 않은 기계는 아무것도 하지 않는다 (사람·planner, 정책 9).
- "더 새 release"는 git 조상으로 정한다: commit이 지금 활성 commit의 자손이고 data schema가 낮지 않을 때만, 여럿이면 나머지 모두의 자손 하나로 바로 간다. 갈라졌으면 따라가지 않고 "diverged"를 보인다: 번호·시각으로 고르면 갈라진 code를 오간다 (planner).
- 이 기계가 활성했다가 내려놓은 release(사람의 이전으로 돌아가기 포함)와 실패한 release는 다시 따라가지 않는다. 옛 기계의 release로 내려가지 않는다 (planner).
- 설치나 활성이 실패하면 지금 release에 남고 이유를 보인다. 받은 release가 이 lophn에 없는 SDK 판을 쓰면 "Update lophn on this computer"다. 설치 실패와 사람이 거절한 동의는 core가 다시 뜨거나 다른 release가 오면 다시 한다: 기억을 ledger에 두면 schema step이 든다 (planner).
- 따라간 activation에는 session이 없다. 결과는 activation 기록(앱 notice)과 이 계획의 상태로 보이고 `activation.report`는 가지 않는다 (planner, 코드).
- held(다른 release의 변경, `app-folder-sync`가 data root에 복사해 둔 것)는 이 기계가 그 release가 되면 출처마다 번호 순서로 적용하고, 그 출처의 stream은 held를 다 적용한 뒤에 잇는다: cursor가 held 뒤에 있어 먼저 읽으면 순서가 뒤집힌다 (사람·planner, 정책 10).
- 출처 X의 snapshot m이 합쳐지거나 held가 되면 X의 그보다 옛 held는 지운다. 그 밖에는 held를 지우지 않는다: snapshot m은 m보다 앞의 변경을 다 담는다(그 계획의 계약 2) (planner).
- 옛 release에서 한 변경은 그 기계가 올라온 뒤 내는 첫 file(snapshot, 그 계획의 규칙)을 clock으로 합칠 때 온다. 그래서 따로 다시 표현하지 않는다. 폰의 길(backup, 허브 snapshot 받기, outbox를 칸 이름으로 다시 표현, 첫 push까지 backup 두기)은 폰이 자기 DB를 허브의 snapshot으로 바꾸기 때문에 있다. 컴퓨터는 자기 DB를 migration하고 덮지 않는 합치기를 받으니 쓰지 않는다 (planner, 코드).
- 그 합치기가 옛 칸 고침을 지키도록 migration 뒤 칸 clock을 지우지 않고 칸 이름으로 옮긴다(이름이 없어진 칸만 지운다): 지금은 칸 목록이 바뀐 표의 칸 clock을 지워, 늦게 올라온 기계의 칸 고침이 먼저 올라간 기계에서 진다 (planner, 코드).
- 한도: 출처 하나·앱 하나에서 가장 새 held snapshot 뒤 held 변경이 128 MiB를 넘으면 더 복사하지 않고 폴더에 둔다. 이 기계가 그 release에 오면 그 cursor부터 읽고, 주인이 그 사이 compaction했으면 지금 규칙대로 뒤의 snapshot으로 따라온다. 128 MiB는 한 release의 changeset 합 한도(`RELEASE_CHANGESET_MAX_BYTES`)다 (planner).
- 기다리는 동안 앱은 이 기계의 data로 그대로 돈다. App details의 "Machines" section이 기계마다 release, 기다리는 것과 이유, 범위 밖 lophn을 보인다 (사람·planner, 정책 10).
- 모든 기계를 올리는 단추는 없고 updater를 짓지 않는다 (사람, 정책 12).
- 앱 agent 지침과 SDK는 바뀌지 않는다(sdk-note 없음). ledger schema step도 없다 (planner).
- worker는 `sonnet-high`, `update-held`와 `update-follow`는 opus high다(brief 머리에 적었다) (planner).

## 기대는 계약

- machine-identity(그 README 계약 2·1): hello 두 꼴(`version`, `min_version`, `capabilities`, core의 `machine`), 범위 밖이면 `conflict`, `connectRemote`·`acceptRemote`, `ctx.machine`.
- app-folder-sync(그 README "다른 계획이 기대는 계약"): 1 배치(`machines/<mch>/apps/<app>/data|releases|source`), 2 file 꼴(1행 판 `lophn-folder 1`, header의 `release.bundle_hash`·`data_schema`, cursor, snapshot m은 m 앞을 다 담는다, 주인의 release가 바뀐 뒤의 첫 file은 snapshot), 3 앱 기록(`active_release`)과 release 기록(`code_commit`, `data_schema`), 4 held(`folder_held`, `<root>/folder-held/…`, `machine-update`가 `FolderApply`로 (origin, n) 순서로 적용하고 지운다), 6 기계 기록 `lophn: { version, protocol }`, 7 `machine/environment`와 오류 code `newer_format`. "정한 것"의 release 신분 = bundle hash, 받는 기계는 봉인 bundle을 그대로 받는다, SDK 판이 없으면 `conflict`, source는 `refs/remotes/<mch>/*`. `folder-apps`의 `takeIn({app, from?, release?})`(같은 앱 id, 봉인 bundle을 prepared로, 이미 같은 bundle의 release가 있으면 그것을 돌려줌, `invalid_input`은 release 폴더가 아직 다 오지 않음).

## 계약 바꾸기 요청(planner가 정한다)

1. machine-identity(`machine-hello`가 todo라 그 brief에 넣는 것이 가장 싸다): 판이 범위 밖일 때 responder도 자기 hello를 보낸 뒤 닫는다. `conflict`의 `details`는 `{ update: "this" | "peer", peer_version, peer_min_version }`. 넣지 않으면 `update-viewer`가 한다.
2. app-folder-sync(`folder-contract`): 기계 기록 `lophn`에 `folder: { version, min_version }`(쓰는 꼴 판, 읽는 하한). 기록과 header는 모르는 칸을 버리고 읽는다(지금 brief는 거절하고 `format`을 올린다). 꼴 판은 옛 판이 틀리게 읽는 바꿈에만 올린다. 넣지 않으면 `update-held`가 한다.
3. app-folder-sync(`folder-apps`): `takeIn({app, from, release})`가 이미 들인 앱에서는 앱 행을 건드리지 않고 그 release만 `prepared`로 설치한다는 것을 계약에 적고, `conflict`의 까닭(SDK 판, slug, `@me` 의존)을 `details.reason`으로 가른다. 따라가기가 같은 함수를 부른다.

## 다른 계획이 기대는 계약

- 연결 오류: 판 범위 밖이면 `connectRemote`가 `conflict`에 `details: { update: "this" | "peer", peer_version, peer_min_version }`. `desktop-remote`도 같은 뜻으로 보인다("Update this app" / "Update lophn on <이름>").
- `machine/environment`(app-folder-sync의 agent 읽기 도구)에 넘길 칸(planner가 넘긴다. 이 계획은 그 도구를 고치지 않는다):
  - `machines[]`: `folder: { version, min_version } | null`, `exchange: "ok" | "update_this" | "update_peer"`.
  - `apps[]`: `follow: { state: "current" | "installing" | "activating" | "waiting_consent" | "declined" | "lophn_update" | "install_failed" | "activation_failed" | "diverged", release: bundle_hash | null, reason: string | null }`, `held_detail: [{ machine, bundle_hash, data_schema, changes, bytes, full, why: "newer_release" | "older_release" }]`, `machines: [{ machine, release: { bundle_hash, code_commit, data_schema } | null }]`.
  - 같은 값을 `apps/update_state`(`update-status`)가 낸다.

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `update-held` | (opus high) 폴더 꼴 판 범위 문, held를 release가 바뀐 뒤 순서대로 적용하고 그 동안 stream 멈춤, snapshot이 덮은 held 지우기, 한도, 칸 clock을 이름으로 옮기기. 위험 test |
| 1 | `update-follow` | (opus high) 새 release 따라가기: git 조상 순서, 봉인 bundle 설치와 activation, 동의, lophn을 올리라는 상태, 실패, 내려가지 않음. 위험 test |
| 1 | `update-viewer` | 판 범위 밖 연결: core도 hello를 보내고 닫기, `details.update`, 폰의 "Update this app"·"Update lophn on <이름>" |
| 2 | `update-status` | `apps/update_state` read, App details "Machines" section, gallery 상태 |

## lead가 할 일

- 돌리기 전에: `app-folder-sync` land를 기다리고 위 "기대는 계약"을 실제 code와 대조한다(이름, path, `FolderApply`, take-in 설치 함수). 계약 바꾸기 요청 가운데 다른 계획이 이미 한 것은 brief에서 뺀다. `desktop-remote`가 연결 code를 옮겼으면 `update-viewer`의 소유 path를 맞춘다.
- 돌리기 전에: `packages/design/i18n/catalog/machine-update.ts`를 빈 catalog로 만들어 `packages/design/i18n/en.ts`에 올린다. task는 key만 더한다.
- 공유 줄(보고의 "넘길 줄"대로 합친다): 폴더와 apps wiring(`update-held`, `update-follow`, `update-status`가 한 줄씩), `packages/protocol/apps/{mod,registry}.ts`·`packages/core/apps/register.ts`·`packages/shell/main/desktop/core/allowlist.ts`(`update-status`), `project-docs/flows/`(task마다 자기 줄).
- merge 때마다 `npm run check`. `update-viewer` 뒤 `cd packages/mobile && npm ci && npm run typecheck && npm test`.
- 다 merge된 뒤 끝에서 끝 확인(사람의 `~/.lophn`, 실제 model provider, 바깥 도구를 쓰지 않는다): 개발 core 둘을 새 data root `LOPHN_HOME=$PWD/.dev-data/mu-a`·`.dev-data/mu-b`(복사하지 않는다)와 다른 port로 띄우고 같은 폴더 `.dev-data/mu-folder`를 두 기계의 `folder.destinations`에 같은 이름으로 둔다. `tests/support/app/activate.ts`의 길로 `sync_to`가 있는 sync 앱을 A에서 r1로 활성하고 B에 들여 활성한다. (a) 둘 다 r1에서 쓰면 서로 맞는다. (b) B의 `folder.destinations` path를 잠시 빈 폴더로 바꿔 두고, A에서 칸 하나를 더한 r2(migration)를 활성해 쓰고, B에서는 r1으로 같은 row의 다른 칸을 고친다. B의 path를 되돌리면 B가 r2를 스스로 활성하고, A의 r2 변경이 held에서 차례로 들어오고, B가 r1에서 고친 칸이 A에 남는다. 두 DB의 data dump가 같다(빈 폴더에 쓴 B의 file 번호는 진짜 폴더에 없으니, B가 r2로 바뀐 뒤 낸 첫 snapshot이 그 빈 곳을 덮는 것도 함께 본다). (c) r3이 바깥 자원을 더하면 B가 동의를 기다리고 활성하지 않으며 App details가 "Needs your OK to update"와 A의 기다리는 변경 수를 보인다. (d) A에서 사람이 r2로 돌아가도 B는 r3에 남는다. (e) 폴더의 B 기계 기록의 `lophn.folder.min_version`을 손으로 올리면 A가 "B runs …"가 아닌 "Update lophn on this computer"를 보이고 B의 file을 읽지 않으며 아무 file도 지우지 않는다(손으로 바꾼 것은 되돌린다). 그림과 숫자를 change-log에 적는다.
- 끝에(문서): `architecture/folder-sync.md`(그 계획이 쓴다)에 release가 다를 때(held drain 순서, snapshot이 덮은 held, 한도, 꼴 판 범위와 모르는 칸), `app-sync.md`(칸 clock은 migration 뒤 이름으로 옮긴다), `activation.md`(따라가는 activation: session 없음, 같은 동의 판정, 실패와 거절을 다시 하지 않음, 내려가지 않음), `remote.md`(범위 밖의 hello와 `details.update`), `boundary-catalog.yaml`·`module-catalog.yaml`(`core/apps/follow`, `core/apps/update-state`), `project-docs/flows/`(`flows` skill로 마지막 대조), roadmap `multi-machine.md`("두 기계가 같은 앱의 다른 release를 돌릴 때"를 정한 것으로), change-log `0.<x>/machine-update.yaml`(갈라진 release는 앱 agent가 합쳐 새 release를 내야 풀린다, 범위 밖 기계는 사람이 그 기계에서 올린다, 영영 올라오지 않는 기계의 옛 변경은 그 기계의 폴더와 다른 기계의 held에만 남는다).
