# Local chaos Toxiproxy image.
#
# Built from the official Shopify Toxiproxy release binary instead of pulling
# ghcr.io/shopify/toxiproxy directly, because that image's blob CDN
# (pkg-containers.githubusercontent.com) is unreachable from some restricted
# dev/CI networks (HTTP 403), while github.com release assets are reachable.
# CI provisions Toxiproxy via a GitHub Actions service container, so this image
# is only used by the local `chaos` compose profile (`pnpm chaos:up`).
#
# The version is pinned to match the ghcr tag used by the CI chaos workflow.
FROM alpine:3.20
ARG TOXIPROXY_VERSION=2.12.0
# TARGETARCH is provided automatically by BuildKit (e.g. amd64, arm64) and matches the
# Toxiproxy release asset suffix, so the image builds natively on both Intel and ARM hosts.
ARG TARGETARCH
ADD --chmod=755 \
  https://github.com/Shopify/toxiproxy/releases/download/v${TOXIPROXY_VERSION}/toxiproxy-server-linux-${TARGETARCH} \
  /usr/local/bin/toxiproxy-server
# Run as a non-root user (Trivy AVD-DS-0002). The proxy binds only high ports (8474 admin API,
# plus the dynamically-created listener ports >1024), so root is unnecessary.
RUN addgroup -S toxiproxy && adduser -S -G toxiproxy toxiproxy
USER toxiproxy
EXPOSE 8474
# Bind the REST API to all interfaces so the published 8474 port is reachable from the host.
ENTRYPOINT ["/usr/local/bin/toxiproxy-server", "-host", "0.0.0.0"]
