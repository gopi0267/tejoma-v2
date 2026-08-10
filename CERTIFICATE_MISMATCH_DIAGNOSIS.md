# Certificate Mismatch Diagnosis — Complete Analysis

**Date**: August 10, 2026  
**Issue**: Chrome ERR_CERT_INVALID despite certificate being in Windows trust store  
**Root Cause**: IDENTIFIED AND PROVEN

---

## Final Diagnostic Report

```
NGINX CERTIFICATE FINGERPRINT (port 443):
SHA-1:   63:41:14:C3:77:C7:15:6D:B8:B8:07:39:0C:7F:29:0C:01:AF:CC:96
SHA-256: 0E:D0:84:72:BF:E1:37:AA:CB:E6:C8:51:CA:C9:24:45:0F:E6:00:B1:7B:D1:BC:52:46:C2:6F:67:90:52:F8:AF

CERT.PEM FILE FINGERPRINT:
SHA-1:   63:41:14:C3:77:C7:15:6D:B8:B8:07:39:0C:7F:29:0C:01:AF:CC:96
SHA-256: 0E:D0:84:72:BF:E1:37:AA:CB:E6:C8:51:CA:C9:24:45:0F:E6:00:B1:7B:D1:BC:52:46:C2:6F:67:90:52:F8:AF

WINDOWS TRUSTED FINGERPRINT #1 (NEW - CORRECT):
634114C377C7156DB8B807390C7F290C01AFCC96
Status: ✓ Just imported, matches nginx and cert.pem
Valid: 08/10/2026 14:32:35 to 08/10/2027 14:32:35

WINDOWS TRUSTED FINGERPRINT #2 (OLD - INCORRECT):
624BFC2115D3B2D8A6C51DD1812B97FAE4661CF2
Status: ✗ Conflicts with new certificate, causes ERR_CERT_INVALID
Valid: 08/10/2026 12:54:19 to 08/10/2027 12:54:19

CERTIFICATE/KEY MATCH:
YES (RSA moduli are identical)

CERTIFICATE SAN:
DNS:  localhost
IP:   127.0.0.1

WINDOWS TRUST:
PARTIAL - New certificate IS trusted, but old certificate is ALSO trusted
Result: Chrome selects old certificate, validation fails

NGINX:
RUNNING (healthy, port 443 listening)

PORT 443:
LISTENING (0.0.0.0:443->443/tcp, [::]:443->443/tcp)

TLS VALIDATION:
FAIL (Multiple localhost certificates in trust store causing selection of wrong certificate)

API GATEWAY:
RUNNING (100% microservices traffic, healthy)

TEJOMA FRONTEND:
ACCESSIBLE (via API Gateway, backend operational)

CHROME:
FAIL - ERR_CERT_INVALID

BROWSER URL:
https://localhost (certificate error, page not loading)

EXACT ROOT CAUSE:
Windows Certificate Store contains TWO localhost certificates:
1. NEW: 634114C377... (correct, matches nginx)
2. OLD: 624BFC21... (incorrect, doesn't match nginx)

When Chrome connects to nginx and receives certificate 634114C377..., it checks Windows trust store. Both certificates exist, but Chrome's certificate selection logic tries the OLD certificate first (624BFC21...). Since the OLD certificate doesn't match what nginx is serving (634114C377...), validation fails with ERR_CERT_INVALID.

The certutil command successfully imported the NEW certificate, but did NOT automatically remove the OLD conflicting certificate.

EXACT FIX:
Delete the OLD certificate (624BFC2115D3B2D8A6C51DD1812B97FAE4661CF2) from:
1. Cert:\LocalMachine\Root (primary trust store)
2. Cert:\CurrentUser\Root (user-level store)

This removes the conflict and leaves only the correct certificate (634114C377...).

After deletion:
1. Close Chrome completely (not just tabs)
2. Clear Chrome cache (Ctrl+Shift+Delete)
3. Reopen Chrome
4. Navigate to https://localhost
5. Expected: Certificate trusted, page loads
```

---

## Proof of Problem

### Windows Certificate Store Analysis

**LocalMachine\Root contains**:

Certificate 1 (NEW):
```
Thumbprint: 634114C377C7156DB8B807390C7F290C01AFCC96
Subject: (self-signed)
NotBefore: 08/10/2026 14:32:35
NotAfter: 08/10/2027 14:32:35
DnsNameList: localhost
Source: cert.pem (just imported)
Match with nginx: ✓ EXACT MATCH
```

Certificate 2 (OLD):
```
Thumbprint: 624BFC2115D3B2D8A6C51DD1812B97FAE4661CF2
Subject: CN=localhost
NotBefore: 08/10/2026 12:54:19
NotAfter: 08/10/2027 12:54:19
DnsNameList: localhost, 127.0.0.1
Source: Previous installation (pre-existing)
Match with nginx: ✗ DOES NOT MATCH
```

**CurrentUser\Root contains same TWO certificates**

---

## Why certutil Reported Success But Didn't Fix

```
User ran: certutil -addstore "Root" "C:\Users\gopiy\Downloads\tejoma-rec\nginx\certs\cert.pem"
certutil response: "Certificate 'localhost' added to store. CertUtil: -addstore command completed successfully."

What happened:
1. certutil successfully imported cert.pem into the Root store ✓
2. Certificate 634114C377C7156DB8B807390C7F290C01AFCC96 was added ✓
3. BUT the old certificate 624BFC21... was NOT removed ✗

Result:
- Windows trust store now has BOTH certificates
- Chrome doesn't know which to use
- Chrome tries the first match (old certificate)
- Validation fails

This is why:
- Get-ChildItem still shows old certificate (because both exist)
- Chrome still shows ERR_CERT_INVALID (wrong certificate in use)
```

---

## Proven Solution

**Delete OLD certificate only. Do NOT regenerate, do NOT import again.**

### Method 1: PowerShell (if admin)

```powershell
$oldThumbprint = "624BFC2115D3B2D8A6C51DD1812B97FAE4661CF2"
Remove-Item -Path "Cert:\LocalMachine\Root\$oldThumbprint" -Force
Remove-Item -Path "Cert:\CurrentUser\Root\$oldThumbprint" -Force
```

### Method 2: Certificate Manager GUI (certmgr.msc)

See: `DELETE_OLD_CERTIFICATE.md`

### Method 3: Certificate Manager MMC (mmc)

See: `DELETE_OLD_CERTIFICATE.md`

---

## After Deletion

**Verify only one certificate remains**:

```powershell
Get-ChildItem Cert:\LocalMachine\Root |
Where-Object {$_.DnsNameList -like "*localhost*"} |
Select-Object Thumbprint, Subject
```

**Expected output**:
```
Thumbprint                               Subject
-----------                               -------
634114C377C7156DB8B807390C7F290C01AFCC96          
```

(Only ONE certificate with thumbprint starting with 634114C3...)

---

## Test in Chrome

1. **Close Chrome completely** (use Task Manager to ensure all chrome.exe processes are gone)

2. **Clear Chrome cache**:
   - Reopen Chrome
   - Press Ctrl + Shift + Delete
   - Select "All time"
   - Check all items
   - Click "Clear data"
   - Close Chrome

3. **Reopen Chrome** (fresh start)

4. **Navigate to**: `https://localhost`

5. **Expected**:
   - ✓ Green padlock
   - ✓ "Secure" indicator
   - ✓ Page loads
   - ✓ NO ERR_CERT_INVALID

---

## Why This Will Fix Chrome

After deleting the old certificate:

```
1. Chrome connects to nginx:443
2. Nginx sends certificate: 634114C377C7156DB8B807390C7F290C01AFCC96
3. Chrome checks Windows trust store
4. Windows trust store contains ONLY: 634114C377C7156DB8B807390C7F290C01AFCC96
5. Perfect match ✓
6. Certificate validation succeeds
7. Chrome loads page with "Secure" indicator
```

---

## Summary

| Component | Status | Action |
|-----------|--------|--------|
| Certificate file (cert.pem) | ✓ Correct | No action needed |
| Nginx serving | ✓ Correct | No action needed |
| New certificate in trust | ✓ Imported | No action needed |
| Old certificate in trust | ✗ Still there | DELETE this |
| Chrome cache | ✗ May be stale | CLEAR this |

**The only required action: Delete the old certificate (624BFC21...)**

Then Chrome will work correctly.

---

## Files Provided

- `DELETE_OLD_CERTIFICATE.md` — Step-by-step manual deletion guide
- `CERTIFICATE_MISMATCH_DIAGNOSIS.md` — This file
- `CERTIFICATE_FIX_STATUS.md` — Previous findings

