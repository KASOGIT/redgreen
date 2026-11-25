---
type: regex
target:
  source: file
  path: slug.sh
pattern: '\[:(punct|alnum):\]|\[\^[^\]]*(a-z|A-Z|0-9)|tr\s+-[a-z]*[cd][a-z]*\s+[''"][^''"\\]*([,!.?;:]|a-z|A-Z|0-9|\[:)'
---
