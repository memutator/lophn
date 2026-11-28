# @lophn/flow 2.3.0

Previous: 2.2.0
Breaking: no.

`tool()` in a flow now reaches an app by skill deployment instead of by the agent's assignment. The API did not change. A `tool()` call reaches an app only when a public skill of that app reaches the agent in `workflow.yaml`'s `agent:` field (`lophn` when omitted) in the flow's workspace through any layer (every agent, that workspace, that agent) and is not switched off. A flow has no person to ask, so a call to any other app is refused.

```sh
# before: the person assigned the app to the agent
# after: deploy one public skill of the app to the flow's agent or workspace
lophn skill deploy budget log-expense --to workspace
lophn skill deploy budget log-expense --to agent:bookkeeper
```

The built-in skill `deploy-skill` says which layer to choose.

Nothing is required of an existing workflow whose apps already have a deployed skill. A workflow that called an app through an assignment keeps working only after you deploy a skill of that app where the flow can see it.

## Instruction diff

lophn changed the instruction text it gives agents that write flows in this version. Update your own habits: before a flow calls an app, check that the app has a public skill deployed to the flow's agent or project (`lophn skill deployments --app <slug>`), and deploy it if it is not.

```diff
# write-workflow skill
@@ -44,4 +44,5 @@ does not read it or call it wrong.
 
-- `agent`: for a folder with `flow.ts`, the agent whose assignment app command
-  (`tool`) calls use. It is an agent handle; when left out it is `lophn`.
+- `agent`: for a folder with `flow.ts`, the agent whose received app skills
+  decide which apps `tool` calls reach. It is an agent handle; when left out it
+  is `lophn`.
 - `participants`: a map from a key you choose to `{ agent, workspace?, on?, open? }`
@@ -250,5 +251,8 @@ goes to stderr. Avoid non-erasable TypeScript syntax (`enum`, `namespace`).
 
-Allotment: app commands called by `tool()` use the current assignment of the
-agent in `workflow.yaml`'s `agent:` field (`lophn` when omitted). Ask the person
-before requiring a new app assignment.
+Allotment: `tool()` reaches an app only when a skill of that app reaches the
+agent in `workflow.yaml`'s `agent:` field (`lophn` when omitted) in the
+flow's workspace, through any layer (every agent, that workspace, that agent),
+and is not switched off. A flow has no person to ask, so a call to any other
+app is refused. Deploy the skill first (read `deploy-skill`; the person is
+asked when you may not deploy it yourself).
 
# flow guide
@@ -42,3 +42,3 @@ import {
 - `workflow({ workflow, input?, inputs?, key?, signal? })` — `Promise<Outcome<SoftOutput>>`. 같은 project 안의 다른 workflow를 sub-workflow로 호출한다(다른 project는 `forbidden`, 순환·최대 깊이 5 초과는 `conflict`).
-- `tool<T = unknown>({ app, tool, input?, key?, signal? })` — `Promise<Outcome<T>>`. 앱 command를 부르고 2단계 checkpoint로 기록한다. `workflow.yaml`의 `agent`(없으면 lophn)의 현재 할당 안에서만 되고 public command만 부른다.
+- `tool<T = unknown>({ app, tool, input?, key?, signal? })` — `Promise<Outcome<T>>`. 앱 command를 부르고 2단계 checkpoint로 기록한다. 그 앱의 skill이 flow의 agent(`workflow.yaml`의 `agent`, 없으면 lophn)에게 그 workspace에서 어느 층(전역, 그 workspace, 그 agent)으로든 닿아 있고 꺼져 있지 않아야 하며(flow는 사람에게 물을 수 없다) public command만 부른다.
 - `onEvent({ source, event, workspace? }, handler)` — `() => void`. 실행 중 앱 event(앱 slug/id)나 session event(`source: "lophn"`)를 비영속 구독한다. 반환된 disposer를 부르면 구독을 해제한다.
```
