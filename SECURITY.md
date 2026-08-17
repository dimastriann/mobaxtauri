# Security policy

## Supported versions

MobaXTauri is currently early-beta software and no release is considered production-hardened. Security fixes are applied to the latest code and, when practical, the latest published release.

| Version | Security support |
| :--- | :--- |
| Latest release / default branch | Best effort |
| Older releases | Not supported |

## Important current limitations

- **SSH host keys are accepted without verification.** The client does not yet use a known-hosts trust workflow, so it cannot protect users from a machine-in-the-middle presenting a different server key.
- Saved credentials use a local Tauri Stronghold vault, but the current application-managed unlock-key design is not equivalent to a user-supplied master password or operating-system credential manager.
- Private-key files are read from the path selected by the user. Passphrase-protected private keys are not currently supported by the connection flow.
- Security behavior has not yet received an independent audit.

Until these limitations are addressed, use disposable test systems and do not connect MobaXTauri to production-sensitive infrastructure.

## Reporting a vulnerability

Please do not open a public GitHub issue for a suspected vulnerability.

Use GitHub's **Security** tab and select **Report a vulnerability** to submit a private security advisory:

https://github.com/dimastriann/mobaxtauri/security/advisories/new

Include:

- the affected version or commit;
- the platform and environment;
- clear reproduction steps or a minimal proof of concept;
- the potential impact;
- any suggested mitigation; and
- whether you want public credit after a fix is available.

Do not include real credentials, private keys, or identifying infrastructure data. You should receive an acknowledgement within seven days. Fix and disclosure timing depends on severity and maintainer availability.

## Security scope

Reports involving credential exposure, host identity verification, unsafe local file access, command/data injection, privilege escalation, or dependency vulnerabilities are in scope. General feature requests and non-security bugs should use the public issue tracker.
