# Connections

A connection is how an agent reaches Claude, ChatGPT, Grok, another supported
service, or a local model. The product name is what you see. Connection is the
general word. A subscription name alone does not mean that path is ready to use.

## What you can connect

In Settings you choose the path and where it connects. API billing, a
subscription limit and extra usage charges are different. An amount that was not
reported stays unknown.

You can use an API key for Claude (Anthropic), ChatGPT (OpenAI), Grok (xAI),
OpenRouter, Groq, DeepSeek and Google Gemini. You can use a local connection for
Ollama, LM Studio and llama.cpp. A local connection on your own machine does not
ask for a secret. A remote connection uses a protected key or sign-in and an
encrypted connection.

Sign in with ChatGPT and SuperGrok sign-in are available only after this product
has confirmed that lophn may use that sign-in and that a real text reply and
tool call succeed. Claude sign-in through Claude.ai is not offered. Claude uses
an API key only. lophn does not pretend an unverified sign-in path is ready, and
it does not reuse a login stored by another program.

## Protected entry

An API key, token or sign-in result is entered only in the protected field that
the app (not the conversation) opens. Do not paste it into the conversation, a
document, instructions or an ordinary Settings field. If one of those places
contains a secret, lophn blocks that submission and points you back to the
protected field.

You start sign-in yourself. Closing the field or canceling saves nothing. The
value is stored by lophn and the agent cannot read it. This guide cannot show
it.

A connection test is separate and only runs when you ask for it. Saving a
setting is not a successful test.

## Accounts and models

Each agent has its own model, and a connection can have more than one account.
You name the accounts, and only confirmed account, organization and plan details
are shown. The same key cannot be registered twice. An agent does not borrow
another account, service or model when one is blocked.

A new model applies the next time a turn starts. A turn already running keeps
the choice it started with. Turning a connection off or removing a saved key
blocks new calls. It does not mark work that already finished as done.
