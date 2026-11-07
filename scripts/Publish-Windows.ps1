param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\dist\win-x64')
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$output = [IO.Path]::GetFullPath($OutputDirectory)
# The project's standalone target builds and embeds the fresh frontend for every publish entry point.
& dotnet publish (Join-Path $repo 'src\SupercarsTiming.Server') --configuration Release --runtime win-x64 `
    --self-contained true -p:Standalone=true -p:DebugType=embedded --output $output
if ($LASTEXITCODE -ne 0) { throw 'Publishing the Windows application failed.' }

$exe = Join-Path $output 'SupercarsTiming.Server.exe'
if (!(Test-Path -LiteralPath $exe)) { throw 'The Windows executable was not produced.' }
$extraFiles = Get-ChildItem -LiteralPath $output -File -Recurse | Where-Object { $_.FullName -ne $exe }
if ($extraFiles) { throw 'The output contains extra files. Publish into an empty directory.' }
Write-Output "Windows executable: $exe"
