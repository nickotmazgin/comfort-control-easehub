#!/usr/bin/env bash
# One-time setup: SSH tag signing for Verified GitHub releases.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "${RELEASE_SIGNING_KEY:-}" ]]; then
  if [[ -f "${HOME}/.ssh/id_ed25519_github.pub" ]]; then
    KEY_PUB="${HOME}/.ssh/id_ed25519_github.pub"
  else
    KEY_PUB="${HOME}/.ssh/id_ed25519.pub"
  fi
else
  KEY_PUB="${RELEASE_SIGNING_KEY}"
fi

SIGN_EMAIL="${RELEASE_SIGN_EMAIL:-nickotmazgin@gmail.com}"
ALLOWED_SIGNERS="${HOME}/.ssh/allowed_signers"

if [[ ! -f "$KEY_PUB" ]]; then
  echo "Missing signing public key: $KEY_PUB"
  exit 1
fi

PUB_LINE="$(cat "$KEY_PUB")"
FPR="$(ssh-keygen -lf "$KEY_PUB" | awk '{print $2}')"
echo "Using signing key: $KEY_PUB ($FPR)"

echo ""
echo "=== Repo-local git signing config ($REPO_ROOT) ==="
git -C "$REPO_ROOT" config gpg.format ssh
git -C "$REPO_ROOT" config user.signingkey "$KEY_PUB"
git -C "$REPO_ROOT" config user.email "$SIGN_EMAIL"
git -C "$REPO_ROOT" config tag.gpgsign true
git -C "$REPO_ROOT" config gpg.ssh.allowedSignersFile "$ALLOWED_SIGNERS"
echo "OK signing key, email=$SIGN_EMAIL, tag.gpgsign=true"

echo ""
echo "=== allowed_signers ($ALLOWED_SIGNERS) ==="
ENTRY="${SIGN_EMAIL} namespaces=\"git\" ${PUB_LINE}"
if [[ -f "$ALLOWED_SIGNERS" ]] && grep -qF "$PUB_LINE" "$ALLOWED_SIGNERS" 2>/dev/null; then
  echo "OK public key already listed"
else
  mkdir -p "$(dirname "$ALLOWED_SIGNERS")"
  printf '%s\n' "$ENTRY" >> "$ALLOWED_SIGNERS"
  chmod 600 "$ALLOWED_SIGNERS"
  echo "OK appended allowed_signers entry"
fi

TEST_TAG="easehub-sign-test-$(date +%s)"
if git -C "$REPO_ROOT" tag -s "$TEST_TAG" -m "signing smoke test" HEAD; then
  git -C "$REPO_ROOT" verify-tag "$TEST_TAG" && echo "OK local verify-tag passed"
  git -C "$REPO_ROOT" tag -d "$TEST_TAG" >/dev/null
else
  echo "WARN: signed tag failed. Load key: ssh-add ~/.ssh/id_ed25519_github"
fi

echo ""
echo "Done. Publish with: EASEHUB_RELEASE_YES=1 ./tools/release-publish.sh"
