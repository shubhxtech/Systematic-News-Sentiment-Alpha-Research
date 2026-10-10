#!/usr/bin/env bash
# =============================================================
#  India Quant Screener — One-tap launcher
#  Usage:  ./start.sh
# =============================================================

set -e

# ── Colours ──────────────────────────────────────────────────
BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

BACKEND_PORT=8766
FRONTEND_PORT=5175
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
LOG_DIR="$SCRIPT_DIR/.logs"

mkdir -p "$LOG_DIR"

# ── Helpers ───────────────────────────────────────────────────
print_header() {
  echo ""
  echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}${CYAN}║      India Quant Screener  🚀                ║${RESET}"
  echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════╝${RESET}"
  echo ""
}

success() { echo -e "${GREEN}✔  $1${RESET}"; }
info()    { echo -e "${CYAN}➜  $1${RESET}"; }
warn()    { echo -e "${YELLOW}⚠  $1${RESET}"; }
error()   { echo -e "${RED}✖  $1${RESET}"; }

port_in_use() { lsof -ti :"$1" > /dev/null 2>&1; }

cleanup() {
  echo ""
  info "Shutting down..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  success "All processes stopped. Goodbye!"
}

# ── Trap Ctrl+C ───────────────────────────────────────────────
trap cleanup INT TERM

# ═════════════════════════════════════════════════════════════
print_header

# ── 1. Kill stale processes on those ports ────────────────────
for PORT in $BACKEND_PORT $FRONTEND_PORT; do
  if port_in_use "$PORT"; then
    warn "Port $PORT already in use — killing stale process..."
    lsof -ti :"$PORT" | xargs kill -9 2>/dev/null || true
    sleep 0.5
  fi
done

# ── 2. Python environment ─────────────────────────────────────
info "Detecting Python environment..."

if conda info --envs 2>/dev/null | grep -q "quant_env"; then
  PYTHON_CMD="conda run -n quant_env python"
  success "Using conda env: quant_env"
elif [ -f "$BACKEND_DIR/.venv/bin/python" ]; then
  PYTHON_CMD="$BACKEND_DIR/.venv/bin/python"
  success "Using venv: backend/.venv"
else
  PYTHON_CMD="python3"
  warn "No dedicated env found — using system python3"
fi

# ── 3. Start Python backend ───────────────────────────────────
info "Starting Python backend on port $BACKEND_PORT..."
cd "$BACKEND_DIR"
$PYTHON_CMD live_server.py > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

# Wait up to 60s for backend to be ready
WAITED=0
while ! port_in_use $BACKEND_PORT; do
  sleep 0.5
  WAITED=$((WAITED + 1))
  if [ $WAITED -ge 120 ]; then
    error "Backend failed to start within 60s!"
    echo ""
    echo -e "${RED}── Last 20 lines of backend.log: ──────────────────${RESET}"
    tail -20 "$LOG_DIR/backend.log"
    exit 1
  fi
done
success "Backend running  →  http://localhost:$BACKEND_PORT"

# ── 4. Install frontend deps if needed ────────────────────────
cd "$FRONTEND_DIR"
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ]; then
  info "Installing frontend dependencies (npm install)..."
  npm install --silent
  success "Dependencies installed"
fi

# ── 5. Start Vite frontend ────────────────────────────────────
info "Starting React frontend on port $FRONTEND_PORT..."
npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

# Wait up to 15s for frontend
WAITED=0
while ! port_in_use $FRONTEND_PORT; do
  sleep 0.5
  WAITED=$((WAITED + 1))
  if [ $WAITED -ge 30 ]; then
    error "Frontend failed to start within 15s!"
    echo ""
    echo -e "${RED}── Last 20 lines of frontend.log: ─────────────────${RESET}"
    tail -20 "$LOG_DIR/frontend.log"
    kill "$BACKEND_PID" 2>/dev/null
    exit 1
  fi
done
success "Frontend running  →  http://localhost:$FRONTEND_PORT"

# ── 6. Open browser ───────────────────────────────────────────
sleep 0.3
open "http://localhost:$FRONTEND_PORT" 2>/dev/null || true

# ── 7. Summary ────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}══ All systems go! ════════════════════════════════${RESET}"
echo -e "  🌐  App       →  ${BOLD}http://localhost:$FRONTEND_PORT${RESET}"
echo -e "  🐍  Backend   →  ${BOLD}http://localhost:$BACKEND_PORT${RESET}"
echo -e "  📄  Logs      →  ${BOLD}.logs/backend.log${RESET}  &  ${BOLD}.logs/frontend.log${RESET}"
echo ""
echo -e "${YELLOW}  Press Ctrl+C to stop everything${RESET}"
echo ""

# ── 8. Stream backend logs so terminal stays alive ────────────
tail -f "$LOG_DIR/backend.log" &
TAIL_PID=$!

# Wait for child processes
wait "$BACKEND_PID" "$FRONTEND_PID"
kill "$TAIL_PID" 2>/dev/null || true
