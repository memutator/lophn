# bs-app-import-map

앱 템플릿의 `check`·`test`·`wording` task가 돌기 전에 앱 폴더의 `deno.json`에서 개발용 import map(`.lophn/import-map.json`)을 다시 쓰게 해서, App Engineer가 `deno.json`에 더한 `npm:`·`jsr:` 의존이 앱 폴더의 `deno task check`·`test`에서 풀리게 한다.

- 단위: apps (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/packages/template/app/deno.json.tmpl`
  - `packages/core/apps/packages/template/app/scripts/refresh-import-map.ts.tmpl`
  - `packages/core/apps/packages/template/app/AGENTS.md.tmpl`
- 읽을 것:
  - architecture: `project-docs/architecture/activation.md`(release 준비가 staging에서 map을 새로 만드는 부분), 앱 템플릿 지침 `packages/core/apps/packages/template/app/AGENTS.md.tmpl`
  - 이슈: `project-docs/issues/activation.md` 둘째 항목("지금", "고치려면"의 추천안)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/apps`(boundary `apps`)
  - 본보기: `packages/core/apps/packages/template/import-map.ts`의 `devImportMap`(map을 만드는 규칙), `scaffold.ts`(map을 `.lophn/import-map.json`에 쓰는 자리), 같은 폴더 `scripts/generate-wording.ts.tmpl`(template script의 모양)
- 계약:
  - 쓰는 것: 앱 폴더의 `deno.json`(`imports`)과 기존 `.lophn/import-map.json`(설치 SDK 위치를 담고 있다).
  - 내놓는 것: 같은 이름과 같은 모양(`{ "imports": { ... } }`)의 map. release 준비(`packages/core/apps/releases/prepare/from-source.ts`)는 staging에서 map을 따로 만들므로 건드리지 않는다.

이슈와 코드가 어긋난 곳: 없다. `deno.json.tmpl`의 `check`·`test`·`wording` task가 `--import-map=.lophn/import-map.json`을 쓰고, `scaffoldApp`이 map을 쓰는 곳은 `app.create`의 source 폴더 깔기(`registration/source-folder.ts`)와 eval 되살리기(`tests/eval/restore/active-app.ts`) 둘이다. `build` task는 map 플래그가 없다(이 task의 범위 밖).

## 할 일

1. **script를 더한다 (`scripts/refresh-import-map.ts.tmpl`).** import가 없는 작은 Deno script다(앱의 map이 아직 없을 때도 돌아야 한다). 하는 일:
   - `deno.json`의 `imports`를 읽는다. 앱 폴더는 script 위치(`new URL("../", import.meta.url)`)로 정한다.
   - 값마다: `lophn-sdk:` 값은 지금 `.lophn/import-map.json`의 같은 key 값을 쓴다. 그 key가 map에 없으면 map의 다른 `lophn-sdk:` 항목에서 설치 위치(`.../sdk/`까지)를 떼어 `devImportMap`과 같은 규칙(`lophn-sdk:@lophn/<이름>@<version>/<경로>` → `<설치 위치>/<이름>/<version>/<경로>`)으로 만든다. 그것도 안 되면 그 key 이름을 말하며 실패한다. `./`·`../`로 시작하는 값은 앱 폴더 기준 file URL로 바꾼다. 나머지(`npm:`, `jsr:` 등)는 그대로 둔다.
   - `.lophn/import-map.json`을 `JSON.stringify({ imports }, null, 2) + "\n"`으로 쓴다(`scaffold.ts`와 같은 모양). 바뀐 것이 없으면 다시 쓰지 않아도 된다.
2. **task에 건다 (`deno.json.tmpl`).** `check`·`test`·`wording` 셋 앞에 `deno run --no-config --allow-read --allow-write=.lophn scripts/refresh-import-map.ts &&`를 붙인다. `--no-config`는 `lophn-sdk:` 값이 든 앱 `deno.json`을 script 자신이 읽지 않게 하려는 것이다(release 준비의 `deno run --no-config`와 같은 이유). `check` task가 `scripts` 폴더도 type check하므로 script는 앱의 lib(`deno.ns`)로 통과해야 한다.
3. **지침 한 줄 (`AGENTS.md.tmpl`).** "명령" 절(`lophn-managed` 블록 밖)에 `check`·`test`·`wording`이 먼저 `deno.json`에서 `.lophn/import-map.json`을 다시 쓴다고 한 문장 적는다. 그래서 `deno.json`에 의존을 더하면 바로 풀린다는 뜻이다.
4. 확인(손으로, test 아님): 임시 폴더에 `scaffoldApp`(`packages/core/apps/packages/template/scaffold.ts`, `dataRoot` 임시 폴더)으로 앱을 깔고 `deno.json`의 `imports`에 `"@std/path": "jsr:@std/path@1.0.0"` 같은 줄을 더한 뒤 script만 돌려 새 map에 그 줄과 기존 `lophn-sdk` 항목이 있는지 본다(`deno task check` 전체는 네트워크가 필요할 수 있어 script만 돌려도 된다).
5. `tests/eval/registry/template/app.json`(eval 러너가 만드는 template 사본)과 `tests/eval/restore/active-app.ts`는 고치지 않는다. 새 template을 eval이 쓰려면 러너가 새 판을 등록한다. 보고에 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check, 4번 확인 결과
- 정한 것: sdk 항목이 map에 없을 때의 처리
- 넘길 줄: `tests/eval`의 template 사본 갱신 필요 여부
- 무겁게 짠 것 / 알려진 미완 동작 (없으면 "없음")
