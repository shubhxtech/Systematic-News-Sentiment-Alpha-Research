#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run.sh  —  India NLP Quant Terminal  ·  Quick-start script
#
# Usage:
#   ./run.sh          → starts both backend + frontend (default)
#   ./run.sh backend  → backend only  (http://localhost:8766)
#   ./run.sh frontend → frontend only (http://localhost:5173)
#   ./run.sh backtest → run CLI backtest (main.py) and exit
#
# Requirements:
#   • conda env  : quant_env  (Python 3.10+)
#   • Node.js    : ≥ 18.x
# ─────────────────────────────────────────────────────────────────────────────

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-all}"

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'

banner() {
  echo ""
  echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
  echo -e "${CYAN}${BOLD}║    India NLP Quant Terminal  ·  IIT Mandi 2025   ║${RESET}"
  echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
  echo ""
}

# ── Helpers ───────────────────────────────────────────────────────────────────
check_python() {
  if ! conda run -n quant_env python --version &>/dev/null; then
    echo -e "${RED}✗ Conda environment 'quant_env' not found.${RESET}"
    echo -e "  Create it with:  ${YELLOW}conda create -n quant_env python=3.10 -y${RESET}"
    echo -e "  Then install:    ${YELLOW}conda run -n quant_env pip install -r requirements.txt${RESET}"
    exit 1
  fi
  echo -e "${GREEN}✓ conda env 'quant_env' found${RESET}"
}

check_node() {
  if ! command -v node &>/dev/null; then
    echo -e "${RED}✗ Node.js not found. Install from https://nodejs.org${RESET}"
    exit 1
  fi
  echo -e "${GREEN}✓ Node.js $(node --version) found${RESET}"
}

install_frontend_deps() {
  if [ ! -d "$PROJECT_DIR/frontend/node_modules" ]; then
    echo -e "${YELLOW}→ Installing frontend npm dependencies...${RESET}"
    cd "$PROJECT_DIR/frontend" && npm install
  fi
}

kill_ports() {
  for port in 8766 5173; do
    lsof -ti :"$port" | xargs kill -9 2>/dev/null || true
  done
}

# ── Modes ─────────────────────────────────────────────────────────────────────
start_backend() {
  echo -e "${CYAN}→ Starting backend on http://localhost:8766 ...${RESET}"
  cd "$PROJECT_DIR"
  conda run -n quant_env python live_server.py
}

start_frontend() {
  echo -e "${CYAN}→ Starting frontend on http://localhost:5173 ...${RESET}"
  install_frontend_deps
  cd "$PROJECT_DIR/frontend" && npm run dev
}

run_backtest() {
  echo -e "${CYAN}→ Running CLI backtest (main.py) ...${RESET}"
  cd "$PROJECT_DIR"
  conda run -n quant_env python main.py
}

# ── Main ──────────────────────────────────────────────────────────────────────
banner

case "$MODE" in
  backend)
    check_python
    start_backend
    ;;

  frontend)
    check_node
    start_frontend
    ;;

  backtest)
    check_python
    run_backtest
    ;;

  all|"")
    check_python
    check_node
    echo ""
    echo -e "${YELLOW}Starting both services. Press Ctrl+C to stop both.${RESET}"
    echo -e "  Backend  → ${BOLD}http://localhost:8766${RESET}"
    echo -e "  Frontend → ${BOLD}http://localhost:5173${RESET}"
    echo ""

    # Kill anything already on those ports
    kill_ports

    # Start backend in background
    cd "$PROJECT_DIR"
    conda run -n quant_env python live_server.py &
    BACKEND_PID=$!

    # Give backend 4s to initialise before frontend tries to connect
    sleep 4

    # Start frontend in background
    install_frontend_deps
    cd "$PROJECT_DIR/frontend" && npm run dev &
    FRONTEND_PID=$!

    # Trap Ctrl+C — cleanly kill both
    trap "echo ''; echo 'Shutting down...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM

    echo -e "${GREEN}✓ Both services running. Open http://localhost:5173 in your browser.${RESET}"
    wait
    ;;

  *)
    echo -e "${RED}Unknown mode: $MODE${RESET}"
    echo "Usage: ./run.sh [all|backend|frontend|backtest]"
    exit 1
    ;;
esac
