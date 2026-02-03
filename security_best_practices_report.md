# Security Best Practices Report

## Executive Summary
Reviewed the React frontend and Node server used to serve the SPA and `/api` routes. Two material security gaps were found: credentials are persisted in `localStorage`, and no security headers are configured in the Cloud Run server code. Both are common hardening issues. No evidence of DOM XSS sinks or `dangerouslySetInnerHTML` usage was found in the current code paths.

## High Severity

### 1) REACT-STORAGE-001: Access credentials stored in `localStorage`
- Severity: High
- Location: `App.tsx` lines 120-159
- Evidence:
  - `restoreAccessFromStorage(localStorage, ACCESS_STORAGE_KEY);` (line 132)
  - `safeSetItem(localStorage, ACCESS_STORAGE_KEY, JSON.stringify(access));` (line 155)
- Impact: Any XSS or malicious browser extension can read demo codes or admin password stored in `localStorage` and reuse them. This weakens the access gate and admin control room protection.
- Fix: Do not persist access credentials in `localStorage`. Keep tokens in memory only, or move to a short-lived, HTTP-only cookie session set server-side. If you must persist, store only a non-sensitive flag, not the code itself.
- Mitigation: Add a strict CSP, avoid any HTML injection, and treat `localStorage` as untrusted input.
- False positive notes: If the access codes are intentionally non-sensitive, the risk is lower, but admin passwords are still sensitive.

## Medium Severity

### 2) REACT-HEADERS-001 / JS-CSP-001: No security headers set in server responses
- Severity: Medium
- Location: `server/index.ts` lines 115-149
- Evidence:
  - API responses only set `Content-Type` (lines 115-118)
  - Static responses only set `Content-Type` (lines 133-149)
- Impact: Missing CSP, `X-Content-Type-Options`, clickjacking protection, and `Referrer-Policy` reduce defense in depth against XSS, MIME sniffing, and clickjacking.
- Fix: Add security headers in the server response path, or configure them at the Cloud Run edge or load balancer. Minimum recommended:
  - `Content-Security-Policy`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Frame-Options: DENY` (or `frame-ancestors` via CSP)
- Mitigation: If you already set headers at the edge, confirm via runtime response headers and document it.
- False positive notes: These headers might be configured outside the repo. Verify with a live `curl -I` response.

## Low Severity

### 3) REACT-STORAGE-001: Lecture content persisted in `localStorage`
- Severity: Low
- Location: `App.tsx` lines 120-149
- Evidence:
  - `safeSetItem(localStorage, LOCAL_STORAGE_KEY, JSON.stringify({ result, timestamp }))` (lines 141-145)
- Impact: The study guide and transcript are stored in `localStorage`. Any XSS can read this content. If lectures contain sensitive data, this increases exposure.
- Fix: Consider making this opt-in, or store only non-sensitive metadata. Alternatively, use server-side storage and per-session access controls.
- Mitigation: Same as above, strict CSP and avoid risky DOM sinks.
- False positive notes: If the content is non-sensitive, the impact is low.

## Notes
- No `dangerouslySetInnerHTML`, `innerHTML`, or `eval` sinks were found in the scanned React UI.
- No third-party scripts loaded from external CDNs were found in the app shell.

Report location: `security_best_practices_report.md`.
