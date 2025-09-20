# Security Policy

## Supported Versions

We actively support security updates for the following versions of Comfort Control (EaseHub):

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of Comfort Control (EaseHub) seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

**Please do NOT create a public GitHub issue for security vulnerabilities.**

Instead, please email us directly at:
- **Email**: [nickotmazgin@gmail.com](mailto:nickotmazgin.dev@gmail.com)
- **Subject**: `[SECURITY] Comfort Control EaseHub - Vulnerability Report`

### What to Include

Please include the following information in your report:

1. **Description**: A clear description of the vulnerability
2. **Steps to Reproduce**: Detailed steps to reproduce the issue
3. **Impact**: What an attacker could achieve with this vulnerability
4. **GNOME Shell Version**: Which version(s) are affected
5. **System Information**: OS, desktop environment, and relevant system details
6. **Proof of Concept**: If available, include screenshots or code snippets

### Response Timeline

- **Acknowledgment**: We will acknowledge receipt within 48 hours
- **Initial Assessment**: We will provide an initial assessment within 5 business days
- **Resolution**: We aim to resolve critical vulnerabilities within 30 days
- **Disclosure**: We will coordinate with you on responsible disclosure timing

### Security Scope

This security policy covers vulnerabilities in:

- Extension code and logic
- Configuration and settings handling
- Integration with GNOME Shell APIs
- Package management functionality
- Screenshot handling capabilities
- System power management features

### Out of Scope

The following are generally not considered security vulnerabilities:

- Issues requiring physical access to an unlocked system
- Vulnerabilities in third-party dependencies (please report to upstream)
- Issues requiring significant user interaction or social engineering
- Performance issues without security implications

### Recognition

We appreciate security researchers who help make Comfort Control (EaseHub) safer for everyone. With your permission, we'll acknowledge your contribution in:

- Security advisory (if published)
- Project contributors list
- Release notes for the fix

## Security Best Practices for Users

### Installation Security

- Always install from official sources:
  - [GNOME Extensions website](https://extensions.gnome.org/extension/8603/comfort-control-easehub/)
  - [Official GitHub releases](https://github.com/nickotmazgin/comfort-control-easehub/releases)
- Verify extension UUID: `comfort-control@nickotmazgin`

### System Security

- Keep your GNOME Shell and system updated
- Review extension permissions before installation
- Monitor extension behavior after installation
- Report any unexpected system behavior

### Configuration Security

- Use secure authentication methods (like `pkexec`) for system operations
- Regularly review and audit enabled extensions
- Limit extension permissions when possible

## Contact

For security-related questions or concerns:
- **Security Issues**: [nickotmazgin@gmail.com](mailto:nickotmazgin.dev@gmail.com)
- **General Support**: [GitHub Issues](https://github.com/nickotmazgin/comfort-control-easehub/issues)

---

*Last updated: September 2025*