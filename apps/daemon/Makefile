.PHONY: all build build-web build-local local test clean run dev resolve-port db-reset

BIN_DIR := bin
BIN_NAME := zenf
BINARY := $(BIN_DIR)/$(BIN_NAME)
CUR_DIR := $(shell pwd)
WEB_DIR := $(CUR_DIR)/../web
GATEWAY_WEB_DIST := $(CUR_DIR)/internal/gateway/web_dist
AIR_BIN := $(shell which air 2>/dev/null || echo "$$(go env GOPATH)/bin/air")

# Allow passing PORT=... or p=... (e.g. make dev p=8080 or make dev PORT=8080)
PORT ?= $(if $(p),$(p),1123)
DB_PATH ?= ~/.zenforge/state.db

# Helper shell snippet to find the first free TCP port starting from $(PORT) (port + 1 fallback)
FIND_FREE_PORT = \
	TARGET_PORT="$(PORT)"; \
	while ss -ltn 2>/dev/null | awk '{print $$4}' | grep -qE "[:.]$$TARGET_PORT$$"; do \
		TARGET_PORT=$$((TARGET_PORT + 1)); \
	done; \
	echo "$$TARGET_PORT"

all: test build

resolve-port:
	@$(FIND_FREE_PORT)

build-web:
	@if [ -d "$(WEB_DIR)" ]; then \
		set -e; \
		echo "Building web dashboard in $(WEB_DIR)..."; \
		(cd $(WEB_DIR) && pnpm build); \
		mkdir -p $(GATEWAY_WEB_DIST); \
		find $(GATEWAY_WEB_DIST) -mindepth 1 ! -name '.keep' -delete; \
		cp -r $(WEB_DIR)/dist/* $(GATEWAY_WEB_DIST)/; \
		touch $(GATEWAY_WEB_DIST)/.keep; \
		echo "Copied web bundle to $(GATEWAY_WEB_DIST)"; \
	fi

build: build-web
	@mkdir -p $(BIN_DIR)
	CGO_ENABLED=0 go build -ldflags="-s -w" -o $(BINARY) ./cmd/zenf

build-local local: build-web
	@mkdir -p $(BIN_DIR)
	@LOCAL_TIME=$$(date +"%H:%M"); \
	BASE_VER=$$(grep 'var Version =' internal/version/version.go | cut -d '"' -f2); \
	LOCAL_VER="$$BASE_VER.local.$$LOCAL_TIME"; \
	echo "Building zenf with local tag: $$LOCAL_VER..."; \
	CGO_ENABLED=0 go build -ldflags="-s -w -X 'zenf/internal/version.Version=$$LOCAL_VER' -X 'main.Version=$$LOCAL_VER'" -o $(BINARY) ./cmd/zenf; \
	TARGET_BIN=$$(which zenf 2>/dev/null || echo "$$HOME/.local/bin/zenf"); \
	echo "Installing zenf to $$TARGET_BIN..."; \
	mkdir -p $$(dirname "$$TARGET_BIN"); \
	cp $(BINARY) "$$TARGET_BIN.new" && mv "$$TARGET_BIN.new" "$$TARGET_BIN"; \
	chmod +x "$$TARGET_BIN"; \
	echo "✔ Successfully installed $$TARGET_BIN ($$($$TARGET_BIN -v))"; \
	if pgrep -f "zenf daemon start" > /dev/null 2>&1; then \
		echo "Restarting background zenf daemon..."; \
		"$$TARGET_BIN" daemon start -f -d; \
		echo "✔ Daemon restarted successfully."; \
	fi

db-reset:
	@DB="$(subst ~,$(HOME),$(DB_PATH))"; \
	BIN="$$(which zenf 2>/dev/null || echo $(HOME)/.local/bin/zenf)"; \
	if pgrep -f "zenf daemon start" >/dev/null 2>&1 && [ -x "$$BIN" ]; then \
		echo "Stopping zenf daemon..."; "$$BIN" daemon stop || true; \
	fi; \
	rm -f "$$DB" "$$DB-wal" "$$DB-shm" "$$DB.old" "$$DB.old-wal" "$$DB.old-shm" "$$DB.pre-migration.bak"; \
	echo "✔ Removed local database state at $$DB"

test:
	go vet ./...
	go test -v -race -count=1 ./...

clean:
	rm -rf $(BIN_DIR) tmp

dev:
	@TARGET_PORT=$$($(FIND_FREE_PORT)); \
	if [ "$$TARGET_PORT" != "$(PORT)" ]; then \
		echo "⚠ Port $(PORT) is in use -> auto-incrementing to port :$$TARGET_PORT"; \
	else \
		echo "✔ Port $$TARGET_PORT is available."; \
	fi; \
	if [ -x "$(AIR_BIN)" ]; then \
		echo "Starting zenf with air live-reload on http://127.0.0.1:$$TARGET_PORT ..."; \
		$(AIR_BIN) -c .air.toml -- daemon start --port "$$TARGET_PORT" --db "$(DB_PATH)"; \
	else \
		echo "air not found, running with go run on http://127.0.0.1:$$TARGET_PORT ..."; \
		go run ./cmd/zenf daemon start --port "$$TARGET_PORT" --db "$(DB_PATH)"; \
	fi

run:
	@TARGET_PORT=$$($(FIND_FREE_PORT)); \
	go run ./cmd/zenf daemon start --port "$$TARGET_PORT" --db $(DB_PATH)
