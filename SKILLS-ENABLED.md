# Agent skills — enablement record

Source pack: `addy-osmani` (github.com/addyosmani/agent-skills, plugin `agent-skills` v0.6.13)
Location: `~/.claude/skills/addy-osmani/` (= `/workspace/.claude/skills/addy-osmani/`)
All 25 skills enabled. Validation: `node scripts/validate-skills.js` → 25 skills + 4 personas, 0 errors, PASSED.

## What was wired

| Target | Link | Effect |
|---|---|---|
| `~/.claude/skills/<name>` → `addy-osmani/skills/<name>` (×25) | symlink | Flattens the pack into the personal skills discovery root so each `SKILL.md` is registered by name |
| `~/.claude/commands` → `addy-osmani/.claude/commands` | symlink | Slash commands: `/spec` `/plan` `/build` `/test` `/review` `/code-simplify` `/constraints` `/ship` `/webperf` |
| `~/.claude/agents` → `addy-osmani/agents` | symlink | Personas: code-reviewer, test-engineer, security-auditor, web-performance-auditor |
| `~/.claude/references` → `addy-osmani/references` | symlink | Shared checklists (testing, performance, security, accessibility, observability) that skills reference |
| `/opt/shared-tooling/opt/pi-agent/skills/addy-osmani` | symlink | Same pack visible to the `pi` coding agent (user scope, shared across sandboxes) |
| `/workspace/.pi/skills/addy-osmani` | symlink | Same pack at project scope for `pi` |

## Enabled skills (25)

Define: interview-me, idea-refine, spec-driven-development, constraint-driven-development
Plan: planning-and-task-breakdown
Build: incremental-implementation, test-driven-development, context-engineering,
source-driven-development, doubt-driven-development, frontend-ui-engineering, api-and-interface-design
Verify: browser-testing-with-devtools, debugging-and-error-recovery
Review: code-review-and-quality, code-simplification, security-and-hardening, performance-optimization
Ship: git-workflow-and-versioning, ci-cd-and-automation, deprecation-and-migration,
documentation-and-adrs, observability-and-instrumentation, shipping-and-launch
Meta: using-agent-skills

## Deliberately NOT wired

- `hooks/session-start.sh` — the pack ships it but does not wire it: hosts with native skill routing
  (Claude Code, pi) would run a second router on top of the native one. Enable only on hosts
  without native routing.
- `hooks/simplify-ignore.sh`, `hooks/sdd-cache-*.sh` — optional plugin hooks, not declared in
  `plugin.json`; add to `~/.claude/settings.json` on request.
- `browser-testing-with-devtools` needs the `chrome-devtools` MCP server configured to run; the
  skill loads regardless. This project drives the browser with the globally installed Playwright
  module (`/opt/shared-tooling/npm/lib/node_modules/playwright`), loaded by absolute path from
  `tools/load-playwright.mjs` because ESM cannot resolve it by bare specifier.

## Missing sources

`superpowers`, `matt-pocock`, `pstack` are not present in this sandbox — nothing to enable there.
