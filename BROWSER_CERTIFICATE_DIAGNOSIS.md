# Browser Certificate Issue — Diagnosis Report

**Date**: August 10, 2026  
**Issue**: Chrome shows `ERR_CERT_INVALID` for https://localhost  
**Root Cause**: IDENTIFIED ✓

---

## Exact Root Cause

**Certificate Mismatch**: The certificate nginx is serving does NOT match the certificate in Windows trust store.

### Certificates Found

**1. Windows Trusted Root Certification Authorities**
```
Subject: CN=localhost
SHA-1 Thumbprint: 624BFC2115D3B2D8A6C51DD1812B97FAE4661CF2
Valid From: 08/10/2026 12:54:19
Valid To: 08/10/2027 12:54:19
Status: ✓ INSTALLED & TRUSTED
```

**2. Currently Served by Nginx**
```
Subject: (empty/minimal)
SHA-1 Fingerprint: 634114c377c7156db8b807390c7f290c01afcc96
SHA-256 Fingerprint: 0E:D0:84:72:BF:E1:37:AA:CB:E6:C8:51:CA:C9:24:45:0F:E6:00:B1:7B:D1:BC:52:46:C2:6F:67:90:52:F8:AF
File: nginx/certs/cert.pem
Valid From: Aug 10 09:02:35 2026 GMT
Valid To: Aug 10 09:02:35 2027 GMT
Status: ✓ Valid, but NOT in Windows trust store
Includes SANs: DNS:localhost, IP:127.0.0.1
```

### Why Chrome Shows ERR_CERT_INVALID

1. Nginx presents certificate with SHA-1: `634114c377c7156db8b807390c7f290c01afcc96`
2. Chrome checks Windows trust store
3. Windows trust store contains different certificate: `624BFC2115D3B2D8A6C51DD1812B97FAE4661CF2`
4. Certificate doesn't match → ERR_CERT_INVALID

---

## Verification Checklist

| Check | Result | Status |
|-------|--------|--------|
| Certificate file exists | nginx/certs/cert.pem (1.1K) | ✓ OK |
| Private key exists | nginx/certs/key.pem (1.7K) | ✓ OK |
| Cert and key match | Both have same RSA modulus | ✓ OK |
| Certificate has SANs | DNS:localhost, IP:127.0.0.1 | ✓ OK |
| Nginx configured | ssl_certificate paths correct | ✓ OK |
| Port 443 listening | 0.0.0.0:443->443/tcp | ✓ OK |
| Nginx serving cert | Successfully connecting via TLS | ✓ OK |
| Windows trust store | Contains localhost cert | ✓ YES |
| Fingerprint match | Windows ≠ Nginx | ✗ MISMATCH |
| Chrome validation | Fails (cert not trusted) | ✗ FAILS |

---

## Solution

### Option A: Add Current Nginx Certificate to Windows (Requires Admin)

**Steps**:

1. **Open Command Prompt as Administrator**
   - Right-click Command Prompt or PowerShell
   - Select "Run as administrator"

2. **Run this command**:
   ```batch
   certutil -addstore "Root" "C:\Users\gopiy\Downloads\tejoma-rec\nginx\certs\cert.pem"
   ```

3. **Verify in PowerShell**:
   ```powershell
   Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -match "634114c3" }
   ```
   Should show the certificate now installed

4. **Close ALL Chrome windows** (completely, not just tabs)

5. **Reopen Chrome and test**: https://localhost

---

### Option B: Delete Old Certificate + Keep New One

**If Option A doesn't work**:

1. **Delete the old certificate from Windows**:
   ```powershell
   Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq "624BFC2115D3B2D8A6C51DD1812B97FAE4661CF2" } | Remove-Item
   ```

2. **Add the new certificate** (run as admin):
   ```batch
   certutil -addstore "Root" "C:\Users\gopiy\Downloads\tejoma-rec\nginx\certs\cert.pem"
   ```

3. **Restart Chrome completely**

4. **Test**: https://localhost

---

## Current Configuration Details

```
CERTIFICATE SERVED BY NGINX:
  SHA-1:   634114c377c7156db8b807390c7f290c01afcc96
  SHA-256: 0E:D0:84:72:BF:E1:37:AA:CB:E6:C8:51:CA:C9:24:45:0F:E6:00:B1:7B:D1:BC:52:46:C2:6F:67:90:52:F8:AF
  
CERTIFICATE FINGERPRINT:
  634114c377c7156db8b807390c7f290c01afcc96
  
CERTIFICATE SAN:
  DNS:localhost
  IP:127.0.0.1
  
CERTIFICATE VALIDITY:
  From: Aug 10 09:02:35 2026 GMT
  To:   Aug 10 09:02:35 2027 GMT
  
KEY/CERT MATCH:
  ✓ YES - Both have matching RSA modulus
  
WINDOWS TRUST:
  ✗ NO - Certificate NOT in Windows trust store
  (Different cert with SHA-1: 624BFC2115D3B2D8A6C51DD1812B97FAE4661CF2 is installed)
  
NGINX:
  ✓ Healthy
  ✓ Listening on port 443
  ✓ Certificate and key configured correctly
  ✓ Serving valid certificate with proper SANs
  
PORT 443:
  ✓ Listening (0.0.0.0:443->443/tcp)
  ✓ Connected via TLS successfully
  
TLS VALIDATION:
  ✗ FAILS - Certificate not trusted by Windows
  
CHROME/BROWSER ACCESS:
  ✗ BLOCKED - Shows ERR_CERT_INVALID
  
EXACT ROOT CAUSE:
  Certificate served by nginx (SHA-1: 634114c3...) is not installed in Windows Trusted Root CA store.
  A different localhost certificate (SHA-1: 624bfc21...) IS installed, but it doesn't match nginx.
  
EXACT FIX:
  Add current nginx certificate to Windows Trusted Root CA store using certutil -addstore with admin privileges.
```

---

## Why This Happened

1. **Certificate was regenerated** when fixing the key mismatch earlier
2. **Old certificate remains in Windows** trust store  
3. **New certificate is valid** but not registered with Windows
4. **Nginx serves new cert** but Windows rejects it because it's not trusted

---

## After Applying Fix

Once you've added the certificate to Windows trust store with admin privileges:

1. **Fully close Chrome** (not just tabs)
2. **Reopen Chrome**
3. **Navigate to** https://localhost
4. Certificate should now be trusted ✓
5. Application loads normally

---

## If Issues Persist

If you still get ERR_CERT_INVALID after adding to trust store:

1. Check the exact thumbprint matches (use certutil or PowerShell Get-ChildItem)
2. Verify you imported to "Root" store, not "Intermediate CA"
3. Clear Chrome cache: Ctrl+Shift+Delete
4. Disable any VPN/proxy
5. Test with a different browser (Firefox, Edge) to confirm it's not Chrome-specific

---

## Windows Instruction Steps (With Screenshots in Mind)

### For Windows Certificate Manager GUI:

1. **Open Certificate Manager**: 
   - Windows Key + R
   - Type: `certlm.msc`
   - Press Enter

2. **Navigate to**: Certificates > Trusted Root Certification Authorities > Certificates

3. **Right-click** in the certificates pane → All Tasks → Import

4. **Browse to**: `C:\Users\gopiy\Downloads\tejoma-rec\nginx\certs\cert.pem`

5. **Select**: Place all certificates in the following store → Trusted Root Certification Authorities

6. **Finish import**

7. **Close Certificate Manager**

8. **Close ALL Chrome windows** (completely)

9. **Reopen Chrome**

10. **Test**: https://localhost

---

**Status**: Issue identified and solution provided. Follow the admin steps to resolve.

