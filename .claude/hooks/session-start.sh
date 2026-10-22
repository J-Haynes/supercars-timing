#!/bin/bash
# SessionStart hook for Claude Code cloud sessions: installs what CI uses
# (.github/workflows/ci.yml: .NET 10 SDK, Node 22) so `dotnet build && dotnet test`
# and `npm run build` work in a fresh container. Does nothing on the laptop.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# No telemetry or first-run banner, here and in the session's own shell.
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
echo 'export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1' >> "$CLAUDE_ENV_FILE"

# .NET 10 SDK from Ubuntu's own archive (noble-updates). Microsoft's download host
# (builds.dotnet.microsoft.com, used by dotnet-install.sh) is blocked by the cloud
# network policy; archive.ubuntu.com and nuget.org are not.
if ! dotnet --list-sdks 2>/dev/null | grep -q '^10\.'; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq dotnet-sdk-10.0
fi

# NuGet packages for the whole solution (cached with the container afterwards).
dotnet restore SupercarsTiming.slnx

# Frontend packages. npm install rather than npm ci: it reuses node_modules when the
# container is cached, so later sessions start faster.
(cd src/web && npm install --no-audit --no-fund)
