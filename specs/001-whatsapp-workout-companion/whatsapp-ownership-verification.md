# WhatsApp Ownership Verification

Approved implementation delta, 2026-10-08. Extends FR-004/FR-005 and T038/T039/T046A/T047/T055/T058; no parallel identity or confirmation mechanism, no Phase C policy.

Website-entered number is a CLAIMED identity. Only an authenticated Meta sender that consumes the owner's number-bound challenge is VERIFIED. Use libphonenumber-js international parsing/possible-number validation without a default country; store expected SHA-256 provider identity hash and masked display, never the form address. Final AES-256-GCM recipient ciphertext comes from the authenticated sender inside the verification transaction.

Extend account_link_tokens: 128-bit uppercase hex code, hashed at rest, 10-minute expiry, one PENDING challenge per user, supersession, consent timestamp, explicit change intent and bounded attempts. Creation requires an authenticated live session, consent, and explicit action; status reload never creates challenges. LINK is deterministic and bypasses AI, including malformed, expired, mismatched and repeated requests.

Link states are VERIFIED/REVOKED; PENDING is represented by the existing challenge. Status reports both the active verified link and pending replacement. Existing Meta-proven links remain verified on migration; unconsumed unbound legacy tokens are superseded. A claimed number never establishes a recipient or transfers another user's identity. Changing numbers keeps the old link until new proof succeeds, then atomically revokes prior links. Confirmed disconnect invalidates all pending challenges. Deleted users cannot link or send.

Successful verification locks the owner, challenge and provider identity; revalidates expiry/ownership; consumes once; writes verified link and sender ciphertext atomically. Production verification supplies a transaction-bound recipient writer from the provider boundary. Repository fixtures remain number-bound but are not the self-service acceptance path.

The existing LINK reply is the exactly-once WELCOME acknowledgement. A consented verified link with a usable routine gets a separate WORKOUT_PLAN_READY outbound intent per link/routine version. Later routine saves use the same intent builder. No worker, marketing templates or invented service window: dispatch is request-driven/manual, and the transport enforces its existing 24-hour conversation window. Ambiguous provider acceptance cannot blindly resend.

Public business destination is configured as WHATSAPP_BUSINESS_NUMBER (international E.164), distinct from WHATSAPP_PHONE_NUMBER_ID. Challenge API returns a wa.me URL and the code once; GET returns only masked status/expiry, not the code/hash/recipient. A reload preserves pending state but requires an explicit new-code action if the original code was lost.

Verification evidence: unit normalization/parser/security tests; PostgreSQL expiry/replay/concurrency/ownership/restart/rollback tests; signed controlled-provider flow; real website/API browser acceptance at desktop/mobile widths. These must pass before affected tasks are marked complete.
