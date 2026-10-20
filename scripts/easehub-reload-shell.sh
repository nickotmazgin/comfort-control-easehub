#!/usr/bin/env bash
# EaseHub — Reload GNOME Shell safely (X11 only).
#
# This does exactly what pressing Alt+F2, typing "r", and pressing Enter does:
# it asks GNOME Shell to restart itself in place through its own run dialog.
# It never calls Meta.restart() from extension code (which can crash or log
# out the session on some desktops), and it verifies the restart succeeded
# from the journal and a live D-Bus ping before reporting success.
#
# Requirements: X11 session, GNOME Shell, xdotool.
set -u

notify_error() {
    notify-send --app-name=EaseHub --urgency=critical --icon=dialog-error-symbolic \
        "EaseHub: Shell Reload Failed" "$1" 2>/dev/null || true
    printf 'ERROR: %s\n' "$1" >&2
}

session_type="${XDG_SESSION_TYPE:-}"
if [[ -z "$session_type" && -n "${XDG_SESSION_ID:-}" ]]; then
    session_type="$(loginctl show-session "$XDG_SESSION_ID" \
        --property=Type --value 2>/dev/null || true)"
fi

if [[ "$session_type" != "x11" ]]; then
    notify_error "Reload is only available on X11. On Wayland, log out and back in instead (restarting the shell would end the session)."
    exit 1
fi

if [[ "${XDG_CURRENT_DESKTOP:-}" != *GNOME* ]]; then
    notify_error "This action is only for GNOME Shell."
    exit 1
fi

if ! command -v xdotool >/dev/null 2>&1; then
    notify_error "xdotool is required. Install it first (e.g. sudo apt install xdotool)."
    exit 1
fi

if ! pgrep -xo gnome-shell >/dev/null; then
    notify_error "GNOME Shell is not running."
    exit 1
fi

if [[ "$(gsettings get org.gnome.desktop.lockdown disable-command-line 2>/dev/null)" == "true" ]]; then
    notify_error "The Alt+F2 command dialog is turned off on this computer (org.gnome.desktop.lockdown disable-command-line). Log out and back in instead."
    exit 1
fi

# Ignore repeated clicks while one reload attempt is in progress.
exec 9>"${XDG_RUNTIME_DIR:-/tmp}/easehub-reload-shell.lock"
if ! flock --nonblock 9; then
    exit 0
fi

# Most distributions run the shell as this systemd user unit; otherwise match
# the shell's journal lines by process name.
shell_unit="org.gnome.Shell@x11.service"
if systemctl --user is-active --quiet "$shell_unit"; then
    journal_match=(--unit="$shell_unit")
else
    shell_unit=""
    journal_match=(_COMM=gnome-shell)
fi
journal_cursor="$(
    journalctl --user "${journal_match[@]}" --lines=0 --show-cursor \
        --no-pager 2>/dev/null |
        sed -n 's/^-- cursor: //p' |
        tail -n 1
)"
started_at="$(date +%s)"

# Same GNOME command as pressing Alt+F2, typing r, then Enter.
if ! xdotool key --clearmodifiers alt+F2; then
    notify_error "Could not open the GNOME command dialog."
    exit 1
fi
# Give the dialog time to open even when the shell is busy (e.g. right
# after installing an extension); a dropped "r" would make the reload a no-op.
sleep 1.2
xdotool type --clearmodifiers --delay 100 r
sleep 0.4
xdotool key --clearmodifiers Return

# GNOME re-executes Shell in place, so a successful reload can keep the same
# process ID. Confirm it from the new journal entry and a live D-Bus check.
for _ in {1..40}; do
    sleep 0.5

    if [[ -n "$journal_cursor" ]]; then
        new_journal="$(
            journalctl --user "${journal_match[@]}" \
                --after-cursor="$journal_cursor" --no-pager -o cat \
                2>/dev/null || true
        )"
    else
        new_journal="$(
            journalctl --user "${journal_match[@]}" \
                --since="@$started_at" --no-pager -o cat \
                2>/dev/null || true
        )"
    fi

    if grep -Fq "GNOME Shell started at" <<<"$new_journal" &&
        { [[ -z "$shell_unit" ]] || systemctl --user is-active --quiet "$shell_unit"; } &&
        gdbus call --session --dest org.gnome.Shell \
            --object-path /org/gnome/Shell \
            --method org.freedesktop.DBus.Peer.Ping \
            >/dev/null 2>&1; then
        notify-send --app-name=EaseHub --icon=view-refresh-symbolic \
            "EaseHub: Shell Reloaded" \
            "GNOME Shell restarted successfully and passed its health check." \
            2>/dev/null || true
        exit 0
    fi
done

notify_error "No successful shell restart was detected. No logout was requested."
exit 1
