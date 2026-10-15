export const agents = {
  "project-workspace.button.add-server": "Add server",
  "project-workspace.button.add-skill": "Add skill",
  "project-workspace.button.agent-editor-add-context": "Add context",
  "project-workspace.button.agent-editor-delete": "Delete Operator",
  "project-workspace.button.agent-editor-delete-confirm": "Delete",
  "project-workspace.button.agent-editor-edit-project": "Edit LOPHN.md",
  "project-workspace.button.agent-editor-reset-model": "Reset",
  "project-workspace.button.agent-editor-save": "Save",
  "project-workspace.button.agent-editor-upload-image": "Upload image",
  "project-workspace.button.edit-instructions": "Edit",
  "project-workspace.button.new-operator": "New Operator",
  "project-workspace.button.open-agent": "Open",
  "project-workspace.button.use-workspace-default": "Use Workspace default",
  "project-workspace.empty.agent-editor-no-contexts":
    "No contexts. This operator works with project documents only.",
  "project-workspace.empty.agent-editor-no-mcp":
    "This project has no MCP servers yet.",
  "project-workspace.empty.agent-editor-no-project":
    "This project has no instructions yet.",
  "project-workspace.empty.agent-editor-no-skills":
    "This project has no skills yet.",
  "project-workspace.empty.no-instructions": "LOPHN.md is empty.",
  "project-workspace.empty.no-mcp-servers": "No MCP servers registered yet.",
  "project-workspace.empty.no-permission-rules": "No permission rules yet.",
  "project-workspace.empty.no-skills": "No skills registered yet.",
  "project-workspace.heading.agent-editor-contexts": "Contexts",
  "project-workspace.heading.agent-editor-delete-title": "Delete {name}?",
  "project-workspace.heading.agent-editor-mcp": "MCP servers",
  "project-workspace.heading.agent-editor-model": "Model",
  "project-workspace.heading.agent-editor-permissions": "Permissions",
  "project-workspace.heading.agent-editor-profile": "Profile",
  "project-workspace.heading.agent-editor-skills": "Skills",
  "project-workspace.heading.agents-in-project": "Agents in {project}",
  "project-workspace.heading.agents-new-operator": "New Operator",
  "project-workspace.heading.instructions": "Instructions",
  "project-workspace.heading.mcp-servers": "MCP servers",
  "project-workspace.heading.models-for-project": "Models for this project",
  "project-workspace.heading.permissions": "Permissions",
  "project-workspace.heading.skills": "Skills",
  "project-workspace.info.instructions-file":
    "Your project's AGENTS.md is for coding agents. lophn agents read LOPHN.md.",
  "project-workspace.info.models-follow-default":
    "Leave a row alone and it follows the Workspace default.",
  "project-workspace.info.permissions-lead":
    "Permissions that last are decided only here.",
  "project-workspace.info.stored-in-lophn":
    "Agent definitions are stored in lophn, not in your project folder.",
  "project-workspace.label.agent-counts-built-in":
    "{skills, plural, one {# skill} other {# skills}} · {mcp, number} MCP",
  "project-workspace.label.agent-counts-operator":
    "{contexts, plural, one {# context} other {# contexts}} · {skills, plural, one {# skill} other {# skills}} · {mcp, number} MCP",
  "project-workspace.label.agent-counts-unknown":
    "Can't count until its file is fixed",
  "project-workspace.label.agent-editor-built-in":
    "Built-in instructions (read only)",
  "project-workspace.label.agent-editor-icons": "Icon",
  "project-workspace.label.agent-editor-image-file": "Image file",
  "project-workspace.label.agent-editor-instructions": "Instructions",
  "project-workspace.label.agent-editor-model-changed": "Changed",
  "project-workspace.label.agent-editor-model-inherit":
    "Use project default — {model} (from {source})",
  "project-workspace.label.agent-editor-model-unset":
    "Use project default — none chosen yet",
  "project-workspace.label.agent-editor-name": "Name",
  "project-workspace.label.agent-editor-project-instructions":
    "Project instructions · LOPHN.md — shared by every agent in {project}",
  "project-workspace.label.agent-editor-remove-context": "Remove {name}",
  "project-workspace.label.agent-editor-source":
    "{layer, select, workspace {Workspace} project {project} app {app} agent {this agent} other {lophn}}",
  "project-workspace.label.agent-kind-built-in": "Built in",
  "project-workspace.label.agent-kind-operator": "Operator",
  "project-workspace.label.agent-no-model": "No model",
  "project-workspace.label.agents-target": "the agents",
  "project-workspace.label.avatar-icon-apps": "Apps",
  "project-workspace.label.avatar-icon-bookmark": "Bookmark",
  "project-workspace.label.avatar-icon-compare": "Compare",
  "project-workspace.label.avatar-icon-contexts": "Library",
  "project-workspace.label.avatar-icon-dock": "Chat",
  "project-workspace.label.avatar-icon-documents": "Documents",
  "project-workspace.label.avatar-icon-edit": "Pencil",
  "project-workspace.label.avatar-icon-read": "Reading",
  "project-workspace.label.avatar-icon-roles": "People",
  "project-workspace.label.avatar-icon-search": "Search",
  "project-workspace.label.avatar-icon-series": "Series",
  "project-workspace.label.avatar-icon-terminal": "Terminal",
  "project-workspace.label.instructions-shared":
    "Shared by every agent in {project}",
  "project-workspace.label.model-default": "Use Workspace default ({model})",
  "project-workspace.label.model-default-none": "No model chosen yet",
  "project-workspace.label.model-overrides": "{model} · overrides Workspace",
  "project-workspace.label.open-agent-named": "Open {name}",
  "project-workspace.label.reset-model-named":
    "Use Workspace default for {role}",
  "project-workspace.label.role-app-engineer": "App Engineer",
  "project-workspace.label.role-context-engineer": "Context Engineer",
  "project-workspace.label.role-lophn": "lophn",
  "project-workspace.label.role-operators": "Operators",
  "project-workspace.notice.agent-editor-body-help":
    "The agent reads project instructions first, then these.",
  "project-workspace.notice.agent-editor-delete-body":
    "Its open sessions close. The conversations stay.",
  "project-workspace.notice.agent-editor-issue":
    "{code, select, malformed {This part couldn't be read} unknownField {This field isn't recognized} invalidValue {This value isn't allowed} required {This is required} notAllowed {This isn't allowed here} reservedName {This name is reserved} duplicate {This is already in use} tooLarge {This is too large} missingReference {Something this refers to no longer exists} archivedReference {This context is archived, so pick an active one} overCap {This is wider than the project allows} other {This couldn't be saved}}.",
  "project-workspace.notice.agent-editor-model-help":
    "Only the fields you change are saved; the rest follow project and Workspace defaults.",
  "project-workspace.notice.agent-editor-save-first":
    "Save first to upload an image.",
  "project-workspace.notice.agent-editor-wider-help":
    "Can't be wider than the project's permissions.",
  "project-workspace.notice.agents-change-failed":
    "Couldn't change that. Nothing changed.",
  "project-workspace.notice.agents-delete-failed":
    "Couldn't delete this agent. Nothing changed.",
  "project-workspace.notice.agents-save-conflict":
    "This agent changed after you opened it. Cancel and open it again.",
  "project-workspace.notice.agents-save-failed":
    "Couldn't save this agent. Nothing changed.",
  "project-workspace.notice.agents-upload-failed":
    "Couldn't upload that image. Nothing changed.",
  "settings.agents.action-failed":
    "That didn't work. Nothing changed. Try again.",
  "settings.agents.intro":
    "These apply to every project unless a project or an Operator sets its own.",
  "settings.agents.no-instructions": "No instructions yet.",
  "settings.agents.no-options": "No options for this model.",
  "settings.agents.no-servers": "No MCP servers yet.",
  "settings.agents.no-skills": "No skills yet.",
  "settings.agents.options-unknown": "Options for this model aren't known yet.",
  "settings.button.add-folder": "Add a skill folder",
  "settings.button.add-server": "Add server",
  "settings.button.add-skill": "Add skill",
  "settings.button.cancel-sign-in": "Cancel sign-in",
  "settings.button.change": "Change",
  "settings.button.disconnect": "Disconnect",
  "settings.button.edit": "Edit",
  "settings.button.enter-credential": "Enter credential",
  "settings.button.new-server": "New tool server",
  "settings.button.save": "Save",
  "settings.button.server-sign-in": "Sign in",
  "settings.error.connect-failed":
    "Couldn't connect. Nothing changed. Try again.",
  "settings.error.custom-id":
    "Use lowercase letters, numbers, hyphens or underscores.",
  "settings.error.custom-name": "Enter a display name.",
  "settings.error.custom-url": "Use https, or http only for this computer.",
  "settings.extensions.folder-added":
    "{name} is added. New work can use its skills.",
  "settings.extensions.folder-failed":
    "The folder wasn't added. Nothing changed. Pick the folder again.",
  "settings.extensions.intro":
    "Skills and tool servers extend what an agent can do. Adding one doesn't give an agent more access.",
  "settings.extensions.no-folders": "No skill folders are added yet.",
  "settings.extensions.no-servers": "No tool servers are added yet.",
  "settings.extensions.server-added":
    "{name} is added. New work can use it once any credential is saved.",
  "settings.extensions.server-failed":
    "{name} wasn't added. Nothing changed. Check the details and add it again.",
  "settings.heading.add-provider": "Add a provider",
  "settings.heading.agents-defaults": "Default models",
  "settings.heading.agents-instructions": "Instructions for all projects",
  "settings.heading.agents-servers": "MCP servers (all projects)",
  "settings.heading.agents-skills": "Skills (all projects)",
  "settings.heading.agents-summaries": "Model for summaries",
  "settings.heading.connected": "Connected",
  "settings.heading.servers": "Tool servers",
  "settings.heading.skills": "Skills",
  "settings.label.agents-target": "your agent settings",
  "settings.label.available-target": "the providers you can add",
  "settings.label.custom-id": "Provider ID",
  "settings.label.custom-key": "Add an API key (optional)",
  "settings.label.custom-name": "Display name",
  "settings.label.custom-provider-hint": "Any OpenAI-compatible endpoint",
  "settings.label.custom-url": "Base URL",
  "settings.label.extensions-target": "your tools and skills",
  "settings.label.location": "Location",
  "settings.label.login-signed-in": "Signed in",
  "settings.label.method-opens-browser": "Opens your browser",
  "settings.label.method-paste-key": "Paste a key",
  "settings.label.method-sign-in": "Sign in with {product}",
  "settings.label.model-line": "{name} · {model}",
  "settings.label.model-name": "Model",
  "settings.label.not-chosen": "Not chosen",
  "settings.label.off": "Off",
  "settings.label.on-computer": "Runs on this computer",
  "settings.label.option-pair": "{axis}: {value}",
  "settings.label.over-web": "Connects over the web",
  "settings.label.providers-target": "your connections",
  "settings.label.role-app-engineer": "App Engineer",
  "settings.label.role-context-engineer": "Context Engineer",
  "settings.label.role-lophn": "lophn",
  "settings.label.role-operator": "Operators",
  "settings.label.server-address": "Address",
  "settings.label.server-arguments": "Arguments",
  "settings.label.server-auth": "Sign-in",
  "settings.label.server-header": "Header name",
  "settings.label.server-name": "Name",
  "settings.label.server-program": "Program",
  "settings.label.server-transport": "How it connects",
  "settings.label.sign-in-how": "How do you want to sign in to {name}?",
  "settings.label.status-connected": "Connected",
  "settings.label.status-needs-sign-in": "Needs sign-in",
  "settings.label.unavailable-connection": "A connection that isn't listed",
  "settings.notice.custom-id-help":
    "Lowercase letters, numbers, hyphens or underscores.",
  "settings.notice.custom-key-help":
    "You enter the key in a protected window after you connect.",
  "settings.notice.custom-key-required":
    "A web address needs an API key. Check the box below.",
  "settings.notice.custom-lead": "Set up an OpenAI-compatible provider.",
  "settings.notice.method-unverified": "Not confirmed to work with lophn yet.",
  "settings.notice.next-run": "Changes apply to new work.",
  "settings.notice.none-connected": "No providers are connected yet.",
  "settings.notice.provider-lead":
    "A provider is a service you connect with one key or sign-in. You choose models per agent and per session, not here.",
  "settings.notice.window-opened":
    "Finish in the window that opened. This list updates when you come back.",
  "settings.server.address-help":
    "A secure web address, or one on this computer.",
  "settings.server.arguments-help": "One per line. They are passed as written.",
  "settings.server.auth-sign-in-absent":
    "Signing in to a tool server isn't available yet.",
  "settings.server.credential-missing":
    "A credential is needed before new work can use this server.",
  "settings.server.credential-set": "Credential saved.",
  "settings.server.credential-unknown":
    "Whether a credential is saved couldn't be checked.",
  "settings.server.error-header": "Use letters, numbers and dashes, up to 64.",
  "settings.server.error-name":
    "Use letters, numbers, dashes and underscores, up to 32.",
  "settings.server.error-path":
    "Enter the full path of the program, starting from the top folder.",
  "settings.server.error-taken": "A server with this name already exists.",
  "settings.server.error-url":
    "Enter a secure web address, or one on this computer.",
  "settings.server.name-help": "A short name you will recognize.",
  "settings.server.program-help":
    "The full path of the program to start on this computer.",
  "settings.server.sign-in-busy":
    "A sign-in for this server is already waiting. Finish it in your browser.",
  "settings.server.sign-in-failed":
    "Couldn't sign in to {name}. Nothing changed. Try again.",
  "settings.server.sign-in-needed":
    "Sign in before new work can use this server.",
  "settings.server.sign-in-not-opened":
    "The sign-in page didn't open. Try again.",
  "settings.server.sign-in-reason-callback-timeout":
    "The sign-in wasn't finished in time. Try again.",
  "settings.server.sign-in-reason-exchange-failed":
    "The service didn't accept the sign-in. Try again.",
  "settings.server.sign-in-reason-expired":
    "This sign-in expired. Sign in again.",
  "settings.server.sign-in-reason-refresh-rejected":
    "The service ended this sign-in. Sign in again.",
  "settings.server.sign-in-reason-state-mismatch":
    "The sign-in page sent back something unexpected, so it was rejected. Try again.",
  "settings.server.sign-in-reason-store-failed":
    "The sign-in couldn't be saved on this computer. Try again.",
  "settings.server.signed-in": "Signed in.",
  "settings.sign-in.waiting": "Complete the sign-in in your browser.",
  "settings.status.plan-access":
    "Your plan doesn't allow this. Check that your plan includes it.",
  "settings.status.sign-in-problem":
    "There's a sign-in problem. Disconnect, then connect again.",
  "settings.status.usage-limit":
    "Usage limit reached. Wait for the limit to reset.",
  "settings.title.connect-provider": "Connect {name}",
  "settings.title.custom-provider": "Custom provider",
} as const;
