# mobile-spike

`mobile/`에 Expo project를 세우고, 뒤 task가 기대는 위험 넷을 Android emulator에서 확인한다.

- 단위: mobile (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `mobile/`(새 폴더)
  - `reports/mobile-spike.md`(새 file)
  - `.gitignore`
- 읽을 것:
  - 계획 README "정한 것", "돌리기 전에"
  - `packages/protocol/remote/{client,channel,noise,frames}.ts`, `tools/remote-client.ts`
  - `../harness-lab/_report/remote-control/orca.md` §14.1, §14.8
- 계약:
  - 쓰는 것: `@lophn/protocol/remote/client`(계획 `phone-remote-web`의 `remote-bytes`가 낸다. 아직 없으면 `channel.ts`를 직접 읽는다)
  - 내놓는 것: 돌아가는 `mobile/` project, type 검사와 test 명령, 보고서의 판정

## 할 일

1. `mobile/`에 Expo SDK 58 project를 만든다(TypeScript, dev build, `expo-dev-client`). 의존성 판을 정확히 고정한다. Android로 빌드해 emulator에 띄운다.
2. 확인 넷, 각각 emulator에서 돌린 결과를 보고서에 적는다:
   - Metro가 `packages/protocol/remote`의 TypeScript source(`./noise.ts` 같은 확장자 붙은 import, `@noble/*`의 subpath)를 읽는가. 안 되면 가장 작은 resolver 설정.
   - Hermes에서 handshake와 frame이 도는가: `TextDecoder`의 `fatal`, `zod`, `btoa`/`atob`, `expo-crypto`의 무작위. 이 machine의 core(`remote.enabled`)에 emulator에서 `ws://`로 붙어 `tools/remote-client.ts`와 같은 pairing과 `call` 하나를 한다. cleartext 설정에 필요한 것.
   - WebView: `shouldInterceptRequest`로 custom scheme `lophn-app://`의 page가 ES module script, CSS, font를 읽는가. 안 되면 https 가짜 host로 되는가. 다른 요청을 모두 막을 수 있는가.
   - bridge: page와 native 사이 message가 양쪽으로 가는가(document 시작 때 넣은 object).
3. iOS에서 달라질 것(`WKURLSchemeHandler`, ATS와 local network 허락, 요청 막기의 한계)을 문서로 조사해 보고서에 적는다. 빌드하지 않는다.
4. `mobile/`의 type 검사와 test 명령을 정하고 `mobile/README.md`에 적는다(띄우는 법 포함).
5. 정한 자리(root workspace 밖의 `mobile/`)로 안 되는 것이 있으면 고치지 말고 보고하고 멈춘다.

## 끝남

- emulator에서 앱이 뜨고 확인 넷의 결과가 보고서에 있다.
- 위험 test: 없음
- `npm run check`가 그대로 통과한다(`mobile/`이 섞이지 않는다).

## 보고

보고서의 path, 확인 넷의 판정, 고른 origin(custom scheme인가 https 가짜 host인가), 뒤 task가 알아야 할 설정.
