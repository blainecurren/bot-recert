# /ship - Commit, Push, and Document

Commit and push code to GitHub, then document the work in Obsidian.

## Instructions

$ARGUMENTS

### Step 1: Gather Context

If arguments were provided, use them as the description of what was accomplished.
Otherwise, ask: "What was accomplished in this ship?"

### Step 2: Git Operations

Run these commands in sequence:

```bash
git add .
git status
```

Show the user what files are staged and ask to confirm. If they provided a commit message in arguments or conversation, use it. Otherwise, generate a conventional commit message (feat:, fix:, docs:, refactor:, etc.) based on the changes and ask for confirmation.

Then:
```bash
git commit -m "<message>"
git push
```

Capture the commit hash from the output.

### Step 3: Write to Obsidian Journal

Use MCP tools to document in Obsidian:

1. Check if today's journal exists at `Projects/HCHB-Teams-Bot/Journal/YYYY-MM-DD.md`
2. If exists: append under a new "## Ship: HH:MM" heading
3. If doesn't exist: create with full template and update Index

**New Journal Template:**
```markdown
# Journal: YYYY-MM-DD

## Summary
[1-2 sentence overview based on what was shipped]

## What Was Done
- [Bullet points of changes]

## Why / Context
[Brief explanation of why these changes matter]

## Decisions Made
- [Any decisions, or "None"]

## Blockers / Issues
- None

## Next Steps
- [Reasonable next steps based on the work]

## Git Activity
- Commit: `<short hash>` - "<commit message>"
- Branch: <current branch>
- Files changed: <count>

## Related
- (Link any related ADRs if applicable)
```

**Append Template (when journal exists):**
```markdown

---

## Ship: HH:MM

**Commit**: `<short hash>` - "<message>"
**Files**: <count> changed

### Changes
- [What was shipped]

### Why
[Brief context]
```

### Step 4: Update Journal Index

If a new journal was created, append to `Projects/HCHB-Teams-Bot/Journal/Index.md`:
```markdown
- [[YYYY-MM-DD]] - [Brief summary]
```

### Step 5: ADR Check

Ask: "Any architectural decisions to document as an ADR? (y/n)"

If yes, gather:
- Decision title
- Context/problem
- What was decided
- Alternatives considered

Create ADR at `Projects/HCHB-Teams-Bot/ADR/ADR-XXX-kebab-case-title.md` using this template:

```markdown
# ADR-XXX: [Title]

**Status**: Accepted
**Date**: YYYY-MM-DD
**Deciders**: Blaine

## Context
[Problem or situation]

## Decision
[What we decided]

## Consequences

### Positive
- [Benefits]

### Negative
- [Drawbacks]

### Risks
- [Potential issues]

## Alternatives Considered

### [Alternative 1]
[Why not chosen]

## References
- Commit: <hash>
```

Update `Projects/HCHB-Teams-Bot/ADR/Index.md` with a link to the new ADR.

### Step 6: Confirm Completion

Report success with:
- Commit hash and message
- Files changed count
- Journal file path
- ADR path (if created)

## MCP Tools

- `obsidian_append_content` - Create new files or add to existing
- `obsidian_get_file_contents` - Read existing files
- `obsidian_list_files_in_dir` - Check what files exist

## Notes

- Use current date and time (24-hour format for time)
- For ADR numbers, check existing files in ADR folder and increment
- Keep documentation concise but complete
- Always show git status before committing for user review
