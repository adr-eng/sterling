// Sign-in page extras: show/hide password and copy-to-clipboard. Served to
// signed-out visitors (auth/gate.mjs lets /brand/ through), and optional: the
// buttons stay hidden until this runs, so the forms work without it.
document.querySelectorAll('[data-reveal]').forEach((btn) => {
  const input = document.getElementById(btn.dataset.reveal);
  if (!input) return;
  btn.hidden = false;
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    input.focus();
  });
});

document.querySelectorAll('[data-copy]').forEach((btn) => {
  const input = document.getElementById(btn.dataset.copy);
  if (!input || !navigator.clipboard) return;
  btn.hidden = false;
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(input.value);
      btn.textContent = 'Copied';
    } catch {
      input.select();
      btn.textContent = 'Press Ctrl/⌘+C';
    }
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });
});
