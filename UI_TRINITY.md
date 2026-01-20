# UI Trinity (Detailed Rules)

## Purpose
Provide a deterministic, low-overhead UI quality workflow that only activates for UI tasks. This document is read only when the UI Trinity Router activates.

## Activation Rules
UI Trinity applies ONLY if at least one is true:
- User request includes: "UI", "frontend", "design", "component", "layout", "Tailwind", "React", "TSX/JSX", "CSS", "accessibility", "a11y".
- Any changed file matches:
  - *.tsx, *.jsx, *.css, *.scss, *.html.
  - tailwind.config.* or postcss.config.*.
  - src/app/**, src/components/**, frontend/**, public/**.

If none are true, do not mention UI Trinity.

## Phase 0: Tool Availability Check (No installs)
Check tool availability with slash commands or binaries.

- Rams: /rams or "rams" binary.
- UI Skills: /ui-skills or "ui-skills" binary.

If missing, output manual install commands exactly:
- curl -fsSL https://rams.ai/install | bash
- npx ui-skills init

Do not install tools automatically.
Do not invent a Vercel CLI.

## Phase 1: Pre-generation Constraints

### UI Skills Constraints (Enforce)
- Use a consistent layout system and spacing scale.
- Avoid "h-screen", use "h-dvh" when full height is needed.
- Use semantic HTML and accessibility primitives.
- Prefer progressive disclosure and clear hierarchy.
- Use motion only when it clarifies state changes.

### Vercel Design Principles (Conceptual)
- Premium feel: spacing, typography, and focus states must be intentional.
- Clear hierarchy: titles and section headers lead the eye.
- Interaction clarity: errors are near inputs, states are explicit.
- Crisp UI: clean borders, subtle shadows, consistent spacing.

## Phase 2: Generation
Generate UI code in the requested stack with the constraints above.

## Phase 3: Mandatory 3 Gates

### Gate 1: Architecture (UI Skills)
- Run: ui-skills review <changed files or directory>.
- Required output format:
  - Violation: <snippet>
  - Why it matters: <1 line>
  - Fix: <code-level change>

### Gate 2: Design and Interaction (Vercel)
- No CLI. Use checklist:
  - Keyboard focus visible.
  - Hit targets >= 44px.
  - Clear error placement.
  - Consistent spacing scale.
  - Crisp borders and shadows.
  - Optical alignment checks.
- Required output format:
  - Violation: <snippet or description>
  - Why it matters: <1 line>
  - Fix: <code-level change>

### Gate 3: Accessibility and Polish (Rams)
- Run: rams review <changed files>.
- Fix all CRITICAL and SERIOUS issues before finalizing.

## Reporting
If tools are missing, output manual install commands and a manual checklist for the three gates. Keep it concise.
