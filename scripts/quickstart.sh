#!/usr/bin/env bash
# Nodedr OrderRestro quickstart — macOS & Linux.
#
# Checks whether Docker is installed and running; installs it if not
# (Docker Desktop via Homebrew on macOS, installing Homebrew first if needed, Docker Engine via the official
# get.docker.com script on Linux). Does the same for git (Homebrew on macOS,
# the system package manager on Linux) if it's missing too. Then clones (or
# updates) nodedr-restaurant-pos into ./nodedr-restaurant-pos and runs its
# installer (which generates a .env with random secrets on first run).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Raktim94/nodedr-restaurant-pos/master/scripts/quickstart.sh | bash
#
# Safe to re-run: every step only acts if the previous one didn't already
# succeed, and an existing ./nodedr-restaurant-pos checkout is updated in
# place rather than clobbered.
set -euo pipefail

REPO_URL="https://github.com/Raktim94/nodedr-restaurant-pos.git"
REPO_DIR="nodedr-restaurant-pos"
SUDO=""

install_docker_linux() {
  echo "==> Installing Docker Engine via the official convenience script..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" 2>/dev/null || true
  sudo systemctl enable --now docker 2>/dev/null || true
}

# Homebrew and Docker Desktop put their binaries outside the minimal PATH a
# non-login `curl | bash` shell gets (Apple Silicon brew lives in /opt/homebrew),
# so add the usual locations before checking for either.
mac_path() {
  for d in /opt/homebrew/bin /usr/local/bin "$HOME/.docker/bin" /Applications/Docker.app/Contents/Resources/bin; do
    [ -d "$d" ] && case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac
  done
  export PATH
}

# Piped installs have the script itself on stdin, so anything interactive
# (Homebrew's sudo prompt, Docker's installer) must read from the terminal.
TTY_IN=/dev/null
[ -r /dev/tty ] && (: </dev/tty) 2>/dev/null && TTY_IN=/dev/tty

install_brew_mac() {
  mac_path
  command -v brew >/dev/null 2>&1 && return
  echo "==> Installing Homebrew (you may be asked for your Mac password; it also installs Apple's command line tools)..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" <"$TTY_IN"
  mac_path
  command -v brew >/dev/null 2>&1 || {
    echo "Homebrew install didn't finish. Install it from https://brew.sh and re-run this command." >&2
    exit 1
  }
}

install_docker_mac() {
  mac_path
  if [ -d /Applications/Docker.app ] || [ -d "$HOME/Applications/Docker.app" ]; then
    echo "==> Docker Desktop is installed but not running — starting it..."
  else
    install_brew_mac
    echo "==> Installing Docker Desktop via Homebrew..."
    brew install --cask docker <"$TTY_IN"
    mac_path
  fi
  open -a Docker
  echo "==> Waiting for Docker to start — if macOS or Docker shows a permission or license prompt, approve it (first launch only)..."
  for _ in $(seq 1 150); do
    mac_path
    docker info >/dev/null 2>&1 && return
    sleep 2
  done
}

[ "$(uname -s)" = "Darwin" ] && mac_path
echo "==> Checking for Docker..."
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "Docker is already installed and running."
else
  case "$(uname -s)" in
    Darwin) install_docker_mac ;;
    Linux) install_docker_linux ;;
    *)
      echo "Unsupported OS: $(uname -s). Install Docker manually: https://docs.docker.com/get-docker/" >&2
      exit 1
      ;;
  esac
fi

if ! docker info >/dev/null 2>&1; then
  if [ "$(uname -s)" = "Linux" ] && sudo docker info >/dev/null 2>&1; then
    # Just-added docker-group membership only takes effect in a fresh login
    # shell. Falling back to sudo for this run means the install still
    # completes in one shot instead of forcing a logout/login first.
    SUDO="sudo"
    echo "Using sudo for Docker for this run — log out and back in once, and future runs won't need it."
  else
    echo "Docker isn't reachable yet." >&2
    echo "On Linux: log out and back in (new docker-group membership needs a fresh session), then re-run this command." >&2
    echo "On Mac: open Docker Desktop, wait for it to say \"running\", then re-run this command." >&2
    exit 1
  fi
fi

install_git_linux() {
  echo "==> Installing git..."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y && sudo apt-get install -y git
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y git
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y git
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -Sy --noconfirm git
  elif command -v zypper >/dev/null 2>&1; then
    sudo zypper install -y git
  elif command -v apk >/dev/null 2>&1; then
    sudo apk add git
  else
    echo "Could not detect a supported package manager to install git automatically." >&2
    echo "Install git manually (https://git-scm.com/downloads) and re-run this command." >&2
    exit 1
  fi
}

install_git_mac() {
  # /usr/bin/git on a stock Mac is a shim that pops a blocking GUI installer
  # (and fails in a pipe) until Apple's command line tools exist, so never run
  # it to check. Homebrew's installer sets those tools up and gives a real git.
  install_brew_mac
  echo "==> Installing git via Homebrew..."
  brew install git <"$TTY_IN"
}

case "$(uname -s)" in
  Darwin)
    # `xcode-select -p` succeeds only when a real developer dir (CLT/Xcode) exists.
    if ! xcode-select -p >/dev/null 2>&1 && ! { command -v brew >/dev/null 2>&1 && [ -x "$(brew --prefix 2>/dev/null)/bin/git" ]; }; then
      install_git_mac
    fi
    mac_path
    ;;
  Linux)
    command -v git >/dev/null 2>&1 || install_git_linux
    ;;
  *)
    command -v git >/dev/null 2>&1 || {
      echo "Unsupported OS: $(uname -s). Install git manually: https://git-scm.com/downloads" >&2
      exit 1
    }
    ;;
esac

echo "==> Getting nodedr-restaurant-pos..."
if [ -d "$REPO_DIR/.git" ]; then
  echo "Existing checkout found in ./$REPO_DIR — updating it instead of re-cloning."
  git -C "$REPO_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"
echo "==> Installing and starting Nodedr OrderRestro..."
$SUDO ./install.sh <"$TTY_IN"
