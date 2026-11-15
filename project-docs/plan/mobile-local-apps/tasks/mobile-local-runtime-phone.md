# mobile-local-runtime-phone

**opus high.** 폰에서 도는 앱의 backend를 그 앱 화면의 guest runtime 안에서 돌린다: guest가 `base|backend|screen`을 싣고, base의 prelude가 backend에 host(handler port, `CAP_HOST`, 앱 DB driver, random)를 깔고, 화면의 `lophnApp.callOperation`이 operation의 effect로 갈린다. read와 write는 늘 guest 안에서(컴퓨터가 닿아도) 호출 하나가 transaction 하나로 돌고 그 변경이 같은 transaction에서 outbox에 남는다. external은 지금처럼 host로 간다. host 쪽 sync(clock 찍기, push, pull)는 `mobile-local-sync-phone`이 이 위에 짓는다.

- 단위: phone-host (wave 5)
- 선행: mobile-local-db-native, mobile-local-build, mobile-local-sdk. **중간 land 뒤**(단계 6의 guest runtime이 main에 있어야 한다)
- 소유(이 task만 고친다):
  - `packages/mobile/guest`(base의 backend prelude, 셋을 싣는 build, fixture와 lab)
  - `packages/mobile/src/apps/guest`
  - `packages/mobile/patches`(sandbox 로더가 script 셋을 싣게 해야 할 때만)
  - `packages/protocol/apps/{phone-screen,phone-screen_test}.ts`
  - `packages/protocol/apps/phone-backend-host.ts`(폰에서 쓰며 고칠 것이 있을 때만)
- 읽을 것:
  - spike 판정: `/home/pyosechang/projects/lophn/reports/mobile-program/local-apps-spike.md`의 "Check 1"(prelude, 시작 시간), "Sandbox and harness pitfalls"
  - spike code(읽기만): `/home/pyosechang/projects/lophn-worktrees/spike-local-apps/mobile/guest/local/{base-local.ts,screen-local.tsx,build-base.sh}`, `mobile/src/spike/local-screen.tsx`
  - 단계 6 guest: `packages/mobile/src/apps/guest/mod.ts`(`GuestScreen`, 메시지 처리, 상태), `packages/mobile/guest/base.ts`(`globalThis.require`, `lophnApp`, `__lophnMount`), `packages/mobile/patches/`(sandbox 로더 `A|B`), `packages/mobile/README.md`의 guest 절
  - 계약: `packages/protocol/apps/phone-screen.ts`(`PHONE_BASE_FORMAT`, 메시지 schema, `PhoneLophnApp`), `packages/protocol/apps/phone-backend-host.ts`(`installPhoneBackendHost`), `packages/protocol/apps/phone-backend.ts`(manifest의 `operations`, `data_schema`)
  - native: `packages/mobile/modules/lophn-app-db/index.ts`(guest의 `install()`, `beginCall`/`endCall`/`abortCall`, `randomBytes`, `GuestScreen`의 `appDb` prop)
  - SDK 폰 entry: `packages/sdk/cap-store`, `packages/sdk/cap-tool`(`mobile-local-sdk`. `CAP_HOST.store.open`·`migrations`, 한 번에 하나짜리 port)
  - 계획 `README.md` "정한 것"(read·write는 늘 local, outbox와 한 transaction)
- 계약:
  - 쓰는 것: 위 native API와 prelude, SDK의 전역 symbol. `GuestScreen`의 단계 6 props와 상태는 그대로 두고 더한다
  - 내놓는 것:
    - `phone-screen.ts`: `PHONE_BASE_FORMAT = 2`. host→guest `init`에 `local: {operations: {[name]: "read" | "write" | "external"}, data_schema: integer} | null`(폰에서 도는 앱이면 값, 아니면 null). guest→host `{type: "local_change"}`(local 호출이 변경을 commit했다. 내용은 싣지 않는다: 변경은 outbox에 있다)
    - `GuestScreen`의 새 props: `backendFile?: string`(내려받아 hash를 확인한 `backend.js`의 path), `local?: {operations, data_schema}`, `onLocalChange?(): void`. `appDb`(`mobile-local-db-native`)와 같이 준다. `backendFile`이 있으면 guest는 `base|backend|screen`을 싣는다
    - guest 안 `lophnApp.callOperation(name, input)`: `local`이 있고 effect가 read나 write면 guest 안에서 돌린다. external과 `local`이 없는 앱은 지금처럼 host로 `call`을 보낸다. 실패는 지금처럼 `"<code>: <message>"` Error로 reject한다(`HandlerRejection`은 그 code, 그 밖의 throw는 `internal`)

## 할 일

1. 계약(`phone-screen.ts`와 test): 위 셋. 옛 base 1로 지은 화면 manifest는 base 2인 폰에서 그대로 돈다(`phoneCanRun`의 비교가 그렇게 되는지 test 한 줄).
2. base prelude(`packages/mobile/guest/`): backend가 평가되기 전에 `install()`로 guest DB handle을 받아 closure에 쥐고(전역에 남기지 않는다), `installPhoneBackendHost`를 깐다(`open`은 handle을 `StoreDb` 꼴로 감싼 것, `migrations`는 `init.local.data_schema`를 target으로, steps 없음: 폰 host가 mount 전에 이미 migrate했다. `randomBytes`는 native). backend 평가 중 예외는 지금 `__lophnFatal`처럼 `fatal`로 보낸다.
3. local 호출: 한 번에 하나씩(줄을 선다). `beginCall()` → handler(`run(name, input, context)`. context에 operation 이름과 시작 시각) → 성공이든 throw든 `endCall({id: <새 ULID>, operation, started_at})` → 변경이 있었으면 `local_change`를 보낸다. `endCall`이 실패하면 `abortCall()`하고 `internal`로 reject. read도 같은 길이다(read가 쓴 변경도 outbox에 가고, 한 줄 log를 남긴다). handler 안의 `await`는 local 일뿐이다(network·broker는 `unavailable`로 바로 끝난다).
4. 싣기: sandbox 로더가 script 셋을 싣게 patch를 늘리거나, host가 `backend.js`와 화면 `phone.js`를 이어 한 file로 cache에 두고 지금 `A|B` 로더를 쓴다. 쉬운 쪽을 고르고 보고한다(hash 확인은 이어 붙이기 전의 두 file에 한다).
5. `GuestScreen`: 위 props, `init`에 `local`, `local_change`를 받으면 `onLocalChange`. 순수 logic(callOperation의 갈림, 줄, endCall/abortCall 순서, 메시지 검사)은 React Native를 import하지 않는 file로 나눠 `node --test`로 test한다(가짜 DB handle).
6. Android 확인(아래 규칙): lab fixture로 싣는다: backend는 `tests/support/app/local`(`mobile-local-build`의 fixture)을 `buildPhoneBackend`로, 화면은 `packages/mobile/guest/fixtures/`에 둘 fixture 폰 화면(그 backend의 operation 셋을 부른다)을 단계 6의 폰 화면 build로 만든다. **debug와 release 둘 다**: (a) handler가 다 등록되고 local write·read 왕복이 되고 outbox에 줄이 생기고 host가 `local_change`를 받는다, (b) external은 host `call`로 간다, (c) `HandlerRejection`의 code가 화면에 온다, (d) backend의 `fetch`·cap-net·broker 길은 `unavailable`이다, (e) backend 평가 중 throw는 `failed`(`fatal`) 상태로 끝나고 폰 앱이 산다, (f) 손가락으로 화면의 단추를 눌러 write가 된다(release). 숫자: release build의 mount→첫 local 호출 ms(spike: 55~139 ms), guest PSS.

## Android 확인 규칙

- emulator는 AVD `lophn-phone`을 `-read-only -memory 2048 -port 5624`로 띄우고 모든 adb 명령에 `-s emulator-5624`를 붙인다. 끝나면 `adb -s emulator-5624 emu kill`로 끈다. Metro는 port 8264다.
- gradle은 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process "-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1536m" --max-workers=3 -PreactNativeArchitectures=x86_64`. daemon을 남기지 않는다. native module을 더하지 않으면 lead가 지어 둔 dev build `/tmp/lophn-mobile-local-apps-x86_64.apk`를 쓴다.
- 사람의 실제 폰(adb serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다. `pkill`·`killall`과 `ps`로 process를 찾아 죽이는 일을 하지 않는다. 띄운 process는 직접 끈다.
- core, relay, 실제 model provider, 사람의 `~/.lophn`을 쓰지 않는다(lab만으로 확인한다).
- 그림은 `.dev-data/mobile-local-runtime-phone/shots/`에 둔다.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check`가 통과한다.
- 위험 test:
  - "local 호출 하나는 transaction 하나다: write와 그 outbox 줄은 같이 commit되고, 던진 handler가 바꾼 것도 outbox에 같이 남고, `endCall`이 실패하면 아무것도 남지 않는다. read와 write는 host로 가지 않고 external만 간다"(node test, 가짜 DB handle)
  - 6번의 (a)~(f)를 release build에서(emulator 확인. 결과를 보고에 적는다)
- 남지 않음: 없음(더하기. 폰에서 도는 앱이 아닌 화면의 길은 그대로다).
- flows catalog: 이 task가 바꾼 guest 메시지와 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 6번 표(debug와 release), 숫자, 셋을 싣는 길로 고른 것과 이유, `mobile-local-sync-phone`이 `GuestScreen`을 쓰는 법(props, `onLocalChange`, external이 host로 오는 모양).
