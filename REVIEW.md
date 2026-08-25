# Archie — Review Contract

Every change to this repo is reviewed against this contract. §1 findings are **blocking**.

## 1. Open-source hygiene — no proprietary leakage (blocking)

Archie is a **public, open-source** repo. Nothing company-, employer-, or customer-specific
may appear anywhere in it — skill prose, references, examples, fixtures, config samples,
tests, docs, comments, **commit messages, or release notes**. Blocking findings:

- **Real internal identifiers** — actual repository/service/team/tool names, internal
  hostnames or domains (anything under a corporate zone, `*.internal`, VPN-only hosts).
- **Real ticket keys or URLs** — concrete issue keys, tracker/wiki/dashboard links, or
  anything that resolves only inside a company.
- **Customer data or PII** — real names, emails, account IDs, or any real content, even as
  "example" data.
- **Org-specific conventions presented as Archie defaults** — one company's stack, layout,
  or process hard-coded into a skill instead of living in the user's own `.archie/` config.

Everything illustrative must be **synthetic and generic**: invented service names
(`api-service`), placeholder keys (`PROJ-123`), and a made-up web-shop domain (orders,
shipments, notifications). When in doubt, genericize.

**Leakage rides on three surfaces that ship separately: the file, the commit message, and
the release note.** Cleaning one is not cleaning the change — before pushing, check the tree
AND `git log` for the phrasing, not just the diff. `scripts/leak-scan.sh` automates this and
runs as a pre-push hook; its pattern list is local-only (committing the list would itself be
the leak) — see the script header for setup.

## 2. Honesty invariants (blocking)

- **No claim without evidence.** Any prose or template that lets a generated page state
  system behavior without a `file:line` citation, or fill a gap with a plausible guess
  instead of an UNKNOWN, is a blocking finding.
- **The verifier only deletes.** Any change giving the adversarial verifier the power to add
  or rephrase content breaks its independence.
- **Rendering stays deterministic.** `wiki`/`status` must remain LLM-free.

## 3. Scope invariants

- Read-only against the analyzed repo (Archie writes only under `.archie/`).
- Single-repo boundary: outbound calls are labelled boxes, never followed (v1).
- The structural model remains the single source of truth; no view may carry content that
  is not in the model.
