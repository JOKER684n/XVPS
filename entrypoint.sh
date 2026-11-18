#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${SONG_SSH_PASSWORD:-}" ]]; then
  echo "song:${SONG_SSH_PASSWORD}" | chpasswd
else
  passwd -l song
fi

mkdir -p /data /var/run/sshd
/usr/sbin/sshd
cd /home/song/XVPS
exec npm start
