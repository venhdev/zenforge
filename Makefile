.PHONY: all test test-web test-daemon test-all build build-web build-daemon local build-local clean dev dev-all dev-daemon dev-web daemon web

# Allow passing PORT=... or p=... (e.g. make dev p=8080 or make dev daemon p=8080)
CUSTOM_PORT := $(if $(p),$(p),$(PORT))
DAEMON_PORT ?= $(if $(CUSTOM_PORT),$(CUSTOM_PORT),1123)
WEB_PORT ?= 5173

# Helper shell snippet to find the first free TCP port starting from $(DAEMON_PORT) (port + 1 fallback)
FIND_FREE_PORT = \
	TARGET_PORT="$(DAEMON_PORT)"; \
	while ss -ltn 2>/dev/null | awk '{print $$4}' | grep -qE "[:.]$$TARGET_PORT$$"; do \
		TARGET_PORT=$$((TARGET_PORT + 1)); \
	done; \
	echo "$$TARGET_PORT"

# Handle `make dev daemon` and `make dev web` positional arguments
DEV_SUBTARGETS := $(filter daemon web,$(MAKECMDGOALS))
ifneq ($(DEV_SUBTARGETS),)
.PHONY: $(DEV_SUBTARGETS)
$(DEV_SUBTARGETS):
	@:
endif

all: test build

# ==============================================================================
# 1. TEST: 1 lệnh duy nhất kiểm thử toàn diện toàn bộ repo (web + daemon)
# ==============================================================================
test: test-web test-daemon
	@echo ""
	@echo "✔ All tests passed successfully (apps/web + apps/daemon)."

test-web:
	@if [ -d "apps/web" ]; then \
		echo "==> Running frontend tests (apps/web)..."; \
		(cd apps/web && pnpm test); \
	fi

test-daemon:
	@echo "==> Running backend tests (apps/daemon)..."; \
	$(MAKE) -C apps/daemon test

test-all: test

# ==============================================================================
# 2. LOCAL: 1 lệnh duy nhất build web bundle -> embed Go binary -> install -> restart
# ==============================================================================
local build-local:
	@$(MAKE) -C apps/daemon local

build: build-daemon

build-daemon:
	@$(MAKE) -C apps/daemon build

build-web:
	@$(MAKE) -C apps/daemon build-web

# ==============================================================================
# 3. DEV WORKFLOW:
#    - `make dev`              : Chạy đồng thời cả Daemon (auto port+1 từ 1123) + Web HMR
#    - `make dev daemon`       : Chỉ chạy Daemon (auto port+1 từ PORT/1123)
#    - `make dev web`          : Chỉ chạy Web Vite HMR (auto port+1 từ WEB_PORT/5173)
#    - Hỗ trợ truyền `p=<port>` hoặc `PORT=<port>`
# ==============================================================================
ifeq ($(DEV_SUBTARGETS),daemon)
DEV_DEPS := dev-daemon
else ifeq ($(DEV_SUBTARGETS),web)
DEV_DEPS := dev-web
else
DEV_DEPS := dev-all
endif

dev: $(DEV_DEPS)

dev-all:
	@FREE_DAEMON_PORT=$$($(FIND_FREE_PORT)); \
	if [ "$$FREE_DAEMON_PORT" != "$(DAEMON_PORT)" ]; then \
		echo "⚠ Daemon port $(DAEMON_PORT) is in use -> auto-incremented to :$$FREE_DAEMON_PORT"; \
	fi; \
	echo "==> Starting Unified Dev Environment (Daemon :$$FREE_DAEMON_PORT + Web Vite HMR)..."; \
	trap 'kill 0' INT TERM EXIT; \
	(cd apps/daemon && make --no-print-directory dev PORT="$$FREE_DAEMON_PORT") & \
	(cd apps/web && PORT="$$FREE_DAEMON_PORT" pnpm dev --port $(WEB_PORT)) & \
	wait

dev-daemon:
	@$(MAKE) --no-print-directory -C apps/daemon dev PORT=$(DAEMON_PORT)

dev-web:
	@WEB_START_PORT=$(if $(CUSTOM_PORT),$(CUSTOM_PORT),$(WEB_PORT)); \
	PROXY_PORT=$(if $(API_PORT),$(API_PORT),1123); \
	echo "==> Starting Frontend Vite HMR (starting from port :$$WEB_START_PORT, proxying API to :$$PROXY_PORT)..."; \
	(cd apps/web && PORT="$$PROXY_PORT" pnpm dev --port "$$WEB_START_PORT")

# ==============================================================================
# 4. CLEAN & UTILITIES: Dọn sạch toàn bộ artifact, cache và log rác
# ==============================================================================
clean:
	@echo "==> Cleaning build artifacts and cache..."; \
	$(MAKE) -C apps/daemon clean; \
	rm -rf apps/web/dist /tmp/zenf_*.log; \
	find apps/daemon/internal/gateway/web_dist -mindepth 1 ! -name '.keep' -delete; \
	echo "✔ Workspace cleaned."
