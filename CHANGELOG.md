# Changelog

## [3.1.0] - 2026-04-05

### Breaking Change: Package Renamed

- Package renamed from `@maxanatsko/gemini-mcp-tool` to `@maxanatsko/llm-cli-bridge`
- New bin alias `llm-cli-bridge` added; existing `gemini-mcp-tool` and `gemini-mcp` aliases preserved for backward compat
- To migrate: update `npx` commands to use `npx -y @maxanatsko/llm-cli-bridge`; MCP config `command` field can still use `gemini-mcp` or `gemini-mcp-tool` if old package is globally installed

## [2.1.0]

- Add `allowedTools` parameter for auto-approval in CLI commands
- Add comprehensive tests for shared session infrastructure
- Update package namespace

## [2.0.0]

- Complete async refactor for all session management
- Shared session infrastructure across tools
- Add `review-code` tool with session management and comment tracking
- Add `brainstorm` tool for creative ideation
- 100% async I/O with `fs/promises`
- Robust error handling
- LRU session eviction policy
- Full type safety

**Breaking**: SessionManager methods are now async

## [1.1.3]

- Add `changeMode` parameter for structured edit responses
- Intelligent parsing and chunking for large edit responses
- Structured response format with Analysis, Suggested Changes, Next Steps
- Token limit handling with continuation support

## [1.1.2]

- Auto-fallback from gemini-2.5-pro to gemini-2.5-flash on quota limit

## [1.1.1]

- Initial public release
- Basic Gemini CLI integration
- File analysis with `@` syntax
- Sandbox mode support
