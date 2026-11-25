---
max_turns: 60
timeout_seconds: 1500
allowed_tools: [Skill, Agent, Read, Glob, Grep, Write, Edit, Bash]
---

Invoke the crew:debug skill with the Skill tool, passing the symptom below as the Skill tool's args, then follow it. Symptom: The drops-punctuation check in ./test.sh fails on 'Hello, World!'. Find and fix the cause. The test command is ./test.sh. End with the final test run's PASS line.
