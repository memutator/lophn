# @lophn/agent 1.4.0

Previous: 1.3.0
Breaking: no

`session.capabilities` (in the `state` of `useAgentSession`) has one more flag, `background`. It is `true` when the session can move its running tool (a long command or a subagent) to the background. The lophn agent always reports `false`. The SDK does not send the input behind it, and the app bridge does not accept it.

Read it like the other capability flags:

```tsx
const canBackground = coach.state?.session?.capabilities.background === true;
```

Nothing is required of an existing app.
