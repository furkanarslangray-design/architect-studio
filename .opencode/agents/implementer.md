---
description: Implements one task from docs/superpowers/plans/2026-11-22-usable-mvp.md
mode: subagent
steps: 8
permissions:
  - action: "edit"
    resource: "*"
    effect: allow
  - action: "shell"
    resource: "*"
    effect: allow
  - action: "read"
    resource: "*"
    effect: allow
  - action: "subagent"
    resource: "*"
    effect: deny
---

You implement exactly one task from the MVP plan.

Read the assigned task brief first. It is your complete requirements. Touch only
the files the task names, run its verification command, and report status,
commits, test output, and concerns. Do not read the whole repository and do not
dispatch subagents.
