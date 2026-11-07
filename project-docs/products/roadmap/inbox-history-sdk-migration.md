# inbox 기록과 SDK migration: 남는 알림, 판이 바뀐 앱을 lophn이 옮긴다

상태: 계획 `inbox-sdk-migration`으로 열었다(2026-11-07). 2026-11-07 사람이 방향을 냈다. 아래 "지금 코드"는 0.20.0 기준이다.
배경 문서: `project-docs/architecture/app-notice.md`, `approval.md`, `activation.md`, `event.md`, `agent-call.md`, `app-call.md`.

## 사람의 말 (원문)

2026-11-07:

> 일단 우리 migration 체계, inbox 체계에 대해서 수정하고 싶거든? 새로운 roadmap을 열자
> 지금은 모든 알림이 휘발적인데 영구적인거 휘발적인 것들 구분할 수 있었으면 좋겠어
> 왜냐하면 예전에 app release 했던 거 같은데 이러한 것들을 찾을 수 있어야해

> 그리고 migration에 대해서는 우리가 결정적으로 할 수 없는 부분들이 있어
> 지금처럼 sdk가 update 되었을 때, 우리는 migration skill을 제공해야해
> 이 앱에서 쓰는 sdk 버젼은 뭐 쓰고 그 이후로 뭐가 바뀌었고 이러한 부분들을 점검해야하고 이렇게 바꿀 수 있다라는 걸 skill로 배포해서
> home lophn agent가 변경해야하는 부분을 찾고 실제 해당 app lophn agent에게 handoff해서 마이그레이션 시키고
> 이제 알림으로 sdk version updated needed 따위를 알리고 사람이 lophn agent 시키고 마이그레이션 할 따위들을 추천하고 핸드 오프하고 이런 것들

> 앱 알림도 영구/휘발을 고를 수있게한다

> 그리고 archived는 lophn이 볼 수도 없게끔하고 그 마이그레이션 조사 대상에서도 제외되게끔 바꾸는 게 맞는 거 같아

> migration skill 자체는 하나로 두고 내용만 md 파일로 append 하는 방식이 맞겠다

## 지금 코드 (0.20.0)

Inbox
- 사람에게 오는 것이 다섯 갈래이고 저장이 따로다. 승인·질문은 session 상태, activation 동의(`activation_consents`)·공유 요청·앱 알림(`app_notices`)은 ledger 표지만 결정하거나 지우면 행이 지워진다. turn Finished는 shell main 메모리(`packages/shell/main/notice/rule.ts`)라 재시작하면 사라진다.
- Inbox(`packages/shell/renderer/desktop/connection/waiting/waiting-panel.tsx`)에 기록 화면이 없다. 비슷한 것은 `SettledList` 하나이고 화면 메모리라 탭을 떠나면 사라진다.
- release 결과(켜짐, 실패, 되돌림)는 `releases` 표에만 있고 앱 상세 Version 탭에서만 보인다. 사람에게 가는 알림은 activation 동의 요청 toast뿐이고, `activation.report`는 release를 만든 agent session에만 간다. ledger step·data step·SDK 설치 결과는 사람에게 보이는 곳이 없다.
- core가 사람에게 알릴 길이 없다. `app_notices.post`는 actor `app`만 받는다. 알림 칸은 `app, key, title, body`뿐이고 종류·출처가 없다.
- `events` 표는 append-only로 남지만 `architecture/event.md`가 화면을 움직이는 데 쓰지 않는다고 정했고, release 결과 event는 없다.

SDK와 migration
- core가 켜질 때마다 `installSdkCopies`(`packages/core/apps/packages/install.ts`)가 지금 판의 SDK를 `<data>/sdk/<part>/<version>/`에 깐다. 옛 판은 지우지 않는다. 앱은 정확한 판을 고정하고(`package.json`, `lophn.ts`의 `sdk_dependencies`), `syncAppSdk`가 고정한 판을 앱 source로 복사한다. 그 판이 data root에 없으면 `sdk_not_installed`다.
- 고정 판과 깔린 판을 비교하는 곳이 없다. minor면 앱은 옛 판으로 돈다. lophn 쪽 계약이 바뀐 major(0.19.0 `@lophn/declaration` 3→4, `sizes`→`places`)면 옛 판으로 묶은 bundle이 뜨지 않는데, 일반 `start_failed`와 crash_loop toast로만 보인다.
- 판마다 무엇이 바뀌었고 어떻게 고치나 하는 메모가 없다. SDK guide의 "version 정책"은 일반 semver 글이고 판별 변화는 제품 changelog에만 있어 agent가 못 읽는다.
- 마지막으로 본 제품 판을 data root에 적지 않아 "lophn이 업데이트됐다"는 때를 program이 모른다.
- home lophn은 앱 source를 못 읽어 고정 판을 직접 보지 못한다. `lophn package read <name> --version`의 사용처(archived 앱과 지난 release까지 센다)로만 거꾸로 찾는다. `lophn app read`는 archived 앱도 보인다(prompt의 앱 목록은 active만이다).
- home skill은 `new-app`, `repair-app`(사람이 `/repair-app`로 부르는 진단과 handoff)이다. `architecture/event.md`는 program이 agent session을 스스로 여는 것을 지웠다.
- skill은 SKILL.md 옆의 `.md` 파일을 `skill.read {name, path}`로 읽는다(`packages/core/lophn-agent/extensions/skill-read.ts`). 하위 폴더는 읽지 않는다.
- private workspace(`mayCall`, `packages/protocol/lophn-agent/call-policy.ts`)는 agent가 보내는 call이 경계를 넘는 것만 막는다(들고 남 모두). 사람이 그 workspace를 여는 것, home lophn이 `app read|status|logs`로 읽는 것은 막지 않는다.

## 정한 것

1. Inbox는 셋이다: 답할 것(승인·질문·동의·공유·job, 지금 그대로), 알림(휘발, 지우면 끝), 기록(영구, 지우면 읽음으로만 바뀌고 남는다). (사람, 2026-11-07)
2. 기록은 ledger 표 하나다. `app_notices`를 그 표로 합치고 출처(`app`, `program`)·종류·앱·project·영구 여부·읽은 시각을 둔다. core(program)도 쓴다. 앱은 `@lophn/cap-notify`의 `notify()`에서 영구/휘발을 고른다(기본 휘발, 지금과 같다). (사람: 고르기, agent: 표 모양)
3. 남기는 기간: program이 남긴 기록은 지우지 않는다. 앱이 영구로 남긴 알림은 앱마다 최근 200개다. (사람이 추천을 받음)
4. program이 기록으로 남기는 것: release 켜짐·실패·되돌림, 앱 멈춤(start_failed·crash_loop), 앱 data migration 적용·복원, lophn 업데이트, SDK 업데이트 필요. 기록 화면은 앱·project·종류로 거르고 찾는다. 앱 상세 Activity 탭이 그 앱의 기록을 보인다. (agent)
5. SDK 판마다 바뀐 점은 built-in skill `migrate-sdk` 하나에 딸린 `.md` 파일로 쌓는다. 판 하나가 파일 하나다(`<sdk>-<version>.md`, 예: `declaration-4.0.0.md`, `agent-1.3.0.md`): 무엇이 바뀌었나, breaking인가, 앱 code를 어떻게 고치나. SKILL.md는 절차 하나로 두고 판이 늘어도 길어지지 않는다. agent는 그 앱이 고정한 판부터 지금 판 사이의 파일만 읽는다. SDK의 판을 올렸는데 그 파일이 없으면 check가 막는다. (사람)
6. SDK마다 lophn이 아직 돌리는 가장 옛 판(지원 하한)을 적는다. 고정 판이 하한보다 옛것이면 "필수"(앱이 못 뜨거나 곧 못 뜬다), 그 위면 "가능"(옛 판으로 돌고 새 기능만 못 쓴다)이다. data root에 옛 사본이 없는 경우(새 설치, 옮긴 앱)를 위해 옛 판을 따로 싣지 않는다. 그 앱은 처음 다시 release할 때 옮긴다. (agent)
7. lophn이 새 제품 판으로 켜진 것을 data root에 적은 마지막 판과 비교해 안다. 그때 archived가 아닌 앱의 켜진 release를 지금 SDK와 비교한다. "필수"는 앱마다 Inbox 기록(lophn에게 맡기기 단추)이 되고, "가능"은 lophn 업데이트 기록 한 줄과 앱 상세에만 보인다. (사람: 알아서)
8. 맡기기는 늘 home을 거친다. 단추를 누르면(사람이 시작한다. `event.md`의 규칙과 맞다) home lophn 대화가 `update-apps` skill로 열리고, home lophn이 SDK 상태 read로 앱마다 고칠 곳을 사람 말로 정리한 뒤 앱마다 그 앱 lophn에게 `reply: none`으로 handoff한다. 앱 lophn은 `migrate-sdk`대로 판을 올리고 메모대로 고치고 check하고 release한다. (사람)
9. home lophn이 앱마다 고정 판, 지원 하한, 지금 판, 읽을 메모 파일을 받는 read를 둔다(home은 앱 source를 못 읽는다). (agent)
10. archived 앱은 agent에게 보이지 않는다(`app read|status|logs`, 사용처, call 대상). SDK 감지에서도 빠진다. 되살리기는 사람이 화면에서 한다. (사람)
11. migration 메모는 지우지 않는다. 쌓여도 agent는 범위만 읽어 context가 그 앱이 뒤처진 만큼만 커지고, 자동으로 지우면 되살린 archived 앱이나 옛 data root가 필요한 메모를 잃는다. 너무 길어지면 제품을 낼 때 오래된 major 구간을 한 파일로 합친다. (사람이 추천을 받음, 2026-11-07)
12. private 앱으로의 handoff: home의 기본 lophn이 private workspace의 lophn에게 `reply: none` handoff만 보낼 수 있는 고정 예외 하나를 둔다. 일은 들어가고 답·결과는 나오지 않으며 private 쪽에서 나가는 call은 그대로 막힌다. home을 통째로 예외로 두면 home의 전역 agent가 private에 일을 넣고 결과를 받아 가 private의 뜻이 없어진다. (사람이 추천을 받음, 2026-11-07)

## 단계

| 단계 | 할 일 | 선행 |
|---|---|---|
| 1 | 기록 표: `app_notices`를 합친 영구/휘발 기록 표, program 쓰기 route, `@lophn/cap-notify`의 영구 option, 남기는 기간, 옮기기 | 없음 |
| 2 | program 기록: release·앱 멈춤·data migration·lophn 업데이트 기록, 마지막 제품 판 적기 | 1 |
| 3 | Inbox 화면: 답할 것·알림·기록, 기록 거르기·찾기, 앱 상세 Activity의 기록 | 1 |
| 4 | SDK 메모와 지원 하한: `migrate-sdk` skill과 판별 `.md`, 지원 하한, 메모 없는 판 올리기를 막는 check, 지금 판들의 첫 메모 | 없음 |
| 5 | SDK 감지와 맡기기: SDK 상태 read, 필수/가능 기록, 단추, `update-apps` home skill, private 예외(정한 것 12) | 2, 4 |
| 6 | archived 숨기기: agent read·사용처·call에서 archived 앱 빼기 | 없음 |

## 계획

- `project-docs/plan/inbox-sdk-migration/`: 단계 1~6 전부.
