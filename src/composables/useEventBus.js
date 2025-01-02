import { inject, ref, watch, onMounted, onUnmounted } from 'vue';
import { useUrlSearchParams, useWebSocket } from '@vueuse/core';

export function useEventBus(handlers, loadDataStore) {
  const query = useUrlSearchParams('history');
  const { datasetId, projectId, uid } = query;
  const _wsId = `volview-${projectId || datasetId || uid || document.location.href}`;
  const _ws = ref();
  const ws = useWebSocket(_ws, { heartbeat: true });
  watch(ws.data, async (data) => {
    let message = typeof data === 'string' ? data : await data.text();
    if (message.startsWith('{')) message = JSON.parse(message);
    if (message?.type === 'open') {
      return ws.send(JSON.stringify({
        type: 'map',
        payload: { peerUid: _wsId },
        from: message.to,
        to: message.from,
      }));
    }
    if (message?.to === _wsId) {
      const { type, payload } = message;
      if (type === 'load') {
        return window.$bus.emitter.emit(type, payload);
      }
      if (type === 'unload') {
        return window.$bus.emitter.emit(type);
      }
      if (type === 'unselect') {
        return window.$bus.emitter.emit(type);
      }
    }
    // console.log('[ws] message', message);
    return _wsId;
  });

  const emitter = inject('bus');
  const bus = { emitter, ws: ws.ws };

  const onload = handlers?.onload;
  const onunload = handlers?.onunload;
  const onunselect = handlers?.onunselect;
  let onslicing;
  let onclose;

  onMounted(async () => {
    if (handlers) {
      window.$bus = bus;
      if (window.parent === window) {
        _ws.value = localStorage.getItem('_ws') || undefined;
      }
    } else {
      return;
    }

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
      ws.send(JSON.stringify({ type: 'slicing', payload, from: _wsId, to: _wsId.replace('volview-', 'tab-project-') }));
    };
    onclose = () => {
      ws.send(JSON.stringify({ type: 'close', from: _wsId, to: _wsId.replace('volview-', 'tab-project-') }));
    };
    emitter.on('slicing', onslicing);
    emitter.on('close', onclose);

    if (loadDataStore) {
      window.$loadDataStore = loadDataStore.$state;
    }

    if (window.parent !== window) {
      window.addEventListener('message', e => {
        if (!_ws.value && `${e.data}`.endsWith('/_ws')) {
          _ws.value = e.data;
        }
      });
      window.parent.postMessage('volview:LOAD', '*');
    } else {
      console.log('[volview]', 'mounted!');
    }
  });

  onUnmounted(() => {
    if (!handlers) {
      return;
    }
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
