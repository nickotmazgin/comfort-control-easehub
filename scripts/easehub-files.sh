#!/usr/bin/env bash
# EaseHub — Files (Nautilus) right-click actions.
#
# Called by the small launcher scripts EaseHub writes to
# ~/.local/share/nautilus/scripts/<menu name>/ when "Files right-click menu"
# is turned on in Preferences. Nautilus runs launchers with the selected items
# as arguments (relative to the current folder); with nothing selected, the
# current folder is used.
#
# Usage: easehub-files.sh <action> [paths...]
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_DIR="$SELF_DIR/../schemas"
SCHEMA=org.gnome.shell.extensions.easehub
NL=$'\n'

setting() {
    gsettings --schemadir "$SCHEMA_DIR" get "$SCHEMA" "$1" 2>/dev/null | sed "s/^'//; s/'$//"
}

notify() {
    # notify <body> [icon] [urgency]
    [[ -n "${EASEHUB_FILES_DRYRUN:-}" ]] && { printf '[notify] %s\n' "$1" >&2; return 0; }
    [[ "$(setting files-notify)" == "false" && "${3:-}" != "critical" ]] && return 0
    command -v notify-send >/dev/null 2>&1 || return 0
    timeout 2 notify-send --app-name=EaseHub --icon="${2:-edit-copy-symbolic}" \
        ${3:+--urgency="$3"} "EaseHub" "$1" 2>/dev/null || true
}

fail() {
    notify "$1" dialog-error-symbolic critical
    printf 'EaseHub: %s\n' "$1" >&2
    exit 1
}

preview() {
    local text="$1" max=70
    if ((${#text} > max)); then printf '…%s' "${text: -$((max - 1))}"; else printf '%s' "$text"; fi
}

url_decode() {
    local s="${1//+/ }"
    printf '%b' "${s//%/\\x}"
}

# Absolute paths of the selection, one per line. Symlinks are kept as the
# path you clicked (not their target), and broken links still count.
collect() {
    local p
    if (($# > 0)); then
        for p in "$@"; do
            [[ -e "$p" || -L "$p" ]] || continue
            realpath -s -- "$p"
        done
    elif [[ "${NAUTILUS_SCRIPT_CURRENT_URI:-}" == file://* ]]; then
        url_decode "${NAUTILUS_SCRIPT_CURRENT_URI#file://}"
        printf '\n'
    else
        pwd
    fi
}

copy_text() {
    local data="$1"
    if [[ -n "${EASEHUB_FILES_DRYRUN:-}" ]]; then
        printf '%s\n' "$data"
        return 0
    fi
    if [[ -n "${WAYLAND_DISPLAY:-}" ]] && command -v wl-copy >/dev/null 2>&1; then
        printf '%s' "$data" | wl-copy && return 0
    fi
    if command -v xclip >/dev/null 2>&1; then
        printf '%s' "$data" | xclip -selection clipboard && return 0
    fi
    if command -v xsel >/dev/null 2>&1; then
        printf '%s' "$data" | xsel --clipboard --input && return 0
    fi
    return 1
}

human_size() {
    numfmt --to=iec --suffix=B --format='%.1f' "$1" 2>/dev/null | sed 's/\.0B$/B/' || printf '%s B' "$1"
}

size_of() {
    local p="$1"
    if [[ -d "$p" && ! -L "$p" ]]; then
        du -s --apparent-size --block-size=1 -- "$p" 2>/dev/null | cut -f1
    else
        stat -c %s -- "$p" 2>/dev/null
    fi
}

kind_of() {
    local p="$1"
    if [[ -L "$p" ]]; then
        [[ -e "$p" ]] && printf 'link' || printf 'broken link'
    elif [[ -d "$p" ]]; then printf 'folder'
    elif [[ -f "$p" ]]; then printf 'file'
    else printf 'other'
    fi
}

shell_quote() {
    # POSIX single-quote form: works in bash, zsh, sh and fish.
    printf "'%s'" "${1//\'/\'\\\'\'}"
}

uri_of() {
    # Percent-encode byte by byte so UTF-8 names (é, 日本) come out right.
    local hex b out=""
    hex="$(printf '%s' "$1" | od -An -v -tx1 | tr -d ' \n')"
    while [[ -n "$hex" ]]; do
        b="${hex:0:2}"
        hex="${hex:2}"
        case "$b" in
            2[d-fD-F]|3[0-9]|4[1-9a-fA-F]|5[0-9aA]|5[fF]|6[1-9a-fA-F]|7[0-9aA]|7[eE]) out+="$(printf "\\x$b")" ;;
            *) out+="%${b^^}" ;;
        esac
    done
    printf 'file://%s' "$out"
}

# Run a line producer over the selection and copy its output.
copy_lines() {
    local label="$1" icon="$2" fn="$3"
    shift 3
    local -a paths
    mapfile -t paths < <(collect "$@")
    ((${#paths[@]})) || fail "Nothing selected."
    local out="" line p n=0
    for p in "${paths[@]}"; do
        line="$("$fn" "$p")" || continue
        [[ -n "$line" ]] || continue
        out+="${out:+$NL}$line"
        n=$((n + 1))
    done
    ((n)) || fail "Nothing to copy for this selection."
    copy_text "$out" || fail "Could not reach the clipboard. Install wl-clipboard (Wayland) or xclip (X11)."
    if ((n == 1)); then
        notify "$label$NL$(preview "$out")" "$icon"
    else
        notify "$label ($n items)$NL$(preview "${out%%"$NL"*}")" "$icon"
    fi
}

line_name()        { basename -- "$1"; }
line_path()        { printf '%s' "$1"; }
line_path_name()   { printf '%s (%s)' "$1" "$(basename -- "$1")"; }
line_parent()      { dirname -- "$1"; }
# shellcheck disable=SC2088  # a literal ~ is the point
line_home()        { case "$1" in "$HOME") printf '~' ;; "$HOME"/*) printf '~/%s' "${1#"$HOME"/}" ;; *) printf '%s' "$1" ;; esac; }
line_quoted()      { shell_quote "$1"; }
line_uri()         { uri_of "$1"; }
line_info()        { local s; s="$(size_of "$1")"; printf '%s | %s | %s' "$(human_size "${s:-0}")" "$(kind_of "$1")" "$1"; }
line_sha256()      { [[ -f "$1" ]] || return 1; printf '%s  %s' "$(sha256sum -- "$1" | cut -d' ' -f1)" "$(basename -- "$1")"; }

terminal_argv() {
    # Prints the argv (NUL-separated) that opens $1 in the preferred terminal.
    local dir="$1" pref t
    pref="$(setting preferred-terminal)"
    for t in "$pref" ptyxis kgx gnome-terminal konsole tilix kitty alacritty wezterm foot x-terminal-emulator; do
        [[ -n "$t" ]] && command -v "$t" >/dev/null 2>&1 || continue
        case "$t" in
            ptyxis)         printf '%s\0' ptyxis --new-window --working-directory="$dir" ;;
            kgx)            printf '%s\0' kgx --working-directory="$dir" ;;
            gnome-terminal) printf '%s\0' gnome-terminal --working-directory="$dir" ;;
            konsole)        printf '%s\0' konsole --workdir "$dir" ;;
            tilix)          printf '%s\0' tilix --working-directory="$dir" ;;
            kitty)          printf '%s\0' kitty --directory "$dir" ;;
            alacritty)      printf '%s\0' alacritty --working-directory "$dir" ;;
            wezterm)        printf '%s\0' wezterm start --cwd "$dir" ;;
            foot)           printf '%s\0' foot --working-directory="$dir" ;;
            *)              printf '%s\0' bash -c 'cd "$1" && exec x-terminal-emulator' _ "$dir" ;;
        esac
        return 0
    done
    return 1
}

open_terminal() {
    local p dir
    p="$(collect "$@" | head -n1)"
    [[ -n "$p" ]] || fail "Nothing selected."
    if [[ -d "$p" ]]; then dir="$p"; else dir="$(dirname -- "$p")"; fi
    local -a argv
    mapfile -d '' -t argv < <(terminal_argv "$dir")
    ((${#argv[@]})) || fail "No supported terminal found."
    setsid -f "${argv[@]}" >/dev/null 2>&1
}

open_editor() {
    local -a paths
    mapfile -t paths < <(collect "$@")
    ((${#paths[@]})) || fail "Nothing selected."
    local pref e
    pref="$(setting files-editor)"
    for e in "$pref" cursor code gnome-text-editor gedit kate; do
        [[ -n "$e" ]] && command -v "$e" >/dev/null 2>&1 && break
        e=""
    done
    [[ -n "$e" ]] || fail "No editor found (Cursor, VS Code, Text Editor, gedit or Kate)."
    setsid -f "$e" "${paths[@]}" >/dev/null 2>&1
}

make_executable() {
    local -a paths
    mapfile -t paths < <(collect "$@")
    local p n=0 last=""
    for p in "${paths[@]}"; do
        [[ -f "$p" && ! -L "$p" ]] || continue
        chmod u+x -- "$p" && { n=$((n + 1)); last="$p"; }
    done
    ((n)) || fail "Select one or more regular files."
    if ((n == 1)); then
        notify "Made executable$NL$(preview "$(basename -- "$last")")" application-x-executable-symbolic
    else
        notify "Made $n files executable" application-x-executable-symbolic
    fi
}

action="${1:-}"
shift || true
case "$action" in
    copy-name)       copy_lines "Copied name" edit-copy-symbolic line_name "$@" ;;
    copy-path)       copy_lines "Copied full path" edit-copy-symbolic line_path "$@" ;;
    copy-path-name)  copy_lines "Copied path and name" edit-copy-symbolic line_path_name "$@" ;;
    copy-parent)     copy_lines "Copied parent folder" folder-symbolic line_parent "$@" ;;
    copy-home)       copy_lines "Copied home-relative path" user-home-symbolic line_home "$@" ;;
    copy-quoted)     copy_lines "Copied shell-quoted path" utilities-terminal-symbolic line_quoted "$@" ;;
    copy-uri)        copy_lines "Copied file URI" emblem-shared-symbolic line_uri "$@" ;;
    copy-info)       copy_lines "Copied size and type" dialog-information-symbolic line_info "$@" ;;
    copy-sha256)     copy_lines "Copied SHA-256 checksum" security-high-symbolic line_sha256 "$@" ;;
    open-terminal)   open_terminal "$@" ;;
    open-editor)     open_editor "$@" ;;
    make-executable) make_executable "$@" ;;
    *)
        printf 'Usage: %s <action> [paths...]\n' "$(basename "$0")" >&2
        exit 2
        ;;
esac
