# A Magnus fleet node for the Studio end-to-end stack: systemd as PID 1, the Magnus agent
# built from a Magnus checkout (the build context) running as a root system service, and an
# unprivileged `ardent` account whose systemd user manager runs the Ardent gateways the
# agent creates. The container needs CAP_SYS_ADMIN in a private cgroup namespace so systemd
# can manage its own cgroup subtree; it never touches the host's.
ARG NODE_IMAGE=node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

FROM ${NODE_IMAGE} AS builder
WORKDIR /opt/magnus-build
COPY . .
RUN npm ci --no-audit --no-fund --ignore-scripts \
      --workspace @hivemagnus/magnus-contracts \
      --workspace @hivemagnus/magnus-agent
RUN npm --workspace @hivemagnus/magnus-contracts run build \
  && npm --workspace @hivemagnus/magnus-agent run build
RUN mkdir -p /packages \
  && (cd packages/agent && npm pack --ignore-scripts --pack-destination /packages) \
  && (cd packages/contracts && npm pack --ignore-scripts --pack-destination /packages)

FROM ${NODE_IMAGE}
RUN apt-get update \
  && apt-get install -y --no-install-recommends systemd systemd-sysv dbus dbus-user-session ca-certificates procps python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && ln -sf /usr/local/bin/node /usr/bin/node \
  && ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/bin/npm \
  && useradd --create-home --home-dir /var/lib/ardent --shell /bin/bash ardent \
  && install -d -o ardent -g ardent /var/lib/ardent/.config /var/lib/ardent/.config/environment.d \
  && mkdir -p /var/lib/systemd/linger && touch /var/lib/systemd/linger/ardent
WORKDIR /opt/magnus-agent
COPY --from=builder /packages/ /tmp/packages/
RUN node -e ' \
      const fs = require("node:fs"); \
      const files = fs.readdirSync("/tmp/packages"); \
      const find = (prefix) => "file:/tmp/packages/" + files.find((file) => file.startsWith(prefix)); \
      const local = { "@hivemagnus/magnus-contracts": find("hivemagnus-magnus-contracts-") }; \
      fs.writeFileSync("package.json", JSON.stringify({ name: "magnus-agent-runtime", private: true, \
        dependencies: { "@hivemagnus/magnus-agent": find("hivemagnus-magnus-agent-"), ...local }, overrides: local }, null, 2)); ' \
  && npm install --omit=dev --no-audit --no-fund \
  && npm cache clean --force && rm -rf /tmp/packages \
  && install -d -m 0700 /var/lib/magnus-agent
RUN printf '%s\n' '[Unit]' 'Description=Magnus agent' 'After=network-online.target' '' '[Service]' \
      'EnvironmentFile=/etc/magnus-agent/agent.env' 'WorkingDirectory=/var/lib/magnus-agent' \
      'ExecStart=/usr/bin/node /opt/magnus-agent/node_modules/@hivemagnus/magnus-agent/dist/index.js start' \
      'Restart=on-failure' 'RestartSec=2' '' '[Install]' 'WantedBy=multi-user.target' > /etc/systemd/system/magnus-agent.service \
  && systemctl enable magnus-agent.service \
  && systemctl mask getty.target console-getty.service systemd-firstboot.service
STOPSIGNAL SIGRTMIN+3
ENTRYPOINT ["/bin/sh", "-c", "mount -o remount,rw /sys/fs/cgroup && exec /lib/systemd/systemd"]
