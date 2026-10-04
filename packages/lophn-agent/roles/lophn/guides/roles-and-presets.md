# Roles and Presets

A Preset is one saved agent setup: the role, the instructions you attached, the
focus it may read, the skills and MCP tools you selected, and the connection and
model. There is a product Preset for each role. You can change that Preset, copy
it, or make a new one. You cannot use a Preset to widen a limit the product
fixed for that role. Copying copies the setup only. It does not copy access,
saved secrets, or history.

## The four roles

lophn is the role you talk to first. There is one for the whole product. It
helps you plan a project or an app from material you already have, recommends
where a document belongs, explains how to use lophn, and summarizes how the
product is operating. It does not design an app in detail, interpret a cause, or
write the app. A request to change code becomes a Task. App detail that needs an
engineer continues with App Engineer.

App Engineer is one per app. It is the role for that app's detailed design and
implementation planning. It does not take over planning that belongs outside the
app.

Context Engineer is one for the whole product. It works on focus and on where
documents belong. It does not directly edit a focus just because another role
asks it to.

Operator repeats a check you define. You can attach more than one Operator to
the same project or app. The screen shows Operator together with that project or
app name. The repeat schedule is the Repeating check. An Operator Preset states
the judgment to repeat, the evidence it needs, what it compares, and when it
should refresh. It is not a focus by itself. The focus it may read is part of
the Preset.

## What is fixed, and when it changes

A Preset stores the role, its name, its prompt, the tools it may use, the focus
it may read, the exact skills, the exact MCP server and tool pairs, the
connection accounts and model, and any Instructions attached to it. It does not
store a secret or a price list. Skills and MCP tools are chosen by exact name
from what you have registered. A new tool that appears later is not added to an
old Preset.

Saving a Preset writes a whole new version or leaves the previous version
unchanged. A bad name, a missing choice, an unknown tool, or a choice outside
the role limit rejects the whole save. The version already in use stays on the
current work. You attach the new version explicitly, and it is used the next
time work starts. Removing access or stopping an Operator is not delayed because
an old version exists. While work is in progress, the version it started with
stays in effect. A narrower permission applies immediately.

The product limits on a role are not raised by Preset text, by Instructions, or
by marking an MCP tool safe. Marking one external MCP tool as safe only means
that one tool is not asked about again. It does not make a different tool safe.
