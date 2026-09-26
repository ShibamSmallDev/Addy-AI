"""
Addy AI — Browser Profile Cloning Utility.
"""
import os
import shutil
import sys
import subprocess
from pathlib import Path

def is_edge_running():
    out = subprocess.run(["tasklist", "/fi", "imagename eq msedge.exe"], capture_output=True, text=True)
    return "msedge.exe" in out.stdout.lower()

def clone_edge():
    if is_edge_running():
        return False, "Microsoft Edge is currently running. Please close Edge for 5 seconds and try again."
    
    local = Path(os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local")))
    src_root = local / "Microsoft" / "Edge" / "User Data"
    src_profile = src_root / "Default"
    dest_root = local / "AddyAI" / "browser_profile"
    dest_profile = dest_root / "Default"

    if not src_profile.exists():
        return False, f"Edge profile not found at {src_profile}"

    dest_root.mkdir(parents=True, exist_ok=True)
    dest_profile.mkdir(parents=True, exist_ok=True)

    # 1. Master encryption key
    src_local_state = src_root / "Local State"
    if src_local_state.exists():
        shutil.copy2(src_local_state, dest_root / "Local State")

    # 2. Key files
    for kf in ["Preferences", "Secure Preferences", "Login Data", "Login Data For Account", "Web Data", "Favicons", "History"]:
        src_f = src_profile / kf
        if src_f.exists():
            shutil.copy2(src_f, dest_profile / kf)

    # 3. Cookies
    src_net = src_profile / "Network"
    dest_net = dest_profile / "Network"
    if src_net.exists():
        dest_net.mkdir(parents=True, exist_ok=True)
        for net_f in ["Cookies", "Cookies-journal", "Network Persistent State"]:
            sf = src_net / net_f
            if sf.exists():
                shutil.copy2(sf, dest_net / net_f)

    # 4. Storage
    for sdir in ["Local Storage", "Session Storage", "IndexedDB"]:
        sd = src_profile / sdir
        dd = dest_profile / sdir
        if sd.exists():
            if dd.exists():
                shutil.rmtree(dd, ignore_errors=True)
            shutil.copytree(sd, dd, ignore_dangling_symlinks=True)

    return True, "Profile cloned successfully."

if __name__ == "__main__":
    ok, msg = clone_edge()
    print(msg)
