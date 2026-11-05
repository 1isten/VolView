import { MaybeRef, Ref, computed, unref, watch } from 'vue';
import { Maybe } from '@/src/types';
import useViewCameraStore from '@/src/store/view-configs/camera';
import vtkCamera from '@kitware/vtk.js/Rendering/Core/Camera';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import { syncRef } from '@vueuse/core';
import { guardedWritableRef } from '@/src/utils/guardedWritableRef';
import type { CameraConfig } from '@/src/store/view-configs/types';

// PMT-ONLY: optional gate so a view never persists the placeholder camera it
// starts with. In pmt a layout change can remount a slice view (e.g. the
// `changeLayout=auto` maximize after a load); with the upstream behavior the
// default camera was written to the config before the view fitted the image,
// and the remounted view restored it, rendering the slice black until the user
// clicked "Reset Camera".
//
// On a merge conflict: keep upstream's structure (vtkFieldRef + configRefs +
// syncRef) and re-apply the two PMT edits below:
//   1. the `enabled` gate + fresh camera read in the configRefs setter;
//   2. the `watch(enabled, ...)` snapshot at the end.
export type PersistCameraConfigOptions = {
  enabled?: MaybeRef<boolean>;
};

export function usePersistCameraConfig(
  viewID: MaybeRef<string>,
  dataID: MaybeRef<Maybe<string>>,
  camera: MaybeRef<vtkCamera>,
  options: PersistCameraConfigOptions = {}
) {
  const viewCameraStore = useViewCameraStore();

  // PMT-ONLY: see the comment above.
  const enabled = computed(() =>
    options.enabled === undefined ? true : !!unref(options.enabled)
  );

  const keys = [
    'position',
    'focalPoint',
    'viewUp',
    'parallelScale',
    'directionOfProjection',
  ] as const;
  type KeyType = (typeof keys)[number];

  // PMT-ONLY: read the camera directly instead of through the (batched)
  // vtkFieldRefs, which can still hold the pre-fit camera right after a
  // programmatic fit.
  function readCameraField(key: KeyType) {
    const cam = unref(camera);
    if (!cam) return undefined;

    const value = {
      position: () => cam.getPosition(),
      focalPoint: () => cam.getFocalPoint(),
      viewUp: () => cam.getViewUp(),
      parallelScale: () => cam.getParallelScale(),
      directionOfProjection: () => cam.getDirectionOfProjection(),
    }[key]();

    if (ArrayBuffer.isView(value)) {
      return Array.from(value as unknown as ArrayLike<number>);
    }
    return Array.isArray(value) ? [...value] : value;
  }

  const cameraRefs = keys.reduce(
    (refs, key) => ({
      ...refs,
      [key]: guardedWritableRef(
        vtkFieldRef(camera, key),
        (incoming) => !!incoming
      ),
    }),
    {} as Record<KeyType, Ref<any>>
  );

  const config = computed(() =>
    viewCameraStore.getConfig(unref(viewID), unref(dataID))
  );

  const configRefs = keys.reduce(
    (refs, key) => ({
      ...refs,
      [key]: computed({
        get: () => config.value?.[key],
        // PMT-ONLY: ignore the value coming from the vtk ref; read the camera
        // itself so the saved config never keeps the pre-fit camera.
        set: () => {
          if (!enabled.value) return;
          const viewIDVal = unref(viewID);
          const dataIDVal = unref(dataID);
          if (!viewIDVal || !dataIDVal) return;
          viewCameraStore.updateConfig(viewIDVal, dataIDVal, {
            [key]: readCameraField(key),
          });
          if (viewCameraStore.isSync()) {
            viewCameraStore.updateSyncConfigs();
          }
        },
      }),
    }),
    {} as Record<KeyType, Ref<any>>
  );

  keys.forEach((key) => {
    syncRef(configRefs[key], cameraRefs[key]);
  });

  // PMT-ONLY: once the view has fitted its camera for this image, capture a
  // full snapshot synchronously. Waiting for the batched vtk refs can race a
  // layout remount, which would then find no saved camera and show black.
  watch(
    enabled,
    (isEnabled) => {
      if (!isEnabled || config.value) return;
      const viewIDVal = unref(viewID);
      const dataIDVal = unref(dataID);
      if (!viewIDVal || !dataIDVal) return;

      const patch = keys.reduce(
        (acc, key) => {
          const value = readCameraField(key);
          if (value !== undefined && value !== null) acc[key] = value;
          return acc;
        },
        {} as Record<string, unknown>
      );

      viewCameraStore.updateConfig(
        viewIDVal,
        dataIDVal,
        patch as Partial<CameraConfig>
      );
      if (viewCameraStore.isSync()) {
        viewCameraStore.updateSyncConfigs();
      }
    },
    { immediate: true, flush: 'post' }
  );
}
