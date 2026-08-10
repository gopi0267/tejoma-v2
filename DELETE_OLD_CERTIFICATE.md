# Delete Old Certificate — Manual Instructions

**Critical Issue**: Windows trust store has TWO localhost certificates. The OLD one is blocking the NEW one.

---

## The Problem

| Certificate | Thumbprint | Status |
|-------------|-----------|--------|
| NEW (serving) | 634114C377C7156DB8B807390C7F290C01AFCC96 | ✓ What nginx serves, what cert.pem contains |
| OLD (blocking) | 624BFC2115D3B2D8A6C51DD1812B97FAE4661CF2 | ✗ Conflicts with new, causes ERR_CERT_INVALID |

**Root Cause**: Chrome checks Windows trust store, finds BOTH certificates, tries to validate with the OLD one first (doesn't match what nginx serves), fails with ERR_CERT_INVALID.

**Solution**: Delete the OLD certificate (624BFC21...) so only the NEW one (634114C3...) remains.

---

## Manual Method 1: Certificate Manager GUI (certmgr.msc)

**This is the safest method if PowerShell fails.**

### Step-by-step:

1. **Close all programs** (Chrome, Firefox, any certificate viewers)

2. **Right-click Windows Search** or press **Windows Key**

3. **Type**: `certmgr.msc`

4. **Right-click the result** → **Run as administrator**

5. **Navigate in the left panel**:
   - Click: **Certificates - Current User**
   - Expand: **Trusted Root Certification Authorities**
   - Click: **Certificates** (in the left tree)

6. **In the middle panel, look for localhost certificates**:
   - You should see TWO certificates with "localhost" in their names
   - One shows: `CN=localhost`
   - One shows: (blank subject)

7. **Find the OLD certificate**:
   - Click on the `CN=localhost` certificate
   - In the bottom panel, find the **Thumbprint** field
   - Check if it shows: `624bfc2115d3b2d8a6c51dd1812b97fae4661cf2`
   - If YES, this is the OLD one to delete

8. **Right-click the OLD certificate** (CN=localhost with thumbprint 624bfc21...)

9. **Select: Delete**

10. **Confirm deletion** when prompted

11. **Verify**: Only ONE localhost certificate should remain
    - Should show thumbprint starting with: `634114c3...`

12. **Close Certificate Manager**

---

## Manual Method 2: Certificate Manager GUI (mmc - Local Computer)

**This manages LocalMachine certificates (the main store).**

### Step-by-step:

1. **Right-click Windows Search** or press **Windows Key**

2. **Type**: `mmc`

3. **Right-click the result** → **Run as administrator**

4. **In MMC Console**, go to **File** → **Add/Remove Snap-in**

5. **Select**: **Certificates**

6. **Click**: **Add >**

7. **Select**: **Computer account**

8. **Click**: **Next >**

9. **Select**: **Local computer**

10. **Click**: **Finish**

11. **Click**: **OK**

12. **In the left panel, expand**:
    - Certificates (Local Computer)
    - Trusted Root Certification Authorities
    - Certificates

13. **In the middle panel, find TWO localhost certificates**

14. **Find the OLD one** (check thumbprint 624bfc21...):
    - Right-click → **Delete**
    - Confirm deletion

15. **Verify only ONE localhost certificate remains**

16. **Close MMC**

---

## Verification After Deletion

**Open PowerShell and run**:

```powershell
Get-ChildItem Cert:\LocalMachine\Root |
Where-Object {$_.DnsNameList -like "*localhost*"} |
Select-Object Thumbprint, Subject, NotBefore
```

**Expected output** (only ONE certificate):

```
Thumbprint                               Subject                      NotBefore
-----------                               -------                      ---------
634114C377C7156DB8B807390C7F290C01AFCC96                              8/10/2026 14:32:35
```

If you still see the old certificate (624BFC21...), repeat the deletion steps.

---

## Also Check CurrentUser Certificates

If you're still having issues after deleting from LocalMachine, also check CurrentUser:

```
Start → Certificate Manager (certmgr.msc)
→ Certificates - Current User
→ Trusted Root Certification Authorities
→ Certificates
```

Delete any `CN=localhost` certificate with thumbprint: `624bfc2115d3b2d8a6c51dd1812b97fae4661cf2`

---

## Clear Chrome's Certificate Cache

After deleting the old certificate:

1. **Close Chrome completely**:
   - Press `Ctrl + Shift + Esc` (Task Manager)
   - Find all `chrome.exe` processes
   - Click each → **End Task**

2. **Clear Chrome cache**:
   - Reopen Chrome
   - Press `Ctrl + Shift + Delete`
   - Select: **All time**
   - Check: **Cookies and other site data**
   - Check: **Cached images and files**
   - Click: **Clear data**

3. **Close Chrome completely again**

4. **Reopen Chrome**

5. **Navigate to**: `https://localhost`

---

## Verify Fix Worked

After deleting old certificate and clearing Chrome cache:

**Expected in Chrome**:
- ✓ URL bar shows: `https://localhost`
- ✓ Green padlock icon
- ✓ "Secure" indicator
- ✓ Page loads (Tejoma login or dashboard appears)
- ✓ NO `ERR_CERT_INVALID` message
- ✓ NO certificate warning dialog

**If still seeing error**:
1. Verify deletion was successful (run PowerShell command above)
2. Make sure you deleted from BOTH LocalMachine and CurrentUser stores
3. Verify cert.pem is still 634114C3... (hasn't changed)
4. Verify nginx is still running and serving same cert

---

## Summary of What's Happening

```
Current State:
├─ Windows Trust Store (LocalMachine\Root)
│  ├─ Certificate A: 634114C377... (NEW - what nginx serves)
│  └─ Certificate B: 624BFC21... (OLD - leftover)
│
├─ Nginx on port 443
│  └─ Serving: Certificate A (634114C377...)
│
└─ Chrome
   ├─ Connects to nginx
   ├─ Gets Certificate A (634114C377...)
   ├─ Checks Windows trust store
   ├─ Finds BOTH A and B
   ├─ Tries to validate with Certificate B (first match)
   ├─ B doesn't match what nginx serves
   └─ Result: ERR_CERT_INVALID

After Fix:
├─ Windows Trust Store (LocalMachine\Root)
│  └─ Certificate A: 634114C377... (only one)
│
├─ Nginx on port 443
│  └─ Serving: Certificate A (634114C377...)
│
└─ Chrome
   ├─ Connects to nginx
   ├─ Gets Certificate A (634114C377...)
   ├─ Checks Windows trust store
   ├─ Finds Certificate A (only match)
   ├─ Validates successfully
   └─ Result: ✓ HTTPS SECURE
```

---

**Next Step**: Follow either Method 1 or Method 2 above to delete the old certificate, then test Chrome.

