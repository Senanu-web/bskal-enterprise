# Deploy to GitHub and Render - BSK@L Enterprise

Write-Host "===== BSK@L Enterprise Deployment Script =====" -ForegroundColor Cyan

# Step 1: Clean Git staging area
Write-Host "`n[Step 1] Cleaning Git staging area..." -ForegroundColor Yellow
git reset HEAD .
git clean -fd

# Step 2: Commit .gitignore first
Write-Host "`n[Step 2] Committing .gitignore..." -ForegroundColor Yellow
git add .gitignore
git commit -m "Add .gitignore to exclude node_modules"

# Step 3: Stage essential files
Write-Host "`n[Step 3] Staging source files (excluding node_modules)..." -ForegroundColor Yellow
git add README.md
git add DEPLOYMENT.md
git add render.yaml
git add "frontend\*.html"
git add "frontend\assets\*"
git add "frontend\js\*"
git add "backend\package.json"
git add "backend\index.js"
git add "backend\db.js"
git add "backend\data-demo.js"
git add "backend\.env.example"

# Step 4: Commit
Write-Host "`n[Step 4] Creating commit..." -ForegroundColor Yellow
git commit -m "Professional e-commerce site with categories, cart, orders, mobile money, receipts"

# Step 5: Instructions for GitHub
Write-Host "`n[Step 5] Ready to push to GitHub!" -ForegroundColor Green
Write-Host "Run these commands to create GitHub repo and push:" -ForegroundColor White
Write-Host ""
Write-Host "gh repo create bskal-enterprise --public --source=. --remote=origin --push" -ForegroundColor Cyan
Write-Host ""
Write-Host "OR manually:" -ForegroundColor White
Write-Host "1. Create repo on GitHub.com" -ForegroundColor White
Write-Host "2. git remote add origin https://github.com/YOUR_USERNAME/bskal-enterprise.git" -ForegroundColor Cyan
Write-Host "3. git push -u origin main" -ForegroundColor Cyan
Write-Host ""
Write-Host "Then deploy on Render:" -ForegroundColor Yellow
Write-Host "https://dashboard.render.com/select-repo" -ForegroundColor Cyan
