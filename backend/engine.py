import time

from data_manager import fetch_fundamental_cache


def simulation_worker():
    """Background worker: refresh the fundamental cache now, then every 6 hours."""
    while True:
        try:
            fetch_fundamental_cache()
        except Exception as e:
            print(f"Screener background worker exception: {e}")
            time.sleep(60)
            continue
        time.sleep(6 * 3600)
