group "default" {
  targets = ["api", "worker"]
}

target "_common" {
  context    = "."
  dockerfile = "Dockerfile"
  args = {
    NODE_VERSION = "24.13.0"
    PNPM_VERSION = "11.1.1"
  }
}

target "api" {
  inherits = ["_common"]
  target   = "api"
  args = {
    GENERATE_MCP_DOCS = "true"
  }
  tags = ["core-be:latest"]
}

target "worker" {
  inherits = ["_common"]
  target   = "worker"
  args = {
    GENERATE_MCP_DOCS = "false"
  }
  tags = ["core-be-worker:latest"]
}
