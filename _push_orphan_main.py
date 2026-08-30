import subprocess

# 1. Create clean orphan branch
subprocess.run(["git", "checkout", "--orphan", "clean-main"], check=True)

# 2. Stage all current project files (secrets.json and opencode_exports are in .gitignore)
subprocess.run(["git", "add", "-A"], check=True)

# 3. Create fresh clean commit
subprocess.run(["git", "commit", "-m", "feat: Addy AI - Full System Release (Browser Automation, Desktop Agent, Memory Core, YouTube & GitHub Integration)"], check=True)

# 4. Rename clean-main to main
subprocess.run(["git", "branch", "-M", "clean-main", "main"], check=True)

# 5. Get token and push
res = subprocess.run([r"C:\Program Files\GitHub CLI\gh.exe", "auth", "token"], capture_output=True, text=True)
token = res.stdout.strip()
auth_url = f"https://x-access-token:{token}@github.com/ShibamSmallDev/Addy-AI.git"

print("Pushing clean main branch to GitHub...")
p = subprocess.run(["git", "push", "--force", "-u", auth_url, "main"], capture_output=True, text=True, timeout=90)
print("STDOUT:", p.stdout)
print("STDERR:", p.stderr)
if p.returncode == 0:
    print("SUCCESS: CLEAN MAIN BRANCH PUSHED TO GITHUB!")
