# Privacy guardrails

- Do not send form values, passwords, email addresses, phone numbers, or free-text content.
- Form tracking records only a form/field identifier and whether interaction occurred.
- URLs are stored without their query string to avoid accidentally collecting identifiers or search terms.
- Country derives from Cloudflare request metadata; no raw IP address is written to Analytics Engine.
- Custom event property strings are length-limited. Add explicit allowlists before accepting sensitive business events.
- Sites should disclose analytics collection and obtain consent where their applicable law requires it.
