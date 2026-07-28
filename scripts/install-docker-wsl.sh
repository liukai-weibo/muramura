#!/usr/bin/env bash
# Install Docker Engine + Compose plugin on Ubuntu WSL2 via apt (docker.io).
set -euo pipefail

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "Docker already available:"
  docker version
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive

sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2

sudo systemctl enable --now docker

# Allow current user to run docker without sudo
sudo usermod -aG docker "$USER"

echo
echo "Installed:"
docker --version || true
docker compose version || true
echo
echo "若提示 permission denied，请先执行: newgrp docker"
echo "或关闭并重新打开当前 WSL 终端后再试 docker ps"
