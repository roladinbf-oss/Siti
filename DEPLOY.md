# Deploy to Railway

## Quick redeploy
```bash
railway redeploy --yes
```

## Check status
```bash
railway status
```

## View live logs
```bash
railway logs
```

## One-time CLI setup (if not done)
```bash
# Install CLI (Apple Silicon Mac)
curl -fsSL "https://github.com/railwayapp/cli/releases/latest/download/railway-v4.47.0-aarch64-apple-darwin.tar.gz" \
  | tar -xz -C "$HOME/.local/bin/"

# Authenticate (requires Account Token from railway.com/account/tokens)
export RAILWAY_TOKEN="<your-account-token>"
echo "export RAILWAY_TOKEN=\"<your-account-token>\"" >> ~/.zshrc

# Link to Siti project
railway link   # choose "Siti" → "siti-eran" → "production"
```

## Token management
Token is stored in `~/.zshrc` as `RAILWAY_TOKEN`.

To rotate:
1. Generate new token at https://railway.com/account/tokens
2. Edit `~/.zshrc` and replace the value
3. `source ~/.zshrc`

## Manual deploy via dashboard
1. Go to railway.com → Siti project → siti-eran service
2. Deployments tab → "Redeploy" button

## What happens on deploy
- Railway builds the Docker image from this repo
- `db/migrate.js` runs all pending SQL migrations on boot
- Service restarts with new code
- SW cache version in `sw.js` controls browser cache eviction
