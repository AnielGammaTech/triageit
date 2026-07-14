```markdown
# triageit Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches you how to contribute effectively to the `triageit` TypeScript codebase. You'll learn the project's coding conventions, how to add or update UI components, manage content models and types, maintain documentation, and structure tests. The guide includes step-by-step workflows and command suggestions for common development tasks.

## Coding Conventions

- **Language:** TypeScript
- **Framework:** None detected (React components present)
- **File Naming:** Use `camelCase` for files (e.g., `toolStrip.tsx`, `featureMockup.tsx`)
- **Import Style:** Use import aliases for clarity and maintainability.

  ```typescript
  import { ToolCard } from '@/components/toolCard';
  ```

- **Export Style:** Prefer named exports.

  ```typescript
  // In toolCard.tsx
  export function ToolCard(props: ToolCardProps) { ... }
  ```

- **Commit Messages:** Follow [Conventional Commits](https://www.conventionalcommits.org/) with prefixes like `feat`, `fix`, `docs`, `refactor`, `chore`.

  ```
  feat: add new tool strip to landing page
  fix: correct typo in mockup component
  ```

## Workflows

### Add or Update a Component with Associated Page
**Trigger:** When introducing a new UI feature/section or updating an existing one.
**Command:** `/add-component-to-page`

1. Create or modify a component file in `src/components/`.
2. Update the relevant page file in `src/app/` (e.g., `page.tsx`) to use the new or updated component.

**Example:**
```typescript
// apps/gtools/src/components/featureStrip.tsx
export function FeatureStrip() { ... }

// apps/gtools/src/app/page.tsx
import { FeatureStrip } from '@/components/featureStrip';

export default function Page() {
  return (
    <main>
      <FeatureStrip />
      {/* other components */}
    </main>
  );
}
```

---

### Add or Update Mockup Components
**Trigger:** When visually representing new tools or updating existing tool mockups.
**Command:** `/add-mockup`

1. Create or update files in `src/components/mockups/`.
2. Optionally, update or add test files in `src/__tests__/`.

**Example:**
```typescript
// apps/gtools/src/components/mockups/toolMockup.tsx
export function ToolMockup() { ... }

// apps/gtools/src/__tests__/toolMockup.test.ts
import { ToolMockup } from '../components/mockups/toolMockup';
test('renders ToolMockup', () => { ... });
```

---

### Add or Update Content Models and Types
**Trigger:** When defining or changing structured content or its types.
**Command:** `/update-content-model`

1. Create or update a content model file in `src/content/`.
2. Update or add type definitions in `src/content/types.ts`.
3. Optionally, update or add test files in `src/__tests__/`.

**Example:**
```typescript
// apps/gtools/src/content/toolModel.ts
export interface ToolModel { ... }

// apps/gtools/src/content/types.ts
export type ToolType = 'utility' | 'visual';

// apps/gtools/src/__tests__/toolModel.test.ts
import { ToolModel } from '../content/toolModel';
test('ToolModel structure', () => { ... });
```

---

### Add or Update Design or Implementation Docs
**Trigger:** When documenting a new feature, site, or plan.
**Command:** `/add-doc`

1. Create or update a markdown file in `docs/superpowers/specs/` or `docs/superpowers/plans/`.

**Example:**
```
docs/superpowers/specs/tool-feature.md
docs/superpowers/plans/roadmap.md
```

## Testing Patterns

- **Test Files:** Use the `*.test.*` pattern (e.g., `toolMockup.test.ts`).
- **Location:** Place tests in `src/__tests__/`.
- **Framework:** Not explicitly detected; likely using Jest or similar.
- **Example:**
  ```typescript
  // apps/gtools/src/__tests__/featureStrip.test.ts
  import { FeatureStrip } from '../components/featureStrip';
  test('FeatureStrip renders', () => { ... });
  ```

## Commands

| Command                  | Purpose                                                        |
|--------------------------|----------------------------------------------------------------|
| /add-component-to-page   | Add or update a React component and integrate it into a page   |
| /add-mockup              | Add or update mockup components for product tools              |
| /update-content-model    | Add or update content models and associated types              |
| /add-doc                 | Add or update design specs or implementation documentation     |
```
