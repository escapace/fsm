# Development Guidelines

## Voice & Tone

Ensure every deliverable — code comments, error messages, UI/UX copy, and assistant replies — is:

- **Precise & Direct:** State exactly what the code does and why.
- **Matter of Fact:** Avoid hype, flattery, or marketing language.
- **Informative:** Judge when detail is needed; when it is, deliver it precisely—otherwise, stay concise.
- **Clarity:** Use lists, tables, or other structured formats only when they genuinely improve clarity; prefer plain prose otherwise.
- **Consistent:** Use the terminology and style already present in the codebase.
- **Professional:** Maintain a calm, objective tone.

## Scripts & Tools

- **GitHub CLI** – use the `gh` CLI to manage repository branches, pull requests, issues, and other repository tasks.
- **Scripts:** – if needed, inspect `package.json` to discover the available scripts. 
- **pnpm:** – use `pnpm`, not `npm`.
- **File tree: ** Run `fd | tree --fromfile` to understand the repository layout. Use this command before making structural changes or when exploring the codebase.
- **ripgrep** – if you need to search the repository, use ripgrep. Prefer the MCP server; if it’s unavailable, fall back to the rg command.

## Patterns & Best Practices

- **Favor simplicity**: Choose the simplest solution that meets requirements.
- **DRY principle**: Avoid code duplication; reuse existing functionality.
- **Focused changes**: Only implement explicitly requested or fully understood changes.
- **Preserve patterns**: Follow existing code patterns when fixing bugs.
- **Test coverage**: Write comprehensive unit and integration tests.
- **Modular design**: Create reusable, modular components.
- **Performance**: Optimize critical code sections when necessary.
- **Impact assessment**: Evaluate how changes affect other codebase areas.
- **Naming**: PascalCase for classes; camelCase for methods/variables; UPPER_SNAKE_CASE for constants.
- **Language**: If writing JavaScript or TypeScript, target the latest ECMAScript standard and use native ECMAScript Modules (ESM).
- **Type Safety**: Write type‑safe code and keep all safety checks enabled — never bypass them.
- **Code style**: Indent with two spaces, use single quotes, and omit semicolons unless required.
- **Documentation**: Use [TSDoc](https://tsdoc.org/) for public APIs and complex functions. Comment sparingly; explain _why_, not _what_. Avoid examples in TSDoc comments. 

## Memory

If you make a mistake that should be avoided in the future, ask to update `CLAUDE.md` so the lesson is recorded; otherwise, do not edit `CLAUDE.md`.
