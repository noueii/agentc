---
name: go-conventions
description: Team conventions for Go code. Use when writing or reviewing Go.
---
# Go conventions

- Return errors, don't panic, outside of `main` and truly impossible states.
- Wrap errors with context: `fmt.Errorf("load user %d: %w", id, err)`.
- Accept interfaces, return concrete types.
- Table-driven tests for anything with more than two cases.
