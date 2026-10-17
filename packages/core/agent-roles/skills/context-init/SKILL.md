---
name: context-init
description: Set the project's purpose, then draft the first context version with its contract and search scripts, test it, and publish it.
---

# Start a context

Use this when the project has no context for the work yet, or a person asks for
a new one. You are the Project Manager of this project, and the context belongs
to it.

## 1. Set the purpose

1. Read the request. Read the project's documents with the file tools
   (`file.glob`, `file.grep`, `file.read`) to see what the work is about.
2. Call `context.list`. If an existing context already covers the request, stop
   and use `context-update` on it instead.
3. Draw the boundary. Documents inside one context should hang tightly together,
   and different contexts should point at each other as little as possible. Pick
   a short name and a purpose of one sentence.
4. The boundary, the name and the purpose are the person's to decide. If the
   request does not settle them, call `ask` with options and the reason for
   each. If there is no answer, stop here and report it as undecided.

## 2. Open the draft

Call `context.draft` with the `name` and `purpose`. It creates the context and
opens its first draft. Keep the draft ID. Write only inside the draft folder it
gives you.

## 3. Write the contract and the search scripts

Write them with the file tools, in the layout the draft folder already has. If
the folder gives you nothing to follow, say so to the person and do not invent a
layout.

The contract describes how the documents map to things the other agents ask
about.

- Each type has a capitalized name, a one-line `summary`, a `visibility`
  (`public` only for what other contexts may point at), a `source` that finds
  its documents (a folder, a list of docs, a numbered series, an index, a
  section, an outline, or app data), a `key` field, its `fields`, its
  `relations` and its check `rules`.
- Each field says where its value comes from (frontmatter, a yaml key, a
  section, the path, the title, links, an outline), its value type, and whether
  it is required.
- Each relation names the type it points to, the field that holds the link, and
  how many (`one`, `optional`, `many`).
- Rules are the checks a document must pass, such as a required field, a unique
  key, an existing relation target, an allowed value, a pattern or a count
  range.
- Keep it small. Model only what people will search for.

Each search has a name, a title, inputs, a query and a result view. Every search
needs at least one example with the keys it must return. Do not touch the
person's documents.

## 4. Test

Call `context.test` with the context and the draft ID. It checks the draft
against the project's files in isolation and applies nothing. Read the report,
fix the draft, and test again until it passes. Do not submit a failing draft.

## 5. Publish

Call `context.submit` with the context and the draft ID. A passing draft is
applied without asking the person. Until then nothing else sees it.

Then call `context.get` and confirm the applied version is the one you
submitted.

## 6. Finish

- Set the terms the person defined with `glossary.set`, in their own words. If
  one word means different things in different documents, report the conflict
  and do not merge them.
- Tell the person what the context covers, its main types and searches, and
  anything left undecided.
- If documents break the new contract, read `context.violations`. If a document
  is wrong, tell the person what to fix. Do not edit it yourself.
