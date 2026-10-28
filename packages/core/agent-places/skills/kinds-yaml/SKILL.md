---
name: kinds-yaml
description: Write or change a domain's kinds file (kinds.yaml): which documents are items of which kind, and which fields each kind has. Also what to do when documents break the kinds.
---

# Write the kinds file

Use this when a domain has no kinds yet, when a person names a new kind of
document, or when documents break the kinds (see "When documents break the
kinds"). The kinds file belongs to a domain and lives in the domain's folder.
The globs in it are relative to the folders of the project or app that holds the
domain. You write it in a conversation at that project or app.

## 1. Read

Read the request and the documents with the file tools (`file.glob`,
`file.grep`, `file.read`, `file.outline`). If the domain already has kinds, call
`kind.check` to see the current state first (pass `domain` if you have more than
one).

## 2. Ask what is the person's to decide

What a document is, which documents are one kind, the field names, which fields
are required and which values are allowed are the person's to decide. If the
request does not settle them, call `ask` with options and the reason for each.
If there is no answer, do not write. Report it as undecided.

## 3. Write

Write the whole file with `file.write` as `kinds.yaml` in the domain's folder
(your place information lists the folder of each domain). It is the only file
you write there for this. There is no draft and no release: a saved file is
checked and used at once. Each domain has its own kinds file, so a kind is
written in the domain it belongs to.

## 4. Check

Call `kind.check` right away (with `domain` if you have more than one).

- If `status.errors` is not empty, the file itself is wrong. Fix it and write it
  again. A wrong file does not replace the last valid one: that keeps being
  used.
- If documents break the schema (violations), follow "When documents break the
  kinds".

## 5. Confirm

Call `kind.list` for each new kind and check that the items you meant to include
come back. Tell the person which kinds you wrote and what is left undecided.

If the domain has a kind map artifact (see "Drawing a domain" in
`guide-artifact`), change its data too when you change the kinds file.

## When documents break the kinds

The person tells you, or `kind.check` shows violations. lophn does not open a
session for it; the person sees a notice and may ask you.

1. Read the state with `kind.check` (with `domain` if you have more than one).
2. Decide whether the kinds file should change or the document is wrong. Say
   which, and why.
3. If the kinds file should change, write it as above. If the document is wrong,
   tell the person what to fix. Do not edit the person's documents.

## The file

```yaml
kinds:
  - name: receipt
    summary: Receipt for one expense
    files: [receipts/**/*.md]
    key: slug
    fields:
      slug: { type: string, required: true, pattern: "^[a-z0-9-]+$" }
      store: { type: string, required: true }
      amount: { type: number, required: true }
      date: { type: date, required: true }
      method: { type: enum, values: [card, cash], required: true }
      year: { type: number, from: path, capture: "receipts/{year}/*.md" }
      vendor: { type: ref, to: vendor }
  - name: vendor
    summary: A shop the person often visits
    files: [vendors/*.md]
    key: file
    fields:
      name: { type: string, required: true, unique: true }
```

- A kind has `name` (`^[a-z][a-z0-9_]*$`), `summary` (one line), `files` (globs
  relative to the folder of the project or app that holds the domain), `key` and
  `fields` (field name to properties). One document is one item. A file must not
  match the globs of two kinds.
- `key` is one field. Its value is unique within the kind. A key of `path` or
  `file` needs no field.
- Every item has two fields without declaring them: `path` (relative to the
  container folder) and `file` (the file name without its extension). You cannot
  declare fields with these names.
- A field `type` is `string`, `number`, `boolean`, `date`, `enum` or `ref`.
  Properties are `required`, `unique`, `list` (a list of that type), `values`
  (enum only, the allowed values), `pattern` (string only, a regex), `to` (ref
  only, a kind in the same file) and `from: path` with `capture`. The `capture`
  is a path glob that contains the field name in braces exactly once.
- Values are read from the frontmatter of an `.md` file, or from the top-level
  map of a `.yaml` or `.json` file. `from: path` reads the value from the path.
  The body of an `.md` file is not a field.
- A file such as a pdf or an image has no document values, only the ones read
  from its path. If a person needs the values inside, write an `.md` next to it
  when asked.
- There is no series. A number is a `from: path` field, the order is the sort of
  `kind.list`, duplicates are caught with `unique`, and the next number is `max`
  plus one.

## What you do not do

- Do not edit the person's documents, not even to fix a violation.
- Do not decide what a term or a kind means. Ask.
- Do not write code. A calculation the schema cannot say is not yours here.
- There are no relations to follow, no saved views and no rule list. Do not look
  for them.
