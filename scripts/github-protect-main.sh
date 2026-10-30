#!/bin/sh
# One-time GitHub setup for the AI workflow (run by a repo admin; needs `gh auth login`).
# Protects main, enables secret scanning + push protection, creates AI labels. See docs/ai-policy.md §8.
set -eu
REPO="${1:-Tushar180203/Gym-Whatsapp-Ai}"

# Branch protection: PR + 1 code-owner approval, required checks, no force-push/deletion, admins included.
gh api -X PUT "repos/$REPO/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Lint, typecheck, unit/integration tests, AI config",
      "PostgreSQL suites",
      "Production build",
      "Secret scan (gitleaks)",
      "CodeQL (SAST)"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "require_code_owner_reviews": true,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true,
  "required_conversation_resolution": true
}
JSON

# Secret scanning + push protection, Dependabot alerts and security updates.
gh api -X PATCH "repos/$REPO" --input - <<'JSON'
{ "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" } } }
JSON
gh api -X PUT "repos/$REPO/vulnerability-alerts"
gh api -X PUT "repos/$REPO/automated-security-fixes"

# Labels used for AI attribution and failure tracking.
gh label create ai-assisted --repo "$REPO" --color 5319e7 --description "Change produced with an AI coding agent" --force
gh label create ai-bug --repo "$REPO" --color d73a4a --description "Defect introduced by AI-assisted code" --force
gh label create dependencies --repo "$REPO" --color 0366d6 --description "Dependency updates" --force

echo "Done. Verify: gh api repos/$REPO/branches/main/protection"
