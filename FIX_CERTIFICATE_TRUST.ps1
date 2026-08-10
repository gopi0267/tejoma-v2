# Fix Chrome ERR_CERT_INVALID by adding nginx certificate to Windows trust store
# REQUIRES: Administrator privileges
# RUN AS: Administrator

Write-Host "TEJOMA CERTIFICATE FIX - REQUIRES ADMIN" -ForegroundColor Green
Write-Host ""

# Step 1: Certificate info
$certPath = "C:\Users\gopiy\Downloads\tejoma-rec\nginx\certs\cert.pem"
$newThumbprint = "634114C377C7156DB8B807390C7F290C01AFCC96"

Write-Host "Step 1: Certificate to install" -ForegroundColor Cyan
Write-Host "Path: $certPath"
Write-Host "Fingerprint: $newThumbprint"
Write-Host ""

# Step 2: Check if already installed
Write-Host "Step 2: Checking if certificate is already trusted..." -ForegroundColor Cyan
$existing = Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $newThumbprint }
if ($existing) {
    Write-Host "✓ Certificate is already in Windows trust store" -ForegroundColor Green
    Write-Host "No further action needed"
} else {
    Write-Host "Certificate not found in trust store - installing..." -ForegroundColor Yellow
    Write-Host ""

    # Step 3: Try to import with certutil
    Write-Host "Step 3: Adding certificate to Windows Trusted Root CA..." -ForegroundColor Cyan
    $importResult = certutil -addstore "Root" "$certPath" 2>&1
    Write-Host $importResult
    Write-Host ""

    # Step 4: Verify installation
    Write-Host "Step 4: Verifying installation..." -ForegroundColor Cyan
    $afterInstall = Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $newThumbprint }
    if ($afterInstall) {
        Write-Host "✓ Certificate successfully installed to Windows trust store" -ForegroundColor Green
    } else {
        Write-Host "✗ Certificate installation verification failed" -ForegroundColor Red
        Write-Host "Check if running with Administrator privileges"
    }
}
Write-Host ""

# Step 5: List all localhost certificates
Write-Host "Step 5: All localhost certificates in Windows trust store:" -ForegroundColor Cyan
$allCerts = Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -match "localhost" }
$allCerts | ForEach-Object {
    Write-Host "  Thumbprint: $($_.Thumbprint)"
    Write-Host "  Subject: $($_.Subject)"
}
Write-Host ""

# Step 6: Remove old certificate if it exists
$oldThumbprint = "624BFC2115D3B2D8A6C51DD1812B97FAE4661CF2"
$oldCert = Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $oldThumbprint }
if ($oldCert) {
    Write-Host "Step 6: Old certificate found - consider removing" -ForegroundColor Yellow
    Write-Host "Old thumbprint: $oldThumbprint"
    Write-Host ""
    Write-Host "To remove old certificate, run:" -ForegroundColor Cyan
    Write-Host '$oldCert = Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq "624BFC2115D3B2D8A6C51DD1812B97FAE4661CF2" }'
    Write-Host 'Remove-Item $oldCert'
} else {
    Write-Host "Step 6: No old certificate found" -ForegroundColor Green
}
Write-Host ""

Write-Host "NEXT STEPS:" -ForegroundColor Green
Write-Host "1. Close ALL Chrome windows completely"
Write-Host "2. Reopen Chrome"
Write-Host "3. Navigate to: https://localhost"
Write-Host "4. Verify: Certificate should now be trusted"
Write-Host ""
