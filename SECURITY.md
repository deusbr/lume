# Security Policy

## Supported Versions

Security fixes apply to the latest minor release on `main` of **lume**.

## Reporting a Vulnerability

Please **do not** open a public GitHub Issue for sensitive security reports (secret leaks, command injection, path traversal, or arbitrary file overwrite vulnerabilities).

Instead, report the issue privately via GitHub Security Advisories (`Security -> Advisories -> Report a vulnerability`) with:
- Affected file path and reproduction steps
- Expected vs. actual security boundary behavior
- Suggested mitigation (if available)

## Repository Security Baseline

- Zero hardcoded credentials or tokens
- Shell-free subprocess invocation (`shell: false`) where external commands are required
- Strict path boundary checks on file operations
