# @lophn/agent 1.3.0

Previous: 1.2.0
Breaking: only for an app that passes an agent id (`agt_...`) as `agent`. An app that passes a handle, or `"lophn"`, keeps working.

The `agent` option is now the agent's handle, not its id. lophn resolves a handle among the agents visible in this app's workspace (global agents and agents created in this app); an `agt_...` id is `not_found`.

New in `useAgentSession({ agent, title?, session?, ... })`:

- `title`: the session title (shown in the sidebar), set when the session is opened. Without it the first prompt text becomes the title.
- `session`: re-attach to an existing session of this app (store its id yourself, for example in the app's data, and pass it back after a page reload). Not a session of this app: `error` is `forbidden: ...`.
- Returns also `rename(title)` and `reset()` (forget the session; the next `send` opens a new one with `title`; stop a running turn first with `stop()`).
- While a turn runs or a send is in flight, the SDK keeps the page alive by itself (`useKeepAlive` is not needed for that).
- The app bridge now accepts only `send`, `stop`, `answer` and `rename` from the app. The SDK sends nothing else; code that called `lophnApp.agent.send` with other inputs (approval decisions, rewind, fork) gets `forbidden`.

Move from 1.2.0:

```tsx
// before: an id
const coach = useAgentSession({ agent: "agt_01H..." });
// after: the handle
const coach = useAgentSession({ agent: "omok-coach", title: `Review: ${game.name}`, session: savedSession });
```

- Find the handle: `lophn agent card <handle>`; for an agent that exists only as an id, ask the person which agent it is. The default lophn agent is `lophn`. To use an agent of this app, create it first in this workspace with `lophn agent create <handle>` (`design-app` skill, "An agent inside the app").
- For per-game or per-review conversations: `title`, store `coach.session`, pass it back as `session`, call `reset()` when the next one starts.
