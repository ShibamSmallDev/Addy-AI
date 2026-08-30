/* ===========================================================================
 * Addy — Electron preload
 * ---------------------------------------------------------------------------
 * Runs in an isolated context and exposes a minimal, explicit API surface to
 * the renderer via contextBridge. In Phase 1 this only advertises that the UI
 * is running inside the desktop shell (so the web UI can adapt if it wants);
 * tray/notification/window controls are added alongside those features.
 * ========================================================================= */

'use strict';

const { contextBridge, desktopCapturer } = require('electron');

contextBridge.exposeInMainWorld('Addy', {
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron,

  // Returns a MediaStream of the primary screen without a permission prompt.
  // Uses Electron's desktopCapturer, so this only works in the desktop app —
  // the renderer falls back to getDisplayMedia() when window.Addy.isDesktop is false.
  getScreenStream: async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
    });

    const primarySource = sources.find(s =>
      s.name === 'Entire Screen' || s.name === 'Screen 1' || s.name.toLowerCase().includes('screen')
    ) || sources[0];

    if (!primarySource) throw new Error('No screen source found');

    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: primarySource.id,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080,
          maxFrameRate: 5,
        },
      },
    });
  },
});
