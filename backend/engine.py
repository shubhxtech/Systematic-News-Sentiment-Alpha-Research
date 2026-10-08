import time
import state
from data_manager import fetch_fundamental_cache

def simulation_worker():
    """
    Screener background worker.
    Periodically refreshes the fundamental cache from network.
    """
    while True:
        try:
            # Refresh every 6 hours
            fetch_fundamental_cache()
            time.sleep(6 * 3600)
        except Exception as e:
            print(f"Screener background worker exception: {e}")
            time.sleep(60)
