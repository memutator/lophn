# trust-view-error-signing

앱 화면 오류 보고의 서명(core가 앱 연결마다 서명하고 서명이 맞는 보고만 받는 장치)을 지운다. 어느 앱 화면인지는 shell main이 sender view로 이미 정한다.

- 단위: trust (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/runtime/{signing,mod}.ts`
  - `packages/core/apps/control.ts`
  - `packages/core/problems/reporting/view-binding.ts`
  - `packages/core/problems/reporting/worker/collector.ts`
  - `packages/protocol/apps/channel.ts`
  - `packages/protocol/problems/reports.ts`
  - `packages/shell/main/app-frame/{view-error,app-ipc,app-call,app-connection,app-protocol,view-model,registry,view-ipc}.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/code-health.md`의 "사용자 앱을 공격자로 보는 장치와 문장"(둘째 bullet과 "정한 것": 서명을 지우고 이유 문장을 고친다. 실수와 인터넷을 막는 코드는 남긴다)
  - architecture: `project-docs/architecture/annotation.md`("지키는 것" 첫 줄의 신원 이유), `project-docs/architecture/app-call.md`(고치는 것은 lead다)
- 계약:
  - 쓰는 것: `protocol/problems/reports.ts`의 `observeViewErrorInputSchema`, `observeViewError`(worker route `problems/observe-view-error`, actors `user`).
  - 내놓는 것(protocol 모양이 바뀐다):
    - `observeViewErrorInputSchema.view`에서 `binding`이 사라진다. `view`는 `view_session, generation, app, release, mode, bundle_hash`(이미 있던 칸)이고 shell main이 sender view에서 정한 값이다.
    - `protocol/apps/channel.ts`에서 `SignedConnection`, `signedConnectionSchema`, `connectionSigningBytes`가 사라진다. `confirmExecutionProofSchema`, `signedConfirmProofSchema`, `invocationCallerSchema`는 `invocations.ts`가 쓰니 남긴다.
  - 쓰는 쪽 전부를 이 task에서 같이 고친다: shell main `app-frame/view-error.ts`(보내는 쪽), core `problems/reporting/view-binding.ts`(받는 쪽 검증, file째 지운다), `problems/reporting/worker/collector.ts`(주석), core 조립 `main/daemon/wiring/problems.ts`·`apps.ts`(아래 4).

## 정한 것

- 이슈는 "`binding`을 앱, 판, 모드 값으로 바꾼다"고 했지만, `view`에 `app`, `release`, `mode`, `bundle_hash`가 이미 따로 있고 collector(`observeViewErrorPayload`)는 `binding`을 읽지 않는다. 그래서 값을 하나 더 두지 않고 `binding` 칸을 **지운다.** "앱 정보는 보고 본문이 아니라 shell이 정한다"는 규칙은 `view`가 shell main이 sender view에서 채운 값이라는 주석으로 남긴다.
- 지금 shell main은 `binding: `${view_session}#${generation}``를 보내고, `view-binding.ts`는 그 값을 서명 JSON으로 읽으려다 실패해 모든 view 오류를 `not_found`로 거절한다(서명이 연결된 적이 없다). 이 task가 그 거절을 같이 없앤다.
- `signConnection`을 부르는 곳이 없었다. 서명 key(`CoreSigner`)의 쓰임은 `view-binding.ts`의 `verifyConnection`과 앱 시작 hello의 `verify_key`뿐이었고 `verify_key`를 읽는 곳이 없다. 그래서 `signing.ts` 전체와 `verifyKey`를 지운다.
- `appStartInputSchema.verify_key`(`protocol/apps/app-start.ts`)는 스키마에만 남은 죽은 칸이 된다. `process-wire.ts`가 이 칸을 구조 분해로 빼고 `apps-large-changeset`·`dead-platform`도 그 file을 소유해서 이 task에서는 열지 않는다. 보고의 "넘길 줄"에 "app-start.ts의 verify_key와 process-wire.ts의 구조 분해를 lead가 지운다"를 적는다.
- `core/main/daemon/wiring/{problems,apps}.ts`는 소유에 적지 않았다(lead의 조립 목록, 다른 task와 file이 겹친다). 지운 것을 가리키던 줄만 뺀다(리뷰 예외).

## 할 일

1. 서명 지우기 (core)
   - `core/apps/runtime/signing.ts` file을 지운다. `core/apps/runtime/mod.ts`에서 `CoreSigner`, `createCoreSigner` export를 뺀다.
   - `core/apps/control.ts`: `createCoreSigner`/`CoreSigner` import, `AppsControl.verifyKey`/`signer`와 그 주석, `createAppsControl`의 `const signer = await createCoreSigner()`, 반환의 `verifyKey: signer.verifyKey, signer,`를 뺀다. 다른 곳이 이 값들을 쓰면(`grep -rn "verifyKey\|appsControl.signer" packages`) 그 줄도 같이 뺀다.
   - `core/problems/reporting/view-binding.ts` file을 지운다.
   - `core/main/daemon/wiring/problems.ts`(소유 밖, 줄만): `withViewBinding` import를 빼고 `workers: new Map(withViewBinding(collectorWorkers({...}), {signer, nowMs}))`를 `workers: new Map(collectorWorkers({...}))`로 바꾼다.
   - `core/main/daemon/wiring/apps.ts`(소유 밖, 줄만): 앱 시작 hello의 `scope.targets`에서 `verify_key: appsControl.verifyKey`를 빼고(`targets: { task: "apps" }`), 위의 "서명 검증 공개 key는 secret이 아니다" 주석을 지운다.
2. 서명 지우기 (protocol)
   - `protocol/apps/channel.ts`: `signedConnectionSchema`, `SignedConnection`, `connectionSigningBytes`를 지운다. 그 결과 안 쓰게 되는 것(`appConnectionSchema`, `AppConnection`, `connectionFields`, `connectionShape`, `screenSizesSchema`, `canonicalize` import, `callOriginSchema`·`appCallOriginSchema`·`agentCallOriginSchema`, 쓰지 않는 값 import)을 이 file 안에서만 확인해 지운다. 다른 file이 import하는 이름(`grep -rn "from .*channel.ts\|protocol/apps/mod.ts"`로 쓰임을 확인)은 지우지 않는다. `invocationCallerSchema`, `confirmExecutionProofSchema`, `signedConfirmProofSchema`와 `signatureSchema`는 남는다.
3. view 오류의 `binding` 지우기
   - `protocol/problems/reports.ts`: `observeViewErrorInputSchema.view.binding`을 지우고 위 주석을 "shell main이 sender view에서 정한 앱·release·mode 값이다(페이지는 자기가 어느 앱인지 모른다)"로 고친다.
   - `shell/main/app-frame/view-error.ts`: `ViewErrorOrigin.binding`과 `observe`의 `binding: ...` 줄을 지운다. `ViewErrorOrigin` 주석("binding은 view 식별이다...")을 고친다. 머리 주석의 "페이지가 주장한 앱·release는 받을 자리가 없고"는 "페이지는 자기가 어느 앱인지 모르고, 앱·release·mode는 main이 정한다"로.
   - `core/problems/reporting/worker/collector.ts`: `observeViewErrorPayload` 위 주석(888줄 근처)을 "view의 app·release·mode·bundle_hash는 shell main이 sender view에서 정해 보낸 값이다"로 고친다.
4. app-frame 이유 문장 (근거: issue "문장을 고친다")
   - `app-ipc.ts`(머리), `app-call.ts`(머리), `app-connection.ts`(머리), `app-protocol.ts`(머리와 19줄 근처 "페이지 주장이 아니라 registry가 정한다" 주석), `view-model.ts`(`BoundView` 주석), `registry.ts`(머리), `view-ipc.ts`(머리)의 "페이지 주장은 쓰지 않는다/받을 자리가 없다/신원은 sender에서만" 문장을 "페이지는 자기가 어느 앱인지 모른다. 신원은 sender view에서 main이 정한다" 식으로 짧게 고친다. 이유를 "page가 다른 앱인 척하지 못하게"로 적은 곳만 고치고 사실을 적은 문장은 그대로 둔다.
   - 코드는 건드리지 않는다: sender view 신원과 main frame 검사(`app-ipc.ts`의 `isMainFrame`, registry의 sender view 조회)는 인터넷으로 이동했거나 iframe에 든 내용을 막는 것이라 남는다.
   - `app-frame/annotate.ts`의 머리 주석은 annotation-target이 고친다(손대지 않는다).
5. architecture 문서는 lead가 고친다.

## 끝남

- `deno task check`가 통과한다(core type check가 무겁다. 끝내기 전에 `deno task check:full`을 한 번 돌린다).
- 위험 test: 없음. 지우는 일이고 shell main의 기존 test(`packages/shell/main`, 특히 `app-frame/app-call_test.ts`)는 그대로 통과해야 한다.
- 남지 않음: `grep -rnE "signConnection|verifyConnection|SignedConnection|signedConnectionSchema|connectionSigningBytes|createCoreSigner|CoreSigner|verifyKey|withViewBinding|view-binding" packages tools`가 0줄이다.
- `grep -n "verify_key" packages/core/main/daemon/wiring/apps.ts`가 0줄이다(`app-start.ts`의 칸은 남는다).
- core를 띄워 확인한다면 `LOPHN_HOME=$PWD/.dev-data/trust-view-error-signing`로 띄운다(앱 시작 hello가 바뀌었으니 기동 확인은 `lead/boot.sh`가 한다).

## 보고

기본 보고 꼴(brief-template)을 따른다. 보고에 "안 쓰게 된 export"로 channel.ts에서 남은 이름과 `signedConfirmProofSchema`가 아직 쓰이는지(서명하는 쪽이 없다)를 적는다.
