# Buena Obsidian Plugin

## One-time setup (per dev machine)

```bash
# 1. Install plugin deps
cd plugin && npm install && cd ..

# 2. Symlink plugin into the vault so Obsidian loads it
mkdir -p buena-vault/buena-hackathon/.obsidian/plugins
ln -sf "$(pwd)/plugin" buena-vault/buena-hackathon/.obsidian/plugins/buena

# 3. Install Obsidian hot-reload helper (auto-reloads on rebuild)
git clone https://github.com/pjeby/hot-reload.git \
  buena-vault/buena-hackathon/.obsidian/plugins/hot-reload

# 4. Open the vault in Obsidian:
#    File → Open Vault → buena-vault/buena-hackathon
#    Settings → Community plugins → enable "Buena Context Engine" + "Hot Reload"
```

## Daily dev loop

```bash
cd plugin
npm run dev   # esbuild watches main.ts, rebuilds main.js on save
```

The hot-reload plugin watches `main.js` and re-injects the plugin into Obsidian instantly. No manual reload, no app restart. Edit `main.ts` in Cursor/VS Code, save, switch to Obsidian → changes are live.

## Build for production

```bash
cd plugin && npm run build
```
