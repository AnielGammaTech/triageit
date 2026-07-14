---
name: add-or-update-mockup-components
description: Workflow command scaffold for add-or-update-mockup-components in triageit.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /add-or-update-mockup-components

Use this workflow when working on **add-or-update-mockup-components** in `triageit`.

## Goal

Adds or updates mockup components for product tools, often in bulk, and may include related test files.

## Common Files

- `apps/gtools/src/components/mockups/*.tsx`
- `apps/gtools/src/__tests__/*.test.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Create or update files in src/components/mockups/
- Optionally update or add test files in src/__tests__/

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.