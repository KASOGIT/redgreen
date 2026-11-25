---
max_turns: 60
timeout_seconds: 1500
allowed_tools: [Skill, Agent, Read, Glob, Grep, Write, Edit, Bash]
---

Invoke the crew:review skill with the Skill tool to review the current branch against main, then follow it. Report the findings only: do not fix anything. Cite each finding as file:line.
