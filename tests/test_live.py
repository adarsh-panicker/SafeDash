import subprocess
import sys
import time
import socket
import json
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from test_e2e import _ws_handshake, _recv_ws_text

def run():
    launcher = HERE.parent / "src" / "simulator" / "run_host_sim.py"
    proc = subprocess.Popen([sys.executable, str(launcher), "--no-browser"])
    
    # Wait for WebSocket port with polling
    deadline = time.time() + 10
    connected = False
    s = None
    while time.time() < deadline:
        try:
            s = socket.create_connection(("127.0.0.1", 8080), timeout=1)
            if _ws_handshake(s, "127.0.0.1", 8080):
                connected = True
                break
            s.close()
        except Exception:
            time.sleep(0.3)
    assert connected and s is not None, "Failed to connect to WebSocket server within 10s"

    try:
        
        for i in range(5):
            txt = _recv_ws_text(s, timeout=3)
            p = json.loads(txt)
            speed = p.get("speed_kmh")
            rpm = p.get("rpm")
            gear = p.get("gear")
            soc = p.get("soc_pct")
            print(f"  [FRAME {i+1}] Speed: {speed:>5.1f} km/h | RPM: {rpm:>4d} | Gear: {gear} | SOC: {soc:>4.1f}% | Frames: {p.get('frame_count')}")
            assert speed is not None and speed > 0, "Invalid speed"
            assert rpm is not None and rpm > 0, "Invalid RPM"
            assert soc is not None and soc > 0, "Invalid SOC"
        s.close()
        print("\nAll live frames streamed with valid automotive telemetry!")
    finally:
        proc.terminate()
        proc.wait(timeout=3)

if __name__ == "__main__":
    run()
