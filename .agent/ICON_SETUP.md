# App Icon Setup Guide (v9.0)

The new icon is a brushed gold microphone with voice waves on an obsidian gradient — matches the MeetingGhost aesthetic and represents audio transcription.

## Web (automatic)
✅ Already set up in `index.html` and `manifest.json`
- SVG favicon: `public/icon.svg` (scales to any size)
- PNG icons: `public/icon-192.png`, `public/icon-512.png` (generate via `scripts/generate-pngs.html`)
- Tested on: browser tabs, PWA homescreen, bookmarks

## iOS (manual setup)
1. Open `ios/App/App.xcodeproj` in Xcode
2. Select the **App** target → **General** → **App Icons and Launch Screen**
3. Under **App Icons**, drag-drop the PNG files to the size slots:
   - 192×192 → "iPhone Notification" (20pt, 40pt, 60pt slots)
   - 512×512 → "iPhone App" (120pt, 180pt slots)
   - Also fill iOS 20+ "Settings" slot with 192×192
4. Verify the icons appear in Xcode's asset catalog (should have a gold microphone on dark background)
5. Build and test on iPhone simulator

**Alternative:** Export PNG from browser (`scripts/generate-pngs.html`), import into Xcode Assets, assign to App Icons.

## Android (manual setup)
1. Generate PNG files (192×192, 512×512) from `scripts/generate-pngs.html`
2. Place in `android/app/src/main/res/`:
   ```
   android/app/src/main/res/
   ├── drawable-mdpi/ic_launcher.png (192×192)
   ├── drawable-hdpi/ic_launcher.png (192×192)
   ├── drawable-xhdpi/ic_launcher.png (192×192)
   ├── drawable-xxhdpi/ic_launcher.png (512×512)
   └── drawable-xxxhdpi/ic_launcher.png (512×512)
   ```
3. Verify `android/app/src/main/AndroidManifest.xml` references `@drawable/ic_launcher` for the app icon
4. Clean and rebuild: `./gradlew assembleDebug`
5. Test on Android emulator

## Generating PNG files
1. Open `scripts/generate-pngs.html` in a browser (or use the preview)
2. Download the generated PNG files
3. Place them in `public/` for web, or follow platform-specific paths above for iOS/Android

## Icon Design
- **Colors:** Brushed gold gradient (#d4af37 → #b8931f) on obsidian gradient (#0a0a0a → #1a1515)
- **Style:** Microphone capsule + voice waves (3 concentric circles) + subtle ghost outline
- **Purpose:** Represents voice recording, transcription, and the "Ghost" in MeetingGhost
- **Scales:** Looks good from 16×16 (favicon) to 1024×1024 (hi-res displays)

## Checklist
- [x] SVG source: `public/icon.svg`
- [x] Web manifest: `public/manifest.json` (updated with icon references)
- [x] Web HTML: `index.html` (favicon + apple-touch-icon meta tags)
- [ ] PNG generation: Use `scripts/generate-pngs.html` to download 192×192 and 512×512
- [ ] iOS setup: Import PNGs into Xcode asset catalog
- [ ] Android setup: Place PNGs in correct `drawable-*` folders
- [ ] Test on actual devices (or simulators)
