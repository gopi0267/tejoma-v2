# Tejoma Staging HTTPS Setup - Windows/Chrome Configuration

## Current Status

✅ **nginx HTTPS Server**: Running with certificate at `https://localhost`  
✅ **Certificate**: Self-signed, valid for 1 year  
✅ **Files**: Ready for Windows trust installation

---

## Problem: NET::ERR_CERT_AUTHORITY_INVALID

Chrome rejects self-signed certificates by default. Solution: Install the certificate in Windows' Trusted Root Certificate Store.

---

## Solution: Install Certificate in Windows

### File Location
```
C:\Users\gopiy\Downloads\tejoma-rec\nginx\certs\cert-localhost.cer
```

### Step-by-Step Instructions

#### 1. Open Certificate File with Windows Certificate Manager

Option A: Double-click the .cer file
```
C:\Users\gopiy\Downloads\tejoma-rec\nginx\certs\cert-localhost.cer
```

Option B: Command line (PowerShell as Administrator)
```powershell
Invoke-Item "C:\Users\gopiy\Downloads\tejoma-rec\nginx\certs\cert-localhost.cer"
```

#### 2. Install Certificate Dialog

When the certificate dialog opens:
- Click **"Install Certificate..."**
- Select **"Local Machine"** (not "Current User")
- Click **"Next >"**

#### 3. Choose Certificate Store

- Select **"Place all certificates in the following store"**
- Click **"Browse..."**
- Select **"Trusted Root Certification Authorities"**
- Click **"OK"**

#### 4. Confirm Installation

- Click **"Next >"**
- Click **"Finish"**
- You should see: **"The import was successful"**

#### 5. Close All Chrome Tabs

Close Chrome completely (not just tabs):
```powershell
Stop-Process -Name "chrome" -Force
```

Or manually:
- Close all Chrome windows
- Close Chrome completely from system tray

#### 6. Restart Chrome

Open Chrome and navigate to:
```
https://localhost
```

---

## Certificate Details

| Property | Value |
|----------|-------|
| **CN (Common Name)** | localhost |
| **Issuer** | CN=localhost (self-signed) |
| **Valid From** | Aug 10 07:19:18 2026 GMT |
| **Valid Until** | Aug 10 07:19:18 2027 GMT |
| **Key Size** | 2048-bit RSA |
| **Signature Algorithm** | sha256WithRSAEncryption |

---

## After Installation

### Expected Result in Chrome

✅ Green padlock icon in URL bar  
✅ "Secure" indicator  
✅ Full access to Tejoma staging application  
✅ No certificate warnings

### URL to Use

```
https://localhost
```

---

## Troubleshooting

### "Certificate Not Trusted" Still Shows

1. **Restart Chrome** (complete close, not just tabs)
   ```powershell
   Stop-Process -Name "chrome" -Force
   Start-Process chrome
   ```

2. **Clear Chrome cache**
   - Chrome Settings → Clear browsing data
   - Select "All time"
   - Check "Cookies and other site data"
   - Click "Clear data"

3. **Verify Certificate Installation**
   ```powershell
   certutil -store Root | Select-String "localhost"
   ```

### Still Getting Error After Installation

1. Check Windows successfully imported the certificate:
   ```powershell
   Get-ChildItem cert:\LocalMachine\Root | Where-Object { $_.Subject -like "*localhost*" }
   ```

2. If not found, try installing again with Administrator privileges

3. Restart computer if needed

---

## Technical Details

### nginx Configuration

```nginx
listen 443 ssl http2;
ssl_certificate     /etc/nginx/certs/cert.pem;
ssl_certificate_key /etc/nginx/certs/key.pem;
```

### Certificate Files

- **cert.pem**: Server certificate (used by nginx)
- **key.pem**: Private key (used by nginx)
- **cert-localhost.cer**: DER format (for Windows import)

### API Gateway Routing

All HTTPS requests from Chrome → nginx (port 443) → API Gateway (internal port 4000) → microservices

---

## Important Notes

⚠️ **Self-Signed Certificate**: This is a self-signed development/staging certificate, NOT issued by a certificate authority.

✅ **Secure**: Despite being self-signed, once installed in Windows trust store, the HTTPS connection is fully encrypted and secure.

✅ **Development Only**: This certificate is for staging/development only. Production uses proper CA-issued certificates.

✅ **No External Services**: No external service calls or internet connection required for HTTPS.

---

## Reverting to HTTP (Not Recommended)

If you need to revert (not recommended):

1. Stop nginx:
   ```bash
   docker restart tejoma-nginx-1
   ```

2. Modify nginx config to remove SSL (would require rebuild)

**Note**: The Tejoma architecture uses HTTPS by design. Reverting is not supported.

---

## Support

If HTTPS still doesn't work after following these steps:

1. Verify nginx is running:
   ```bash
   docker ps | grep nginx
   ```

2. Check nginx logs:
   ```bash
   docker logs tejoma-nginx-1
   ```

3. Verify certificate files exist:
   ```bash
   ls -la C:\Users\gopiy\Downloads\tejoma-rec\nginx\certs\
   ```

4. Test raw HTTPS (with curl):
   ```bash
   curl -k https://localhost
   ```

---

**Setup Date**: 2026-08-10  
**Certificate Valid Until**: Aug 10 07:19:18 2027  
**Status**: ✅ READY FOR USE
