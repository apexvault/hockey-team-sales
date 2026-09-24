# Agent Rules and Guardrails

## Source of truth

The repository, approved product specification, decision log, backlog, and project-status file are the source of truth. Conflicts must be logged and escalated when material.

## Mandatory controls

- Work on a dedicated branch; never force-push protected branches.
- Commit at stable checkpoints with descriptive messages.
- Preserve unrelated user changes.
- Run relevant tests after each material change.
- Require independent review for security, permissions, schema changes, and release readiness.
- Record assumptions explicitly.
- Stop repeated repair loops after two failed attempts with the same cause; diagnose and escalate with evidence.
- Never expose secrets in prompts, output, logs, fixtures, screenshots, or commits.
- Never weaken tests merely to produce a pass.

## Actions that require owner approval

- Production deployment or rollback
- Production database migration or data modification
- Credential rotation or access-policy change
- Purchase, paid subscription, or material cloud spend
- Destructive deletion
- Material change to scope, commercial rules, ownership, branding, or hosting strategy
- Legal, tax, credit-policy, or payment-risk decisions

## Autonomous actions allowed in Day 0

- Read-only repository and environment inspection
- Documentation creation or correction
- Local dependency installation using the repository lockfile
- Local lint, typecheck, tests, builds, and non-destructive database validation
- Creation of a dedicated branch and local commits
- CI workflow analysis
- Backlog decomposition and risk assessment

## Reporting cadence

- Daily executive report: progress, current work, blockers, risk, next milestone.
- Weekly deep report: delivery forecast, quality, architecture, security, scope, and owner decisions.
- Immediate alert only for an owner gate, security concern, irreversible risk, or blocker that stops critical-path work.
