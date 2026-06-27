# mac n phone

Control your Mac from your phone: touchpad, 1080p screen stream, and a real terminal.
Two channels — tiny JSON commands over WebSocket (low latency), H.264 video over HTTP (hardware-encoded).

## Layout
- `daemon/` — Node service on the Mac (cursor/keyboard via robotjs, ffmpeg stream, PTY shell)
- `phone-app/` — Expo (React Native) app: Touchpad / Stream / Terminal tabs

## Mac setup
1. Grant permissions (silent failures without these):
   - System Settings → Privacy & Security → **Accessibility** → add your terminal
   - System Settings → Privacy & Security → **Screen Recording** → add your terminal
2. Find your screen capture index:
   ```
   ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep -i 'screen\|capture'
   ```
3. Run the daemon:
   ```
   cd daemon
   npm install
   REMOTE_SECRET=pick-a-secret AVF_SCREEN_INDEX=1 npm start
   ```
   - Command channel: `ws://<mac-ip>:3001?token=<secret>`
   - Video: `http://<mac-ip>:3002`  (test directly: `ffplay http://localhost:3002`)

## Phone setup
```
cd phone-app
npm install
npm start        # scan QR with Expo Go (same Wi-Fi)
```
Enter the Mac's LAN IP and the same secret, tap Connect.

## Remote access (off home Wi-Fi)
Cloudflare Tunnel both ports, then use the host in the app:
```
brew install cloudflared
cloudflared tunnel --url http://localhost:3001
```

## Not built yet
- Chrome control via CDP (needs Chrome launched with `--remote-debugging-port`)
- launchd auto-start (plist in the roadmap)
- xterm.js terminal for interactive TUIs (current view shows raw escape codes)
