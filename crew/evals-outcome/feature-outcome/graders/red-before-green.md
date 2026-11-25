---
type: tool_order
before:
  tool: Bash
  input_match: 'git commit(?:.|\\n)*?(?:\\n|[^a-z])test[(:]'
after:
  tool: Bash
  input_match: 'git commit(?:.|\\n)*?(?:\\n|[^a-z])feat[(:]'
---
