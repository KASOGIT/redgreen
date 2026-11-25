---
type: tool_order
before:
  tool: Agent
  input_match: '"subagent_type":\s*"crew:test-engineer"'
after:
  tool: Agent
  input_match: '"subagent_type":\s*"crew:implementer"'
---
