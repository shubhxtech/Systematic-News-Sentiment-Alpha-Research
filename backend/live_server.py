import threading
from http.server import ThreadingHTTPServer

import state
from api import LiveAPIHandler
from data_manager import init_global_caches
from engine import simulation_worker


def start_server():
    try:
        init_global_caches()
    except Exception as e:  # a bad cache must not stop the API from starting
        print(f"⚠️  Price cache init failed: {e}")

    class ReusableHTTPServer(ThreadingHTTPServer):
        allow_reuse_address = True
        daemon_threads = True

    server = ReusableHTTPServer((state.HOST, state.PORT), LiveAPIHandler)
    print(f"🚀 Live Interface running on http://localhost:{state.PORT}")
    print("📊 Fundamental data loading in background (~60-90 sec)...")

    # The worker fetches fundamentals immediately and then every 6 hours.
    threading.Thread(target=simulation_worker, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == '__main__':
    start_server()
