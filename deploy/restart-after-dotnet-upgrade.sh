#!/bin/sh
# Restarts the supercars-timing user service when apt has replaced the .NET files it is running on.
#
# Why: a .NET process loads runtime DLLs lazily, as code first needs them. When apt upgrades .NET (say 10.0.13 ->
# 10.0.14) it deletes the old runtime folder, and the next DLL the running server loads fails with
# FileNotFoundException. That's how the server went down during Sandown Practice 1 on 6 Nov 2026.
#
# How: apt runs this as root after every dpkg run (DPkg::Post-Invoke, see 99restart-supercars-timing). Loaded DLLs are
# memory-mapped, so /proc/<pid>/maps lists them. When the file behind a mapping is deleted, the kernel adds
# " (deleted)" to its line. If any process in the service's cgroup maps a deleted file under /usr/lib/dotnet, the
# service is restarted. Otherwise (most upgrades) nothing happens.
#
# Install (root runs it, so it lives in a root-owned path, not in a folder jack can write to):
#   sudo install -m 755 deploy/restart-after-dotnet-upgrade.sh /usr/local/sbin/restart-supercars-after-dotnet-upgrade
#   sudo install -m 644 deploy/99restart-supercars-timing /etc/apt/apt.conf.d/99restart-supercars-timing
# Log: journalctl -t supercars-dotnet-hook
#
# Never fails: an apt hook that exits non-zero would make every apt run report an error.

SERVICE_USER="${SERVICE_USER:-jack}"
UNIT="${UNIT:-supercars-timing.service}"
DOTNET_DIR="${DOTNET_DIR:-/usr/lib/dotnet}"   # overridable for testing
DRY_RUN="${DRY_RUN:-}"                        # set to only log what it would do

log() { logger -t supercars-dotnet-hook "$*" 2>/dev/null; echo "supercars-dotnet-hook: $*"; }

uid=$(id -u "$SERVICE_USER" 2>/dev/null) || exit 0
runtime_dir="/run/user/$uid"
[ -d "$runtime_dir" ] || exit 0   # no user manager running: the service isn't either

# apt runs this as root; running it as the service user (for testing) works too.
as_user() {
    if [ "$(id -u)" = "$uid" ]; then env XDG_RUNTIME_DIR="$runtime_dir" "$@"
    else runuser -u "$SERVICE_USER" -- env XDG_RUNTIME_DIR="$runtime_dir" "$@"; fi
}

cgroup=$(as_user systemctl --user show -p ControlGroup --value "$UNIT" 2>/dev/null)
procs="/sys/fs/cgroup$cgroup/cgroup.procs"
[ -n "$cgroup" ] && [ -r "$procs" ] || exit 0   # service not running

for pid in $(cat "$procs"); do
    if grep -F "$DOTNET_DIR/" "/proc/$pid/maps" 2>/dev/null | grep -q ' (deleted)$'; then
        log "pid $pid of $UNIT is running on deleted .NET files; restarting it"
        [ -n "$DRY_RUN" ] && exit 0
        # --no-block: don't make apt wait for the restart (dotnet run may rebuild after an SDK upgrade).
        as_user systemctl --user --no-block restart "$UNIT" || log "restart failed"
        exit 0
    fi
done
exit 0
