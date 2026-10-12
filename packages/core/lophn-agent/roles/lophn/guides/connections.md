# Connections

A Connection is how an agent reaches Claude, ChatGPT, Grok, another supported
service, or a local model. The product name is what you see. Connection is the
general word. A subscription name alone does not mean that path is ready to use.

## What you can connect

In Settings you choose the path and where it connects. API billing, a
subscription limit, and extra usage charges are different. An amount that was
not reported stays unknown.

You can use an API key for Claude (Anthropic), ChatGPT (OpenAI), Grok (xAI),
OpenRouter, Groq, DeepSeek, and Google Gemini. You can use a local connection
for Ollama, LM Studio, and llama.cpp. A local connection on your own machine
does not ask for a secret. A remote connection uses a protected key or sign-in
and an encrypted connection.

Sign in with ChatGPT and SuperGrok sign-in are available only after this product
has confirmed that lophn may use that sign-in and that a real text reply and
tool call succeed. Claude sign-in through Claude.ai is not offered. Claude uses
an API key only. Google account sign-in, Vertex AI, and AWS sign-in are not
offered. lophn does not pretend an unverified sign-in path is ready, and it does
not reuse a login stored by another program.

## Protected entry

An API key, token, or sign-in result is entered only in the protected field in
the confirmation window. Do not paste it into the conversation, a document,
Instructions, or an ordinary Settings field. If one of those places contains a
secret, lophn blocks that submission and points you back to the protected field.

You start sign-in yourself. ChatGPT uses its official device sign-in first, and
only if that account cannot use it do you paste the final browser address from
the fallback sign-in. SuperGrok uses its device sign-in only. Closing the window
or canceling does not count as agreement, and no key or sign-in is saved. The
value is stored in the operating system keychain. The product keeps a reference,
not the value. The agent cannot read it, and this guide cannot show it. If the
keychain is missing or locked, connections that need a secret stay unavailable.
lophn does not switch them to a plain file or an environment variable. Local
features that need no secret keep working.

A connection test is separate and only runs when you ask for it. It uses test
material, not your documents or the current conversation. Saving a setting is
not a successful test. A test does not bypass a usage wait.

## Accounts and models

Each Preset has its own ordered list of accounts and its own model. For
decisions and For summaries are the two uses. For decisions is the model used
when the role chooses. If you do not choose a separate model for summaries, that
Preset uses the same model it uses for decisions. The common defaults are only a
starting suggestion when you create a Preset. They do not silently replace a
Preset you already saved.

The same service can have more than one account. You name them, and only
confirmed account, organization, and plan details are shown. The same key, or
the same account and organization sign-in, cannot be registered twice. The same
email in a different organization stays a different account. A Preset uses only
the accounts you listed, in the order you listed. It does not borrow another
account, another service, or another model when one is blocked. The next account
in that same list is used only when the current one rejects sign-in, is waiting
on a usage limit, or cannot use the selected model.

A new model or account order applies the next time work starts. Work already in
progress keeps the choice it started with. Turning a connection off or removing
a saved key or sign-in blocks new calls. It does not mark work that already
finished, failed, or stopped as done.
