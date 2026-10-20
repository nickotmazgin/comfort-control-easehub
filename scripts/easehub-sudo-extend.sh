#!/usr/bin/env bash
# EaseHub — Sudo Timeout helper.
#
# Manages how long sudo remembers your password (timestamp_timeout) through a
# single drop-in file: /etc/sudoers.d/99-easehub-sudo-timeout-<user>
# (characters other than letters, digits, _ and - in <user> become _).
# Every change is syntax-checked with visudo before it is installed, and the
# previous file is backed up, so a typo can never lock sudo.
#
# Usage:
#   easehub-sudo-extend.sh status                  Show the current setting
#   easehub-sudo-extend.sh set <minutes> [global]  Set timeout (1-1440); "global"
#                                                  shares one login across terminals
#   easehub-sudo-extend.sh reset                   Remove override (system default)
#   easehub-sudo-extend.sh forget                  Forget the cached password now
#   easehub-sudo-extend.sh menu                    Interactive menu
#
# The configured minutes are also written to ~/.cache/easehub/sudo-timeout so
# the panel menu can show them without asking for a password.
set -u

ME="$(id -un)"
# sudo silently skips sudoers.d files whose names contain "." or end in "~",
# so map anything outside [A-Za-z0-9_-] to "_" (e.g. john.doe -> john_doe).
SAFE_ME="$(printf '%s' "$ME" | tr -c 'A-Za-z0-9_-' '_')"
DROPIN="/etc/sudoers.d/99-easehub-sudo-timeout-${SAFE_ME}"
STATE_FILE="${XDG_CACHE_HOME:-$HOME/.cache}/easehub/sudo-timeout"

say()  { printf '%s\n' "$*"; }
note() { notify-send --app-name=EaseHub --icon=security-high-symbolic "EaseHub: Sudo Timeout" "$1" 2>/dev/null || true; }
fail() {
    printf 'ERROR: %s\n' "$1" >&2
    notify-send --app-name=EaseHub --urgency=critical --icon=dialog-error-symbolic "EaseHub: Sudo Timeout" "$1" 2>/dev/null || true
    exit 1
}

remember() {
    # remember <minutes|default>: what the panel menu shows next to "Sudo Timeout".
    mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null &&
        printf '%s\n' "$1" > "$STATE_FILE" 2>/dev/null || true
}

require_sudo() {
    say "Administrator access is needed (sudo will ask for your password)."
    sudo -v || fail "Authentication failed or was cancelled. Nothing was changed."
}

current_setting() {
    # Prints the configured minutes from our drop-in, or "default" if unset.
    # Uses non-interactive sudo only, so it never prompts; callers that need
    # a guaranteed answer should call require_sudo first.
    if sudo -n test -f "$DROPIN" 2>/dev/null; then
        local mins
        mins="$(sudo -n grep -o 'timestamp_timeout=[0-9]*' "$DROPIN" 2>/dev/null \
            | head -1 | cut -d= -f2)"
        [ -n "$mins" ] && { printf '%s' "$mins"; return 0; }
        printf 'default'
        return 0
    fi
    if sudo -n true 2>/dev/null; then
        printf 'default'
    else
        printf 'unknown (locked; will check when applying)'
    fi
}

show_status() {
    require_sudo
    local cur
    cur="$(current_setting)"
    say ""
    remember "$cur"
    if [ "$cur" = "default" ]; then
        say "Sudo timeout: no EaseHub override is installed."
        say "Your system default applies (usually 15 minutes, unless other sudoers config sets its own value)."
        note "No EaseHub sudo-timeout override is set."
    else
        say "Sudo timeout: ${cur} minutes (set by EaseHub)."
        if sudo -n grep -q 'timestamp_type=global' "$DROPIN" 2>/dev/null; then
            say "Shared across terminals: yes (one login for every terminal)."
        else
            say "Shared across terminals: no (each terminal asks once)."
        fi
        say "Override file: $DROPIN"
        note "Sudo timeout is ${cur} minutes."
    fi
    if sudo -n true 2>/dev/null; then
        say "Sudo cache: ACTIVE right now (no password needed)."
    else
        say "Sudo cache: not active."
    fi
}

set_timeout() {
    local mins="$1" scope="${2:-}"
    case "$mins" in
        ''|*[!0-9]*) fail "Minutes must be a whole number (got: '$mins')." ;;
    esac
    if [ "$mins" -lt 1 ] || [ "$mins" -gt 1440 ]; then
        fail "Minutes must be between 1 and 1440 (24 hours)."
    fi

    require_sudo

    local tmp
    tmp="$(mktemp)" || fail "Could not create a temporary file."
    cat > "$tmp" <<EOF
# Managed by EaseHub (easehub-sudo-extend.sh) — safe to delete.
# Keeps sudo authentication cached for ${mins} minutes for ${ME}.
Defaults:${ME} timestamp_timeout=${mins}
EOF
    if [ "$scope" = "global" ]; then
        # One cached login shared by every terminal of this user.
        printf 'Defaults:%s timestamp_type=global\n' "$ME" >> "$tmp"
    fi

    if ! sudo visudo -c -f "$tmp" >/dev/null 2>&1; then
        rm -f "$tmp"
        fail "Generated sudoers content failed validation. Nothing was changed."
    fi

    if sudo test -f "$DROPIN" 2>/dev/null; then
        sudo cp -a "$DROPIN" "${DROPIN}.bak" 2>/dev/null || true
    fi

    if sudo install -o root -g root -m 0440 "$tmp" "$DROPIN"; then
        rm -f "$tmp"
        # Final whole-config validation; roll back immediately if broken.
        if ! sudo visudo -c >/dev/null 2>&1; then
            sudo rm -f "$DROPIN"
            fail "Final sudoers validation failed; the change was rolled back."
        fi
        sudo -v 2>/dev/null || true
        say ""
        remember "$mins"
        say "SUCCESS: sudo will now remember your password for ${mins} minutes."
        if [ "$scope" = "global" ]; then
            say "One login is shared by all your terminals."
        else
            say "Each terminal asks once, then remembers for ${mins} minutes."
        fi
        say "Override file: $DROPIN"
        note "Sudo timeout set to ${mins} minutes."
    else
        rm -f "$tmp"
        fail "Could not install the sudoers drop-in. Nothing was changed."
    fi
}

reset_timeout() {
    require_sudo
    if ! sudo test -f "$DROPIN" 2>/dev/null; then
        remember default
        say "No EaseHub override is installed — already using the system default."
        note "Already using the system default sudo timeout."
        return 0
    fi
    sudo cp -a "$DROPIN" "${DROPIN}.bak" 2>/dev/null || true
    if sudo rm -f "$DROPIN" && sudo visudo -c >/dev/null 2>&1; then
        say ""
        remember default
        say "SUCCESS: EaseHub override removed. Sudo timeout is back to the system default (usually 15 minutes)."
        note "Sudo timeout reset to the system default."
    else
        fail "Could not remove the override file."
    fi
}

forget() {
    # sudo -K needs no password: it only deletes this user's cached login.
    if sudo -K 2>/dev/null; then
        note "Sudo will ask for your password next time."
        say "Done: sudo will ask for your password next time."
    else
        fail "Could not clear the cached sudo login."
    fi
}

menu() {
    say "EaseHub — Sudo Timeout"
    say "======================"
    say "Current: $(current_setting 2>/dev/null || printf 'unknown')"
    say ""
    say "  1) 15 minutes"
    say "  2) 30 minutes"
    say "  3) 60 minutes (1 hour)"
    say "  4) 120 minutes (2 hours)"
    say "  5) 180 minutes (3 hours)"
    say "  6) Custom…"
    say "  7) Reset to system default"
    say "  8) Show status"
    say "  q) Quit"
    say ""
    printf 'Choose an option: '
    local choice
    read -r choice
    case "$choice" in
        1) set_timeout 15 ;;
        2) set_timeout 30 ;;
        3) set_timeout 60 ;;
        4) set_timeout 120 ;;
        5) set_timeout 180 ;;
        6) printf 'Minutes (1-1440): '; local m; read -r m; set_timeout "$m" ;;
        7) reset_timeout ;;
        8) show_status ;;
        q|Q) say "Cancelled. Nothing was changed." ;;
        *) fail "Unknown option: $choice" ;;
    esac
}

case "${1:-menu}" in
    status) show_status ;;
    set)    set_timeout "${2:-}" "${3:-}" ;;
    reset)  reset_timeout ;;
    forget) forget ;;
    menu)   menu ;;
    *)
        say "Usage: $(basename "$0") [status|set <minutes> [global]|reset|forget|menu]"
        exit 2
        ;;
esac
