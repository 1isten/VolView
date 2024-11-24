import { inject, onMounted, onUnmounted } from 'vue';

async function handleVolViewEvents() {
  async function handleVolViewEvent(event) {
    if (!event.data?.type) {
      console.log('[port1]:', event.data);
      return;
    }

    const { type, payload } = event.data;
    console.log(type, payload);

    if (type === 'load') {
      window.$bus.emitter.emit(type, payload);
    }
    if (type === 'unload') {
      window.$bus.emitter.emit(type);
    }
    if (type === 'unselect') {
      window.$bus.emitter.emit(type);
    }
  }

  window.addEventListener('message', e => {
    if (e.source === window && e.data === 'project-volview-port') {
      const [port2] = e.ports;
      port2.onmessage = handleVolViewEvent;
      port2.postMessage('PONG');
      window._port2 = port2;
    }
  });

  // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
  while (!window.$electron) await new Promise(r => setTimeout(r, 100));
  if (window.$electron) {
    window.$electron.requestProjectVolviewPorts();
  }
}

export function useEventBus(handlers) {
  const emitter = inject('bus');
  const bus = { emitter };

  const onload = handlers?.onload;
  const onunload = handlers?.onunload;
  const onunselect = handlers?.onunselect;
  let onslicing;
  let onclose;

  onMounted(async () => {
    if (!handlers) {
      return;
    }
    handleVolViewEvents();
    window.$bus = bus;

    if (onload) {
      emitter.on('load', onload);
    }
    if (onunload) {
      emitter.on('unload', onunload);
    }
    if (onunselect) {
      emitter.on('unselect', onunselect);
    }
    onslicing = payload => {
      const port2 = window._port2;
      if (port2) {
        port2.postMessage({ type: 'slicing', payload });
      }
    };
    onclose = () => {
      const port2 = window._port2;
      if (port2) {
        port2.postMessage({ type: 'close' });
      }
    };
    emitter.on('slicing', onslicing);
    emitter.on('close', onclose);
  });

  onUnmounted(() => {
    if (!handlers) {
      return;
    }
    delete window._port2;
    delete window.$bus;

    if (onload) {
      emitter.off('load', onload);
    }
    if (onunload) {
      emitter.off('unload', onunload);
    }
    if (onunselect) {
      emitter.off('unselect', onunselect);
    }
    if (onslicing) {
      emitter.off('slicing', onslicing);
    }
    if (onclose) {
      emitter.off('close', onclose);
    }
  });

  return bus;
}
