export const agents = {
  "agents.heading.settings-default-model": "Default model",
  "agents.label.providers-custom-key-title": "API key",
  "agents.label.providers-key-hint": "Typed in a protected prompt",
  "agents.label.settings-instructions-path": "~/.lophn/LOPHN.md",
  "agents.label.settings-lophn-in": "{agent} \u00b7 {workspace}",
  "agents.notice.providers-custom-key":
    "Typed in a protected prompt after you connect, outside this window.",
  "agents.notice.providers-disconnect-body":
    "lophn forgets the saved key or sign-in for {name}. Agents can't use it until you connect again.",
  "agents.notice.providers-disconnect-failed":
    "Couldn't disconnect. Nothing changed. Try again.",
  "agents.error.settings-model-save-failed":
    "Couldn't save this model. The previous one is kept. Try again.",
  "agents.error.instructions-conflict":
    "This file changed somewhere else. Reload to see it. Your text here isn't saved.",
  "agents.error.instructions-save-failed":
    "Couldn't save the instructions. Nothing changed. Try again.",
  "agents.notice.settings-agents-lead":
    "Defaults for every project. A project or an agent can change them.",
  "agents.notice.settings-default-model-help":
    "One model for every agent. A project, or an agent's own settings, can pick another.",
  "agents.notice.settings-instructions-help":
    "Every lophn agent reads this first, in every project and app.",
  "agents.notice.settings-tools-elsewhere":
    "Skills and MCP servers for all projects are in Tools and skills.",
  "agents.notice.settings-tools-lead":
    "The global layer, shared by every project. A project can turn an item off for itself, and an agent can turn it off for itself too.",
  "agents.notice.settings-tools-servers":
    "A server with the same name in a project or an agent replaces this one for that layer.",
  "agents.notice.settings-tools-skills":
    "Skill folders follow the Agent Skills format (SKILL.md). lophn has no built-in skills yet.",
  "agents.notice.stored-in-lophn":
    "Agent definitions are stored in lophn, in one place for every project, not in your project folder.",
  "agents.heading.model-for-workspace":
    "Model for {kind, select, home {Home} app {this app} other {this project}}",
  "agents.label.card-model":
    "Model: {layer, select, agent {{model}} project {workspace default ({model})} other {global default ({model})}}",
  "agents.notice.model-for-workspace":
    "One model for every agent in {kind, select, home {Home} app {this app} other {this project}}. An agent can pick its own in its settings.",
  "agents.notice.skills-workspace":
    "A switch turns a skill on or off for {kind, select, home {Home} app {this app} other {this project}}. Global skills can be turned off here too.",
  "agents.heading.memory": "Memory",
  "agents.label.memory-head": "Memory \u00b7 memory.md of {workspace}",
  "agents.label.memory-head-agent": "Memory of this agent",
  "agents.label.memory-size": "{size} of {max}",
  "agents.label.memory-size-over": "{size} of {max} \u2014 too long",
  "agents.empty.memory": "Nothing remembered yet.",
  "agents.notice.memory-home":
    "lophn writes this with its memory tool. This is the global memory: every agent in every workspace reads it, so keep to what holds across workspaces. Your edits show from the next session on.",
  "agents.notice.memory-workspace":
    "lophn writes this with its memory tool. Every agent in {workspace} reads it, and they also read the global memory (Home's memory). Your edits show from the next session on.",
  "agents.notice.memory-agent":
    "This agent writes this with its memory tool and reads it at the start of a session. Your edits show from the next session on.",
  "agents.notice.memory-agent-after-create":
    "This agent can remember things once it is saved.",
  "agents.notice.tab-lead":
    "Global agents work in every project and app. An agent scoped to this workspace shows only here. A session works in the workspace where you open it.",
  "agents.notice.tab-lead-home":
    "Home lists every agent: global ones and those scoped to a project or app. A scoped agent works only in its own workspace, and a session works in the workspace where you open it.",
  "agents.button.assign-app": "Assign app",
  "agents.button.choose-character": "Choose character",
  "agents.button.create-agent": "Create agent",
  "agents.button.remove-app": "Remove app",
  "agents.button.remove-image": "Remove image",
  "agents.button.remove-tool": "Remove {name}",
  "agents.button.remove-tool-short": "Remove",
  "agents.button.add-tool": "Add",
  "agents.button.change-secret": "Change {label}",
  "agents.button.set-secret": "Set {label}",
  "agents.button.sign-in": "Sign in",
  "agents.empty.grants-computers": "No apps from other computers are assigned.",
  "agents.empty.grants-apps":
    "No apps. An assigned app brings all of its tools.",
  "agents.heading.all-agents": "All agents",
  "agents.heading.coding-agents": "Your coding agents",
  "agents.notice.coding-agents":
    "Your favorite coding agents from Settings. lophn can hand work to them, and they run with your own settings for that tool.",
  "agents.heading.grants-apps": "Apps",
  "agents.heading.grants-computers": "Other computers",
  "agents.heading.server-form": "Add a server for this agent only",
  "agents.heading.skip": "Skip permissions",
  "agents.heading.extensions": "Shell extensions",
  "agents.label.extension-tools":
    "{count, plural, one {# tool} other {# tools}}",
  "agents.label.extension-unavailable": "Not available: turned off or removed",
  "agents.notice.extensions-help":
    "Tools of an assigned extension are available to this agent. Only extensions installed and turned on are listed. A custom agent still picks the ones it uses under Tools.",
  "agents.heading.runtime": "Runtime",
  "agents.heading.tools": "Tools",
  "agents.label.agent-instructions": "Instructions for this agent",
  "agents.label.description": "Description",
  "agents.label.runtime": "Runtime",
  "agents.label.runtime-lophn": "lophn",
  "agents.label.runtime-custom": "Custom",
  "agents.label.runtime-claude-code": "Claude Code",
  "agents.label.runtime-codex": "Codex",
  "agents.label.runtime-opencode": "OpenCode",
  "agents.label.tools-add": "Add an MCP tool by name",
  "agents.label.tools-add-placeholder": "mcp__server__tool",
  "agents.label.auth-api-key": "API key in a header",
  "agents.label.auth-bearer": "Bearer token",
  "agents.label.auth-none": "None",
  "agents.label.auth-oauth2": "OAuth 2.1",
  "agents.label.character-shape": "Shape",
  "agents.label.character-color": "Color",
  "agents.label.character-square": "Square",
  "agents.label.character-capsule": "Capsule",
  "agents.label.character-wide": "Wide",
  "agents.label.character-pear": "Pear",
  "agents.label.character-round": "Round",
  "agents.label.character-arch": "Arch",
  "agents.label.character-coral": "Coral",
  "agents.label.character-periwinkle": "Periwinkle",
  "agents.label.character-yellow": "Yellow",
  "agents.label.card-runtime": "Runtime: {runtime}",
  "agents.label.card-model-line": "Model: {model} ({provider})",
  "agents.label.card-model-priced":
    "Model: {model} ({provider}), ${input} in / ${output} out per 1M tokens",
  "agents.label.card-modality": "Takes {input}. Gives {output}.",
  "agents.label.card-replies": "Replies: {replies}",
  "agents.label.card-plus": "Has more than lophn: {items}",
  "agents.label.card-minus": "Lacks: {items}",
  "agents.label.modality-text": "text",
  "agents.label.modality-image": "image",
  "agents.label.modality-file": "file",
  "agents.label.modality-input": "Takes",
  "agents.label.modality-output": "Gives",
  "agents.label.reply-none": "none",
  "agents.label.reply-result": "result",
  "agents.label.reply-conversation": "conversation",
  "agents.heading.card": "Card",
  "agents.heading.modality": "Input and output",
  "agents.notice.card-help":
    "What other agents and people see when they pick this agent. It follows the saved definition.",
  "agents.notice.modality-help":
    "What this agent takes in and gives back. Every kind is on unless you turn it off.",
  "agents.label.character-sage": "Sage",
  "agents.label.character-lavender": "Lavender",
  "agents.label.character-peach": "Peach",
  "agents.label.character-blue": "Blue",
  "agents.label.character-teal": "Teal",
  "agents.label.avatar-preview": "Avatar preview",
  "agents.label.built-in": "Built-in",
  "agents.label.effect-external": "External",
  "agents.label.effect-read": "Read",
  "agents.label.effect-write": "Write",
  "agents.label.grant-col-allowed": "Allowed",
  "agents.label.grant-col-effect": "Effect",
  "agents.label.grant-col-name": "Name",
  "agents.label.grants-app-tools-summary":
    "{used, number} of {total, number} tools",
  "agents.label.grants-app-gone": "Not on this computer any more",
  "agents.label.grants-apps-unread": "Could not read {machine}'s apps",
  "agents.label.grants-target": "the grants",
  "agents.label.instructions-head-placed":
    "Workspace instructions \u00b7 {file} in {workspace} \u2014 read by every agent working there",
  "agents.label.secret-client": "client secret",
  "agents.label.secret-header": "{name} header",
  "agents.label.secret-value": "value",
  "agents.label.layer-agent": "This agent",
  "agents.label.layer-app": "App",
  "agents.label.layer-builtin": "Built-in",
  "agents.label.layer-global": "Global",
  "agents.label.layer-workspace-data": "Data folder",
  "agents.label.layer-project": "Project",
  "agents.label.layer-workspace": "Workspace",
  "agents.label.layer-shared": "Shared by an app",
  "agents.label.model-inherit":
    "Use {layer, select, project {workspace} other {global}} default \u2014 {model}",
  "agents.label.model-overrides":
    "Overrides {layer, select, project {workspace} other {global}}",
  "agents.label.no-model-chosen": "No model chosen yet",
  "agents.label.workspace": "Workspace",
  "agents.label.workspace-lophn": "All of lophn",
  "agents.label.workspace-home": "Home",
  "agents.label.workspace-named": "{name} \u00b7 project",
  "agents.label.workspace-named-app": "{name} \u00b7 app",
  "agents.label.protected-key": "Key or token",
  "agents.label.protected-secret": "Client secret",
  "agents.label.skip-start": "Start new sessions with Skip permissions",
  "agents.label.tab-general": "General",
  "agents.label.tab-runtime": "Runtime",
  "agents.label.tab-instructions": "Instructions",
  "agents.label.tab-skills": "Skills",
  "agents.label.tab-memory": "Memory",
  "agents.label.tab-tools": "Tools",
  "agents.label.tab-grants": "Grants",
  "agents.label.tab-has-issues": "Needs attention",
  "agents.label.nav-back": "Back",
  "agents.label.nav-forward": "Forward",
  "agents.notice.credential-later":
    "If the server needs a key or token, lophn asks for it in a protected prompt after you add it.",
  "agents.notice.grants-after-create":
    "You can assign apps in the Grants tab once the agent exists.",
  "agents.notice.instructions-app-none":
    "This app has no source folder yet, so it has no AGENTS.md. Only the instructions below apply here.",
  "agents.notice.grants-apply-now": "Changes in Grants apply right away.",
  "agents.notice.grants-lead":
    "What {name} can use besides its own tools. Anything you don't assign here, {name} can't use.",
  "agents.notice.grants-computers":
    "Apps that run on your other computers. Only the commands an app offers to other computers can be assigned, and they run on that computer.",
  "agents.notice.grants-mcp-layers":
    "MCP servers are set where you add them: Settings \u203a Tools and skills, the project, or this agent's Definition.",
  "agents.notice.instructions-help":
    "Read after the workspace instructions. Your global instructions come before both.",
  "agents.notice.instructions-help-lophn":
    "Read after your global instructions (Settings \u203a Agents).",
  "agents.notice.handle-fixed-lophn":
    "lophn's handle and profile can't be changed. You can rename how it is shown.",
  "agents.label.handle": "Handle",
  "agents.notice.handle-help":
    "How other agents and apps address this agent. Lowercase letters, digits, - and _. Left empty, it is made from the name. It can't be changed after you save.",
  "agents.notice.workspace-help":
    "Where this agent can be used. A scoped agent shows only in its workspace. It can't be changed after you save.",
  "agents.notice.profile-help":
    "Choose a shape and color, or upload an image. It shows next to the agent's messages.",
  "agents.notice.protected-key":
    "Typed in a protected prompt after you add the server. It isn't typed here and isn't shown again.",
  "agents.notice.server-name-help":
    "Letters, numbers, dashes and underscores. Other agents don't see this server.",
  "agents.notice.description-help": "One line about what this agent is for.",
  "agents.notice.runtime-help":
    "lophn adds the lophn rules, skills and built-in tools. Custom sends only the instructions above, the lophn tool and the tools and skills you pick.",
  "agents.notice.fixed-coding":
    "Built-in coding agent: its handle, runtime and scope can't be changed, and it can't be deleted. You can rename how it is shown. It runs the CLI with your own settings.",
  "agents.notice.tools-help":
    "A session only gets a picked tool its workspace kind (home, project, app) and its MCP servers allow. A custom agent always has the lophn tool with every lophn command of its workspace and the public commands of its apps.",
  "agents.notice.skip-help":
    "A session started this way runs shell commands without asking. Deny rules still block them.",
  "agents.notice.skills-custom-pick":
    "Pick the skills this agent gets. Picking one also gives it skill.read.",
  "agents.notice.skills-agent-only":
    "The chip says which layer a skill comes from. Switch a skill off to leave it out for this agent. A skill that is off in a layer above stays off.",
  "agents.error.mcp-sign-in-failed":
    "The server didn't finish signing in. Try again.",
  "agents.title.change-failed": "Couldn't change that",
  "agents.title.delete-failed": "Couldn't delete",
  "agents.title.providers-disconnect": "Disconnect {name}?",
  "agents.title.save-conflict": "Changed since you opened it",
  "agents.title.save-failed": "Couldn't save",
  "agents.title.sign-in-failed": "Couldn't sign in",
  "agents.title.upload-failed": "Couldn't upload",
  "project-workspace.button.add-server": "Add server",
  "project-workspace.button.add-skill": "Add skill",
  "project-workspace.button.agent-editor-delete": "Delete agent",
  "project-workspace.button.agent-editor-delete-confirm": "Delete",
  "project-workspace.button.agent-editor-save": "Save",
  "project-workspace.button.agent-editor-upload-image": "Upload image",
  "project-workspace.button.edit-instructions": "Edit",
  "project-workspace.button.new-agent": "New agent",
  "project-workspace.button.open-agent": "Open",
  "project-workspace.empty.agent-editor-no-project":
    "No instructions here yet.",
  "project-workspace.empty.no-instructions": "No instructions yet.",
  "project-workspace.empty.no-mcp-servers": "No MCP servers registered yet.",
  "project-workspace.empty.no-skills": "No skills registered yet.",
  "project-workspace.heading.agent-editor-delete-title": "Delete {name}?",
  "project-workspace.heading.agent-editor-mcp": "MCP servers",
  "project-workspace.heading.agent-editor-model": "Model",
  "project-workspace.heading.agent-editor-profile": "Profile",
  "project-workspace.heading.agent-editor-skills": "Skills",
  "project-workspace.heading.agents-new-agent": "New agent",
  "project-workspace.heading.instructions": "Instructions",
  "project-workspace.heading.mcp-servers": "MCP servers",
  "project-workspace.heading.skills": "Skills",
  "project-workspace.info.instructions-file":
    "Your project's AGENTS.md is for coding agents. lophn agents read LOPHN.md.",
  "agents.notice.instructions-file-home":
    "Home's LOPHN.md is kept in lophn's data folder. It is read by lophn in Home.",
  "agents.notice.instructions-file-app":
    "This is the AGENTS.md in the app's source folder. Coding agents and lophn agents read it.",
  "agents.notice.instructions-file-app-none":
    "This app has no source folder yet, so there is no AGENTS.md to edit.",
  "project-workspace.label.agent-counts":
    "{skills, plural, one {# skill} other {# skills}} · {mcp, number} MCP",
  "project-workspace.label.agent-counts-unknown":
    "Can't count until its file is fixed",
  "project-workspace.label.agent-editor-image-file": "Image file",
  "project-workspace.label.agent-editor-instructions": "Instructions",
  "project-workspace.label.agent-editor-model-unset":
    "Use workspace default — none chosen yet",
  "agents.label.model-unset-global": "Use global default — none chosen yet",
  "project-workspace.label.agent-editor-name": "Name",
  "project-workspace.label.agent-no-model": "No model",
  "project-workspace.label.agents-target": "the agents",
  "project-workspace.label.instructions-shared":
    "Shared by every agent in {workspace}",
  "project-workspace.label.open-agent-named": "Open {name}",
  "project-workspace.notice.agent-editor-delete-body":
    "Its open sessions close. The conversations stay.",
  "project-workspace.notice.agent-editor-issue":
    "{code, select, malformed {This part couldn't be read} unknownField {This field isn't recognized} invalidValue {This value isn't allowed} required {This is required} notAllowed {This isn't allowed here} reservedName {This handle is reserved} duplicate {This is already in use} unknown {This isn't a tool, command, or MCP tool name} tooLarge {This is too large} overCap {This is wider than the project allows} other {This couldn't be saved}}.",
  "project-workspace.notice.agent-editor-model-help":
    "Only the fields you change are saved; the rest follow workspace and global defaults.",
  "project-workspace.notice.agent-editor-save-first":
    "Save first to upload an image.",
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
  "settings.agents.no-instructions": "No instructions yet.",
  "settings.agents.no-servers": "No MCP servers yet.",
  "settings.agents.no-skills": "No skills yet.",
  "settings.button.add-server": "Add server",
  "settings.button.add-skill": "Add skill",
  "settings.button.disconnect": "Disconnect",
  "settings.button.edit": "Edit",
  "settings.button.save": "Save",
  "settings.button.skip": "Skip",
  "settings.error.connect-failed":
    "Couldn't connect. Nothing changed. Try again.",
  "settings.error.custom-id":
    "Use lowercase letters, numbers, hyphens or underscores.",
  "settings.error.custom-name": "Enter a display name.",
  "settings.error.custom-url": "Use https, or http only for this computer.",
  "settings.error.sign-in-expired":
    "The sign-in took too long. Nothing changed. Try again.",
  "settings.error.sign-in-refused":
    "This account can't be used here. Nothing changed. Try another account or an API key.",
  "settings.extensions.server-added":
    "{name} is added. New work can use it once any credential is saved.",
  "settings.extensions.server-failed":
    "{name} wasn't added. Nothing changed. Check the details and add it again.",
  "settings.heading.add-provider": "Add a provider",
  "settings.heading.agents-instructions": "Instructions for all projects",
  "settings.heading.agents-servers": "MCP servers (all projects)",
  "settings.heading.agents-skills": "Skills (all projects)",
  "settings.heading.connected": "Connected",
  "settings.label.agents-target": "your agent settings",
  "settings.label.available-target": "the providers you can add",
  "settings.label.api-anthropic-messages": "Anthropic Messages",
  "settings.label.api-openai-chat-completions": "Chat Completions",
  "settings.label.api-openai-responses": "Responses",
  "settings.label.custom-api": "API",
  "settings.label.custom-id": "Provider ID",
  "settings.label.custom-name": "Display name",
  "settings.label.custom-provider-hint":
    "Any server that speaks the OpenAI or Anthropic API",
  "settings.label.custom-url": "Base URL",
  "settings.label.extensions-target": "your tools and skills",
  "settings.label.login-signed-in": "Signed in",
  "settings.label.method-opens-browser": "Opens your browser",
  "settings.label.method-sign-in": "Sign in with {product}",
  "settings.label.off": "Off",
  "settings.label.on-computer": "Runs on this computer",
  "settings.label.over-web": "Connects over the web",
  "settings.label.providers-target": "your connections",
  "settings.label.server-address": "Address",
  "settings.label.server-arguments": "Arguments",
  "settings.label.server-auth": "Sign-in",
  "settings.label.server-client-id": "Client ID",
  "settings.label.server-header": "Header name",
  "settings.label.server-issuer": "Issuer",
  "settings.label.server-name": "Name",
  "settings.label.server-program": "Program",
  "settings.label.server-scopes": "Scopes",
  "settings.label.server-transport": "How it connects",
  "settings.button.sign-in-complete": "Complete sign-in",
  "settings.error.sign-in-callback-invalid":
    "That link didn't match this sign-in. Copy the full redirected URL and try again.",
  "settings.label.sign-in-callback-placeholder":
    "http://localhost:.../callback?code=...&state=...",
  "settings.label.sign-in-callback-url": "Redirected URL",
  "settings.label.sign-in-how": "How do you want to sign in to {name}?",
  "settings.label.status-connected": "Connected",
  "settings.label.status-needs-sign-in": "Needs sign-in",
  "settings.notice.choose-default-model":
    "Agents use this model unless a project or an agent picks another. You can change it later in Settings → Agents.",
  "settings.notice.custom-id-help":
    "Lowercase letters, numbers, hyphens or underscores.",
  "settings.notice.custom-lead":
    "Set up a server that speaks the OpenAI or Anthropic API.",
  "settings.notice.custom-url-help":
    "The address goes right before /chat/completions, /responses or /messages, for example https://api.example.com/v1.",
  "settings.notice.none-connected": "No providers are connected yet.",
  "settings.notice.provider-lead":
    "A provider is a service you connect with one key or sign-in. You pick models in the model picker and in Settings → Agents.",
  "settings.notice.sign-in-browser":
    "Finish signing in to {product} in your browser.",
  "settings.notice.sign-in-code":
    "Enter this code on the page that opened in your browser.",
  "settings.notice.sign-in-handoff-auto":
    "Finish signing in to {product} in your browser. lophn will catch the redirect automatically, or paste the redirected URL below.",
  "settings.notice.sign-in-handoff-paste":
    "Finish signing in to {product} in your browser. After signing in, the page will redirect to a localhost address that won't load — copy that full URL from your browser's address bar and paste it below.",
  "settings.server.address-help":
    "A secure web address, or one on this computer.",
  "settings.server.arguments-help": "One per line. They are passed as written.",
  "settings.server.error-client-id":
    "Enter the client ID the service gave you, up to 200 characters.",
  "settings.server.error-header": "Use letters, numbers and dashes, up to 64.",
  "settings.server.error-issuer":
    "Enter a secure web address starting with https://.",
  "settings.server.error-name":
    "Use letters, numbers, dashes and underscores, up to 32.",
  "settings.server.error-path":
    "Enter the full path of the program, starting from the top folder.",
  "settings.server.error-scopes": "Up to 32 scopes, each up to 128 characters.",
  "settings.server.error-taken": "A server with this name already exists.",
  "settings.server.error-url":
    "Enter a secure web address, or one on this computer.",
  "settings.server.issuer-help":
    "The service's OAuth issuer address. lophn asks it where to sign in.",
  "settings.server.program-help":
    "The full path of the program to start on this computer.",
  "settings.server.scopes-help":
    "Separate with spaces or commas. Leave empty to ask for no scopes.",
  "settings.status.plan-access":
    "Your plan doesn't allow this. Check that your plan includes it.",
  "settings.status.sign-in-problem":
    "There's a sign-in problem. Disconnect, then connect again.",
  "settings.status.sign-in-waiting": "Waiting for you to finish signing in.",
  "settings.status.usage-limit":
    "Usage limit reached. Wait for the limit to reset.",
  "settings.title.choose-default-model": "Choose a default model",
  "settings.title.connect-provider": "Connect {name}",
  "settings.title.custom-provider": "Custom provider",
} as const;
