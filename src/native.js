// Ponte nativa: o esbuild empacota isto em www/native.js durante a compilação.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import { Clipboard } from '@capacitor/clipboard';

window.Nativo = {
  isNative: Capacitor.isNativePlatform(),
  Capacitor, LocalNotifications, Preferences, Share, Clipboard
};
