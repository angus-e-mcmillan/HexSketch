/**
 * File > Send Feedback: a short message, and an email address if the person
 * would like a reply. It goes to the HexSketch server (POST /api/feedback,
 * stored for the developer to read). Drawings are never included.
 */

export function openFeedback(): Promise<void> {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'doc-settings feedback';
    dlg.innerHTML = `
      <form method="dialog">
        <h2>Send Feedback</h2>
        <p class="fb-intro">What should we fix, change or add? Bugs, ideas and annoyances are all welcome.</p>
        <textarea name="message" rows="7" maxlength="5000" required placeholder="For example: pasting into PowerPoint makes the structure too small…"></textarea>
        <label class="fb-email"><span>Email (optional, if you'd like a reply)</span><input name="email" type="email" maxlength="200" autocomplete="email"></label>
        <input name="website" class="fb-trap" tabindex="-1" autocomplete="off" aria-hidden="true">
        <p class="fb-note">Your drawing is not sent, only what you type here and your browser's name.</p>
        <p class="fb-status" role="status"></p>
        <div class="ds-buttons"><button type="button" class="ds-cancel">Cancel</button><button class="ds-ok" type="submit">Send</button></div>
      </form>`;
    const f = dlg.querySelector('form')!;
    const message = f.elements.namedItem('message') as HTMLTextAreaElement;
    const email = f.elements.namedItem('email') as HTMLInputElement;
    const trap = f.elements.namedItem('website') as HTMLInputElement;
    const status = dlg.querySelector<HTMLElement>('.fb-status')!;
    const send = dlg.querySelector<HTMLButtonElement>('.ds-ok')!;
    const close = () => { dlg.close(); dlg.remove(); resolve(); };
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!message.value.trim()) { message.focus(); return; }
      send.disabled = true;
      status.textContent = 'Sending…';
      status.className = 'fb-status';
      try {
        const r = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: message.value, email: email.value, website: trap.value, context: navigator.userAgent }),
        });
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `error ${r.status}`);
        dlg.querySelector('form')!.innerHTML = `<h2>Thank you!</h2><p class="fb-intro">Your feedback has been sent. It helps make HexSketch better.</p>
          <div class="ds-buttons"><button type="button" class="ds-ok">Close</button></div>`;
        dlg.querySelector('.ds-ok')!.addEventListener('click', close);
        (dlg.querySelector('.ds-ok') as HTMLButtonElement).focus();
      } catch (err) {
        status.textContent = `Couldn't send: ${(err as Error).message}. Please try again.`;
        status.className = 'fb-status fb-error';
        send.disabled = false;
      }
    });
    dlg.querySelector('.ds-cancel')!.addEventListener('click', close);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dlg.addEventListener('keydown', (e) => e.stopPropagation()); // typing here is not drawing hotkeys
    document.body.append(dlg);
    dlg.showModal();
    message.focus();
  });
}
