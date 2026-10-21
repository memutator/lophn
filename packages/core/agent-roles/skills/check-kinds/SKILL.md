---
name: check-kinds
description: Check every domain of the project against its kinds and say, for each violation, whether the kinds file or the document is wrong.
---

# Check kinds

The person called this with `/check-kinds`.

1. For each domain in your place information, call `kind.check` with that
   `domain`.
2. For each violation, say whether the kinds file or the document is wrong and
   what you would change. Do not edit the person's documents.
3. If the kinds file has to change, follow the skill `kinds-yaml`. Summarize per
   domain.
