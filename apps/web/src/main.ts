import './site.css';
import { mountApp } from './app.ts';
import { DEV } from './env.ts';
import { finishSignIn, isSignInReturn } from './openrouter.ts';

if (isSignInReturn()) {
  // OpenRouter's sign-in came back to this window (the popup Ask AI opened): finish it there and close.
  document.body.innerHTML = '<p class="signin-return">Signing in to OpenRouter…</p>';
  const say = (t: string) => { document.querySelector('.signin-return')!.textContent = t; };
  finishSignIn().then(() => { say('Signed in. You can close this window.'); window.close(); }, (err) => say((err as Error).message));
} else {
  // Round trips with Word, PowerPoint and Google go through the clipboard: copy in
  // HexSketch and paste in the document; copy the picture there and paste here.
  const api = mountApp({ firstRunGuide: true, openLinks: true, aboutLinks: true });
  // The dev server exposes the app for scripted checks.
  if (DEV) (window as unknown as { hexsketch: typeof api }).hexsketch = api;

  // Ask AI: the chat (and the chemistry it brings) loads the first time it is opened.
  const ask = Object.assign(document.createElement('button'), { type: 'button', className: 'ask-ai', textContent: 'Ask AI', title: 'Chat with an AI about your structures' });
  ask.addEventListener('click', async () => {
    try { (await import('./chat.ts')).toggleChat(api); } catch (err) { api.flash(`The chat did not load: ${(err as Error).message}`); }
  });
  document.getElementById('menu')!.append(ask);
}
