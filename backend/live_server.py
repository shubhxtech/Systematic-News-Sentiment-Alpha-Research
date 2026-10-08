import threading
from http.server import ThreadingHTTPServer
import state
from data_manager import init_global_caches, fetch_fundamental_cache
from engine import simulation_worker
from api import LiveAPIHandler

def start_server():
    init_global_caches()

    # Fetch fundamental data in background — does not block server startup
    fund_thread = threading.Thread(target=fetch_fundamental_cache, daemon=True)
    fund_thread.start()

    class ReusableHTTPServer(ThreadingHTTPServer):
        allow_reuse_address = True
        daemon_threads = True

    server = ReusableHTTPServer((state.HOST, state.PORT), LiveAPIHandler)
    print(f"🚀 Live Interface running on http://localhost:{state.PORT}")
    print(f"📊 Fundamental data loading in background (~60-90 sec)...")
    
    worker = threading.Thread(target=simulation_worker, daemon=True)
    worker.start()
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()

if __name__ == '__main__':
    start_server()
