import os
import threading
from pathlib import Path

HOST = os.environ.get("LIVE_HOST", "127.0.0.1")
PORT = int(os.environ.get("LIVE_PORT", "8766"))
STATIC_DIR = Path(__file__).parent

state_lock = threading.RLock()

UPSTOX_TOKEN = os.environ.get("UPSTOX_TOKEN", "")
if not UPSTOX_TOKEN:
    try:
        with open(STATIC_DIR / ".upstox_token", "r") as f:
            UPSTOX_TOKEN = f.read().strip()
    except:
        pass

APP_STATE = {
    "status": "ONLINE",
    "fundamental_min_score": 45,
    "yfinance_cache": None,
    "fundamental_cache": {},
    "factor_scores": None
}
