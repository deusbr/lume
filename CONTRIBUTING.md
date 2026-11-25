# Contributing to lume

Thank you for your interest in contributing to **lume**!

## Development Setup

1. Fork this repository and create a topic branch from `main`:
   ```bash
   git checkout -b feat/my-improvement
   ```
2. Make focused, minimal changes without external runtime dependencies unless strictly justified.
3. Never commit secrets, tokens, or local configuration snapshots.

## Verification Before Opening a Pull Request

Run the automated test suite locally:

```bash
node --test tests/*.test.cjs
```

## Pull Request Checklist

- [ ] Linked to a GitHub Issue describing the bug or enhancement
- [ ] All tests pass locally (`node --test tests/*.test.cjs`)
- [ ] Documentation (`README.md`) updated if user-facing CLI flags, tools, or schemas changed
- [ ] Zero hardcoded secrets or untracked build artifacts
