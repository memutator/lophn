# Terminal tab 전환 지연 진단

2026-10-29, Linux 설치 앱(`/opt/lophn`, 0.9.0)의 실행 중인 terminal-host, main, renderer에서 측정했다. 소스 대조 기준은 저장소 HEAD `cc734efd2`다. 설치 bundle의 `readLines` 구현도 직접 읽어 저장소와 같음을 확인했다.

**확인한 원인**

1. 선택하지 않은 terminal tab은 unmount되고 xterm도 dispose된다. 돌아오면 `after_seq: 0`으로 남아 있는 raw 출력을 전부 받아 새 xterm에서 재생한다. 화면의 마지막 상태를 유지하는 방식이 아니다.
2. main의 `readLines`는 pipe 조각이 올 때마다 누적 문자열에 조각을 붙이고 누적 문자열의 처음부터 newline을 찾는다. snapshot은 JSON 한 줄이라 마지막 조각 전에는 newline이 없다. 큰 응답에서 같은 prefix를 반복 처리한다.
3. 재진입 effect와 polling effect가 각각 시작해, 첫 snapshot이 도착하기 전에 두 번째 `after_seq: 0` 요청이 나간다. 실제 사용자의 tab 전환에서 동일한 전체 출력이 두 번 전송되는 것을 관찰했다.

관련 소스:

- `packages/shell/renderer/workspace/panes/panes.tsx:399`: 선택된 일반 tab만 render한다.
- `packages/shell/renderer/terminal/terminal-tab.tsx:246`: view 생성과 unmount 시 dispose.
- `packages/shell/renderer/terminal/terminal-tab.tsx:293`: 재진입 시 전체 snapshot.
- `packages/shell/renderer/terminal/terminal-tab.tsx:327`: 별도로 시작되는 polling.
- `packages/shell/terminal-host/cli.ts`: snapshot 응답 전체를 JSON 한 줄로 stdout에 쓴다.
- `packages/shell/main/terminal/supervisor.ts:233`: 누적 문자열의 처음부터 newline을 찾는다.

**실제 출력으로 측정한 시간**

첫 snapshot 측정에서 받은 출력을 renderer 메모리에 보관한 뒤, 설치 앱의 실제 `deps.createView`로 만든 별도 xterm에 동일한 출력을 세 번 재생했다. 측정용 xterm은 입력·resize·title을 실제 PTY나 store에 보내지 않았고 매번 dispose했다. 크기는 실제 화면과 같은 2264 × 1368 px, 322 columns × 80 rows였다. 출력 본문은 파일에 저장하지 않았다.

| Terminal | 첫 측정 당시 raw 출력 | Chunk 수 | 전체 snapshot 응답 시간, 1회 | 같은 출력의 xterm 재생 시간, 3회 |
| --- | ---: | ---: | ---: | --- |
| OMP `term_1` | 5,242,863 bytes | 5,193 | 391.5 ms | 169.9 / 79.6 / 84.4 ms |
| OMP `term_3` | 4,570,521 bytes | 2,108 | 241.6 ms | 83.3 / 72.2 / 82.7 ms |
| Codex `term_5` | 267,692 bytes | 2,076 | 9.0 ms | 16.1 / 7.5 / 10.2 ms |
| OpenCode `term_6` | 635,055 bytes | 671 | 15.6 ms | 12.4 / 13.2 / 10.9 ms |

xterm 생성은 9.2–18.3 ms, fit은 1.8–3.1 ms였다. 재생 완료는 마지막에 넣은 OSC title marker가 처리된 시각으로 측정했다. 이는 parser 완료 시간이며 사용자의 click부터 최종 화면 표시까지의 시간은 아니다. 두 번의 requestAnimationFrame을 추가로 기다린 시간도 원자료에 남겼지만 실제 사용자의 화면 표시 시각으로 취급하지 않았다.

전체 snapshot을 네 번씩 더 요청한 결과 OMP `term_1`은 295.7–1067.3 ms, median 326.0 ms였고 `term_3`은 217.9–283.0 ms, median 239.3 ms였다. 같은 시기의 빈 delta 응답은 대부분 0.2–2.5 ms였다. `term_1`의 첫 빈 delta는 253.4 ms로 늦었으며 제외하지 않았다. 실행 중인 agent의 출력과 사용자의 tab 전환이 계속되므로 반복 요청의 출력량과 경합은 고정되어 있지 않다.

**main CPU profile**

두 OMP terminal에 전체 snapshot을 각각 세 번 요청하는 동안 main을 500 µs sampling interval로 profile했다. 전체 구간은 2168.8 ms였다.

| 항목 | Self time | 전체 구간 대비 |
| --- | ---: | ---: |
| `readLines` | 1322.6 ms | 61.0% |
| Garbage collector | 262.2 ms | 12.1% |
| `onLine` | 32.1 ms | 1.5% |
| Idle | 353.3 ms | 16.3% |

`readLines` inclusive time은 1396.1 ms였다. 큰 snapshot에서 main의 line 수신 처리가 주요 병목이라는 직접적인 근거다. 이 profile은 main만 측정하므로 terminal-host의 JSON 직렬화나 renderer의 xterm 비용을 포함하지 않는다.

같은 line reader 알고리즘을 별도 Node process에서 synthetic JSON 한 줄로 비교했다. 5 MiB payload를 8 KiB 조각으로 나누면 현재 방식은 678.8–750.9 ms, 조각마다 newline을 찾고 마지막에 한 번 join하는 방식은 3.8–5.6 ms였다. 64 KiB 조각에서는 각각 97.8–119.1 ms, 3.1–3.7 ms였다. 이는 line reader만 비교한 microbenchmark이며 수정 후 앱 전체의 예상 속도가 아니다. subprocess나 브라우저를 띄우는 test, E2E는 추가하지 않았다.

**사용자의 실제 tab 전환에서 관찰한 중복 요청**

main의 기존 snapshot handler를 호출하는 관찰용 wrapper로 요청 시각, after_seq, 응답 시간, chunk 수만 기록했다. 직접 tab을 전환하지 않았다. 관찰 후 원래 handler로 복원했다.

| 같은 진입의 요청 | 첫 요청과의 시작 간격 | after_seq | 반환 chunk 수 | 각 요청의 응답 시간 |
| --- | ---: | ---: | ---: | ---: |
| OMP `term_3`, 첫 요청 | 0 ms | 0 | 5,175 | 419.2 ms |
| OMP `term_3`, 두 번째 요청 | 20.2 ms | 0 | 5,175 | 728.4 ms |
| 다음 OMP `term_3` 진입, 첫 요청 | 0 ms | 0 | 4,606 | 374.3 ms |
| 같은 진입, 두 번째 요청 | 9.1 ms | 0 | 4,606 | 678.5 ms |

Codex tab으로 돌아올 때도 두 번의 `after_seq: 0` 요청을 관찰했다. renderer의 `acceptOutput`이 이미 받은 seq를 버리므로 두 응답 전체를 반드시 xterm에서 두 번 재생한다는 뜻은 아니다. 하지만 terminal-host와 main의 전송·수신 비용은 중복으로 발생한다.

**“Some earlier output isn't shown.” 메시지**

이 문구는 우리 앱의 `terminal.status.output-missing`이며 `MissingOutput`이 표시한다. terminal-host의 raw 출력 ring buffer는 5,242,880 UTF-8 bytes 또는 계산상 10,000줄을 넘으면 오래된 chunk부터 버린다. 출력은 disk에 저장하지 않는다. 첫 측정 당시 두 OMP terminal 모두 `dropped_output=true`였다.

이 상한은 현재 구현이 정한 값이다. 다만 상한만 늘리면 재진입 때 전송·재생하는 양도 커지므로 전환 지연을 더 키울 수 있다.

줄 수 계산에도 문제가 있다. `countLines`는 chunk마다 1부터 세기 때문에 newline 없는 chunk도 한 줄로 계산한다. 따라서 실제 화면이나 연속된 텍스트의 10,000줄과 다르다. 첫 측정의 Codex 출력은 chunk 2,076개에 실제 LF는 1개였고, 이후 관찰에서는 반환 chunk 수가 10,000개까지 찼다. 작은 TUI 갱신이 많으면 화면의 10,000줄보다 일찍 보관 상한에 닿을 수 있다.

관련 소스는 `packages/design/wording/catalog/project.ts:227`, `packages/shell/renderer/terminal/exit-banner.tsx`, `packages/shell/renderer/terminal/terminal-tab.tsx:154`, `packages/shell/terminal-host/ring-buffer.ts`다. renderer는 seq가 끊긴 경우에도 같은 문구를 표시하므로 문구 자체만으로 원인을 구별할 수는 없다. 이번 OMP terminal에서는 host의 dropped flag를 직접 확인했다.

**추천하는 수정 순서**

1. `readLines`가 이미 검사한 prefix를 반복 처리하지 않게 바꾼다. 현재 측정에서 가장 큰 main CPU 비용이다.
2. 첫 snapshot과 polling 시작을 하나의 흐름으로 만들어 재진입 시 전체 요청을 한 번만 보낸다.
3. tab 전환 때 xterm 상태와 마지막 seq를 유지해, 새 출력만 받아 이어 그리게 한다. 그러면 매번 과거 raw 출력을 다시 가져와 파싱하는 비용을 없앨 수 있다.
4. raw buffer의 줄 계산을 chunk 경계와 무관하게 고친다. xterm 상태를 유지하는 설계에서 raw buffer 상한과 scrollback 보관 방식을 함께 정한다.

1–2는 현재 경로의 직접적인 결함을 줄이는 변경이고, 3은 전환 비용이 과거 출력량에 비례하는 구조를 바꾸는 변경이다. 다른 terminal 앱을 같은 조건에서 측정하지 않았으므로 앱 사이의 속도 배수나 다른 앱의 내부 구현은 결론에 포함하지 않았다.

진단 과정에서는 제품 코드를 수정하지 않았다. 관찰용 handler와 renderer 메모리를 정리하고, 측정용 view와 inspector를 종료했다. 원자료와 일회용 측정 script는 저장소의 `.cache/terminal-diagnosis/`에 있다.

`npm run check`를 실행했으나 진단 중 별도로 변경된 `packages/core/router/router.ts`의 formatting 오류로 중단됐다. 이 진단에서는 해당 파일을 수정하지 않았다.

**2026-10-29 수정 후 확인**

이 위의 측정은 수정 전 설치 앱에 대한 기록이다. 이후 xterm·DOM·seq를 창 안에서 유지하고, 초기 snapshot 뒤에는 구독한 창에만 새 출력을 push하도록 수정했다. 출력 polling, 초기 중복 snapshot, 출력 일부 없음 배너를 제거했다. raw buffer와 xterm scrollback 상한은 유지한다. 탭을 닫거나 project를 떠나거나 다른 창으로 옮기면 view와 구독을 해제한다.

개발 앱(`.dev-data/mock`, 실제 PTY)에서 약 5.45 MB의 반복 화면 갱신 출력을 만든 다음, terminal 두 개를 8회 번갈아 선택했다. 선택한 tab과 xterm DOM이 바뀐 시각을 MutationObserver로 측정했다.

| 항목 | 결과 |
| --- | --- |
| DOM 전환 | 6.8–10.3 ms, median 7.5 ms |
| 전환 뒤 첫 requestAnimationFrame callback | 시작 기준 7.4–11.2 ms |
| 8회 전환 중 추가 snapshot | 0회 |
| 8회 전환 중 추가 xterm 생성 | 0회 |
| 원래 terminal로 돌아왔을 때 DOM identity | 유지 |
| idle 동안 반복 snapshot | 없음 |
| 배너 | 없음 |

두 번째 terminal을 처음 열 때의 snapshot 1회는 별도로 있었다. 첫 requestAnimationFrame callback은 GPU 표시 완료 시각을 뜻하지 않는다. 이 개발 workload와 viewport는 앞선 설치 앱 OMP 측정과 다르므로 `392 ms → 7.5 ms` 같은 직접적인 속도 배수 비교는 하지 않는다.

숨은 terminal에서 Python으로 DA 질의를 발생시켜, main의 `respond` 경로로 7자 응답이 전달되는 것을 확인했다. 종료된 tab을 UI에서 닫으면 `watch: false` 요청이 나가는 것도 확인했다. 개발 terminal-host를 종료하고 Restart를 누른 경우, 새 `IdSource` ref로 살아 있는 shell을 받고 기존 xterm view를 reset해 재사용했다. 측정용 앱·inspector는 종료했다.

실제 수정한 `readLines`와 이전 알고리즘을 같은 Node process에서 비교했다. 5 MiB ASCII JSON 한 줄, 조건당 3회 결과다.

| pipe 조각 크기 | 이전 알고리즘 | 수정한 `readLines` |
| --- | --- | --- |
| 8 KiB | 696.0 / 759.7 / 698.0 ms | 5.08 / 4.86 / 4.66 ms |
| 64 KiB | 91.2 / 90.5 / 92.9 ms | 3.25 / 3.92 / 4.01 ms |

이 값은 line reader만의 microbenchmark다. 추가한 subprocess 없는 테스트 5개와 최종 `npm run check`가 통과했다. 원자료는 `.cache/terminal-diagnosis/runtime-after.json`, `requests-after.json`, `line-reader-after.json`에 있다.

resource 절충은 열린 terminal의 처리된 상태를 메모리에 남겨 전환 때 재생할 일을 없애는 것이다. 숨은 화면의 drawing과 idle 출력 polling은 쉬지만, 새 출력의 파싱과 열린 terminal 수만큼의 상태 메모리는 필요하다. 새 renderer나 다른 창에 붙는 cold 경로는 여전히 raw buffer를 한 번 복원한다. disk checkpoint나 별도 headless parser는 추가하지 않았다.
