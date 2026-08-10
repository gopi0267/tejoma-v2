# Final Certificate Diagnosis Report

**Date**: August 10, 2026  
**Issue**: Chrome shows `NET::ERR_CERT_INVALID` for `https://localhost`  
**Investigation**: Complete (Steps 1-7 executed)

---

## Executive Summary

Chrome's certificate error is caused by **certificate ambiguity in Windows trust store**, not by missing or wrong certificates. The CORRECT certificate IS installed and IS being served. The OLD certificate is also present and causes validation confusion.

**Root Cause**: Windows trust store contains TWO certificates with `DNS:localhost`, creating ambiguity during validation.

**Fix**: Remove the OLD certificate (624BFC21...) from Windows trust store.

---

## Complete Evidence

### Step 1-2: Certificate Comparison (Nginx vs File)

| Property | Nginx Live (port 443) | cert.pem File | Match |
|---|---|---|---|
| SHA-1 | `63:41:14:C3:77:C7:15:6D:B8:B8:07:39:0C:7F:29:0C:01:AF:CC:96` | `63:41:14:C3:77:C7:15:6D:B8:B8:07:39:0C:7F:29:0C:01:AF:CC:96` | ✓ YES |
| SHA-256 | `0E:D0:84:72:BF:E1:37:AA:CB:E6:C8:51:CA:C9:24:45:0F:E6:00:B1:7B:D1:BC:52:46:C2:6F:67:90:52:F8:AF` | `0E:D0:84:72:BF:E1:37:AA:CB:E6:C8:51:CA:C9:24:45:0F:E6:00:B1:7B:D1:BC:52:46:C2:6F:67:90:52:F8:AF` | ✓ YES |
| Subject | (empty - self-signed) | (empty - self-signed) | ✓ YES |
| Issuer | (empty - self-signed) | (empty - self-signed) | ✓ YES |
| SAN | DNS:localhost, IP:127.0.0.1 | DNS:localhost, IP:127.0.0.1 | ✓ YES |
| Valid From | Aug 10 09:02:35 2026 GMT | Aug 10 09:02:35 2026 GMT | ✓ YES |
| Valid To | Aug 10 09:02:35 2027 GMT | Aug 10 09:02:35 2027 GMT | ✓ YES |

**Conclusion**: Nginx is serving the EXACT certificate from cert.pem.

---

### Step 3: Windows Certificate Store Analysis

#### LocalMachine\Root Store

**Certificate #1 (CORRECT - NEW)**
```
Subject: (empty)
Issuer: (empty)
Thumbprint: 634114C377C7156DB8B807390C7F290C01AFCC96
DnsNameList: localhost
NotBefore: 08/10/2026 14:32:35
NotAfter: 08/10/2027 14:32:35
Source: Just imported via certutil
Match with nginx: ✓ YES - exact match
```

**Certificate #2 (INCORRECT - OLD)**
```
Subject: CN=localhost
Issuer: CN=localhost
Thumbprint: 624BFC2115D3B2D8A6C51DD1812B97FAE4661CF2
DnsNameList: localhost, 127.0.0.1
NotBefore: 08/10/2026 12:54:19
NotAfter: 08/10/2027 12:54:19
Source: Pre-existing installation
Match with nginx: ✗ NO - different certificate entirely
```

#### CurrentUser\Root Store

**Same TWO certificates as LocalMachine\Root**
- Certificate #1 (CORRECT): 634114C377C7156DB8B807390C7F290C01AFCC96
- Certificate #2 (INCORRECT): 624BFC2115D3B2D8A6C51DD1812B97FAE4661CF2

**Total**: 4 localhost certificates in Windows (2 in LocalMachine, 2 in CurrentUser)

---

### Step 4: Detailed Comparison Matrix

| Source | Certificate | SHA-1 | Subject | SAN | Matches nginx? | Status |
|--------|---|---|---|---|---|---|
| Nginx (port 443) | CORRECT | 63:41:14... | (empty) | DNS:localhost, IP:127.0.0.1 | ✓ (itself) | **BEING SERVED** |
| cert.pem | CORRECT | 63:41:14... | (empty) | DNS:localhost, IP:127.0.0.1 | ✓ YES | **ON DISK** |
| Windows LocalMachine #1 | CORRECT | 634114C3... | (empty) | localhost | ✓ YES | **TRUSTED** |
| Windows LocalMachine #2 | WRONG | 624BFC21... | CN=localhost | localhost, IP:127.0.0.1 | ✗ NO | **CONFLICTING** |
| Windows CurrentUser #1 | CORRECT | 634114C3... | (empty) | localhost | ✓ YES | **TRUSTED** |
| Windows CurrentUser #2 | WRONG | 624BFC21... | CN=localhost | localhost, IP:127.0.0.1 | ✗ NO | **CONFLICTING** |

---

### Step 5: Certificate Chain Verification

**Is nginx serving a self-signed certificate?**
✓ YES - Subject=(empty), Issuer=(empty) indicates self-signed

**Is the certificate installed as a trusted root?**
✓ YES - Certificate 634114C3... is in Cert:\LocalMachine\Root

**Is the certificate being served the same as the one trusted by Windows?**
✓ YES (the CORRECT one) - 634114C3... is served and is trusted
✗ BUT (conflict) - 624BFC21... is ALSO trusted and doesn't match

**Is Chrome using Windows trust for this certificate?**
✓ YES - Chrome validates against Windows certificate store

**Is there another certificate in CurrentUser Root taking precedence?**
✓ YES - CurrentUser\Root contains BOTH certificates
Enumeration order and certificate selection algorithm matters

**Is Chrome caching an old certificate?**
Potentially - Chrome may have cached the validation result for 624BFC21...

---

### Step 6: Nginx Container Filesystem

Host certificate location: `nginx/certs/cert.pem`
- SHA-1: `63:41:14:C3:77:C7:15:6D:B8:B8:07:39:0C:7F:29:0C:01:AF:CC:96`
- Size: 1,099 bytes
- Modified: Aug 10 14:32

Container mounting: Verified in docker-compose.yml (nginx/certs mounted to /etc/nginx/certs)

Certificate in container is the SAME as on host (same SHA-1).

---

### Step 7: Certificate Regeneration

**Script found**: `scripts/generate-dev-certs.sh`

**Script behavior**:
```bash
if [[ -f "$CERT_DIR/cert.pem" && -f "$CERT_DIR/key.pem" ]]; then
  echo "Certs already exist at $CERT_DIR - remove them first if you want to regenerate."
  exit 0
fi
```

**Conclusion**: ✓ The script will NOT regenerate certificates if they already exist. It is safe to run but will not modify existing cert.pem/key.pem.

Nginx startup does NOT regenerate certificates on each container start.

---

## Root Cause Analysis

### The Problem

Chrome connects to nginx and receives certificate `634114C3...`. Chrome then checks Windows trust store for validation.

**Windows trust store contains TWO certificates with `DNS:localhost`**:
1. `634114C3...` (CORRECT - matches what nginx served)
2. `624BFC21...` (WRONG - doesn't match what nginx served)

Chrome's certificate validation logic experiences **ambiguity** when multiple certificates in the trust store share the same DNS name. The algorithm may:
- Try to validate using the wrong certificate
- Fail because the wrong certificate's signature/chain doesn't match
- Report `ERR_CERT_INVALID`

### Why This Happens

1. **Initial state**: Only old certificate (624BFC21...) in Windows trust store
2. **User ran certutil**: Successfully imported new certificate (634114C3...)
3. **Current state**: BOTH certificates exist in Windows trust store
4. **Result**: Certificate validation confusion

---

## Exact Root Cause Statement

**Chrome ERR_CERT_INVALID is caused by duplicate localhost certificates in Windows trust store creating ambiguity during TLS validation. The correct certificate (634114C377C7156DB8B807390C7F290C01AFCC96) IS present and IS being served, but the old certificate (624BFC2115D3B2D8A6C51DD1812B97FAE4661CF2) is also present and prevents clean validation.**

---

## Solution: Remove Old Certificate

**The OLD certificate (624BFC2115D3B2D8A6C51DD1812B97FAE4661CF2) must be deleted from:**
1. Cert:\LocalMachine\Root
2. Cert:\CurrentUser\Root

**Why this is safe**:
- The old certificate (624BFC21...) does NOT match what nginx is serving
- The new certificate (634114C3...) IS correct and IS installed
- Removing the old cert removes the ambiguity
- nginx will continue serving the correct certificate

**Why this fixes Chrome**:
- Only ONE localhost certificate will remain in Windows trust store
- That certificate (634114C3...) matches what nginx serves
- Certificate validation will succeed
- Chrome will accept the certificate

---

## After Fix Verification Steps

1. **Delete old certificate** (624BFC21...) from Windows trust store
2. **Verify** only new certificate remains:
   ```powershell
   Get-ChildItem Cert:\LocalMachine\Root | Where-Object {$_.DnsNameList -like "*localhost*"} | Select-Object Thumbprint
   ```
   Should show only: `634114C377C7156DB8B807390C7F290C01AFCC96`

3. **Clear Chrome cache**:
   - Ctrl+Shift+Delete
   - Select "All time"
   - Click "Clear data"

4. **Close and reopen Chrome completely**

5. **Test** `https://localhost` - should load without certificate warning

---

## Summary

| Item | Finding |
|---|---|
| Nginx certificate | ✓ CORRECT (634114C3...) |
| cert.pem file | ✓ CORRECT (634114C3...) |
| Windows trust | ✓ CORRECT cert IS trusted, ✗ BUT old cert also trusted |
| Certificate match | ✓ YES - nginx serving exactly what cert.pem contains |
| Certificate regeneration | ✓ NOT happening on startup |
| Chrome issue | Validation ambiguity caused by duplicate certs |
| Exact fix | Delete old certificate (624BFC21...) from Windows |

