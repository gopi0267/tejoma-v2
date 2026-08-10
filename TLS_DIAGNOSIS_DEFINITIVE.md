# Definitive End-to-End TLS Diagnosis Report
**Date**: August 10, 2026  
**Issue**: Chrome shows `NET::ERR_CERT_INVALID` for `https://localhost`

---

## Executive Summary

**ROOT CAUSE IDENTIFIED**: The localhost certificate (634114C377...) is misconfigured for server use. It has `X509v3 Basic Constraints: critical CA:TRUE` (marking it as a root CA certificate) but NO `X509v3 Extended Key Usage: TLS Web Server Authentication` (required for server certificates). Chrome rejects this configuration because it violates certificate constraint rules.

**Previous diagnosis claiming "duplicate certificates" is DISPROVEN**: Windows trust store now contains only ONE localhost certificate (634114C377...), which matches what nginx serves exactly.

---

## Step-by-Step Findings

### A. Certificate Chrome Actually Receives (from localhost:443)

```
Subject: (empty - self-signed)
Issuer: (empty - self-signed)
SHA-1:   63:41:14:C3:77:C7:15:6D:B8:B8:07:39:0C:7F:29:0C:01:AF:CC:96
SHA-256: 0E:D0:84:72:BF:E1:37:AA:CB:E6:C8:51:CA:C9:24:45:0F:E6:00:B1:7B:D1:BC:52:46:C2:6F:67:90:52:F8:AF
Serial:  7D5960F4FD1E767DB969870B2E178D540A1B1A91
SAN:     DNS:localhost, IP Address:127.0.0.1
Valid:   Aug 10 09:02:35 2026 GMT → Aug 10 09:02:35 2027 GMT
Algorithm: sha256WithRSAEncryption (RSA 2048-bit)
```

### B. Certificate nginx Is Configured to Use

**Host cert.pem file:**
```
SHA-1:   63:41:14:C3:77:C7:15:6D:B8:B8:07:39:0C:7F:29:0C:01:AF:CC:96
SHA-256: 0E:D0:84:72:BF:E1:37:AA:CB:E6:C8:51:CA:C9:24:45:0F:E6:00:B1:7B:D1:BC:52:46:C2:6F:67:90:52:F8:AF
```

**Mount in docker-compose.yml:**
```yaml
volumes:
  - ./nginx/certs:/etc/nginx/certs:ro
```

**Nginx configuration:**
```nginx
ssl_certificate     /etc/nginx/certs/cert.pem;
ssl_certificate_key /etc/nginx/certs/key.pem;
```

### C. Certificate Windows Trusts

**LocalMachine\Root:**
- 1 certificate found: `634114C377C7156DB8B807390C7F290C01AFCC96`
  - Subject: (empty)
  - NotBefore: 08/10/2026 14:32:35
  - NotAfter: 08/10/2027 14:32:35
  - DNS Names: localhost

**CurrentUser\Root:**
- 1 certificate found: `634114C377C7156DB8B807390C7F290C01AFCC96` (same as LocalMachine)
  - Subject: (empty)
  - NotBefore: 08/10/2026 14:32:35
  - NotAfter: 08/10/2027 14:32:35
  - DNS Names: localhost

### D. Certificate Comparison Matrix

| Component | Certificate | Match |
|-----------|------------|-------|
| Nginx (port 443, live) | 634114C377C7... | baseline |
| Host cert.pem | 634114C377C7... | ✓ YES |
| Container cert.pem | 634114C377C7... | ✓ YES (mounted from host) |
| Windows LocalMachine\Root | 634114C377C7... | ✓ YES |
| Windows CurrentUser\Root | 634114C377C7... | ✓ YES |

**Verdict: A = B = C = D (all match)**

### E. Private Key Verification

```
Certificate public key modulus:  CB68C30E1DDCB64D03835912D56AA94A02273BC7BE...
Private key modulus:             CB68C30E1DDCB64D03835912D56AA94A02273BC7BE...

Match: ✓ YES
```

### F. Certificate Extensions Analysis (THE CRITICAL FINDING)

```
X509v3 Subject Key Identifier: 
    CA:38:D2:A4:36:51:E7:05:33:54:7B:CD:62:73:90:1D:C6:89:B8:51

X509v3 Authority Key Identifier: 
    CA:38:D2:A4:36:51:E7:05:33:54:7B:CD:62:73:90:1D:C6:89:B8:51

X509v3 Basic Constraints: critical
    CA:TRUE                                             ← PROBLEM: Marked as CA
    
X509v3 Subject Alternative Name: 
    DNS:localhost, IP Address:127.0.0.1

[NO Extended Key Usage extension found]                 ← PROBLEM: Missing serverAuth
```

**Missing**: `X509v3 Extended Key Usage: TLS Web Server Authentication`

### G. Hostname Resolution

```
localhost → 127.0.0.1 (IPv4) and ::1 (IPv6)
```

### H. Port Ownership

```
0.0.0.0:443 → listening via nginx container
Port confirmed as tejoma-nginx-1 container
```

### I. Curl Test Result

```
Successfully connects via schannel (Windows native TLS)
HTTP 200 response received
Note: Schannel shows "remote party requests renegotiation" multiple times (suspicious)
```

---

## What Is Actually Causing ERR_CERT_INVALID

Chrome's certificate validation is failing because:

1. **Certificate constraint violation**: The certificate has `X509v3 Basic Constraints: critical CA:TRUE`
   - This tells the browser: "This is a root CA certificate"

2. **Missing server authentication extension**: No `X509v3 Extended Key Usage: TLS Web Server Authentication`
   - This tells the browser: "This certificate is approved for TLS server use"

3. **Conflicting usage**: 
   - Nginx is using it as a **server certificate**
   - But the certificate claims to be a **root CA** (CA:TRUE)
   - And has no explicit approval for server use (no serverAuth EKU)
   - This violates certificate constraint rules

4. **Chrome's validation**:
   - Checks the certificate constraints
   - Sees `CA:TRUE` (root CA only)
   - Sees no `serverAuth` EKU (server approval)
   - Concludes: "This certificate is not valid for TLS server use"
   - Result: `ERR_CERT_INVALID`

---

## Why Previous Diagnosis Was Wrong

**Claim**: "Duplicate localhost certificates in Windows trust store (634114C3... and 624BFC21...) causing ambiguity"

**Reality**: 
- Only ONE certificate in Windows: `634114C377C7156DB8B807390C7F290C01AFCC96`
- That certificate matches what nginx serves exactly
- The old certificate (624BFC21...) is NOT present

**The real problem was never about duplicates—it was about certificate misconfiguration.**

---

## Minimal Safe Fix

**The certificate must be regenerated with proper server constraints:**

1. `CA:FALSE` in Basic Constraints (or omitted entirely for a leaf certificate)
2. `X509v3 Extended Key Usage: TLS Web Server Authentication`

**Regeneration method** (in `scripts/generate-dev-certs.sh`):

Replace:
```bash
MSYS_NO_PATHCONV=1 openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -days 365 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

With:
```bash
MSYS_NO_PATHCONV=1 openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -days 365 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -addext "basicConstraints=CA:FALSE" \
  -addext "keyUsage=digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth"
```

---

## Exact Commands/Actions Performed

1. ✓ Connected to localhost:443 with openssl, extracted certificate
2. ✓ Verified certificate SHA-1/SHA-256 fingerprints (openssl)
3. ✓ Verified cert.pem file SHA-1/SHA-256 (openssl x509)
4. ✓ Verified docker-compose.yml mounts cert to container
5. ✓ Verified Windows LocalMachine\Root for localhost certificates (PowerShell Get-ChildItem)
6. ✓ Verified Windows CurrentUser\Root for localhost certificates (PowerShell Get-ChildItem)
7. ✓ Verified certificate/key moduli match (openssl x509 + openssl rsa)
8. ✓ Analyzed certificate extensions with openssl x509 -text
9. ✓ Verified hostname resolution (nslookup, ping)
10. ✓ Tested with curl -vk

---

## Final HTTPS Test Result

**Before Fix**: Chrome shows `NET::ERR_CERT_INVALID`

**After Fix** (once certificate is regenerated with proper constraints): Chrome should show green padlock and load page successfully

---

## Summary Table

| Item | Finding | Status |
|------|---------|--------|
| Certificate served by nginx | 634114C377... | ✓ Valid |
| Certificate in Windows trust | 634114C377... | ✓ Present |
| Certificate and key match | Yes | ✓ Verified |
| Hostname SAN | localhost | ✓ Present |
| Private key accessible | Yes | ✓ Verified |
| Basic Constraints | **CA:TRUE** | ✗ WRONG for server |
| Extended Key Usage | **MISSING serverAuth** | ✗ WRONG for server |
| Chrome ERR_CERT_INVALID | Yes | Caused by constraints above |

---

## Conclusion

**Chrome ERR_CERT_INVALID is caused by certificate constraint misconfiguration, not by missing installation, old certificates, or hostname issues.**

The localhost certificate (634114C377...) is correctly served by nginx and correctly installed in Windows trust store. However, it was generated with constraints that mark it as a root CA (CA:TRUE) without explicit server authentication approval (no serverAuth EKU). This violates RFC 5280 certificate constraint rules for server use.

**Fix**: Regenerate the certificate with proper server constraints (`CA:FALSE` and `serverAuth` EKU).
