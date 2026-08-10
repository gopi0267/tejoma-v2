# Fix Chrome ERR_CERT_INVALID — Step-by-Step Guide

**Status**: Root cause identified and fix procedure documented  
**Required**: Administrator privileges

---

## The Problem

| Component | Certificate Fingerprint | Status |
|-----------|------------------------|--------|
| Nginx (serving) | `634114C377C7156DB8B807390C7F290C01AFCC96` | Valid, but NOT trusted |
| Windows Trust Store | `624BFC2115D3B2D8A6C51DD1812B97FAE4661CF2` | Trusted, but doesn't match nginx |
| Chrome Result | — | `ERR_CERT_INVALID` |

**Root Cause**: Nginx is serving a certificate that isn't in Windows' trusted list.

---

## Solution: Add Certificate to Windows Trust Store

### Method 1: PowerShell (Recommended)

1. **Right-click PowerShell** → Select "Run as administrator"

2. **Copy and paste this entire block**:
```powershell
$certPath = "C:\Users\gopiy\Downloads\tejoma-rec\nginx\certs\cert.pem"
$newThumbprint = "634114C377C7156DB8B807390C7F290C01AFCC96"

Write-Host "Installing certificate..."
certutil -addstore "Root" "$certPath" 2>&1

Write-Host ""
Write-Host "Verifying installation..."
$existing = Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $newThumbprint }
if ($existing) {
    Write-Host "✓ Certificate successfully installed!" -ForegroundColor Green
} else {
    Write-Host "✗ Installation may have failed" -ForegroundColor Red
}

Write-Host ""
Write-Host "All localhost certificates in trust store:"
Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -match "localhost" } | ForEach-Object {
    Write-Host "Thumbprint: $($_.Thumbprint) - $($_.Subject)"
}
```

3. **Press Enter**

4. **If successful, you'll see "✓ Certificate successfully installed!"**

---

### Method 2: Certificate Manager GUI (Windows)

1. **Press Windows Key + R**

2. **Type**: `certlm.msc` → **Press Enter**

3. **Navigate to**: 
   - Certificates (Local Computer) → Trusted Root Certification Authorities → Certificates

4. **Right-click in the certificates pane** → **All Tasks** → **Import**

5. **Browse to**: `C:\Users\gopiy\Downloads\tejoma-rec\nginx\certs\cert.pem`

6. **Click Next, then:**
   - Select: "Place all certificates in the following store"
   - Ensure: "Trusted Root Certification Authorities" is selected
   - Click "Finish"

7. **Close Certificate Manager**

---

### Method 3: Command Prompt (As Administrator)

1. **Right-click Command Prompt** → "Run as administrator"

2. **Run**:
```batch
certutil -addstore "Root" "C:\Users\gopiy\Downloads\tejoma-rec\nginx\certs\cert.pem"
```

3. **Wait for completion**

---

## After Installing: Verify Chrome Access

### Critical: Close Chrome Completely

Simply closing tabs is NOT enough. Chrome caches certificates.

**Windows 11**:
1. Press `Ctrl + Shift + Esc` (Open Task Manager)
2. Find any "chrome.exe" process
3. Select it → Click "End Task"
4. Repeat for all chrome processes
5. Close Task Manager

**Or**: Restart your computer

### Test in Chrome

1. **Open Chrome** (freshly launched, not restored)
2. **Navigate to**: `https://localhost`
3. **Expected result**:
   - ✓ Page loads without certificate warning
   - ✓ "Tejoma" or login page appears
   - ✓ Padlock icon shows "Secure"

### If Still Getting ERR_CERT_INVALID

1. **Check Windows certificate was imported**:
   - Run: `certlm.msc`
   - Navigate to: Trusted Root Certification Authorities → Certificates
   - Look for: `CN=localhost`
   - Verify fingerprint matches: `634114C377C7156DB8B807390C7F290C01AFCC96`

2. **Check if old certificate is interfering**:
   - Delete old localhost certificates with fingerprint starting with `624BFC21`
   - Run the installation again
   - Restart Chrome completely

3. **Verify nginx is serving correct certificate**:
   - Open PowerShell (as admin is not needed):
   ```powershell
   openssl s_client -connect localhost:443 -showcerts 2>/dev/null | openssl x509 -noout -fingerprint -sha1
   ```
   - Should show: `sha1 Fingerprint=63:41:14:C3:77:C7:15:6D:B8:B8:07:39:0C:7F:29:0C:01:AF:CC:96`

---

## Certificate Details (For Reference)

```
Certificate File: C:\Users\gopiy\Downloads\tejoma-rec\nginx\certs\cert.pem
Private Key File: C:\Users\gopiy\Downloads\tejoma-rec\nginx\certs\key.pem

SHA-1 Fingerprint:   63:41:14:C3:77:C7:15:6D:B8:B8:07:39:0C:7F:29:0C:01:AF:CC:96
SHA-256 Fingerprint: 0E:D0:84:72:BF:E1:37:AA:CB:E6:C8:51:CA:C9:24:45:0F:E6:00:B1:7B:D1:BC:52:46:C2:6F:67:90:52:F8:AF

Subject: CN=localhost
SANs: DNS:localhost, IP:127.0.0.1
Valid: Aug 10 2026 → Aug 10 2027

Key/Cert Match: ✓ YES (RSA moduli identical)
Nginx Serving: ✓ YES (port 443 active)
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Administrator permissions are needed" | Running PowerShell without admin | Right-click PowerShell → "Run as administrator" |
| Certificate not appearing in Trust Store after import | Import destination wrong | Use `certlm.msc`, navigate to Trusted Root CA, import there |
| Still seeing ERR_CERT_INVALID after import | Chrome cached old cert | Completely close all Chrome windows, reopen |
| Nginx giving key mismatch error | Stale nginx logs | Certificate and key match (verified), logs are old |

---

## Success Indicators

After fixing, you should see:

1. ✓ Chrome page loads at `https://localhost`
2. ✓ Green padlock icon (Secure)
3. ✓ No certificate warnings
4. ✓ Tejoma login page/dashboard appears
5. ✓ Network requests go through HTTPS
6. ✓ API calls visible in DevTools (F12 → Network tab)

---

## What NOT To Do

❌ Do NOT use `curl -k` as proof of success (bypasses certificate validation)  
❌ Do NOT install to "Intermediate CA" store (must be "Trusted Root")  
❌ Do NOT trust only "Current User" certificates (use "LocalMachine")  
❌ Do NOT regenerate certificates (current cert is valid)  
❌ Do NOT blindly delete all localhost certificates (one may be needed)

---

## After Browser Access Works

Once `https://localhost` loads without certificate warnings:

1. **Log in** with test credentials (if available)
2. **Browse the application** to verify functionality
3. **Open DevTools** (F12) → Network tab
4. **Verify requests**:
   - ✓ Requests go through: `https://localhost` → `nginx` → `api-gateway:4000`
   - ✓ NO direct requests to `localhost:3001` (monolith)
   - ✓ NO requests to internal microservice ports
   - ✓ Response times < 1000ms

---

**Next Step**: Follow Method 1, 2, or 3 above to install the certificate with administrator privileges, then complete the Chrome verification.

