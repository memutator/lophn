---
name: context-update
description: Draft a new context version from the applied one, test it, and publish it.
---

# Change a context

Use this when an existing context's contract, searches or glossary must change:
the documents changed shape, a search is missing, or a person or agent asked for
it. You are the Project Manager of this project, and the context belongs to it.

## 1. Read what is applied

1. Call `context.get` with the context. It gives the applied version number and
   the text other agents receive (types, relations, searches, glossary).
2. Read the contract and the search scripts in the context's folder with the
   file tools. The applied version is the base for the change.
3. If the change comes from broken documents, call `context.violations`. Decide
   whether the contract is wrong or the document is wrong. If the document is
   wrong, tell the person what to fix and stop. Do not edit the person's
   documents.
4. If a type you will rename, remove or make private is public, other contexts
   may point at it. Call `context.list` and `context.get` on the others and keep
   their links working.
5. A change in what a context covers, or in what a term means, is the person's
   to decide. Call `ask` with options and the reason for each. If there is no
   answer, do not submit the related change. Report it as undecided.

## 2. Open the draft

Call `context.draft` with the context ID. It opens a draft of the next version.
Keep the draft ID. Write only inside the draft folder it gives you. Check what
the folder holds against the applied contract. Carry over everything you are not
changing, so the new version differs from the applied one only where the change
needs it.

## 3. Write the change

Edit the contract and the search scripts with the file tools, in the layout the
draft folder already has. A search you keep still needs at least one example. A
search you add needs a name, inputs, a result view and an example.

## 4. Test

Call `context.test` with the context and the draft ID. It checks the draft
against the project's files in isolation and applies nothing. Read the report,
fix the draft, and test again until it passes. Do not submit a failing draft.

## 5. Publish

Call `context.submit` with the context and the draft ID. A passing draft is
applied without asking the person. Until then other agents keep using the
applied version.

Then call `context.get` and confirm the version number moved on.

## 6. Finish

- If a term changed, update it with `glossary.set`, in the person's words.
- Tell the person what changed, what was left as it was, and anything undecided.
