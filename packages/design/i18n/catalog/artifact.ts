export const artifact = {
  "artifact.button.annotate": "Annotate",
  "artifact.button.delete": "Delete",
  "artifact.button.delete-named": "Delete {name}",
  "artifact.button.edit-source": "Edit source",
  "artifact.button.send-annotations": "Send to agent",
  "artifact.dialog.delete-text":
    "This deletes the artifact's folder and everything in it. Rewind can't bring it back.",
  "artifact.dialog.delete-title": "Delete {title}?",
  "artifact.empty.missing":
    "The folder for {name} isn't here anymore. It may have been moved or deleted.",
  "artifact.empty.none":
    "No artifacts yet. Ask an agent for a chart or a report and it will show up here.",
  "artifact.error.delete-failed": "{title} wasn't deleted. Try again.",
  "artifact.label.agent": "the agent",
  "artifact.label.kind": "Artifact",
  "artifact.label.list": "Artifacts",
  "artifact.label.note": "Note",
  "artifact.label.open-link": "Open in an artifact tab",
  "artifact.note.file-root":
    "Opened from your files. This artifact can only read files in {folder}.",
  "artifact.text.annotate-on":
    "Click an element or drag an area, then write a note.",
  "artifact.text.annotations-note":
    "They go as one message to the agent that last wrote this artifact, or to lophn where it lives, and aren't reported as problems.",
  "artifact.text.annotations-sent":
    "They arrived as one message in its session.",
  "artifact.text.memo-note": "Notes stay here until you send them all.",
  "artifact.title.annotations-sent":
    "{count, plural, one {# annotation} other {# annotations}} sent to {agent}",
} as const;
