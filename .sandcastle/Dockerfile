FROM node:22-bookworm

# Install system dependencies. The second group is what Tauri 2 needs to
# compile on Linux (https://v2.tauri.app/start/prerequisites/#linux): `npm run
# check` builds the Tauri shell for clippy and the tests.
RUN apt-get update && apt-get install -y \
  git \
  curl \
  jq \
  build-essential \
  file \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libssl-dev \
  libwebkit2gtk-4.1-dev \
  libxdo-dev \
  wget \
  && rm -rf /var/lib/apt/lists/*

# The issue tracker is local (.scratch/, read and closed by `npm run tickets`
# with this image's Node), so it needs no CLI. The pre-commit hook does need
# gitleaks (see AGENTS.md): same version as the hosts, checksums pinned from
# the release's checksums.txt.
RUN version=8.30.1 \
  && case "$(dpkg --print-architecture)" in \
    amd64) arch=x64 sha=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;; \
    arm64) arch=arm64 sha=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;; \
    *) echo "gitleaks: no pinned build for this architecture" >&2; exit 1 ;; \
  esac \
  && curl -fsSL -o /tmp/gitleaks.tar.gz \
    "https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_linux_${arch}.tar.gz" \
  && echo "${sha}  /tmp/gitleaks.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks \
  && rm /tmp/gitleaks.tar.gz

# Build-args for UID/GID alignment: sandcastle docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -o -g $AGENT_GID node && usermod -o -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node
USER ${AGENT_UID}:${AGENT_GID}

# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash

# Add Claude to PATH
ENV PATH="/home/agent/.local/bin:$PATH"

# Rust for the Cargo workspace, pinned to the version in rust-toolchain.toml
# (keep both in sync), with the rustfmt and clippy that `npm run check` runs.
# cargo-audit is the same version as the hosts (see AGENTS.md).
RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain 1.99.0 \
      --component rustfmt --component clippy \
  && /home/agent/.cargo/bin/cargo install cargo-audit --locked --version 0.22.2 \
  && rm -rf /home/agent/.cargo/registry
ENV PATH="/home/agent/.cargo/bin:$PATH"

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at /home/agent/workspace
# and overrides the working directory to /home/agent/workspace at container start.
# Structure your Dockerfile so that /home/agent/workspace can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
