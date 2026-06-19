// src/lib/toast.js
// A tiny global toast system. Call toast.success('Saved!') from anywhere.
// A single <Toaster/> mounted in App listens for these events and renders them.

const EVENT = 'app-toast';

function emit(type, message) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { type, message, id: Date.now() + Math.random() } }));
}

const toast = {
  success: (message) => emit('success', message),
  error: (message) => emit('error', message),
  info: (message) => emit('info', message),
  EVENT,
};

export default toast;
