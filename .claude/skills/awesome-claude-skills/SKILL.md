---
name: awesome-claude-skills
description: Reference list of official and community Claude Skills (docx, pdf, pptx, xlsx, frontend-design, mcp-builder, security skills, etc.) with install commands and links. Use when the user asks what Claude Skills exist, wants to find or install a skill, or asks how to install skills via /plugin marketplace add.
---

# Awesome Claude Skills

Source: https://github.com/travisvn/awesome-claude-skills

Curated reference of Claude Skills. Use this to look up what a skill does and how to install it, then guide the user to the actual install step (`/plugin marketplace add <owner>/<repo>` in Claude Code CLI, or the relevant skill repo).

## How Skills Work

Progressive disclosure: metadata (~100 tokens) always scanned, full SKILL.md (<5k tokens) loads when relevant, bundled resources load on demand.

## Getting Started

**Claude.ai Web**: Settings > Capabilities > enable Skills toggle. Team/Enterprise needs org-wide admin enablement first.

**Claude Code CLI**:
```bash
# Install skills from marketplace
/plugin marketplace add anthropics/skills

# Or install from local directory
/plugin add /path/to/skill-directory
```

**Claude API**: `/v1/skills` endpoint. See https://platform.claude.com/docs/en/api/beta/skills

## Official Skills (anthropics/skills marketplace)

Document Skills:
- **docx** - Word documents: tracked changes, comments, formatting, text extraction
- **pdf** - Extract text/tables, create/merge/split PDFs, forms
- **pptx** - PowerPoint: layouts, templates, charts, automated slides
- **xlsx** - Excel: formulas, formatting, analysis, visualization

Design & Creative:
- **algorithmic-art** - Generative art via p5.js (seeded randomness, flow fields, particle systems)
- **canvas-design** - Visual art in .png/.pdf using design philosophies
- **slack-gif-creator** - Animated GIFs sized for Slack

Development:
- **frontend-design** - Avoid generic "AI slop" aesthetics; bold design decisions, works well with React/Tailwind
- **web-artifacts-builder** - Complex claude.ai HTML artifacts using React, Tailwind, shadcn/ui
- **mcp-builder** - Guide for building high-quality MCP servers
- **webapp-testing** - Test local web apps with Playwright

Communication:
- **brand-guidelines** - Anthropic's official brand colors/typography for artifacts
- **internal-comms** - Status reports, newsletters, FAQs

Skill Creation:
- **skill-creator** - Interactive Q&A tool to build new skills

## Community Skills

Collections:
- **obra/superpowers** (https://github.com/obra/superpowers) - 20+ skills: TDD, debugging, collaboration patterns. `/brainstorm`, `/write-plan`, `/execute-plan` commands. Install: `/plugin marketplace add obra/superpowers-marketplace`
- **obra/superpowers-lab** - Experimental skills, install from `superpowers-marketplace` plugin

Individual skills (repo -> description):
| Skill | Description |
| --- | --- |
| ios-simulator-skill (conorluddy) | iOS app building, navigation, testing automation |
| ffuf-web-fuzzing (jthack) | ffuf web fuzzing guidance for pentesting, auth fuzzing, auto-calibration |
| playwright-skill (lackeyjb) | General-purpose browser automation via Playwright |
| claude-d3js-skill (chrisvoncsefalvay) | d3.js visualizations |
| claude-scientific-skills (K-Dense-AI) | Scientific libraries and databases |
| web-asset-generator (alonw0) | Favicons, app icons, social media images |
| loki-mode (asklokesh) | Multi-agent orchestration across 37 agents/6 swarms |
| Trail of Bits Security Skills (trailofbits) | Static analysis: CodeQL/Semgrep, variant analysis, auditing |
| frontend-slides (zarazhangrui) | Animation-rich HTML presentations, PPTX conversion |
| Expo Skills (expo) | Official Expo app development skills |
| shadcn/ui | shadcn component context and pattern enforcement |
| get-shit-done (gsd-build) | Meta-prompting, context engineering, spec-driven dev |

Tools:
- **yusufkaraaslan/Skill_Seekers** - Convert documentation websites into Claude Skills

## Security Notes

Skills execute arbitrary code in Claude's environment. Only install from trusted sources; review SKILL.md and any scripts before enabling; audit before production/enterprise use.

## Choosing Skills vs Prompts vs Subagents vs MCP

| Tool | Best For |
|------|----------|
| Skills | Reusable procedural knowledge across conversations |
| Prompts | One-time instructions and immediate context |
| Projects | Persistent background knowledge within workspaces |
| Subagents | Independent task execution with specific permissions |
| MCP | Connecting Claude to external data sources |

Rule of thumb: if you keep typing the same prompt across conversations, make it a Skill.
