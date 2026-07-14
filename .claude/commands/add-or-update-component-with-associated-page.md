---
name: add-or-update-component-with-associated-page
description: Workflow command scaffold for add-or-update-component-with-associated-page in triageit.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /add-or-update-component-with-associated-page

Use this workflow when working on **add-or-update-component-with-associated-page** in `triageit`.

## Goal

Adds or updates a React component and integrates it into a page (e.g., landing page, tool section, or feature strip).

## Common Files

- `apps/gtools/src/components/*.tsx`
- `apps/gtools/src/app/page.tsx`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Create or modify a component file in src/components/
- Update the relevant page file in src/app/ (e.g., page.tsx) to use the new or updated component

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.