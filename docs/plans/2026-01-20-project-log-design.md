# Project Log Design

## Goal
Provide a lightweight, chronological history file that complements CONTINUITY.md so a new Codex session can recover context quickly after chat reset.

## Rationale
CONTINUITY.md is optimized for current state, not historical actions. A separate log avoids mixing live state with timeline details while preserving important events, decisions, and verification outcomes.

## File
- Path: PROJECT_LOG.md (repo root)
- Ownership: maintained by Codex during each session
- Audience: future Codex sessions and maintainers

## Format
Each entry is a short block with a date header and fixed fields to keep scanning easy.

Example entry:

- 2026-01-20
  - Summary: Consolidated async endpoints into /api/process to stay under Hobby limits.
  - Files: api/process/index.ts, services/geminiService.ts.
  - Verification: npm test (15 tests passed).
  - Notes: Verify Vercel deployment.

## Update Rules
- Add an entry when:
  - A design decision changes behavior or architecture.
  - A fix or refactor is applied.
  - Tests or deploy verification are run.
- Keep entries short and factual.
- Do not include chat transcripts.

## Instructions Update
- Global AGENTS.md and project AGENTS.md will instruct Codex to read and update PROJECT_LOG.md each turn along with CONTINUITY.md.
- CONTINUITY.md remains the live state, PROJECT_LOG.md is chronological history.

## Verification
- No runtime code impact.
- Successful update is the presence of PROJECT_LOG.md with a first entry.
