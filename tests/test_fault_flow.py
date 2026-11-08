import subprocess
import sys
import time
import urllib.request
import json
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from test_e2e import _ws_handshake, _recv_ws_text

def test_full_pipeline_with_faults():
    launcher = HERE.parent / "src" / "simulator" / "run_host_sim.py"
    proc = subprocess.Popen([sys.executable, str(launcher), "--no-browser"])
    
    # Wait for HTTP server port with polling
    deadline = time.time() + 10
    connected = False
    while time.time() < deadline:
        try:
            with urllib.request.urlopen("http://127.0.0.1:9201/", timeout=1) as resp:
                if resp.status == 200:
                    connected = True
                    break
        except Exception:
            time.sleep(0.3)
    assert connected, "Failed to connect to HTTP server within 10s"

    try:
        # 1. Verify HTTP Dashboard is served
        with urllib.request.urlopen("http://127.0.0.1:9201/") as resp:
            assert resp.status == 200
            html = resp.read().decode("utf-8")
            assert "SafeDash" in html
            print("  [PASS] Web Dashboard served via HTTP (200 OK)")

        # 2. Test Fault Injection: ADAS Alert
        req_fault = urllib.request.Request(
            "http://127.0.0.1:9201/fault",
            data=json.dumps({"fault": "adas_alert"}).encode(),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req_fault) as resp:
            data = json.loads(resp.read().decode())
            assert data["status"] == "ok"
            assert data["fault"] == "adas_alert"
            print("  [PASS] Fault 'adas_alert' injected successfully (HTTP 200)")

        # 3. Test Fault Clear
        req_clear = urllib.request.Request(
            "http://127.0.0.1:9201/fault",
            data=json.dumps({"fault": "clear"}).encode(),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req_clear) as resp:
            data = json.loads(resp.read().decode())
            assert data["status"] == "ok"
            assert data["fault"] == "clear"
            print("  [PASS] Fault 'clear' executed successfully (HTTP 200)")

    finally:
        proc.terminate()
        proc.wait(timeout=3)

if __name__ == "__main__":
    test_full_pipeline_with_faults()
    print("\nFull end-to-end integration and fault injection test PASSED!\n")
