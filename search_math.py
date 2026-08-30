import os
import glob

print("Current working directory:", os.getcwd())
print("Files in current directory:", os.listdir('.'))

# Let's search for anything with "math" in the name in the current directory and parent directories
for root, dirs, files in os.walk('.'):
    for file in files:
        if 'math' in file.lower():
            print("Found math file in workspace:", os.path.join(root, file))
