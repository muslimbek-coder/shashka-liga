const pageFiles = ['login', 'modes', 'game', 'profile', 'invitation'];

async function loadPages() {
  const pages = await Promise.all(pageFiles.map(async name => {
    const response = await fetch(`pages/${name}.html`);
    if (!response.ok) throw new Error(`Sahifa yuklanmadi: ${name} (${response.status})`);
    return [name, await response.text()];
  }));

  for (const [name, html] of pages) {
    const mount = document.querySelector(`[data-page="${name}"]`);
    if (!mount) throw new Error(`Sahifa joyi topilmadi: ${name}`);
    mount.innerHTML = html;
  }

  const app = document.createElement('script');
  app.src = 'app.js';
  app.onerror = () => showLoadError("Ilova JavaScript fayli yuklanmadi.");
  document.body.append(app);
}

function showLoadError(message) {
  const error = document.createElement('div');
  error.setAttribute('role', 'alert');
  error.textContent = message;
  error.style.cssText = 'margin:24px;padding:16px;border:1px solid #ff9a84;color:#ff9a84';
  document.body.prepend(error);
}

loadPages().catch(error => {
  console.error(error);
  showLoadError(error.message || "Sahifalarni yuklashda xatolik yuz berdi.");
});
