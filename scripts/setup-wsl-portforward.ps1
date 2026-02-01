# Setup WSL Port Forwarding for tmai Web Remote Control
# Run this script as Administrator in PowerShell
#
# Usage:
#   .\setup-wsl-portforward.ps1         # Setup forwarding
#   .\setup-wsl-portforward.ps1 -Remove # Remove forwarding

param(
    [switch]$Remove,
    [int]$Port = 9876
)

$ErrorActionPreference = "Stop"
$RuleName = "tmai-web-remote"

function Get-WslIp {
    $wslIp = wsl hostname -I | ForEach-Object { $_.Trim().Split(" ")[0] }
    if (-not $wslIp) {
        throw "Failed to get WSL IP address. Is WSL running?"
    }
    return $wslIp
}

function Add-PortForward {
    $wslIp = Get-WslIp
    Write-Host "WSL IP: $wslIp" -ForegroundColor Cyan

    # Remove existing rule if any
    netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=0.0.0.0 2>$null

    # Add port forwarding
    Write-Host "Setting up port forwarding: 0.0.0.0:$Port -> ${wslIp}:$Port" -ForegroundColor Green
    netsh interface portproxy add v4tov4 listenport=$Port listenaddress=0.0.0.0 connectport=$Port connectaddress=$wslIp

    # Add firewall rule
    $existingRule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
    if ($existingRule) {
        Write-Host "Firewall rule already exists, updating..." -ForegroundColor Yellow
        Remove-NetFirewallRule -DisplayName $RuleName
    }

    Write-Host "Adding firewall rule for port $Port" -ForegroundColor Green
    New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null

    Write-Host ""
    Write-Host "Setup complete!" -ForegroundColor Green
    Write-Host "Port forwarding active: Windows:$Port -> WSL:$Port" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Note: WSL IP may change after reboot. Re-run this script if connection fails." -ForegroundColor Yellow
}

function Remove-PortForward {
    Write-Host "Removing port forwarding..." -ForegroundColor Yellow
    netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=0.0.0.0 2>$null

    $existingRule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
    if ($existingRule) {
        Write-Host "Removing firewall rule..." -ForegroundColor Yellow
        Remove-NetFirewallRule -DisplayName $RuleName
    }

    Write-Host "Cleanup complete!" -ForegroundColor Green
}

# Check for admin privileges
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "This script requires Administrator privileges." -ForegroundColor Red
    Write-Host "Please run PowerShell as Administrator and try again." -ForegroundColor Yellow
    exit 1
}

if ($Remove) {
    Remove-PortForward
} else {
    Add-PortForward
}
