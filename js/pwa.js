const workerUrl = new URL('../sw.js', import.meta.url);
let showingSavedPlan = false;

export function setSavedPlanState(saved) {
  showingSavedPlan = saved;
  showStatus();
}

function showStatus() {
  const status = document.getElementById('pwa-status');
  if (!status) return;
  const controlled = navigator.serviceWorker?.controller?.scriptURL === workerUrl.href;
  const message = !navigator.onLine ? 'Tryb offline · zapisany plan'
    : showingSavedPlan ? 'Wyświetlasz zapisany plan' : 'Plan dostępny offline';
  status.hidden = !controlled;
  if (controlled && status.textContent !== message) status.textContent = message;
}

export async function registerOffline() {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;

  const workers = navigator.serviceWorker;
  workers.addEventListener('controllerchange', showStatus);
  window.addEventListener('online', showStatus);
  window.addEventListener('offline', showStatus);
  showStatus();

  try {
    await workers.register(workerUrl);
  } catch (error) {
    console.warn('Nie udało się przygotować planu do odczytu offline:', error);
  }
}
