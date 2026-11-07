param(
    [Parameter(Mandatory)] [string]$Executable
)

$ErrorActionPreference = 'Stop'
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testRoot = [IO.Path]::GetFullPath((Join-Path $tempBase "supercars-timing-smoke-$([guid]::NewGuid().ToString('N'))"))
$appDir = Join-Path $testRoot 'app'
$dataDir = Join-Path $testRoot 'data'
$workingDir = Join-Path $testRoot 'working'
$process = $null

try {
    New-Item -ItemType Directory -Path $appDir,$workingDir -Force | Out-Null
    $app = Join-Path $appDir 'SupercarsTiming.exe'
    Copy-Item -LiteralPath $Executable -Destination $app
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = $listener.LocalEndpoint.Port
    $listener.Stop()
    $url = "http://127.0.0.1:$port"
    $arguments = @("--Standalone:Port=$port", "--Standalone:DataDirectory=`"$dataDir`"",
        '--Standalone:OpenBrowser=false', '--Feed:Mode=Replay', '--F1:Enabled=false')
    $process = Start-Process -FilePath $app -ArgumentList $arguments -WorkingDirectory $workingDir -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $testRoot 'stdout.log') -RedirectStandardError (Join-Path $testRoot 'stderr.log')

    $ready = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($process.HasExited) { throw 'The packaged application exited during startup.' }
        try {
            $features = Invoke-RestMethod "$url/api/features" -TimeoutSec 2
            $ready = $true
            break
        } catch { Start-Sleep -Milliseconds 200 }
    }
    if (!$ready -or !$features.scheduleImport) { throw 'The portable application did not become ready.' }
    $networkHost = @{ Host = 'timing.local' }
    if ((Invoke-WebRequest "$url/api/features" -Headers $networkHost -SkipHttpErrorCheck).StatusCode -ne 400) {
        throw 'Default loopback hosting did not retain its local Host filter.'
    }
    $html = (Invoke-WebRequest $url).Content
    $asset = [regex]::Match($html, 'src="(/assets/[^\"]+\.js)"').Groups[1].Value
    if (!$asset -or (Invoke-WebRequest "$url$asset").StatusCode -ne 200) { throw 'Embedded frontend assets were not served.' }
    if ((Invoke-WebRequest "$url/f1").Content -ne $html) { throw 'The F1 page was not served.' }
    $schedule = Invoke-RestMethod "$url/api/schedule"
    if ($schedule.events.Count -eq 0) { throw 'The bundled schedule is missing.' }
    $before = Get-FileHash -LiteralPath (Join-Path $dataDir 'schedule\supercars.json')
    $headers = @{ 'X-SupercarsTiming-Local' = '1' }
    $rejected = Invoke-WebRequest "$url/api/schedule" -Method Post -ContentType 'application/json' -Headers $headers `
        -Body '{"events":[]}' -SkipHttpErrorCheck
    if ($rejected.StatusCode -ne 400 -or $before.Hash -ne (Get-FileHash (Join-Path $dataDir 'schedule\supercars.json')).Hash) {
        throw 'An invalid import was not rejected safely.'
    }
    $json = $schedule | ConvertTo-Json -Depth 20
    $blocked = Invoke-WebRequest "$url/api/schedule" -Method Post -ContentType 'application/json' -Body $json -SkipHttpErrorCheck
    if ($blocked.StatusCode -ne 403) { throw 'An import without the local application header was accepted.' }
    $schedule.events[0].name += ' (packaging test)'
    $json = $schedule | ConvertTo-Json -Depth 20
    Invoke-RestMethod "$url/api/schedule" -Method Post -ContentType 'application/json' -Headers $headers -Body $json | Out-Null
    if ((Invoke-RestMethod "$url/api/schedule").events[0].name -ne $schedule.events[0].name) { throw 'The imported timetable was not saved.' }

    $second = Start-Process -FilePath $app -ArgumentList $arguments -WorkingDirectory $workingDir -WindowStyle Hidden -PassThru
    if (!$second.WaitForExit(10000)) { $second.Kill(); throw 'A second application instance did not exit.' }
    if ($second.ExitCode -ne 0 -or $process.HasExited) { throw 'Duplicate launch handling failed.' }
    $process.Kill()
    $process.WaitForExit()
    $process = Start-Process -FilePath $app -ArgumentList $arguments -WorkingDirectory $workingDir -WindowStyle Hidden -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    $persisted = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        try { $persisted = (Invoke-RestMethod "$url/api/schedule" -TimeoutSec 2).events[0].name -eq $schedule.events[0].name; break }
        catch { if ($process.HasExited) { throw 'Restart failed.' }; Start-Sleep -Milliseconds 200 }
    }
    if (!$persisted) { throw 'The imported timetable did not survive a restart.' }
    $process.Kill()
    $process.WaitForExit()
    # A fresh wildcard port avoids the previous loopback listener's closing connections on Windows.
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Any, 0)
    $listener.Start()
    $networkPort = $listener.LocalEndpoint.Port
    $listener.Stop()
    $networkUrl = "http://127.0.0.1:$networkPort"
    $networkArguments = @($arguments | Where-Object { $_ -notlike '--Standalone:Port=*' }) + @('--Standalone:Port=1', "--urls=http://0.0.0.0:$networkPort")
    $process = Start-Process -FilePath $app -ArgumentList $networkArguments -WorkingDirectory $workingDir -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $testRoot 'network-stdout.log') -RedirectStandardError (Join-Path $testRoot 'network-stderr.log')
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    $networkReady = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $networkReady = (Invoke-WebRequest "$networkUrl/api/features" -Headers $networkHost -TimeoutSec 2).StatusCode -eq 200
            break
        } catch { if ($process.HasExited) { throw 'Explicit URL hosting failed.' }; Start-Sleep -Milliseconds 200 }
    }
    if (!$networkReady) { throw 'The explicit --urls address was not used or the network Host header was refused.' }
    $networkLog = Get-Content -LiteralPath (Join-Path $testRoot 'network-stdout.log') -Raw
    if (!$networkLog.Contains("Now listening on: http://0.0.0.0:$networkPort") -or !$networkLog.Contains("Supercars Timing is ready at $networkUrl")) {
        throw 'The listener or local browser address did not follow --urls.'
    }
    Write-Output 'Windows binary passed: isolated launch, embedded assets, both series, schedule validation/import/persistence, duplicate launch, explicit network URL and default loopback hosting.'
} catch {
    foreach ($log in @('stdout.log', 'stderr.log', 'network-stdout.log', 'network-stderr.log')) {
        $path = Join-Path $testRoot $log
        if (Test-Path -LiteralPath $path) { Get-Content -LiteralPath $path }
    }
    throw
} finally {
    if ($process -and !$process.HasExited) { $process.Kill(); $process.WaitForExit() }
    if (!$testRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $testRoot) -notmatch '^supercars-timing-smoke-[a-f0-9]{32}$') {
        throw 'Refusing to remove a directory outside the smoke test location.'
    }
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
