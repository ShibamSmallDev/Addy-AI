import subprocess
import sys

try:
    # Try to import playwright to see if it's installed
    import playwright
    print("playwright is already installed.")
    
    # Also check if driver is installed/ready
    try:
        result = subprocess.run([sys.executable, "-m", "playwright", "--version"], capture_output=True, text=True)
        if result.returncode == 0:
            print(f"Playwright CLI version: {result.stdout.strip()}")
        else:
            print("Playwright is installed but CLI check failed.")
    except Exception as e:
        print(f"Error checking Playwright CLI: {e}")

except ImportError:
    print("playwright is NOT installed.")
