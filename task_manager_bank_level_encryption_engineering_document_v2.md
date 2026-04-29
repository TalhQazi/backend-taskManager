# Task Manager Security Architecture & Encryption Engineering Document

**Scope:** employee onboarding, ID images, payroll data, tax forms, signatures, HR records, and other sensitive internal records

**System:** Se7en Task Manager / internal workforce platform
**Security target:** Bank-grade handling of PII, payroll, onboarding, and identity documents
**Required outcome:** Encrypt data in transit, at rest, and at field level; enforce strict access control; make all sensitive actions auditable
**Audience:** Backend, mobile, web, DevOps, database, and compliance engineers

**Executive summary.** Use TLS 1.3 for all transport, envelope encryption with a cloud KMS for all stored data, field-level encryption for SSNs, bank accounts, DOB, license numbers, and payroll values, object-storage encryption for uploaded IDs, and strict role-based access with per-action audit logging. No plaintext secrets, no direct database exposure, no unrestricted admin access, and no local storage of sensitive files on mobile devices.

## 1. Security objectives
* Protect employee identity documents, payroll records, tax forms, addresses, signatures, and onboarding artifacts from theft, misuse, and accidental disclosure.
* Prevent any employee, manager, or developer from seeing more data than their role requires.
* Make every sensitive read, export, update, approval, and deletion traceable to a user, device, IP, and timestamp.
* Keep encryption keys separated from application data so a database compromise does not expose readable records.
* Support secure web, iOS, and Android access without allowing open public signup or uncontrolled account creation.

## 2. Threat model
The design must assume four realistic threat classes:
* External attacker gains API access through stolen credentials, session theft, or a web/mobile exploit.
* Database snapshot, backup, or object-storage bucket is exposed by error or stolen credentials.
* Insider abuse: an administrator or payroll user attempts to browse records outside authorized scope.
* Compromised device: an employee phone or laptop is lost, rooted, jailbroken, or infected with malware.

## 3. Required security architecture
### 3.1 High-level model
Implement a zero-trust application pattern: clients never connect directly to the database; all access flows through authenticated APIs; secrets and keys are isolated in managed security services; and each request is authorized server-side against role and record scope.
* Client layer: React web app, iOS app, Android app.
* API layer: authenticated HTTPS APIs behind a load balancer or API gateway.
* Service layer: onboarding service, payroll service, document service, user/role service, audit service, notification service.
* Data layer: application database, object storage for documents/images, Redis or equivalent only for ephemeral non-sensitive cache, never for raw PII unless encrypted.
* Security layer: KMS/HSM-backed keys, secrets manager, WAF, centralized logs, SIEM/alerts.

### 3.2 Data classification
| Class | Examples | Storage rule | Encryption rule |
| --- | --- | --- | --- |
| Public | app version, help text | standard DB/cache | TLS in transit |
| Internal | task notes, schedules | standard DB | AES-256 at rest |
| Confidential | employee addresses, phone, pay rate | DB only | KMS-backed DB + field-level encryption for key values |
| Restricted | SSN, bank acct, tax forms, ID photos, W-4/I-9, signatures | encrypted object storage or encrypted DB columns only | field/object encryption + key separation + strict scoped access |

## 4. Encryption requirements
### 4.1 Encryption in transit
* Enforce TLS 1.3 for all external and internal HTTPS traffic wherever supported. Disable TLS 1.0, 1.1, weak ciphers, and insecure renegotiation.
* Use HSTS on the web app. Redirect all HTTP to HTTPS. Mark cookies Secure and HttpOnly. Use SameSite=Lax or Strict unless there is a hard cross-site need.
* Use certificate pinning in mobile apps if practical for your stack, especially for production API domains handling payroll and identity data.
* Between services, prefer mTLS or private network-only service communication.

### 4.2 Encryption at rest
* Database volumes, snapshots, replicas, and backups must use AES-256 encryption managed by the cloud provider KMS.
* Object storage for uploaded IDs, payroll exports, W-4/I-9 packets, and signed documents must be encrypted server-side with customer-managed KMS keys, not default anonymous storage settings.
* Search indexes, log stores, and analytics sinks that may contain identifiers must also be encrypted at rest.

### 4.3 Field-level encryption
Certain values are too sensitive to rely only on full-disk or database-at-rest encryption. Encrypt these fields before persistence in the application layer or use native client-side/field-level encryption supported by the database driver.
* Social Security number
* Driver’s license or state ID number
* Date of birth
* Bank account and routing numbers
* Payroll tax identifiers
* Signature image blobs or signature hash payloads
* Any recovery codes, invite tokens, or one-time onboarding secrets

Implementation rule: store only masked derivatives where possible. Example: keep last four digits for display/search; keep the full value only in encrypted form.

### 4.4 Envelope encryption design
Use envelope encryption for restricted data.
* Application requests a data key from KMS for the specific purpose or tenant scope.
* KMS returns a plaintext data key plus an encrypted version of that same data key.
* Application encrypts the sensitive payload locally with the plaintext data key using an AEAD mode such as AES-256-GCM.
* Application discards the plaintext key immediately, stores only the ciphertext payload, nonce/IV, auth tag, and the encrypted data key.
* On read, only an authorized service can ask KMS to decrypt the stored encrypted data key and then decrypt the payload in memory.

### 4.5 Password handling
* Never encrypt passwords for later recovery. Hash them with Argon2id with a strong memory cost. Bcrypt is acceptable only if Argon2id is unavailable.
* Support MFA for administrators, payroll staff, and any role with access to employee records or exports.
* Use short-lived access tokens and rotating refresh tokens. Revoke on logout, suspected compromise, role change, or employment termination.

## 5. Access control and identity
### 5.1 Closed enrollment model
The Task Manager app should not allow public self-registration. Use invitation-only enrollment.
* Admin creates an employee record and generates a one-time onboarding token.
* Token is sent by SMS or email and expires quickly, ideally in 15–30 minutes if unused.
* Token is single-use, bound to intended identity, and invalidated after first successful account setup.
* High-risk actions during onboarding, such as uploading IDs or entering direct deposit info, require re-authentication or step-up verification.

### 5.2 RBAC and scope control
| Role | Allowed access | Blocked access |
| --- | --- | --- |
| Employee | own profile, own tasks, own onboarding checklist | other employees’ payroll, IDs, HR docs |
| Manager | team tasks, team completion status, limited onboarding progress | raw SSNs, bank accounts, full tax docs unless explicitly granted |
| HR/Onboarding | ID docs, forms, checklist, hiring records | company-wide payroll exports unless payroll role added |
| Payroll | pay rates, bank setup, tax docs, payroll exports | general HR case notes unless explicitly needed |
| Super Admin | system config, user management, audit review | must not bypass audit logging or view secrets directly |

* Enforce server-side authorization on every request; never trust hidden buttons or client-side role checks.
* Add record-level scoping so a manager can only see direct reports or assigned locations.
* Use just-in-time privileged access for security admins when possible.

## 6. Secure document and ID handling
* Store uploaded ID images and signed forms in private object storage only. No public URLs. Use time-limited signed URLs for controlled downloads/previews.
* Strip metadata where possible from uploaded images and PDFs before long-term storage.
* Virus-scan and validate file type on upload. Reject executable or mismatched file types.
* Generate thumbnails/previews in an isolated worker process, not in the public API request path.
* Do not embed full SSNs or bank account numbers into filenames, URLs, logs, or search indexes.
* Watermark or stamp exported copies where appropriate to discourage casual sharing.

## 7. Logging, monitoring, and auditability
Sensitive systems fail when reads are invisible. Treat view access like a security event, not only writes.
* Log login success/failure, token issuance, MFA events, password reset, invite creation, invite redemption, role changes, exports, record reads of restricted data, document downloads, and admin impersonation if supported.
* Audit events must be append-oriented and tamper-resistant. Separate audit retention from general app logs.
* Never log raw SSNs, bank account numbers, passwords, full tokens, or plaintext invite codes.
* Alert on abnormal behavior: many failed logins, repeated document downloads, bulk exports, off-hours admin activity, privilege escalation, and access from unfamiliar geographies or IP ranges.

## 8. Secrets and key management
* Keep database credentials, JWT signing keys, SMS credentials, payroll provider secrets, and storage credentials in a secrets manager, never in source code or .env files committed to Git.
* Rotate secrets on schedule and on suspicion of exposure.
* Use separate KMS keys by environment: dev, staging, production. Production keys must never be shared downward.
* Restrict KMS decrypt permissions to the minimum set of application roles that truly need them.
* Use key aliases and formal rotation procedures so ciphertext remains decryptable during rotation.

## 9. Mobile and web client hardening
* Store tokens in secure platform storage only: Keychain on iOS, EncryptedSharedPreferences or Keystore-backed secure storage on Android, secure cookies for web.
* Do not cache restricted documents or ID images on-device unless absolutely necessary. If temporary local storage is needed, encrypt it and wipe it after use.
* Detect rooted or jailbroken devices for higher-risk roles and block or step-up verify as needed.
* Use inactivity timeouts and require re-authentication before showing payroll data, bank details, or ID documents.
* Disable screenshots on sensitive mobile screens if your product and platform constraints allow it.

## 10. Database design rules
* Use separate schemas or logically separated tables for authentication, HR, payroll, audit, and task data.
* Do not duplicate restricted values across convenience tables, caches, exports, or analytics systems.
* Use opaque IDs instead of predictable incremental identifiers in public-facing APIs.
* Support soft delete for business records but hard-delete transient secrets and expired onboarding tokens.
* Backups must be encrypted and access-controlled exactly like production.

## 11. DevOps and infrastructure controls
* Run production in a private network with least-privilege security groups, no public database exposure, and restricted bastion/admin access.
* Place a WAF in front of public APIs and web app endpoints.
* Use CI/CD with secret scanning, dependency vulnerability scanning, container/image scanning, IaC review, and mandatory code review for security-sensitive changes.
* Separate dev/staging/prod accounts or projects. Never test with real employee SSNs or bank accounts in lower environments.
* Enable centralized log retention, alerting, and immutable backup strategy.

## 12. Recommended implementation stack
| Control area | Recommended control | Notes |
| --- | --- | --- |
| Transport | TLS 1.3 + HSTS + secure cookies | mTLS internally if feasible |
| Passwords | Argon2id | never reversible |
| API auth | short-lived JWT or secure session + refresh rotation | MFA for elevated roles |
| Key management | AWS KMS or equivalent + Secrets Manager | customer-managed keys |
| Database | managed encryption + field-level encryption | protect restricted columns |
| File storage | private object storage + KMS + signed URLs | scan uploads |
| Audit | append-only audit trail + alerts | log reads and exports |

## 13. API-level engineering requirements
* Validate and sanitize all input server-side.
* Apply rate limiting to login, password reset, onboarding token redemption, and document retrieval.
* Use idempotency keys for sensitive create/update actions that may be retried.
* Return generic auth error messages so account enumeration is harder.
* Mask restricted values by default in all API responses and require elevated scope for full reveal.
* For exports, require explicit permission, watermark the output, and log who exported what and why if business flow allows.

## 14. Security acceptance checklist for coders
| Must be complete before launch | Validation |
| --- | --- |
| TLS enforced everywhere; no insecure endpoints | □ |
| All restricted fields encrypted with envelope or field-level encryption | □ |
| ID images and signed docs stored only in private encrypted object storage | □ |
| Invitation-only onboarding with expiring one-time tokens | □ |
| MFA enabled for admins, HR, payroll, and super users | □ |
| Role and record-scope checks on every sensitive endpoint | □ |
| Audit logs for reads, exports, role changes, and downloads | □ |
| No secrets in repo, client bundle, or plaintext config files | □ |
| Encrypted backups and tested restore path | □ |
| Security test pass: auth, authorization, injection, file upload, session handling | □ |

## 15. Recommended rollout order
1. Lock transport security, secrets manager usage, and production network boundaries first.
2. Implement closed invitation onboarding and strong authentication next.
3. Add field-level encryption and private document storage before live employee data import.
4. Add audit logging, alerts, and export controls before payroll goes live.
5. Run penetration testing and role-scope validation before full deployment.

## 16. Bottom line
For this Task Manager, bank-level encryption should mean more than turning on database encryption. The correct implementation is layered: TLS 1.3 in transit, KMS-backed encryption at rest, field-level encryption for the most sensitive values, private encrypted file storage, invitation-only identity flow, MFA for elevated roles, strict RBAC, record-scope controls, and full auditability of every sensitive action. Build all of it together. Anything less leaves payroll and identity data exposed at the exact points attackers and insiders target.
