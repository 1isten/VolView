import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { computed, effectScope, nextTick, ref, type EffectScope } from 'vue';
import vtkCamera from '@kitware/vtk.js/Rendering/Core/Camera';
import { useViewCameraStore } from '@/src/store/view-configs/camera';

// The camera store pulls in the view store, whose module-level config builds
// canvas colors that happy-dom does not support. The camera tests do not need
// any layout configuration.
vi.mock('@/src/config', () => ({
  DefaultNamedLayouts: { 'Axial Only': [['axial']] },
  getAvailableViews: () => ({ list: [], byName: {} }),
}));
import { usePersistCameraConfig } from '@/src/composables/usePersistCameraConfig';

// vtkFieldRef bubbles camera changes through a `setTimeout(0)` batch.
const flushNextTask = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const CAM_VIEW = 'view-1';
const CAM_DATA = 'data-1';

function setCamera(
  camera: vtkCamera,
  {
    position,
    focalPoint,
    viewUp,
    parallelScale,
  }: {
    position: [number, number, number];
    focalPoint: [number, number, number];
    viewUp: [number, number, number];
    parallelScale: number;
  }
) {
  camera.setPosition(...position);
  camera.setFocalPoint(...focalPoint);
  camera.setViewUp(...viewUp);
  camera.setParallelScale(parallelScale);
}

describe('usePersistCameraConfig', () => {
  let scope: EffectScope;

  beforeEach(() => {
    setActivePinia(createPinia());
    scope = effectScope();
  });

  afterEach(() => {
    scope.stop();
  });

  it('does not persist the default camera before the view is initialized', async () => {
    const camera = vtkCamera.newInstance();
    const initialized = ref(false);

    scope.run(() =>
      usePersistCameraConfig(CAM_VIEW, CAM_DATA, camera, {
        enabled: computed(() => initialized.value),
      })
    );
    await flushNextTask();

    expect(useViewCameraStore().getConfig(CAM_VIEW, CAM_DATA)).toBeUndefined();
  });

  it('seeds the config from the fitted camera on the first enabled tick', async () => {
    const camera = vtkCamera.newInstance();
    const initialized = ref(false);

    scope.run(() =>
      usePersistCameraConfig(CAM_VIEW, CAM_DATA, camera, {
        enabled: computed(() => initialized.value),
      })
    );

    // The camera fit a view performs before marking itself initialized.
    setCamera(camera, {
      position: [1, 2, 3],
      focalPoint: [1, 2, 4],
      viewUp: [0, -1, 0],
      parallelScale: 42,
    });
    initialized.value = true;
    await nextTick();
    await flushNextTask();

    expect(useViewCameraStore().getConfig(CAM_VIEW, CAM_DATA)).toMatchObject({
      position: [1, 2, 3],
      focalPoint: [1, 2, 4],
      viewUp: [0, -1, 0],
      parallelScale: 42,
    });
  });

  it('restores the saved camera on a remount instead of the default camera', async () => {
    const store = useViewCameraStore();
    store.updateConfig(CAM_VIEW, CAM_DATA, {
      position: [5, 6, -100],
      focalPoint: [5, 6, 7],
      viewUp: [0, -1, 0],
      parallelScale: 120,
      directionOfProjection: [0, 0, 1],
    });

    const remountedCamera = vtkCamera.newInstance();
    scope.run(() =>
      usePersistCameraConfig(CAM_VIEW, CAM_DATA, remountedCamera, {
        enabled: computed(() => true),
      })
    );

    expect(remountedCamera.getPosition()).toEqual([5, 6, -100]);
    expect(remountedCamera.getFocalPoint()).toEqual([5, 6, 7]);
    expect(remountedCamera.getViewUp()).toEqual([0, -1, 0]);
    expect(remountedCamera.getParallelScale()).toBe(120);
  });

  it('tracks camera changes in the config once enabled', async () => {
    const camera = vtkCamera.newInstance();
    scope.run(() =>
      usePersistCameraConfig(CAM_VIEW, CAM_DATA, camera, {
        enabled: computed(() => true),
      })
    );
    await nextTick();

    setCamera(camera, {
      position: [9, 9, 9],
      focalPoint: [8, 8, 8],
      viewUp: [0, 0, 1],
      parallelScale: 7,
    });
    await flushNextTask();
    await nextTick();

    expect(useViewCameraStore().getConfig(CAM_VIEW, CAM_DATA)).toMatchObject({
      position: [9, 9, 9],
      focalPoint: [8, 8, 8],
      viewUp: [0, 0, 1],
      parallelScale: 7,
    });
  });
});
