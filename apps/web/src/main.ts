import { mountApp } from './app.ts';
import { DEV } from './env.ts';

// Round trips with Word, PowerPoint and Google go through the clipboard: copy in
// HexSketch and paste in the document; copy the picture there and paste here.
const api = mountApp({ firstRunGuide: true, openLinks: true });
// The dev server exposes the app for scripted checks.
if (DEV) (window as unknown as { hexsketch: typeof api }).hexsketch = api;
