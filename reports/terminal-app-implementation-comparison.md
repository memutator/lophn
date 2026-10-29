# Terminal 앱의 tab 전환·출력 보관 구현 비교

2026-10-29에 공식 문서와 공개 소스를 확인했다. Wave, Hyper, VS Code, Tabby는 저장소를 shallow clone해 아래 commit의 실제 호출 경로를 읽었다. 앱을 같은 workload로 실행한 성능 비교는 아니며, 조사한 default branch와 배포 release의 구현이 같다고 단정하지 않는다. lophn의 실측은 [앞선 진단](terminal-tab-switch-diagnosis.md)에 있다.

| 앱 | 조사한 commit | 우리와 가까운 부분 |
| --- | --- | --- |
| Wave | `9f1c9670d407be3b93cf090319a63ef30bf54d0e` | Electron, React 19, TypeScript, xterm 6, WebGL. PTY/backend는 Go |
| Hyper | `30ec0a2a91de17eeb32dd71998fe8a8ec59f98eb` | Electron, React 18, TypeScript, node-pty, xterm 5.3 |
| VS Code | `fc8954c90fe6dea1f4c411dd73fdfe5f1913b5ca` | Electron, TypeScript, node-pty, xterm. terminal UI는 React가 아님 |
| Tabby | `467ce8ebfa467fb88cf6d154c9a5891e3d3647f0` | Electron, TypeScript, xterm 6. UI는 Angular |

stack은 각 저장소의 `package.json`, Wave의 `pkg/blockcontroller`, VS Code의 `terminalProcess.ts`도 함께 확인했다. clone은 `.cache/terminal-research/`에 있다.

**일반 tab 전환에서는 이미 만든 terminal을 유지한다**

네 앱 모두 조사한 일반 전환 경로에서 terminal 인스턴스를 유지하는 구현을 확인했다. lophn처럼 매번 xterm을 dispose하고 raw 출력 전체를 다시 받아 재생하는 경로와 다르다. 이 사실로부터, 해당 경로에서는 과거 raw 출력량에 비례하는 재전송·재파싱을 피한다고 판단할 수 있다. 실제 전환 시간이 얼마인지는 별도의 runtime 측정이 필요하다.

| 앱 | 일반 tab 전환 | view를 새로 만들어야 할 때 |
| --- | --- | --- |
| Wave | tab별 `WebContentsView`를 cache에서 재사용하고 비활성 view를 화면 밖으로 옮긴다 | 저장한 terminal 상태와 그 이후 raw 출력으로 복원 |
| Hyper | 모든 `TermGroup`을 stable key로 render하고 비활성 group을 화면 밖으로 옮긴다 | split 등에서 xterm을 다시 붙일 수 있게 수명을 React component와 분리한 경로가 있다 |
| VS Code | `TerminalInstance`를 유지하며 group의 display와 instance visibility를 바꾼다 | reconnect/revive에는 별도 serialize/replay 경로가 있다 |
| Tabby | 모든 tab body를 유지하고 active CSS class로 위치를 바꾼다 | 처음 focus할 때 frontend를 attach하며, recovery용 상태 저장은 별도다 |

**Wave: view cache와 상태 snapshot을 함께 쓴다**

`getOrCreateWebViewForTab`은 cache hit면 기존 view를 반환한다. 기본 cache 목표 크기는 10이며 active view와 최근 1초 안에 쓴 view는 eviction을 피한다. 따라서 항상 정확히 10개 이하라는 뜻은 아니다. 전환은 기존 view를 다시 활성화하고, 비활성 view는 크기를 유지한 채 `(-15000, -15000)`으로 옮긴다. [view cache](https://github.com/wavetermdev/waveterm/blob/9f1c9670d407be3b93cf090319a63ef30bf54d0e/emain/emain-tabview.ts#L213-L291), [전환 경로](https://github.com/wavetermdev/waveterm/blob/9f1c9670d407be3b93cf090319a63ef30bf54d0e/emain/emain-window.ts#L498-L544).

cache에서 제거됐거나 renderer를 다시 만든 경우에는 `SerializeAddon`으로 저장한 상태를 읽는다. 상태에는 `ptyoffset`과 terminal 크기가 함께 기록된다. 그 상태를 먼저 쓰고, `fetchWaveFile(..., ptyOffset)`으로 이후 출력만 받는다. 처리한 출력이 100 KiB 이상이면 5초 timer 뒤 idle callback에서 상태 저장을 시도한다. 매번 원본 출력 전체를 파싱하지 않도록 checkpoint를 두는 방식이다. snapshot 자체도 xterm에 다시 write하므로 복원이 비용 0이라는 뜻은 아니다. [복원·저장 구현](https://github.com/wavetermdev/waveterm/blob/9f1c9670d407be3b93cf090319a63ef30bf54d0e/frontend/app/view/term/termwrap.ts#L486-L600), [상태와 offset 저장](https://github.com/wavetermdev/waveterm/blob/9f1c9670d407be3b93cf090319a63ef30bf54d0e/pkg/service/blockservice/blockservice.go#L45-L67).

실시간 출력은 file append event를 구독해 xterm에 이어 쓴다. 복원 파일은 HTTP 응답의 `arrayBuffer()`로 읽으며 offset을 query에 넣는다. lophn의 큰 JSON 한 줄을 main에서 누적해 읽는 경로와 다르다. [append 구독](https://github.com/wavetermdev/waveterm/blob/9f1c9670d407be3b93cf090319a63ef30bf54d0e/frontend/app/view/term/termwrap.ts#L469-L479), [파일 읽기](https://github.com/wavetermdev/waveterm/blob/9f1c9670d407be3b93cf090319a63ef30bf54d0e/frontend/app/store/global.ts#L448-L475).

우리에게 적용할 것은 살아 있는 terminal을 재사용하고, 실제로 다시 만드는 경우에만 checkpoint를 사용하는 원칙이다. tab마다 `WebContentsView`를 만드는 Wave의 큰 구조까지 도입할 필요는 없다.

**Hyper: React를 유지하고 보이지 않는 terminal의 drawing을 쉰다**

`Terms.render`는 선택한 group만 render하지 않고 전체 group을 stable key로 render한다. 비활성 group은 `left: -9999em`으로 옮긴다. 소스 주석에도 xterm의 `IntersectionObserver`로 rendering을 쉬게 한다고 명시돼 있다. session이 제거됐을 때 xterm을 dispose하며, split 때문에 component가 바뀔 때도 다시 붙일 수 있도록 terminal 객체를 재사용한다. [전체 group 유지·숨김](https://github.com/vercel/hyper/blob/30ec0a2a91de17eeb32dd71998fe8a8ec59f98eb/lib/components/terms.tsx#L62-L194), [component와 terminal 수명](https://github.com/vercel/hyper/blob/30ec0a2a91de17eeb32dd71998fe8a8ec59f98eb/lib/components/term.tsx#L496-L505).

출력은 PTY event를 main에서 모아 renderer로 push한다. batch 기준은 16 ms 또는 약 200 KiB다. 작은 출력마다 IPC를 보내는 부담을 줄이고, 한 batch가 무제한으로 커지지 않게 한다. [DataBatcher](https://github.com/vercel/hyper/blob/30ec0a2a91de17eeb32dd71998fe8a8ec59f98eb/app/session.ts#L31-L84).

우리와 UI stack이 가까워 일반 tab 전환의 가장 단순한 참고 구현이다. 화면 밖으로 옮기는 CSS 값 자체보다, terminal의 수명과 보임 여부를 분리하는 점이 중요하다.

**VS Code: 인스턴스 유지, 짧은 출력 batch, parser 완료에 따른 flow control**

`TerminalGroup.setVisible`은 group의 display를 바꾸고 각 instance의 visibility를 갱신한다. `TerminalInstance.setVisible`은 기존 xterm을 대상으로 보임·resize를 처리한다. DOM container가 바뀌어도 wrapper를 다시 붙이고 refresh하는 별도 경로가 있다. [group visibility](https://github.com/microsoft/vscode/blob/fc8954c90fe6dea1f4c411dd73fdfe5f1913b5ca/src/vs/workbench/contrib/terminal/browser/terminalGroup.ts#L518-L524), [재부착·visibility](https://github.com/microsoft/vscode/blob/fc8954c90fe6dea1f4c411dd73fdfe5f1913b5ca/src/vs/workbench/contrib/terminal/browser/terminalInstance.ts#L1078-L1104).

`TerminalDataBufferer`는 기본 5 ms 동안 출력 조각을 배열에 모은 뒤 한 번 join해 전달한다. renderer는 xterm write callback에서 처리한 문자 수를 ACK한다. 미처리 문자가 100,000자를 넘으면 PTY를 pause하고 5,000자 미만이면 resume한다. 정상 출력 경로에서 큰 backlog가 renderer와 공유 연결을 압박하지 않도록 한다. [batch](https://github.com/microsoft/vscode/blob/fc8954c90fe6dea1f4c411dd73fdfe5f1913b5ca/src/vs/platform/terminal/common/terminalDataBuffering.ts#L28-L63), [parser 완료 ACK](https://github.com/microsoft/vscode/blob/fc8954c90fe6dea1f4c411dd73fdfe5f1913b5ca/src/vs/workbench/contrib/terminal/browser/terminalInstance.ts#L1717-L1725), [PTY pause/resume](https://github.com/microsoft/vscode/blob/fc8954c90fe6dea1f4c411dd73fdfe5f1913b5ca/src/vs/platform/terminal/node/terminalProcess.ts#L333-L344), [임계값](https://github.com/microsoft/vscode/blob/fc8954c90fe6dea1f4c411dd73fdfe5f1913b5ca/src/vs/platform/terminal/common/terminal.ts#L892-L912).

창 reload와 앱 재시작의 복원은 일반 tab 전환과 분리한다. PTY host에는 `@xterm/headless` 기반 `XtermSerializer`가 있고, 처리된 terminal 상태를 serialize해 replay event를 만든다. [serializer](https://github.com/microsoft/vscode/blob/fc8954c90fe6dea1f4c411dd73fdfe5f1913b5ca/src/vs/platform/terminal/node/ptyService.ts#L1045-L1124), [공식 persistent sessions 설명](https://code.visualstudio.com/docs/terminal/advanced#_persistent-sessions).

**Tabby: tab을 유지하고, 초기 출력에서도 반복 concat을 피한다**

Angular template은 모든 tab body를 유지하고 active class만 바꾼다. 비활성 tab은 `left: -1000%`, active tab은 `left: 0`이다. 최초 focus 때 frontend를 attach하지만 매번 focus할 때 새 xterm을 만드는 것은 아니다. `destroy`에서 frontend와 xterm을 정리한다. [전체 tab 유지](https://github.com/Eugeny/tabby/blob/467ce8ebfa467fb88cf6d154c9a5891e3d3647f0/tabby-core/src/components/appRoot.component.pug#L109-L118), [숨김 CSS](https://github.com/Eugeny/tabby/blob/467ce8ebfa467fb88cf6d154c9a5891e3d3647f0/tabby-core/src/components/appRoot.component.scss#L174-L190), [최초 attach](https://github.com/Eugeny/tabby/blob/467ce8ebfa467fb88cf6d154c9a5891e3d3647f0/tabby-terminal/src/api/baseTerminalTab.component.ts#L424-L433).

아직 한 번도 표시하지 않은 session의 출력은 8 MiB까지 chunk 배열에 보관한다. 처음 표시할 때 한 번 concat하고 이후에는 output event로 보낸다. 소스는 이전처럼 chunk마다 `Buffer.concat`하면 O(n²)이 된다는 이유를 명시한다. concat 대상은 다르지만, 큰 누적 데이터를 조각마다 다시 처리하는 일을 피한다는 점에서 lophn의 `readLines` 병목에 직접 참고할 수 있다. [초기 buffer](https://github.com/Eugeny/tabby/blob/467ce8ebfa467fb88cf6d154c9a5891e3d3647f0/tabby-terminal/src/session.ts#L7-L84).

frontend에는 xterm write callback의 미완료 수를 보고 대기하는 flow control도 있다. 이것을 VS Code와 동일한 end-to-end PTY pause 구현이라고 해석하지는 않았다. [frontend flow control](https://github.com/Eugeny/tabby/blob/467ce8ebfa467fb88cf6d154c9a5891e3d3647f0/tabby-terminal/src/frontends/xtermFrontend.ts#L55-L88).

**출력 상한은 다른 앱에도 있다. 무엇을 제한하는지가 다르다**

| 앱 | 확인한 보관 정책 |
| --- | --- |
| Wave | xterm scrollback 기본 2,000줄, 설정 최대 50,000줄. 별도 raw terminal file은 2 MiB circular file |
| Hyper | 기본 scrollback 1,000줄 |
| VS Code | 기본 scrollback 1,000줄, persistent session 재연결 복원량은 별도 기본 100줄 |
| Tabby | 기본 scrollback 25,000줄. recovery용 serialize는 normal buffer의 scrollback 1,000줄. 최초 표시 전 raw buffer는 별도 8 MiB |
| Ghostty | surface별 메모리 byte 상한. 화면을 위한 메모리는 항상 확보하고 나머지를 scrollback에 쓰며, 오래된 scrollback 줄부터 제거 |

각 값은 조사한 branch 기준이다. 일반 사용 중 scrollback, 재연결 시 복원량, 최초 표시 전 raw buffer는 서로 다른 상한이다. [Wave scrollback](https://github.com/wavetermdev/waveterm/blob/9f1c9670d407be3b93cf090319a63ef30bf54d0e/frontend/app/view/term/term.tsx#L278-L289), [Wave raw file](https://github.com/wavetermdev/waveterm/blob/9f1c9670d407be3b93cf090319a63ef30bf54d0e/pkg/blockcontroller/blockcontroller.go#L44-L47), [Hyper](https://github.com/vercel/hyper/blob/30ec0a2a91de17eeb32dd71998fe8a8ec59f98eb/app/config/config-default.json#L11), [VS Code scrollback](https://github.com/microsoft/vscode/blob/fc8954c90fe6dea1f4c411dd73fdfe5f1913b5ca/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts#L329-L332), [VS Code 복원량](https://github.com/microsoft/vscode/blob/fc8954c90fe6dea1f4c411dd73fdfe5f1913b5ca/src/vs/platform/terminal/common/terminalPlatformConfiguration.ts#L401-L405), [Tabby scrollback](https://github.com/Eugeny/tabby/blob/467ce8ebfa467fb88cf6d154c9a5891e3d3647f0/tabby-terminal/src/config.ts#L60), [Tabby recovery](https://github.com/Eugeny/tabby/blob/467ce8ebfa467fb88cf6d154c9a5891e3d3647f0/tabby-terminal/src/frontends/xtermFrontend.ts#L802-L811), [Ghostty](https://ghostty.org/docs/config/reference#scrollback-limit).

TUI가 같은 화면을 반복해서 덮어 그리면 raw 출력 bytes와 갱신 chunk 수는 계속 늘지만, 그만큼 scrollback 줄이 늘어난 것은 아니다. 살아 있는 parser는 그 갱신을 처리한 현재 화면과 mode를 유지한다. lophn은 raw buffer를 줄이는 동시에 탭을 떠날 때 이 처리된 상태도 버리므로, 돌아올 때 보관된 raw tail로 다시 만들어야 한다. raw tail만으로 항상 모든 terminal mode와 화면을 복원할 수 있다는 보장은 없다. 이 마지막 항목은 데이터 구조와 lifecycle로부터의 판단이며, 모든 harness에서 화면 손상을 실측했다는 뜻은 아니다.

**Warp·Ghostty는 비교 범위가 다르다**

Warp 공식 설계 글은 Rust와 GPU renderer를 설명하고, Ghostty는 Zig의 `libghostty`와 native macOS/Linux GUI를 사용한다. 우리와 가까운 stack의 구현 참고로는 Wave·Hyper가 우선이다. native 앱의 설계만 보고 현재 lophn의 전송·lifecycle 병목을 해결하려고 renderer를 교체해야 한다고 판단할 근거는 없다. [Warp 설계 글, 2021년](https://www.warp.dev/blog/how-warp-works), [Ghostty 공식 구조](https://ghostty.org/docs/about).

**lophn에 대한 추천**

1. 먼저 `readLines`의 누적 prefix 반복 처리를 없애고, 최초 snapshot과 polling의 중복 시작을 고친다. 앞선 실측에서 확인한 직접적인 결함이며 terminal 엔진 교체가 필요하지 않다.
2. 일반 tab 전환은 Hyper·VS Code처럼 xterm 인스턴스를 유지한다. 같은 창에서 tab을 숨기는 것과 terminal을 닫는 것을 다른 lifecycle로 둔다. 기존 `TabKindDef.keep` 경로를 활용할 여지는 있지만, pane·desk·float 이동으로 React subtree가 바뀌는 경우도 별도로 확인해야 한다.
3. 출력 수신과 마지막 seq를 선택된 React tab의 mount에 묶지 않는다. 숨은 terminal도 새 출력을 순서대로 파싱해 상태를 최신으로 유지하고, 보이지 않는 화면의 drawing을 쉰다. focus와 visibility도 분리한다. 우리에게 설치된 xterm 6의 `RenderService`에도 IntersectionObserver 기반 drawing pause가 있다. 이것은 parser·PTY 입력까지 멈춘다는 뜻이 아니다. [xterm RenderService](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/services/RenderService.ts#L123-L151).
4. 출력은 짧은 batch로 전달하고, 각 terminal에는 수신 흐름을 하나만 둔다. 현재의 큰 JSON snapshot을 반복하는 경로를 정상 출력의 기본 경로로 쓰지 않는다. 숨은 모든 tab에 지금의 40 ms polling을 단순 복제하면 다른 비용이 커질 수 있다. 현재 host는 빈 delta를 만들 때도 보관 chunk 전체를 복사·filter한다.
5. renderer reload나 다른 창으로 이동하는 복원이 필요할 때 Wave식 상태 snapshot과 이후 seq/offset을 검토한다. 현재 화면·cursor·mode와 필요한 scrollback을 보존하는 checkpoint여야 한다. 일반 tab 전환부터 매번 serialize하는 구조로 바꿀 필요는 없다.
6. raw chunk 수를 화면 줄 수로 세는 현재 보관 계산은 고친다. scrollback 상한과 재연결용 보관 상한은 각각의 목적에 맞게 정한다.

여기서 2–6은 조사 결과에 근거한 추천이며 아직 구현하거나 개선 폭을 측정한 결과는 아니다. 이번 변경은 조사 문서만 추가한다.
