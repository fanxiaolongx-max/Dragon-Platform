# Desktop agent icons

Client identification icons extracted at 96 px from the locally installed macOS applications on 2026-10-26: Codex (`com.openai.codex`, installed as ChatGPT.app), Claude.app, and Antigravity.app. Used only to identify the corresponding connected clients; trademarks belong to their respective owners. No network request is needed when rendering the provider controls.

The current files and their consumers were checked against the repository on 2026-10-28.

| File | Provider ID | Display name | Size |
| --- | --- | --- | --- |
| `codex.png` | `codex` | Codex | 96 × 96 |
| `claudecode.png` | `claudecode` | Claude Code | 96 × 96 |
| `antigravity.png` | `antigravity` | Antigravity | 96 × 96 |

The filenames match the provider IDs used by the desktop Agent backend. They are served locally as `/assets/desktop-agents/<provider>.png` and appear in:

- [Desktop Agent settings](../../js/shared/desktop-agent-settings.js): provider identification.
- [Desktop conversations](../../js/home/desktop-agents.js): provider switches and native conversation avatars.
- [DragonTAC discussions](../../js/home/agent-discussion.js): live member reports and restored message avatars in the same platform conversation.

Provider names remain available through text, tooltips, or accessible labels. Connection indicators are rendered separately from these images; an icon alone does not indicate that a desktop client is connected or able to send messages. Consecutive replies from the same member share an avatar group; switching members or adding a user message starts a new group.

When replacing an icon, retain its provider filename and dimensions and check the settings, conversation list, native timeline, and discussion view in light and dark themes. No frontend build is required. Run the following from the project root in a graphical Electron environment to verify the affected views with fixtures:

```bash
node_modules/.bin/electron tests/desktop-agents-browser.cjs
node_modules/.bin/electron tests/desktop-agent-discussion-browser.cjs
```

For connection prerequisites, permissions, supported send modes, and client-specific limitations, see [Desktop Agent conversations](../../../docs/desktop-agent-conversations.md).
