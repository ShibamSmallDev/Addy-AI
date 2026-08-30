import os

print("Current Directory:", os.getcwd())
try:
    print("Contents of current directory:")
    for item in os.listdir('.'):
        print(f"  {item}")
except Exception as e:
    print("Error:", e)
