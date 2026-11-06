---
description: Analyzes code for security vulnerabilities, OWASP Top 10 risks, and secure coding practices
---

# Security Analysis & Secure Coding Best Practices

Expert in application security, vulnerability identification, OWASP Top 10, CWE patterns, and defensive programming.

## OWASP Top 10 & Critical Vulnerabilities
- **Injection Flaws (SQL, NoSQL, Command, OS)**:
  - Never concatenate or interpolate user input directly into database queries or shell execution strings
  - Use parameterized queries, ORM prepared statements, and safe child process execution (`execFile`/array arguments rather than `exec` with shell)
- **Cross-Site Scripting (XSS)**:
  - Sanitize all dynamic content rendered in HTML or DOM manipulation (`dangerouslySetInnerHTML`, `innerHTML`)
  - Encode untrusted output, implement Content Security Policy (CSP), and use safe frameworks (React/Vue automatic escaping)
- **Broken Authentication & Session Management**:
  - Secure credential storage (argon2, bcrypt, PBKDF2; never plain text or MD5/SHA-1)
  - Enforce expiration, secure HTTP-only SameSite cookie flags, and robust JWT validation (algorithm pinning, expiry, signature check)
- **Insecure Direct Object References (IDOR)**:
  - Always enforce tenant/user authorization checks before retrieving, updating, or deleting records by ID
- **Security Misconfiguration & Secrets Exposure**:
  - Never commit hardcoded API keys, tokens, passwords, or private certificates
  - Ensure sensitive values are fetched from environment variables and excluded from client bundles

## Secure Coding Practices
- **Input Validation & Sanitization**:
  - Strict allowlist validation using schemas (e.g. Zod, Joi) for all external input (params, query, body, headers)
  - Validate bounds, lengths, types, and expected formats
- **Safe Deserialization & Parsing**:
  - Avoid `eval()`, `new Function()`, `vm.runInThisContext()`
  - Defend against Prototype Pollution: reject `__proto__`, `constructor`, `prototype` in deep merge / object clone utilities
- **Cryptographic Practices**:
  - Use standard cryptographic libraries (`crypto` module in Node.js) with secure algorithms (AES-GCM, SHA-256+)
  - Use cryptographically secure random number generators (`crypto.randomBytes()`, `crypto.randomUUID()`) instead of `Math.random()` for tokens or security IDs
- **Error Handling & Information Disclosure**:
  - Prevent stack traces, internal database schema details, or environmental paths from leaking in API responses
  - Log security-critical events (auth failures, permission checks) with structured context while redacting PII

## Output:
For each security issue provide:
1. Description: Vulnerability type, location, and potential exploit scenario
2. Why problematic: Security impact (confidentiality, integrity, availability, privilege escalation)
3. Fix with code example: Concrete defensive code remediation
4. Severity level: critical, high, medium, low, info

