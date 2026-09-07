# Security Policy

## Reporting Security Vulnerabilities

We take the security and privacy of GodView and our users very seriously. If you discover a security vulnerability or privacy leak, please do not disclose it publicly via GitHub Issues.

Instead, please report it via private vulnerability reporting on GitHub or by contacting the maintainer directly.

### Scope

- **Collector Edge Security**: Origin validation, batch boundaries, DoS protection, payload size limits.
- **Privacy Guarantees**: Absolute zero raw IP address storage, no tracking cookies, no personal identifiable information (PII).
- **Dashboard API Security**: SQL injection mitigation, token protection, multi-tenant isolation.

## Security Architecture

- **No Cookies**: GodView does not set or read third-party or tracking cookies.
- **No IP Storage**: Cloudflare Workers inspect IP headers only for geolocation lookup (`request.cf.country`), then immediately discard them.
- **Strict Origin Check**: Event ingestion requests must present an `Origin` matching the allowed origins configured for the destination site.
