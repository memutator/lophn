# @lophn/app-ui

## 목적

앱 view의 bridge(`lophnApp`)를 쓰는 UI 셋이다. 선언한 operation 하나를 부르는
`OperationButton`·`useOperation`, 앱 화면 root의 `AppErrorBoundary`, 화면의 머리
조작을 lophn 탭 머리 줄에 올리는 `useTabHead`, 화면이 열린 자리·인자·workspace를 읽는
`usePlace`, lophn project 목록을 읽는 `useProjects`, 사람의 컴퓨터 명단을 읽는 `useMachines`, 일이 도는 동안 page를 살려 두는
`useKeepAlive`, 선언한 key의 handler를 거는 `useCommand`, 앱 event를 받는 `useEvent`다. 화면은
operation만 부르고, 호출은 앱 view의 `lophnApp.callOperation` 하나로만 한다.
호출이 허락되는지, 사람이 정해야 하는지는 lophn이 정하고 앱 안에 따로 확인
dialog를 두지 않는다. 조작은 lophn 화면과 같은 component(`@lophn/ui`)다. bridge가
필요 없는 UI(레이아웃·필터·ReadState·toast 등)는 `@lophn/ui/<분류>`에 있다.

## 공개 API와 type

```tsx
import {
  AppErrorBoundary,
  OperationButton,
  useOperation,
} from "@lophn/app-ui";
```

- `OperationButton({operation, input?, children?, app?, onDone?, onFailed?, variant?, size?, disabled?})`
  — operation 하나의 버튼이다.
  - `operation`은 선언한 operation의 `name`·`title`이다. 버튼 글은 `children`,
    없으면 선언의 `title`이다. DOM에는 `data-operation={operation.name}`이 붙는다.
  - 부르는 동안 버튼은 눌리지 않고(`aria-busy`) 시계 아이콘을 보인다. 같은
    버튼을 다시 눌러도 두 번 부르지 않는다.
  - 실패하면 원문 없이 "<label> didn't finish. Try again."을 버튼 옆에 남기고
    다시 누를 수 있다. `onFailed`는 오류
    code(`invalid_input`·`forbidden`·`conflict`· `unavailable`)를 받는다.
  - `input`은 operation 입력이거나 누를 때 입력을 만드는 함수다. 없으면 `null`이다.
  - `app`은 `lophnApp`이다. 없으면 `window.lophnApp`을 쓴다.
- `useOperation(operation, app?)` — `{state, run}`. 버튼이 아닌 trigger에서 같은
  pending·실패를 쓴다. `run(input)`은 `{ok: true, value}`나
  `{ok: false, code}`이고 기다리는 동안 다시 부르면 `undefined`다.
- `appBridge()` — `window.lophnApp`이다(`callOperation(operation, input)`). 앱 view
  밖이면 `undefined`다. 선언에 없는 이름과 command는 `forbidden`이다. operation의
  입력은 앱 process가 검사하지 않으므로 handler가 직접 확인한다.
- `AppErrorBoundary({children})` — 앱 화면 root의 오류 경계다. 앱 진입에서
  root를 감싼다. 아래에서 render 오류가 나면 `window`에 `RENDER_ERROR_EVENT`
  (`lophn:render-error`) DOM event를 보낸다. `detail`은 오류의 `name`과
  `message`다. lophn의 앱 preload가 그것을 앱 log의 `view_error` 줄로 넘기므로
  앱이 따로 보고하지 않아도 된다. 화면에는 원문 오류 없이 "Couldn't show this
  screen."과 [Try again]만 보인다.
- 두 component의 문구(실패 문장과 [Try again])는 lophn 화면과 같은 언어로
  보인다. lophn이 앱 view 문서의 `<html data-lophn-locale>`에 그 언어를 적고,
  값이 없으면(앱 view 밖) en이다. 앱 자기 화면의 문구는 앱이 그대로 쓴다.
- `useTabHead(head, handlers?, app?)` — 화면이 열린 lophn 프레임의 머리 줄에
  `head`를 올린다. lophn이 앱 화면을 감싸는 모든 곳(앱 화면 탭, 앱 panel 탭과
  dock·desk float·전역 float, 앱 sidebar panel, tray popup, 세션 앱 카드)이
  머리 줄을 그린다. 자기 머리 줄(제목 줄, 새로 고침 단추 줄)을 따로 그리지 않는다.
  화면의 상태 글과 주 행동은 여기에 올린다.
  - `head`는 글과 id뿐이다. `crumbs`(앱 이름 뒤 경로), `tabs`(`{items,
    selected}`, 경로 뒤 탭), `status`(상태 글), `actions`(⋯ 앞 단추.
    `primary`·`busy`·`disabled`), `menu`(⋯ 메뉴 맨 위 묶음), `nav`(`{canBack,
    canForward}`. 주면 ← →가 앱 안의 뒤로·앞으로가 된다. ← →는 앱 화면 탭에만
    있고 다른 자리는 그리지 않는다). 항목은 `{id, label}`이고 글은 80자,
    항목은 24개까지 보인다. React 요소는 싣지 못하고 아이콘은 이름으로만
    준다(아래 `icon`). 좁은 자리(sidebar, float)는 `crumbs`·`tabs`보다
    `status`와 `actions` 몇 개를 올린다.
  - `actions` 항목의 `icon`은 lophn이 자기 아이콘으로 그리는 이름이다:
    `refresh`, `add`, `open`, `edit`, `delete`, `copy`, `run`, `stop`,
    `download`. 모르는 이름은 무시하고 글 단추로 그리고, release 준비는 목록에 없는
    이름의 `icon`을 거절한다. **tray popup의 머리
    줄은 `actions`만 아이콘 단추로 그린다**(label은 tooltip). `status`·`crumbs`·
    `tabs`·`menu`는 tray에서 그리지 않는다. 그러니 한눈에 필요한 한두 개
    (예: 새로 고침)를 `actions` 맨 앞에 `icon`과 함께 준다. `icon`이 없는
    단추는 작은 글 단추로 남는다. 다른 자리(탭, panel, sidebar, 카드)는 label
    글 앞에 아이콘을 붙인다.
  - `handlers`는 `onTab(id)`·`onAction(id)`·`onMenu(id)`·`onBack()`·
    `onForward()`다.
  - 돌려주는 값은 lophn이 지금 그 머리 줄을 그리는지다. 앱 전용 창처럼 lophn
    프레임의 머리 줄이 없는 곳이면 false이고, 그때만 화면이 꼭 필요한 조작을
    스스로 그린다(최소한으로). `null`이나 화면이 사라지면 내린다. `head`는 값이
    바뀔 때만 다시 올린다.
- `useCommand(id, handler, options?)` — 선언의 key `id`(`declaration`의 `keys`)에 handler를 건다. 화면이
  mount된 동안만 산다. `options.when`은 `() => boolean`이다. 거짓을 돌려주면 handler가 돌지 않고 그 key는
  shell로 넘어간다(없으면 늘 참이다). handler와 `when`은 부를 때의 가장 최근 것을 쓰므로 그릴 때마다 새로 넘겨도 된다.
  앱 view 밖이면 아무 일도 없다. 선언에 없는 `id`는 아무도 부르지 않는다.
  ```tsx
  useCommand("save", () => void save(), { when: () => dirty });
  ```
- `usePlace()` — 이 화면이 열릴 때 정해진 `{place, params, workspace}`다. 읽기만
  하고 화면이 열려 있는 동안 바뀌지 않는다(dock·desk float·전역 float는 모두
  `panel`이라 자리가 바뀌는 경우가 없다).
  - `place`는 `tab`·`panel`·`card`·`sidebar`·`tray`다. 앱 view 밖이거나 lophn이
    준 값이 틀리면 `null`이다. 선언에 적은 자리(`places`)에서만 열린다.
  - `params`는 화면 선언의 `params` schema를 lophn이 이미 검사한 인자다. 인자 없이
    열렸으면 `{}`다. 값을 쓰기 전에 앱이 다시 검사할 필요는 없다.
  - `workspace`는 `{kind: "project" | "home" | "app", id, folders}`이고 project면
    `identity`와 `formerIdentities`도 있다(`useProjects()`의 같은 칸과 같은 값). 앱 sidebar
    panel처럼 모든 workspace에 나오는 화면이 이걸 보고 맞춘다. `folders`는
    project의 등록 폴더 path 목록이고 Home과 앱 workspace는 `[]`이다. workspace를
    모르는 자리(앱 전용 창, 전역 float)에서는 `null`이다.
- `useProjects(app?)` — lophn의 모든 project(보관 포함)를 화면이 열릴 때 한 번 읽는다.
  `{state, reload}`이고 `state`는 `{status: "loading"}`·`{status: "ready", projects}`·
  `{status: "failed", code}`다. project는
  `{id, identity, formerIdentities, name, title, purpose, status}`다.
  `id`는 이 컴퓨터에서만 뜻이 있고, `identity`는 내 다른 컴퓨터에서도 같은 project를
  가리킨다(모든 project가 갖는다). `formerIdentities`는 그 project가 전에
  가졌던 `identity`다(오래된 것이 앞, 없으면 `[]`).
  `title`은 사람에게 보일 이름, `name`은 agent 주소에 쓰는 slug, `status`는
  `active`·`archived`다. 폴더 path는 주지 않는다(지금 열린 project의 폴더만
  `usePlace().workspace.folders`). 화면이 열린 동안 바뀐 것은 저절로 오지 않으니
  `reload()`로 다시 읽는다(예: 머리 줄의 새로 고침). 읽는 사이 목록이 바뀌면
  `conflict`, 앱 view 밖이면 `unavailable`이다. 쓰는 법은 아래 "project에 붙는 앱".
- `useMachines(app?)` — 사람의 컴퓨터(폰 제외)와 이 화면의 backend가 도는 컴퓨터를 화면이 열릴 때 한 번 읽는다.
  `{state, reload}`이고 `state`는 `{status: "loading"}`·`{status: "ready", machines}`·`{status: "failed", code}`다.
  machine은 `{id, name, status, current, always_on}`이다. `id`는 `mch_` id로 `connectCommands(…, { on })`에
  그대로 쓴다. `status`는 `online`·`offline`·`connecting`·`update`(`@lophn/ui`의 `MachineOption`과 같다)라
  `machines`를 `MachineSelector`에 그대로 넘긴다. `current`는 이 화면의 backend가 도는 컴퓨터 하나다(다른 컴퓨터의
  창에 그려진 화면이면 그 backend의 컴퓨터다). `always_on`은 그 컴퓨터가 "늘 켜 둠"으로 표시됐는지이고 그 컴퓨터의
  기록이 아직 없으면 `null`이다. 켜짐 상태는 저절로 오지 않으니 `reload()`로 다시 읽는다. 앱 view 밖이면 `unavailable`이다.
  허락이 필요 없고 선언에 적을 것도 없다. 쓰는 법은 아래 "컴퓨터를 고르는 화면".
- `useEvent(source, event, listener)` — 다른 앱이나 lophn이 낸 event를 화면이 mount된 동안 받는다. `source`는 발행 앱의
  slug이거나 lophn의 `"lophn"`이다. 앱의 선언 `subscriptions`에 같은 `{source, event}`가 있어야 온다(`@lophn/declaration`).
  `listener(payload)`는 부를 때의 가장 최근 것을 쓰므로 그릴 때마다 새로 넘겨도 된다. event는 일이 일어난 뒤의 알림이라 한 번
  오고 저장되지 않는다. 화면이 닫힌 동안의 것은 오지 않으니 **처음 값은 발행 앱의 read로 읽고** event로 고친다(화면은
  operation만 부르므로 앱이 그 값을 operation으로도 내놓는다). 앱 view 밖이면 아무 일도 없다.
  ```tsx
  useEvent<{ percent: number }>("masup", "usage.limit", (e) => setPercent(e.percent));
  ```
- `useKeepAlive(active, app?)` — `active`인 동안 사람이 이 화면이 있는 workspace를
  떠나도(다른 project로 가도) lophn이 page를 숨겨 살려 두고, 돌아오면 다시 load하지
  않는다. 기본은 떠나면 page를 놓고 돌아오면 다시 load한다. 다시 load하면 화면
  state와 진행 중인 일(agent 답을 기다리는 중, 업로드)이 사라지므로 그런 일이 도는
  동안만 켜고 끝나면 `false`로 둔다.
  - 살려 두는 page는 창마다 6개까지이고 넘치면 가장 오래 안 본 것부터 놓인다. 그
    탭을 사람이 닫으면 바로 놓인다. 놓인 화면은 다시 열 때 새로 load된다. 그래서
    살려 두기에 기대지 말고 되살릴 것(session 이름 등)은 앱이 저장한다.
  - page가 새로 load되면 신호가 꺼지고, 화면이 사라지거나 `active`가 `false`가 되면
    내려간다. 앱 view 밖이면 아무 일도 하지 않는다.
  - 신호는 key별이다. 이 hook을 쓰는 곳마다 따로 켜지고(내부 key), 하나라도 켜져
    있으면 page가 살아 있다. `@lophn/agent`가 turn이 도는 동안 스스로 켜는
    신호와 서로 끄지 않으므로 agent 답을 기다리는 것만이면 이 hook이 필요 없다.
    `lophnApp.setKeepAlive(active, key?)`를 직접 부를 때도 같은 key로 켜고 끈다.
- type: `CommandOptions`, `CommandBridge`, `KeepAliveBridge`, `EventBridge`, `Project`, `ProjectsBridge`, `ProjectsState`, `UseProjects`, `Machine`, `MachinesBridge`, `MachinesState`, `UseMachines`, `Place`, `PlaceJson`, `PlaceValue`, `PlaceWorkspace`, `OperationSpec`, `OperationInput`, `AppBridge`, `OperationState`,
  `OperationResult`, `OperationButtonProps`, `UseOperation`,
  `AppErrorBoundaryProps`, `TabHead`, `TabHeadItem`, `TabHeadAction`, `TabHeadIcon`,
  `TabHeadEvent`, `TabHeadHandlers`, `TabHeadBridge`

## 요구 permission

없다. 부르는 operation의 permission은 그 앱의 선언이 정한다. `AppErrorBoundary`의
오류 전달은 플랫폼이 이미 여는 통로라 따로 선언하지 않는다.

## peer 의존

정확한 peer다. 범위가 아니라 정확한 판을 쓴다.

| peer                 | version |
| -------------------- | ------- |
| `react`              | 19.3.0  |
| `lucide-react`       | 1.51.0  |
| `@lophn/declaration` | 4.9.0   |
| `@lophn/ui`          | 1.2.0   |
| `@lophn/i18n`        | 1.0.0   |

## 사용

선언으로 버튼을 만들고 앱 root를 경계로 감싼다.

```tsx
import { AppErrorBoundary, OperationButton } from "@lophn/app-ui";

const archive = declaration.operations.find((operation) =>
  operation.name === "archive-shipped"
)!;

createRoot(element).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);

<OperationButton
  operation={archive}
  input={() => ({ orders: selected() })}
  onDone={reload}
/>;
```

문구는 앱의 message key로 주고 operation 이름과 섞지 않는다.

화면 안 보기 탭과 주 행동은 lophn 탭 머리 줄에 올리고, 올리지 못한 곳에서만
스스로 그린다.

```tsx
import { useTabHead, useOperation } from "@lophn/app-ui";

const collect = useOperation(collectOperation);
const inHead = useTabHead(
  {
    tabs: { items: VIEWS, selected: view },
    status: summary,
    actions: [{
      id: "collect",
      label: "Collect now",
      primary: true,
      busy: collect.state.status === "pending",
    }],
  },
  {
    onTab: setView,
    onAction: (id) => id === "collect" && void collect.run(null),
  },
);

return (
  // title과 actions를 다 빼면 AppShell은 자기 머리 줄을 그리지 않는다.
  <AppShell
    title={inHead ? undefined : "Usage"}
    actions={inHead ? undefined : <CollectButton />}
  >
    {inHead ? null : <ViewTabs />}
    …
  </AppShell>
);
```

hover 설명은 `@lophn/ui/overlay`의 `Tooltip`으로 만든다. HTML `title` 속성은 쓰지
않는다(브라우저 기본 tooltip이 뜬다. release 준비가 거절한다. `<iframe title>`만 예외다).

자리마다 다른 꼴로 그리고, 크기는 자리가 아니라 CSS container query로 맞춘다.
같은 자리도 칸의 크기가 다르다(sidebar 폭, float 크기). 그래서 `place`는 어떤
정보를 보일지(카드는 요약, tab은 전체)를 고르는 데 쓰고, 배치는 container query가
정한다.

```tsx
import { usePlace } from "@lophn/app-ui";

function Orders() {
  const { place, params } = usePlace();
  const status = typeof params.status === "string" ? params.status : "open";
  // card는 요약 한 줄, 나머지는 표.
  return (
    <div className="orders">
      {place === "card" ? <Summary status={status} /> : <Table status={status} />}
    </div>
  );
}
```

```css
.orders { container-type: inline-size; }
/* 좁은 칸(sidebar, 작은 float)에서는 열을 줄인다. */
@container (max-width: 360px) {
  .orders .col-secondary { display: none; }
}
```

## project에 붙는 앱

작업·일정·문서처럼 "project별"로 나뉘는 data를 다루는 앱(Gantt, 할 일, 회의록)은 project를
따로 만들지 않는다. lophn project가 project다. 앱 안에 project 만들기·이름 바꾸기·목록 화면을
두지 않고, 앱 data에는 lophn project를 key로 붙인다(이름과 제목은 바뀌므로 key로 쓰지
않는다). project 만들기와 고치기는 사람이 lophn에서 한다.

- key는 `identity`다. 앱 data는 사람의 다른 컴퓨터로 옮겨질 수 있고, 거기서 같은
  project를 가리키는 것은 `identity`뿐이다. `id`는 이 컴퓨터에서만 뜻이 있어 다른
  컴퓨터에서는 주인 없는 줄이 된다. 모든 project가 `identity`를 갖는다.
- `identity`는 바뀔 수 있다. lophn은 사람의 다른 컴퓨터에 같은 git 저장소의 project가
  있으면 묻지 않고 같은 `identity`(먼저 만든 것)로 맞추고, 사람이 project를 잇거나
  나눠도 바뀐다. 옛 값은 `formerIdentities`에 남는다.
- 화면이 열릴 때 `useProjects()` 목록의 project마다 `id`와 `formerIdentities`의 id로 붙은
  줄을 `identity`로 옮긴다(옮길 것이 없으면 아무것도 하지 않는 write operation 하나).
  예전에 `id`로 붙인 줄과 `identity`가 바뀌기 전에 붙인 줄이 그렇게 따라간다. 옮기지
  않으면 그 줄은 어느 project의 것도 아닌 줄이 된다.

- 화면이 project workspace에서 열렸으면(`usePlace().workspace?.kind === "project"`) 그
  project의 data만 보인다. 사람에게 project를 고르게 하지 않는다.
- 그 밖의 자리(Home, 앱 workspace, 앱 전용 창, 전역 float)에서는 모든 project를 project별로
  묶어 보인다. 묶음 제목은 `useProjects()`의 `title`이다. 보관한 project는 접거나 뺀다.
- 앱 data에 있는데 목록의 어느 project의 `identity`·`formerIdentities`·`id`와도 맞지 않는
  key는 무시한다(이 컴퓨터에 없거나 보이지 않는 project다).

```tsx
import { usePlace, useProjects } from "@lophn/app-ui";

function Board() {
  const { workspace } = usePlace();
  const { state } = useProjects();
  const only = workspace?.kind === "project" ? workspace.id : null;
  if (state.status !== "ready") return <Loading />;
  const shown = state.projects.filter((p) =>
    only === null ? p.status === "active" : p.id === only,
  );
  // 앱 data는 operation 입력으로 project key(identity)를 넘겨 읽는다.
  return shown.map((p) => (
    <ProjectTasks key={p.id} project={p.identity} title={p.title} />
  ));
}
```

## 컴퓨터를 고르는 화면

사람은 컴퓨터를 여러 대 잇는다. 한 앱 release는 그 모든 컴퓨터가 따르고 각 컴퓨터에서 같은 선언과 code로 돈다. 앱이 "내가 어느 컴퓨터에서
도나", "다른 컴퓨터는 무엇이 있나"를 알려면 `useMachines()`(화면)나 `@lophn/cap-tool`의 `machines()`(backend)를 읽는다. 앱이 lophn의 data
root를 읽거나, hostname·`/proc`·환경 변수로 컴퓨터를 알아내려 하지 않는다. 그런 길은 컴퓨터마다 달라 어긋나고 lophn이 주는 값이 아니다.

다른 컴퓨터의 data를 지금 보려면: 화면이 `MachineSelector`로 컴퓨터를 고르고, 고른 `id`를 operation 입력으로 넘기고, 그 operation의
handler가 `connectCommands(앱 slug, [command], { on: id })`로 그 컴퓨터의 같은 앱 command를 부른다(`@lophn/cap-tool`의 "다른 기계의 앱 부르기").
`current`인 컴퓨터는 `on`에 줄 수 없다(`invalid_input`). 그 컴퓨터는 이 컴퓨터의 handler가 바로 읽는다. 그 컴퓨터가 꺼져 있으면 부르는 것이
`unavailable`이다.

```tsx
import { useState } from "react";
import { useMachines, useOperation } from "@lophn/app-ui";
import { MachineSelector } from "@lophn/ui/input";

function ServerUsage() {
  const { state } = useMachines();
  const [picked, setPicked] = useState<string | null>(null);
  const usage = useOperation("usage.read"); // handler가 picked 컴퓨터면 connectCommands로 건너간다
  if (state.status !== "ready") return <Loading />;
  const machine = picked ?? state.machines.find((m) => m.current)?.id ?? null;
  return (
    <MachineSelector
      machines={state.machines}
      value={machine}
      onValueChange={setPicked}
      ariaLabel="Computer"
    />
    // 그리고 machine을 입력으로 usage를 부른다. current면 on 없이 읽고 아니면 { on: machine }으로 부른다.
  );
}
```

## version 정책

판마다 바뀐 점과 앱 code를 옮기는 법은 `migrate-sdk` skill의 메모 `<이름>-<판>.md`(예: `declaration-4.0.0.md`)에 있다(이 SDK의 판을 올리면 그 메모를 같이 쓴다).

- **patch**: API·동작을 유지한 내부 수정·문서 개선이다.
- **minor**: 기존 API를 유지한 component·prop 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
