#!/usr/bin/env bash
#
# Creates ONE encrypted file containing everything that cannot be regenerated:
# the production secrets and the SSH key that is the only way into the server.
#
# The output is safe to store anywhere — cloud drive, email to yourself, USB
# stick — because it is AES-256 encrypted with a passphrase you choose and that
# is never written down. Losing the passphrase is the same as losing the file,
# so put the passphrase in a password manager even if the file goes elsewhere.
#
#   ./scripts/backup-secrets.sh                 # create a backup
#   ./scripts/backup-secrets.sh --verify FILE   # prove a backup actually opens
#   ./scripts/backup-secrets.sh --restore FILE  # unpack to ./restored-secrets/
#
# WHY THE SSH KEY IS IN HERE. Password authentication is disabled on the server
# and exactly one public key is authorised. If the private key is lost, SSH is
# closed permanently. There is still a way back — Vultr's web console plus a
# root password reset from the control panel — but that is a bad afternoon,
# whereas this file is thirty seconds.

set -euo pipefail

SERVER_IP="${GRIMS_SERVER_IP:-45.63.35.93}"
SSH_KEY="${GRIMS_SSH_KEY:-$HOME/.ssh/grims_squad_ed25519}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="grims-secrets-${STAMP}.tar.gz.enc"

die() { printf '\n  ERROR: %s\n\n' "$1" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed."; }
need openssl
need tar
need ssh

# --------------------------------------------------------------------- verify
if [[ "${1:-}" == "--verify" ]]; then
  [[ -f "${2:-}" ]] || die "Usage: $0 --verify <file>"
  # A backup nobody has ever opened is a backup you are ASSUMING works. This
  # decrypts and lists the contents without writing anything to disk.
  echo "  Enter the passphrase for ${2}:"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in "$2" \
    | tar -tzv || die "Could not decrypt. Wrong passphrase, or the file is damaged."
  printf '\n  ✓ Backup opens correctly and contains the files listed above.\n\n'
  exit 0
fi

# -------------------------------------------------------------------- restore
if [[ "${1:-}" == "--restore" ]]; then
  [[ -f "${2:-}" ]] || die "Usage: $0 --restore <file>"
  mkdir -p restored-secrets
  echo "  Enter the passphrase for ${2}:"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in "$2" \
    | tar -xzv -C restored-secrets || die "Could not decrypt."
  chmod -R 600 restored-secrets 2>/dev/null || true
  printf '\n  ✓ Restored to ./restored-secrets/ — DELETE IT once you are done.\n\n'
  exit 0
fi

# --------------------------------------------------------------------- create
[[ -f "$SSH_KEY" ]] || die "SSH key not found at $SSH_KEY"

STAGE="$(mktemp -d)"
# Even on a crash, the plaintext staging directory must not survive.
trap 'rm -rf "$STAGE"' EXIT INT TERM
chmod 700 "$STAGE"

echo "  Fetching /srv/grims/.env from ${SERVER_IP}..."
ssh -o StrictHostKeyChecking=accept-new -i "$SSH_KEY" "root@${SERVER_IP}" \
  'cat /srv/grims/.env' > "$STAGE/production.env" \
  || die "Could not read /srv/grims/.env. Is the server reachable?"

[[ -s "$STAGE/production.env" ]] || die "/srv/grims/.env came back empty — refusing to write a useless backup."

cp "$SSH_KEY" "$STAGE/grims_squad_ed25519"
cp "${SSH_KEY}.pub" "$STAGE/grims_squad_ed25519.pub" 2>/dev/null || true

cat > "$STAGE/README.txt" <<EOF
Grim's Squad Hub — emergency secrets backup
Created: ${STAMP}
Server:  ${SERVER_IP}

CONTENTS
  production.env             copy of /srv/grims/.env (root-owned 0600 on the server)
  grims_squad_ed25519        SSH PRIVATE KEY — the only way into the server
  grims_squad_ed25519.pub    matching public key

TO RESTORE THE SERVER SECRETS
  scp production.env root@${SERVER_IP}:/srv/grims/.env
  ssh root@${SERVER_IP} 'chown root:root /srv/grims/.env && chmod 600 /srv/grims/.env'

TO RESTORE SSH ACCESS
  cp grims_squad_ed25519 ~/.ssh/ && chmod 600 ~/.ssh/grims_squad_ed25519

IF YOU LOST THE SSH KEY AND HAVE NO BACKUP
  Vultr control panel -> the instance -> View Console, and reset the root
  password from the same page. Then re-add a new public key and set
  PasswordAuthentication back to no.

WHAT IS *NOT* IN HERE
  The database. Application data is backed up separately; this file is only
  the things that cannot be regenerated at all.
EOF

echo "  Choose a passphrase for the backup (you will be asked twice)."
echo "  Store it in a password manager — losing it loses the backup."
tar -czf - -C "$STAGE" . \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -out "$OUT" \
  || die "Encryption failed."

chmod 600 "$OUT"

printf '\n  ✓ Created %s (%s bytes)\n' "$OUT" "$(wc -c < "$OUT")"
printf '\n  NOW DO THESE THREE THINGS:\n'
printf '    1. Verify it opens:  %s --verify %s\n' "$0" "$OUT"
printf '    2. Copy it somewhere off this machine (cloud drive, USB, email to yourself)\n'
printf '    3. Put the PASSPHRASE in your password manager\n'
printf '\n  A backup on the same disk as the original protects against nothing.\n\n'
