.PHONY: lint fmt check

# ── Lint (read-only) ──────────────────────────────────────────────────
lint:
	@echo "==> Linting TypeScript (biome)..."
	cd src/web-client && npx @biomejs/biome lint src/
	@echo "==> Linting Python (ruff)..."
	python3 -m ruff check src/
	@echo "==> Linting C++ (clang-format)..."
	clang-format --dry-run --Werror src/server/*.cpp src/server/*.h
	@echo "==> All linters passed."

# ── Format (writes files) ────────────────────────────────────────────
fmt:
	@echo "==> Formatting TypeScript (biome)..."
	cd src/web-client && npx @biomejs/biome format --write src/
	@echo "==> Formatting Python (ruff)..."
	python3 -m ruff format src/
	@echo "==> Formatting C++ (clang-format)..."
	clang-format -i src/server/*.cpp src/server/*.h
	@echo "==> All files formatted."

# ── Check (CI-friendly: lint + format-check, no writes) ──────────────
check:
	@echo "==> Checking TypeScript (biome)..."
	cd src/web-client && npx @biomejs/biome check src/
	@echo "==> Checking Python (ruff)..."
	python3 -m ruff check src/
	python3 -m ruff format --check src/
	@echo "==> Checking C++ (clang-format)..."
	clang-format --dry-run --Werror src/server/*.cpp src/server/*.h
	@echo "==> All checks passed."
