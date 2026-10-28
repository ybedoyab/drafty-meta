# Start the API and the web app in this terminal.
# Running the script again stops the previous instance first.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$PidFile = Join-Path $Root ".drafty-dev.pids"
$WebDir = Join-Path $Root "apps\web"

function Stop-ProcessTree([int]$ProcessId) {
    if ($ProcessId -le 0 -or $ProcessId -eq $PID) { return }
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue)
    foreach ($child in $children) {
        Stop-ProcessTree ([int]$child.ProcessId)
    }
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Stop-PreviousInstance {
    if (Test-Path $PidFile) {
        foreach ($line in Get-Content $PidFile) {
            $recorded = 0
            if ([int]::TryParse($line.Trim(), [ref]$recorded)) {
                Stop-ProcessTree $recorded
            }
        }
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }

    $rootPattern = [regex]::Escape($Root)
    $owned = @(Get-CimInstance Win32_Process | Where-Object {
        $command = $_.CommandLine
        $command -and (
            $command -match "drafty_api\.(main|executor)" -or
            $command -match "drafty-api" -or
            ($command -match "vite" -and $command -match $rootPattern)
        )
    })
    foreach ($proc in $owned) {
        Stop-ProcessTree ([int]$proc.ProcessId)
    }

    if (Get-Command docker -ErrorAction SilentlyContinue) {
        try {
            $containers = @(docker ps -q --filter ancestor=drafty-ccx 2>$null)
            foreach ($container in $containers) {
                if ($container) { docker stop $container 2>$null | Out-Null }
            }
        } catch {
            Write-Host "Docker is not responding. Solver jobs will report that when they run."
        }
    }
    Start-Sleep -Milliseconds 400
}

function Wait-ApiReady([System.Diagnostics.Process]$Process, [int]$TimeoutSeconds = 90) {
    Write-Host "Waiting for the API at http://127.0.0.1:8000 ."
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            throw "The API exited before it accepted connections (exit $($Process.ExitCode))."
        }
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/v1/health" -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                Write-Host "API is ready."
                return
            }
        } catch {
            Start-Sleep -Milliseconds 400
        }
    }
    throw "The API did not respond within $TimeoutSeconds seconds."
}

function Ensure-FileFromExample {
    $envFile = Join-Path $Root ".env"
    if (-not (Test-Path $envFile)) {
        Copy-Item (Join-Path $Root ".env.example") $envFile
        Write-Host "Created .env from .env.example. Empty credentials stay disabled."
    }
}

Write-Host "Stopping a previous Drafty instance, if one is running."
Stop-PreviousInstance
Ensure-FileFromExample

if (-not (Test-Path (Join-Path $Root ".venv\Scripts\python.exe"))) {
    Write-Host "Installing Python dependencies."
    & uv sync --extra dev
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-Path (Join-Path $WebDir "node_modules"))) {
    Write-Host "Installing web dependencies."
    Push-Location $WebDir
    try {
        & npm install
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }
}

if (Get-Command docker -ErrorAction SilentlyContinue) {
    docker image inspect drafty-ccx 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Building the CalculiX image drafty-ccx."
        & docker build -t drafty-ccx -f (Join-Path $Root "infra\docker\Dockerfile.ccx") (Join-Path $Root "infra\docker")
        if ($LASTEXITCODE -ne 0) {
            Write-Host "The solver image was not built. The API will still start and report that CalculiX is missing."
        }
    }
} else {
    Write-Host "Docker was not found. The API will start, and a solve will fail until ccx or the drafty-ccx image is available."
}

$uv = (Get-Command uv -ErrorAction Stop).Source
$node = (Get-Command node -ErrorAction Stop).Source
$vite = Join-Path $WebDir "node_modules\vite\bin\vite.js"
if (-not (Test-Path $vite)) {
    throw "Vite is not installed in apps/web."
}

$ProgressPreference = "SilentlyContinue"
$api = $null
$web = $null
try {
    $api = Start-Process -FilePath $uv -ArgumentList @("run", "drafty-api") -WorkingDirectory $Root -NoNewWindow -PassThru
    Wait-ApiReady $api
    $web = Start-Process -FilePath $node -ArgumentList @(".\node_modules\vite\bin\vite.js", "--host", "127.0.0.1", "--port", "5173") -WorkingDirectory $WebDir -NoNewWindow -PassThru
    @($api.Id, $web.Id) | Set-Content -Path $PidFile -Encoding ascii

    Write-Host ""
    Write-Host "API  http://127.0.0.1:8000"
    Write-Host "Web  http://127.0.0.1:5173"
    Write-Host "Ctrl+C stops both. Running this script again stops them first."
    Write-Host ""

    while (-not $api.HasExited -and -not $web.HasExited) {
        Start-Sleep -Milliseconds 500
    }
    if ($api.HasExited) {
        Write-Host "The API stopped (exit $($api.ExitCode))."
    }
    if ($web.HasExited) {
        Write-Host "The web app stopped (exit $($web.ExitCode))."
    }
} finally {
    if ($null -ne $web) { Stop-ProcessTree $web.Id }
    if ($null -ne $api) { Stop-ProcessTree $api.Id }
    if (Test-Path $PidFile) {
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }
}
