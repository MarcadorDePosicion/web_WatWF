const installButton = document.getElementById('open-install');
const installDialog = document.getElementById('install-dialog');

if (typeof installDialog.showModal === 'function') {
  installButton.hidden = false;
  installButton.addEventListener('click', () => installDialog.showModal());
}
