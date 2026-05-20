import { inject, onMounted, onUnmounted } from 'vue';
import { useUrlSearchParams } from '@vueuse/core';

export function useEventBus(handlers, loadDataStore) {
  const query = useUrlSearchParams();
  const { uid, datasetId, projectId, pipelineId, blackboxTaskId, pipelineEmbedded, manualNodeId } = query;

  const peerId = `volview-${projectId || datasetId || uid || window.btoa(encodeURIComponent(document.location.href))}`;
  const ports = Object.create(null);

  const emitter = inject('bus');
  const bus = { emitter };

  const onloading = handlers?.onloading;
  const onload = handlers?.onload;
  const onunload = handlers?.onunload;
  const onunselect = handlers?.onunselect;
  const onsetslice = handlers?.onsetslice;
  const onsetwindowlevel = handlers?.onsetwindowlevel;
  const onsetactiveview = handlers?.onsetactiveview;
  const onsetactiveviewtype = handlers?.onsetactiveviewtype;
  const onsetactiveviewmaximized = handlers?.onsetactiveviewmaximized;
  const oncaptureactiveview = handlers?.oncaptureactiveview;
  let onuserselectfiles;
  let onsavesession;
  let onsavesegmentation;
  let onactiveview;
  let onfrontendstate;
  let onactiveviewsnapshot;
  let onslicing;
  let onclose;

  onMounted(async () => {
    if (handlers) {
      window.$bus = bus;
    } else {
      return;
    }

    const isInsideIframe = window.parent !== window;

    if (onloading) {
      emitter.on('loading', onloading);
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
    if (onsetslice) {
      emitter.on('setslice', onsetslice);
    }
    if (onsetwindowlevel) {
      emitter.on('setwindowlevel', onsetwindowlevel);
    }
    if (onsetactiveview) {
      emitter.on('setactiveview', onsetactiveview);
    }
    if (onsetactiveviewtype) {
      emitter.on('setactiveviewtype', onsetactiveviewtype);
    }
    if (onsetactiveviewmaximized) {
      emitter.on('setactiveviewmaximized', onsetactiveviewmaximized);
    }
    if (oncaptureactiveview) {
      emitter.on('captureactiveview', oncaptureactiveview);
    }
    onuserselectfiles = files => {
      if (projectId && datasetId) {
        const port = ports[peerId.replace('volview-', 'tab-project-')];
        if (port) {
          port.postMessage({
            type: 'userselectfiles',
            payload: { files },
          });
        }
      } else if (isInsideIframe) {
        window.parent.postMessage({
          type: 'volview:userselectfiles',
          payload: { files },
        }, '*');
      }
    };
    onsavesession = payload => {
      if (projectId && datasetId) {
        const port = ports[peerId.replace('volview-', 'tab-project-')];
        if (port) {
          port.postMessage({
            type: 'save-session',
            payload,
          });
        }
      }
    };
    onsavesegmentation = payload => {
      if (pipelineId && manualNodeId) {
        const oid = payload.uid ?? uid;
        const labelmap = payload?.data?.path || payload?.data?.filePath;
        if (labelmap && oid) {
          const msg = {
            type: 'created-segmentation',
            payload: {
              pipelineId,
              manualNodeId,
              oid,
              labelmap,
            },
          };
          const port = ports[`comfyui-${pipelineId}`];
          if (port) {
            port.postMessage(msg);
          } else if (isInsideIframe || blackboxTaskId || pipelineEmbedded === 'embedded') {
            window.parent.postMessage(msg, '*');
          }
        }
      }
    };
    onactiveview = payload => {
      if (isInsideIframe) {
        window.parent.postMessage({
          type: 'volview:activeview',
          payload,
        }, '*');
      }
    };
    onfrontendstate = payload => {
      if (isInsideIframe) {
        window.parent.postMessage({
          type: 'volview:state',
          payload,
        }, '*');
      }
    };
    onactiveviewsnapshot = payload => {
      if (isInsideIframe) {
        window.parent.postMessage({
          type: 'volview:activeviewsnapshot',
          payload,
        }, '*');
      }
    };
    onslicing = payload => {
      if (projectId && datasetId) {
        const port = ports[peerId.replace('volview-', 'tab-project-')];
        if (port) {
          port.postMessage({
            type: 'slicing',
            payload,
          });
        }
      } else if (isInsideIframe) {
        window.parent.postMessage({
          type: 'volview:slicing',
          payload,
        }, '*');
      }
    };
    onclose = () => {
      if (projectId && datasetId) {
        const port = ports[peerId.replace('volview-', 'tab-project-')];
        if (port) {
          port.postMessage({
            type: 'close',
          });
        }
      } else if (isInsideIframe) {
        window.parent.postMessage({
          type: 'volview:close',
        }, '*');
      }
    };
    emitter.on('userselectfiles', onuserselectfiles);
    emitter.on('savesession', onsavesession);
    emitter.on('savesegmentation', onsavesegmentation);
    emitter.on('activeview', onactiveview);
    emitter.on('frontendstate', onfrontendstate);
    emitter.on('activeviewsnapshot', onactiveviewsnapshot);
    emitter.on('slicing', onslicing);
    emitter.on('close', onclose);

    if (loadDataStore) {
      loadDataStore.loadBus(bus.emitter);
      window.$loadDataStore = loadDataStore.$state;
    }

    if (isInsideIframe) {
      window.parent.postMessage('volview:LOAD', '*');
      window.addEventListener('message', (e) => {
        if (e.source !== window && e.data?.type) {
          if (e.data.type.startsWith('volview:')) {
            const type = e.data.type.slice('volview:'.length);
            if (type) {
              const payload = e.data.payload;
              switch (type) {
                case 'loading': {
                  window.$bus.emitter.emit(type, payload);
                  break;
                }
                case 'load': {
                  window.$bus.emitter.emit(type, payload);
                  break;
                }
                case 'unload': {
                  window.$bus.emitter.emit(type);
                  break;
                }
                case 'unselect': {
                  window.$bus.emitter.emit(type);
                  break;
                }
                case 'set-slice': {
                  window.$bus.emitter.emit('setslice', payload);
                  break;
                }
                case 'set-window-level': {
                  window.$bus.emitter.emit('setwindowlevel', payload);
                  break;
                }
                case 'set-active-view': {
                  window.$bus.emitter.emit('setactiveview', payload);
                  break;
                }
                case 'set-active-view-type': {
                  window.$bus.emitter.emit('setactiveviewtype', payload);
                  break;
                }
                case 'set-active-view-maximized': {
                  window.$bus.emitter.emit('setactiveviewmaximized', payload);
                  break;
                }
                case 'capture-active-view': {
                  window.$bus.emitter.emit('captureactiveview', payload);
                  break;
                }
                // ...
                default:
                  break;
              }
            }
          }
        }
      });
      if (loadDataStore) {
        loadDataStore.isInsideIframe = true;
      }
    } else {
      // window['__ports__'] = ports;
      window.addEventListener('message', (e) => {
        if (e.source === window && e.data?.type === 'response-message-port') {
          const { peer1, peer2 } = e.data.payload;
          if (peerId === peer1) {
            ports[peer2] = e.ports[0];
            const port = ports[peer2];
            port.onclose = () => {
              delete ports[peer2];
            };
            port.onmessage = (event) => {
              const { type, payload } = event.data;
              switch (type) {
                // ...
                default:
                  console.log(payload);
                  break;
              }
            };
          }
          if (peerId === peer2) {
            ports[peer1] = e.ports[0];
            const port = ports[peer1];
            port.onclose = () => {
              delete ports[peer1];
            };
            port.onmessage = (event) => {
              const { type, payload } = event.data;
              switch (type) {
                case 'loading': {
                  window.$bus.emitter.emit(type, payload);
                  break;
                }
                case 'load': {
                  window.$bus.emitter.emit(type, payload);
                  break;
                }
                case 'unload': {
                  window.$bus.emitter.emit(type);
                  break;
                }
                case 'unselect': {
                  window.$bus.emitter.emit(type);
                  break;
                }
                // ...
                default:
                  break;
              }
            };
          }
          if (loadDataStore) {
            loadDataStore.hasProjectPort = true;
          }
        }
      })
      while (!window.$electron) {
        await new Promise(r => setTimeout(r, 1000));
      }
      if (window.$electron && projectId) {
        window.$electron.requestMessagePort({
          peer1: peerId.replace('volview-', 'tab-project-'),
          peer2: peerId,
        });
      }
      console.log('[volview]', 'mounted!');
    }
  });

  onUnmounted(() => {
    if (!handlers) {
      return;
    }
    delete window.$bus;

    if (onloading) {
      emitter.off('loading', onloading);
    }
    if (onload) {
      emitter.off('load', onload);
    }
    if (onunload) {
      emitter.off('unload', onunload);
    }
    if (onunselect) {
      emitter.off('unselect', onunselect);
    }
    if (onsetslice) {
      emitter.off('setslice', onsetslice);
    }
    if (onsetwindowlevel) {
      emitter.off('setwindowlevel', onsetwindowlevel);
    }
    if (onsetactiveview) {
      emitter.off('setactiveview', onsetactiveview);
    }
    if (onsetactiveviewtype) {
      emitter.off('setactiveviewtype', onsetactiveviewtype);
    }
    if (onsetactiveviewmaximized) {
      emitter.off('setactiveviewmaximized', onsetactiveviewmaximized);
    }
    if (oncaptureactiveview) {
      emitter.off('captureactiveview', oncaptureactiveview);
    }
    if (onuserselectfiles) {
      emitter.off('userselectfiles', onuserselectfiles);
    }
    if (onsavesession) {
      emitter.off('savesession', onsavesession);
    }
    if (onsavesegmentation) {
      emitter.off('savesegmentation', onsavesegmentation);
    }
    if (onactiveview) {
      emitter.off('activeview', onactiveview);
    }
    if (onfrontendstate) {
      emitter.off('frontendstate', onfrontendstate);
    }
    if (onactiveviewsnapshot) {
      emitter.off('activeviewsnapshot', onactiveviewsnapshot);
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
