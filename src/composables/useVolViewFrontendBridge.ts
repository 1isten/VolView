import { type Ref, computed, watch } from 'vue';
import { NAME_TO_TAG, TAG_TO_NAME } from '@/src/core/dicomTags';
import { getWindowLevels } from '@/src/store/datasets-dicom';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useLoadDataStore } from '@/src/store/load-data';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { useViewStore } from '@/src/store/views';
import { indexPointToWorld } from '@/src/utils/imageSpace';
import {
  computeEllipseMeasurements,
  computePolygonMeasurements,
  computeRectangleMeasurements,
} from '@/src/utils/roiStats';
import type { Vector3 } from '@kitware/vtk.js/types';
import { vec3 } from 'gl-matrix';

type BridgeEmitter = {
  emit: (event: string, payload?: any) => void;
};

type BridgeOptions = {
  currentImageID: Readonly<Ref<string | null | undefined>>;
  currentImageMetadata: Readonly<Ref<any>>;
  isImageLoading: Readonly<Ref<boolean>>;
  vtkRenderWindowParent: Ref<any>;
};

type RoiPoint = [number, number] | { x?: number; y?: number };

type RoiSamplePayload = {
  requestId?: string;
  roi?: any;
  type?: string;
  shape?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  cx?: number;
  cy?: number;
  centerX?: number;
  centerY?: number;
  radius?: number;
  radiusX?: number;
  radiusY?: number;
  rx?: number;
  ry?: number;
  diameter?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  points?: RoiPoint[];
  includePixels?: boolean;
  bins?: number;
  pixelWidth?: number;
  pixelHeight?: number;
  maxSamples?: number;
  viewID?: string;
  dataID?: string;
  component?: number;
};

export function useVolViewFrontendBridge(options: BridgeOptions) {
  const {
    currentImageID,
    currentImageMetadata,
    isImageLoading,
    vtkRenderWindowParent,
  } = options;

  const imageCacheStore = useImageCacheStore();
  const loadDataStore = useLoadDataStore();
  const viewStore = useViewStore();
  const viewSliceStore = useViewSliceStore();
  const windowingStore = useWindowingStore();
  const activeView = computed(() => viewStore.activeView);
  let emitter: BridgeEmitter | null = null;
  let started = false;

  const handlers = {
    onsetslice(payload: { slice?: number; delta?: number; instanceDelta?: number; dicomTag?: string; tag?: string; value?: string | number; match?: 'equals' | 'contains'; direction?: 'first' | 'last' | 'forward' | 'backward' | 'nearest'; viewID?: string; dataID?: string }) {
      setActiveSlice(payload);
    },
    onsetwindowlevel(payload: { width?: number; level?: number; widthDelta?: number; levelDelta?: number; widthScale?: number; reset?: boolean; applyDicom?: boolean; viewID?: string; dataID?: string }) {
      setWindowLevel(payload);
    },
    onsetactiveview(payload: { viewID?: string; name?: string; orientation?: string; type?: '2D' | '3D'; maximized?: boolean; maximize?: boolean }) {
      setActiveView(payload);
    },
    onsetactiveviewtype(payload: { viewID?: string; name?: string; orientation?: string; type?: '2D' | '3D' }) {
      setActiveViewType(payload);
    },
    onsetactiveviewmaximized(payload: { viewID?: string; maximized?: boolean }) {
      setActiveViewMaximized(payload);
    },
    oncaptureactiveview(payload: { requestId?: string; includeImage?: boolean; includeHistogram?: boolean; includePixels?: boolean; maxWidth?: number; maxHeight?: number; bins?: number; pixelWidth?: number; pixelHeight?: number }) {
      void captureActiveView(payload);
    },
    onsamplecurrentsliceroi(payload: RoiSamplePayload) {
      sampleCurrentSliceRoi(payload);
    },
  };

  function start(nextEmitter: BridgeEmitter) {
    if (started) return;
    started = true;
    emitter = nextEmitter;

    watch([activeView, currentImageID], ([activeViewID, primarySelection]) => {
      if (activeViewID && primarySelection) {
        const viewID = activeViewID;
        const dataID = primarySelection;
        const sliceConfig = viewSliceStore.getConfig(viewID, dataID);
        if (sliceConfig) {
          // trigger currentSliceMetadata update for DicomTagBrowser
          viewSliceStore.updateConfig(viewID, dataID, { ...sliceConfig });
        }
        const view = viewStore.getView(viewID);
        if (view?.dataID) {
          emitter?.emit('activeview', jsonClone(view));
        }
      }
    }, { immediate: true });

    watch(currentImageID, (primarySelection) => {
      if (!primarySelection) {
        viewStore.setLayoutFromGrid([1, 1]);
      }
    }, {
      immediate: true,
      once: true,
    });

    watch([
      activeView,
      currentImageID,
      currentImageMetadata,
      activeSliceConfig,
      activeWindowConfig,
      activeLayoutState,
      () => isImageLoading.value,
      () => loadDataStore.currentSliceMetadata,
    ], ([activeViewID, primarySelection]) => {
      emitFrontendState(activeViewID, primarySelection);
    }, {
      deep: true,
      immediate: true,
    });
  }

  function getActiveViewData(payload: { viewID?: string; dataID?: string } = {}) {
    const viewID = payload.viewID || activeView.value;
    const dataID = payload.dataID || (viewID ? viewStore.getView(viewID)?.dataID : currentImageID.value);
    return { viewID, dataID };
  }

  function normalizeText(value: any) {
    return String(value || '').trim().toLowerCase();
  }

  function findView(payload: { viewID?: string; name?: string; orientation?: string; type?: '2D' | '3D' } = {}) {
    const views = (viewStore.visibleViews.length ? viewStore.visibleViews : viewStore.getAllViews()).filter(Boolean);
    if (payload.viewID) {
      return viewStore.getView(payload.viewID);
    }
    const name = normalizeText(payload.name);
    const orientation = normalizeText(payload.orientation);
    const type = normalizeText(payload.type);
    return views.find((view: any) => {
      if (name && normalizeText(view.name) === name) return true;
      if (orientation && normalizeText(view.options?.orientation) === orientation) return true;
      if (type && normalizeText(view.type) === type) return true;
      if (type === '3d' && view.type === '3D') return true;
      return false;
    }) || null;
  }

  function setActiveView(payload: { viewID?: string; name?: string; orientation?: string; type?: '2D' | '3D'; maximized?: boolean; maximize?: boolean } = {}) {
    const view = findView(payload);
    if (!view?.id) {
      console.warn('[volview] set-active-view ignored: no matching view', payload);
      return;
    }
    viewStore.setActiveView(view.id);
    if (payload.maximize || typeof payload.maximized === 'boolean') {
      const shouldMaximize = payload.maximize ? true : !!payload.maximized;
      if (viewStore.isActiveViewMaximized !== shouldMaximize) {
        viewStore.toggleActiveViewMaximized();
      }
    }
  }

  function findViewType(payload: { name?: string; orientation?: string; type?: '2D' | '3D' } = {}) {
    const name = normalizeText(payload.name);
    const orientation = normalizeText(payload.orientation || payload.name);
    const type = normalizeText(payload.type || payload.name);
    return viewStore.availableViewsForSwitcher.find((viewInfo: any) => {
      if (name && normalizeText(viewInfo.name) === name) return true;
      if (orientation && normalizeText(viewInfo.options?.orientation) === orientation) return true;
      if (type && normalizeText(viewInfo.type) === type) return true;
      if ((name === '3d' || type === '3d') && viewInfo.type === '3D') return true;
      if (name === 'volume' && viewInfo.type === '3D') return true;
      return false;
    }) || null;
  }

  function setActiveViewType(payload: { viewID?: string; name?: string; orientation?: string; type?: '2D' | '3D' } = {}) {
    const targetViewID = payload.viewID || activeView.value;
    const existingView = targetViewID ? viewStore.getView(targetViewID) : null;
    if (!targetViewID || !existingView) {
      console.warn('[volview] set-active-view-type ignored: no active view', payload);
      return;
    }
    const selectedView = findViewType(payload);
    if (!selectedView) {
      console.warn('[volview] set-active-view-type ignored: no matching view type', payload);
      return;
    }
    const newViewID = viewStore.replaceView(targetViewID, {
      ...selectedView,
      dataID: existingView.dataID,
    });
    viewStore.setActiveView(newViewID);
  }

  function setActiveViewMaximized(payload: { viewID?: string; maximized?: boolean } = {}) {
    const targetViewID = payload.viewID || activeView.value;
    if (!targetViewID || !viewStore.getView(targetViewID)) {
      console.warn('[volview] set-active-view-maximized ignored: no active view', payload);
      return;
    }
    if (viewStore.activeView !== targetViewID) {
      viewStore.setActiveView(targetViewID);
    }
    if (typeof payload.maximized === 'boolean') {
      if (viewStore.isActiveViewMaximized !== payload.maximized) {
        viewStore.toggleActiveViewMaximized();
      }
      return;
    }
    viewStore.toggleActiveViewMaximized();
  }

  function getVisibleViewIDs() {
    return viewStore.visibleViews
      .map((viewInfo: any) => viewInfo?.id)
      .filter((id: any) => !!id);
  }

  function getPlaneAxisIndex(view: any, metadata: any) {
    const orientation = view?.options?.orientation || view?.name || 'Axial';
    const mapped = metadata?.lpsOrientation?.[orientation];
    if (Number.isFinite(mapped)) {
      return Number(mapped);
    }
    if (orientation === 'Sagittal') return 0;
    if (orientation === 'Coronal') return 1;
    return 2;
  }

  function getSliceHistogram(viewID: string | null | undefined, dataID: string | null | undefined, bins = 64) {
    const view = viewID ? viewStore.getView(viewID) : null;
    if (!viewID || !dataID || !view || view.type === '3D') {
      return null;
    }
    const image = imageCacheStore.imageById[dataID];
    const imageData = image?.getVtkImageData?.();
    const scalars = imageData?.getPointData?.().getScalars?.();
    const values = scalars?.getData?.();
    if (!imageData || !scalars || !values?.length) {
      return null;
    }

    const dimensions = imageData.getDimensions?.() || [];
    const metadata = image.getImageMetadata?.();
    const axisIndex = getPlaneAxisIndex(view, metadata);
    const sliceConfig = viewSliceStore.getConfig(viewID, dataID);
    const slice = Math.max(0, Math.min(dimensions[axisIndex] - 1, Math.round(sliceConfig?.slice ?? 0)));
    const components = scalars.getNumberOfComponents?.() || 1;
    const scalarType = scalars.getDataType?.() || values.constructor?.name || 'unknown';
    const width = dimensions[(axisIndex + 1) % 3] || 0;
    const height = dimensions[(axisIndex + 2) % 3] || 0;
    const totalPixels = Math.max(0, width * height);
    const maxSamples = 262144;
    const stride = Math.max(1, Math.ceil(totalPixels / maxSamples));
    const sampleValues: number[] = [];

    function scalarAt(a: number, b: number) {
      const ijk = [0, 0, 0];
      ijk[axisIndex] = slice;
      ijk[(axisIndex + 1) % 3] = a;
      ijk[(axisIndex + 2) % 3] = b;
      return Number(values[((ijk[2] * dimensions[1] + ijk[1]) * dimensions[0] + ijk[0]) * components]);
    }

    for (let index = 0; index < totalPixels; index += stride) {
      const a = index % width;
      const b = Math.floor(index / width);
      const value = scalarAt(a, b);
      if (Number.isFinite(value)) {
        sampleValues.push(value);
      }
    }
    if (!sampleValues.length) {
      return null;
    }

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const value of sampleValues) {
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
    }
    const mean = sum / sampleValues.length;
    const variance = sampleValues.reduce((acc, value) => acc + ((value - mean) ** 2), 0) / sampleValues.length;
    const binCount = Math.max(2, Math.min(256, Math.round(bins || 64)));
    const counts = Array.from({ length: binCount }, () => 0);
    const span = max - min || 1;
    for (const value of sampleValues) {
      const bin = Math.min(binCount - 1, Math.max(0, Math.floor(((value - min) / span) * binCount)));
      counts[bin] += 1;
    }

    return {
      source: 'vtkImageData.scalars',
      dataID,
      viewID,
      viewName: view.name,
      orientation: (view.options as any)?.orientation ?? null,
      dimensions: dimensions.slice(0, 3),
      axisIndex,
      slice,
      planeSize: { width, height, pixels: totalPixels },
      scalarType,
      components,
      sampled: stride > 1,
      sampleStride: stride,
      sampleCount: sampleValues.length,
      min,
      max,
      mean,
      stddev: Math.sqrt(variance),
      histogram: {
        bins: binCount,
        min,
        max,
        counts,
      },
    };
  }

  function getSlicePixelGrid(viewID: string | null | undefined, dataID: string | null | undefined, pixelWidth = 64, pixelHeight = 64) {
    const view = viewID ? viewStore.getView(viewID) : null;
    if (!viewID || !dataID || !view || view.type === '3D') {
      return null;
    }
    const image = imageCacheStore.imageById[dataID];
    const imageData = image?.getVtkImageData?.();
    const scalars = imageData?.getPointData?.().getScalars?.();
    const values = scalars?.getData?.();
    if (!imageData || !scalars || !values?.length) {
      return null;
    }

    const dimensions = imageData.getDimensions?.() || [];
    const metadata = image.getImageMetadata?.();
    const axisIndex = getPlaneAxisIndex(view, metadata);
    const sliceConfig = viewSliceStore.getConfig(viewID, dataID);
    const slice = Math.max(0, Math.min(dimensions[axisIndex] - 1, Math.round(sliceConfig?.slice ?? 0)));
    const components = scalars.getNumberOfComponents?.() || 1;
    const scalarType = scalars.getDataType?.() || values.constructor?.name || 'unknown';
    const sourceWidth = dimensions[(axisIndex + 1) % 3] || 0;
    const sourceHeight = dimensions[(axisIndex + 2) % 3] || 0;
    if (!sourceWidth || !sourceHeight) {
      return null;
    }

    const gridWidth = Math.max(1, Math.min(128, Math.round(pixelWidth || 64)));
    const gridHeight = Math.max(1, Math.min(128, Math.round(pixelHeight || 64)));
    const rows: Array<Array<number | null>> = [];
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let sampleCount = 0;

    function scalarAt(a: number, b: number) {
      const ijk = [0, 0, 0];
      ijk[axisIndex] = slice;
      ijk[(axisIndex + 1) % 3] = a;
      ijk[(axisIndex + 2) % 3] = b;
      return Number(values[((ijk[2] * dimensions[1] + ijk[1]) * dimensions[0] + ijk[0]) * components]);
    }

    for (let row = 0; row < gridHeight; row++) {
      const sourceY = Math.min(sourceHeight - 1, Math.max(0, Math.round(((row + 0.5) / gridHeight) * sourceHeight - 0.5)));
      const valuesRow: Array<number | null> = [];
      for (let col = 0; col < gridWidth; col++) {
        const sourceX = Math.min(sourceWidth - 1, Math.max(0, Math.round(((col + 0.5) / gridWidth) * sourceWidth - 0.5)));
        const value = scalarAt(sourceX, sourceY);
        const safeValue = Number.isFinite(value) ? value : null;
        valuesRow.push(safeValue);
        if (safeValue !== null) {
          min = Math.min(min, safeValue);
          max = Math.max(max, safeValue);
          sum += safeValue;
          sampleCount += 1;
        }
      }
      rows.push(valuesRow);
    }

    return {
      source: 'vtkImageData.scalars',
      dataID,
      viewID,
      viewName: view.name,
      orientation: (view.options as any)?.orientation ?? null,
      dimensions: dimensions.slice(0, 3),
      axisIndex,
      slice,
      scalarType,
      components,
      sourceSize: {
        width: sourceWidth,
        height: sourceHeight,
        pixels: sourceWidth * sourceHeight,
      },
      gridSize: {
        width: gridWidth,
        height: gridHeight,
        pixels: gridWidth * gridHeight,
      },
      sampling: 'nearest-center',
      valueRange: sampleCount ? {
        min,
        max,
        mean: sum / sampleCount,
      } : null,
      rows,
    };
  }

  function toFiniteNumber(value: any) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clampNumber(value: any, fallback: number, min: number, max: number) {
    const number = Number(value);
    const safe = Number.isFinite(number) ? number : fallback;
    return Math.max(min, Math.min(max, Math.round(safe)));
  }

  function pointInPolygon(x: number, y: number, points: Array<[number, number]>) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      const intersects = (yi > y) !== (yj > y)
        && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function pointInEllipse(x: number, y: number, ellipse: { cx: number; cy: number; rx: number; ry: number }) {
    if (ellipse.rx <= 0 || ellipse.ry <= 0) return false;
    const dx = (x - ellipse.cx) / ellipse.rx;
    const dy = (y - ellipse.cy) / ellipse.ry;
    return dx * dx + dy * dy <= 1;
  }

  function normalizeRoiShape(payload: RoiSamplePayload, sourceWidth: number, sourceHeight: number) {
    const roi = payload.roi && typeof payload.roi === 'object' ? payload.roi : payload;
    const pointsInput = Array.isArray(roi?.points) ? roi.points : Array.isArray(roi?.polygon) ? roi.polygon : null;
    const shapeType = normalizeText(roi?.type || roi?.shape || (pointsInput ? 'polygon' : 'rectangle'));

    if (shapeType === 'polygon' || pointsInput) {
      const points: Array<[number, number]> = (pointsInput || [])
        .map((point: RoiPoint) => {
          if (Array.isArray(point)) {
            const x = toFiniteNumber(point[0]);
            const y = toFiniteNumber(point[1]);
            return x === null || y === null ? null : [x, y] as [number, number];
          }
          const x = toFiniteNumber(point?.x);
          const y = toFiniteNumber(point?.y);
          return x === null || y === null ? null : [x, y] as [number, number];
        })
        .filter((point: [number, number] | null): point is [number, number] => !!point);
      if (points.length < 3) {
        throw new Error('ROI polygon requires at least three finite points');
      }
      const left = Math.max(0, Math.min(sourceWidth, Math.floor(Math.min(...points.map(point => point[0])))));
      const top = Math.max(0, Math.min(sourceHeight, Math.floor(Math.min(...points.map(point => point[1])))));
      const right = Math.max(0, Math.min(sourceWidth, Math.ceil(Math.max(...points.map(point => point[0])))));
      const bottom = Math.max(0, Math.min(sourceHeight, Math.ceil(Math.max(...points.map(point => point[1])))));
      if (right <= left || bottom <= top) {
        throw new Error('ROI polygon does not overlap the current slice');
      }
      return {
        type: 'polygon',
        points,
        boundingBox: { x: left, y: top, width: right - left, height: bottom - top },
        contains: (x: number, y: number) => pointInPolygon(x + 0.5, y + 0.5, points),
      };
    }

    if (shapeType === 'circle' || shapeType === 'ellipse') {
      const centerX = toFiniteNumber(roi?.cx ?? roi?.centerX);
      const centerY = toFiniteNumber(roi?.cy ?? roi?.centerY);
      const radius = toFiniteNumber(roi?.radius);
      let rx = toFiniteNumber(roi?.rx ?? roi?.radiusX ?? radius);
      let ry = toFiniteNumber(roi?.ry ?? roi?.radiusY ?? radius);
      let x = toFiniteNumber(roi?.x ?? roi?.left ?? roi?.x1);
      let y = toFiniteNumber(roi?.y ?? roi?.top ?? roi?.y1);
      const right = toFiniteNumber(roi?.right ?? roi?.x2);
      const bottom = toFiniteNumber(roi?.bottom ?? roi?.y2);
      let width = toFiniteNumber(roi?.width ?? roi?.diameter);
      let height = toFiniteNumber(roi?.height ?? roi?.diameter);
      if (centerX !== null && centerY !== null && rx !== null && ry !== null) {
        x = centerX - rx;
        y = centerY - ry;
        width = rx * 2;
        height = ry * 2;
      } else {
        if (x === null || y === null) {
          throw new Error('ROI circle/ellipse requires center plus radius/rx/ry, or x/y plus width/height');
        }
        if (width === null && right !== null) width = right - x;
        if (height === null && bottom !== null) height = bottom - y;
        if (shapeType === 'circle' && width !== null && height === null) height = width;
        if (shapeType === 'circle' && height !== null && width === null) width = height;
        if (width !== null) rx = Math.abs(width) / 2;
        if (height !== null) ry = Math.abs(height) / 2;
      }
      if (x === null || y === null || width === null || height === null || rx === null || ry === null || rx <= 0 || ry <= 0) {
        throw new Error('ROI circle/ellipse requires positive radius or non-zero width and height');
      }
      const rawLeft = Math.min(x, x + width);
      const rawRight = Math.max(x, x + width);
      const rawTop = Math.min(y, y + height);
      const rawBottom = Math.max(y, y + height);
      const clippedLeft = Math.max(0, Math.min(sourceWidth, rawLeft));
      const clippedRight = Math.max(0, Math.min(sourceWidth, rawRight));
      const clippedTop = Math.max(0, Math.min(sourceHeight, rawTop));
      const clippedBottom = Math.max(0, Math.min(sourceHeight, rawBottom));
      if (clippedRight <= clippedLeft || clippedBottom <= clippedTop) {
        throw new Error('ROI circle/ellipse does not overlap the current slice');
      }
      const left = Math.max(0, Math.min(sourceWidth - 1, Math.floor(clippedLeft)));
      const top = Math.max(0, Math.min(sourceHeight - 1, Math.floor(clippedTop)));
      const integerRight = Math.max(left + 1, Math.min(sourceWidth, Math.ceil(clippedRight)));
      const integerBottom = Math.max(top + 1, Math.min(sourceHeight, Math.ceil(clippedBottom)));
      const ellipse = {
        cx: (rawLeft + rawRight) / 2,
        cy: (rawTop + rawBottom) / 2,
        rx: Math.abs(rawRight - rawLeft) / 2,
        ry: Math.abs(rawBottom - rawTop) / 2,
      };
      return {
        type: 'ellipse',
        ellipse,
        rectangle: {
          x: clippedLeft,
          y: clippedTop,
          width: clippedRight - clippedLeft,
          height: clippedBottom - clippedTop,
        },
        boundingBox: { x: left, y: top, width: integerRight - left, height: integerBottom - top },
        contains: (sampleX: number, sampleY: number) => pointInEllipse(sampleX, sampleY, ellipse),
      };
    }

    const x = toFiniteNumber(roi?.x ?? roi?.left ?? roi?.x1);
    const y = toFiniteNumber(roi?.y ?? roi?.top ?? roi?.y1);
    const right = toFiniteNumber(roi?.right ?? roi?.x2);
    const bottom = toFiniteNumber(roi?.bottom ?? roi?.y2);
    let width = toFiniteNumber(roi?.width);
    let height = toFiniteNumber(roi?.height);
    if (x === null || y === null) {
      throw new Error('ROI rectangle requires x and y');
    }
    if (width === null && right !== null) width = right - x;
    if (height === null && bottom !== null) height = bottom - y;
    if (width === null || height === null || width === 0 || height === 0) {
      throw new Error('ROI rectangle requires non-zero width and height');
    }
    const rawLeft = Math.min(x, x + width);
    const rawRight = Math.max(x, x + width);
    const rawTop = Math.min(y, y + height);
    const rawBottom = Math.max(y, y + height);
    const clippedLeft = Math.max(0, Math.min(sourceWidth, rawLeft));
    const clippedRight = Math.max(0, Math.min(sourceWidth, rawRight));
    const clippedTop = Math.max(0, Math.min(sourceHeight, rawTop));
    const clippedBottom = Math.max(0, Math.min(sourceHeight, rawBottom));
    if (clippedRight <= clippedLeft || clippedBottom <= clippedTop) {
      throw new Error('ROI rectangle does not overlap the current slice');
    }
    const left = Math.max(0, Math.min(sourceWidth - 1, Math.floor(clippedLeft)));
    const top = Math.max(0, Math.min(sourceHeight - 1, Math.floor(clippedTop)));
    const integerRight = Math.max(left + 1, Math.min(sourceWidth, Math.ceil(clippedRight)));
    const integerBottom = Math.max(top + 1, Math.min(sourceHeight, Math.ceil(clippedBottom)));
    return {
      type: 'rectangle',
      rectangle: {
        x: clippedLeft,
        y: clippedTop,
        width: clippedRight - clippedLeft,
        height: clippedBottom - clippedTop,
      },
      boundingBox: { x: left, y: top, width: integerRight - left, height: integerBottom - top },
      contains: (sampleX: number, sampleY: number) => {
        const centerX = sampleX + 0.5;
        const centerY = sampleY + 0.5;
        return centerX >= clippedLeft && centerX < clippedRight && centerY >= clippedTop && centerY < clippedBottom;
      },
    };
  }

  function compactMeasurements(measurements: any) {
    if (!measurements) return null;
    return {
      mean: measurements.mean,
      median: measurements.median,
      sdev: measurements.sdev,
      stddev: measurements.sdev,
      sum: measurements.sum,
      max: measurements.max,
      min: measurements.min,
      count: measurements.count,
      area: measurements.area,
      perimeter: measurements.perimeter,
      width: measurements.width,
      height: measurements.height,
    };
  }

  function summarizeSampleValues(sampleValues: number[], bins = 64) {
    if (!sampleValues.length) {
      return null;
    }
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const value of sampleValues) {
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
    }
    const mean = sum / sampleValues.length;
    const variance = sampleValues.reduce((acc, value) => acc + ((value - mean) ** 2), 0) / sampleValues.length;
    const binCount = Math.max(2, Math.min(256, Math.round(bins || 64)));
    const counts = Array.from({ length: binCount }, () => 0);
    const span = max - min || 1;
    for (const value of sampleValues) {
      const bin = Math.min(binCount - 1, Math.max(0, Math.floor(((value - min) / span) * binCount)));
      counts[bin] += 1;
    }
    return {
      min,
      max,
      mean,
      stddev: Math.sqrt(variance),
      histogram: {
        bins: binCount,
        min,
        max,
        counts,
      },
    };
  }

  function getSliceRoiSample(payload: RoiSamplePayload = {}) {
    const { viewID, dataID } = getActiveViewData(payload);
    const view = viewID ? viewStore.getView(viewID) : null;
    if (!viewID || !dataID || !view || view.type === '3D') {
      throw new Error('ROI sampling requires an active 2D VolView pane with image data');
    }
    const image = imageCacheStore.imageById[dataID];
    const imageData = image?.getVtkImageData?.();
    const scalars = imageData?.getPointData?.().getScalars?.();
    const values = scalars?.getData?.();
    if (!imageData || !scalars || !values?.length) {
      throw new Error('ROI sampling requires scalar image data for the current slice');
    }

    const dimensions = imageData.getDimensions?.() || [];
    const metadata = image.getImageMetadata?.();
    const axisIndex = getPlaneAxisIndex(view, metadata);
    const sliceConfig = viewSliceStore.getConfig(viewID, dataID);
    const slice = Math.max(0, Math.min(dimensions[axisIndex] - 1, Math.round(sliceConfig?.slice ?? 0)));
    const components = scalars.getNumberOfComponents?.() || 1;
    const component = clampNumber(payload.component, 0, 0, Math.max(0, components - 1));
    const scalarType = scalars.getDataType?.() || values.constructor?.name || 'unknown';
    const xAxis = (axisIndex + 1) % 3;
    const yAxis = (axisIndex + 2) % 3;
    const sourceWidth = dimensions[xAxis] || 0;
    const sourceHeight = dimensions[yAxis] || 0;
    if (!sourceWidth || !sourceHeight) {
      throw new Error('ROI sampling requires a non-empty current slice plane');
    }

    const roi = normalizeRoiShape(payload, sourceWidth, sourceHeight);
    const pointToWorld = (x: number, y: number) => {
      const ijk = vec3.fromValues(0, 0, 0);
      ijk[axisIndex] = slice;
      ijk[xAxis] = x;
      ijk[yAxis] = y;
      return Array.from(indexPointToWorld(imageData, ijk)) as Vector3;
    };
    const measurements = (() => {
      const normalizedRoi: any = roi;
      if (normalizedRoi.type === 'polygon' && Array.isArray(normalizedRoi.points)) {
        return computePolygonMeasurements(imageData, normalizedRoi.points.map(([x, y]: [number, number]) => pointToWorld(x, y)));
      }
      if (normalizedRoi.type === 'ellipse' && normalizedRoi.ellipse) {
        const { cx, cy, rx, ry } = normalizedRoi.ellipse;
        return computeEllipseMeasurements(imageData, pointToWorld(cx - rx, cy - ry), pointToWorld(cx + rx, cy + ry));
      }
      if (normalizedRoi.rectangle) {
        const { x, y, width, height } = normalizedRoi.rectangle;
        return computeRectangleMeasurements(imageData, pointToWorld(x, y), pointToWorld(x + width, y + height));
      }
      return null;
    })();
    const candidatePixelCount = roi.boundingBox.width * roi.boundingBox.height;
    const maxSamples = clampNumber(payload.maxSamples, 262144, 1, 1048576);
    const sampleStride = Math.max(1, Math.ceil(candidatePixelCount / maxSamples));
    const sampleValues: number[] = [];

    function scalarAt(x: number, y: number) {
      const ijk = [0, 0, 0];
      ijk[axisIndex] = slice;
      ijk[xAxis] = x;
      ijk[yAxis] = y;
      return Number(values[((ijk[2] * dimensions[1] + ijk[1]) * dimensions[0] + ijk[0]) * components + component]);
    }

    for (let offset = 0; offset < candidatePixelCount; offset += sampleStride) {
      const x = roi.boundingBox.x + (offset % roi.boundingBox.width);
      const y = roi.boundingBox.y + Math.floor(offset / roi.boundingBox.width);
      if (!roi.contains(x, y)) continue;
      const value = scalarAt(x, y);
      if (Number.isFinite(value)) {
        sampleValues.push(value);
      }
    }

    const stats = summarizeSampleValues(sampleValues, Number(payload.bins) || 64);
    const result: Record<string, any> = {
      source: 'vtkImageData.scalars',
      dataID,
      viewID,
      viewName: view.name,
      orientation: (view.options as any)?.orientation ?? null,
      coordinateSystem: 'current-slice-image-plane-index',
      dimensions: dimensions.slice(0, 3),
      axisIndex,
      planeAxes: { x: xAxis, y: yAxis, slice: axisIndex },
      slice,
      scalarType,
      components,
      component,
      sourceSize: {
        width: sourceWidth,
        height: sourceHeight,
        pixels: sourceWidth * sourceHeight,
      },
      roi: {
        type: roi.type,
        rectangle: 'rectangle' in roi ? roi.rectangle : undefined,
        ellipse: 'ellipse' in roi ? roi.ellipse : undefined,
        points: 'points' in roi ? roi.points : undefined,
        boundingBox: roi.boundingBox,
      },
      measurements: compactMeasurements(measurements),
      measurementSource: 'VolView/src/utils/roiStats.ts',
      sampled: sampleStride > 1,
      sampleStride,
      sampleCount: measurements?.count ?? sampleValues.length,
      candidatePixelCount,
      maxSamples,
      valueRange: measurements ? {
        min: measurements.min,
        max: measurements.max,
        mean: measurements.mean,
        median: measurements.median,
        sdev: measurements.sdev,
        stddev: measurements.sdev,
        sum: measurements.sum,
        count: measurements.count,
      } : stats ? {
        min: stats.min,
        max: stats.max,
        mean: stats.mean,
        stddev: stats.stddev,
      } : null,
      histogram: stats?.histogram ?? null,
    };

    if (payload.includePixels) {
      const gridWidth = clampNumber(payload.pixelWidth, 64, 1, 128);
      const gridHeight = clampNumber(payload.pixelHeight, 64, 1, 128);
      const rows: Array<Array<number | null>> = [];
      const gridValues: number[] = [];
      for (let row = 0; row < gridHeight; row++) {
        const sourceY = Math.min(
          roi.boundingBox.y + roi.boundingBox.height - 1,
          Math.max(roi.boundingBox.y, Math.round(((row + 0.5) / gridHeight) * roi.boundingBox.height - 0.5 + roi.boundingBox.y))
        );
        const valuesRow: Array<number | null> = [];
        for (let col = 0; col < gridWidth; col++) {
          const sourceX = Math.min(
            roi.boundingBox.x + roi.boundingBox.width - 1,
            Math.max(roi.boundingBox.x, Math.round(((col + 0.5) / gridWidth) * roi.boundingBox.width - 0.5 + roi.boundingBox.x))
          );
          const value = roi.contains(sourceX, sourceY) ? scalarAt(sourceX, sourceY) : NaN;
          const safeValue = Number.isFinite(value) ? value : null;
          valuesRow.push(safeValue);
          if (safeValue !== null) {
            gridValues.push(safeValue);
          }
        }
        rows.push(valuesRow);
      }
      const gridStats = summarizeSampleValues(gridValues, Number(payload.bins) || 64);
      result.roiPixelGrid = {
        gridSize: {
          width: gridWidth,
          height: gridHeight,
          pixels: gridWidth * gridHeight,
        },
        sampling: 'nearest-center-with-null-outside-roi',
        valueRange: gridStats ? {
          min: gridStats.min,
          max: gridStats.max,
          mean: gridStats.mean,
        } : null,
        rows,
      };
    }

    return result;
  }

  function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('snapshot image failed to load'));
      image.src = src;
    });
  }

  async function cropSnapshot(dataURL: string, viewID: string | null | undefined, maxWidth = 768, maxHeight = 768) {
    const source = await loadImage(dataURL);
    const renderWindowView = vtkRenderWindowParent.value?.renderWindowView;
    const canvas = renderWindowView?.getCanvas?.() as HTMLCanvasElement | undefined;
    const viewEl = viewID ? document.querySelector(`[data-volview-view-id="${CSS.escape(viewID)}"]`) as HTMLElement | null : null;
    const canvasRect = canvas?.getBoundingClientRect?.();
    const viewRect = viewEl?.getBoundingClientRect?.();
    type SnapshotRect = { left: number; top: number; width: number; height: number; right?: number; bottom?: number };
    const isUsableRect = (rect: SnapshotRect | null | undefined): rect is SnapshotRect => !!rect
      && Number.isFinite(rect.left)
      && Number.isFinite(rect.top)
      && Number.isFinite(rect.width)
      && Number.isFinite(rect.height)
      && rect.width > 0
      && rect.height > 0;
    const gridRects = Array.from(document.querySelectorAll('[data-volview-view-id]'))
      .map(element => (element as HTMLElement).getBoundingClientRect())
      .filter(isUsableRect);
    const gridRect = gridRects.length ? {
      left: Math.min(...gridRects.map(rect => rect.left)),
      top: Math.min(...gridRects.map(rect => rect.top)),
      right: Math.max(...gridRects.map(rect => rect.right)),
      bottom: Math.max(...gridRects.map(rect => rect.bottom)),
    } : null;
    const referenceRect = isUsableRect(canvasRect)
      ? canvasRect
      : gridRect
        ? {
            ...gridRect,
            width: gridRect.right - gridRect.left,
            height: gridRect.bottom - gridRect.top,
          } as SnapshotRect
        : null;
    let rawCrop = { x: 0, y: 0, width: source.naturalWidth, height: source.naturalHeight };
    if (isUsableRect(referenceRect) && isUsableRect(viewRect)) {
      const refRect = referenceRect;
      const targetRect = viewRect;
      rawCrop = {
        x: Math.round((targetRect.left - refRect.left) * (source.naturalWidth / refRect.width)),
        y: Math.round((targetRect.top - refRect.top) * (source.naturalHeight / refRect.height)),
        width: Math.round(targetRect.width * (source.naturalWidth / refRect.width)),
        height: Math.round(targetRect.height * (source.naturalHeight / refRect.height)),
      };
    }
    const crop = {
      x: Number.isFinite(rawCrop.x) ? Math.max(0, Math.min(source.naturalWidth - 1, rawCrop.x)) : 0,
      y: Number.isFinite(rawCrop.y) ? Math.max(0, Math.min(source.naturalHeight - 1, rawCrop.y)) : 0,
      width: Number.isFinite(rawCrop.width) ? rawCrop.width : source.naturalWidth,
      height: Number.isFinite(rawCrop.height) ? rawCrop.height : source.naturalHeight,
    };
    crop.width = Math.max(1, Math.min(crop.width, source.naturalWidth - crop.x));
    crop.height = Math.max(1, Math.min(crop.height, source.naturalHeight - crop.y));
    const safeMaxWidth = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : 768;
    const safeMaxHeight = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : 768;
    const scale = Math.min(1, safeMaxWidth / crop.width, safeMaxHeight / crop.height);
    const output = document.createElement('canvas');
    output.width = Math.max(1, Math.round(crop.width * scale));
    output.height = Math.max(1, Math.round(crop.height * scale));
    const context = output.getContext('2d');
    if (!context) {
      throw new Error('snapshot canvas context unavailable');
    }
    context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, output.width, output.height);
    return {
      dataURL: output.toDataURL('image/png'),
      mimeType: 'image/png',
      width: output.width,
      height: output.height,
      sourceWidth: source.naturalWidth,
      sourceHeight: source.naturalHeight,
      crop,
      scaled: scale < 1,
    };
  }

  async function captureActiveView(payload: { requestId?: string; includeImage?: boolean; includeHistogram?: boolean; includePixels?: boolean; maxWidth?: number; maxHeight?: number; bins?: number; pixelWidth?: number; pixelHeight?: number } = {}) {
    try {
      const viewID = activeView.value;
      const view = viewID ? viewStore.getView(viewID) : null;
      const dataID = view?.dataID ?? currentImageID.value ?? null;
      const result: Record<string, any> = {
        activeViewID: viewID ?? null,
        activeViewDataID: dataID,
        activeView: view ? jsonClone(view) : null,
        capturedAt: Date.now(),
      };
      if (payload.includeImage !== false) {
        const renderWindow = vtkRenderWindowParent.value?.renderWindow;
        if (renderWindow?.captureImages) {
          renderWindow.render?.();
          const imageURL = await renderWindow.captureImages()[0];
          result.image = await cropSnapshot(imageURL, viewID, Number(payload.maxWidth) || 768, Number(payload.maxHeight) || 768);
        } else {
          result.image = null;
        }
      }
      if (payload.includeHistogram !== false) {
        result.currentSlicePixels = getSliceHistogram(viewID, dataID, Number(payload.bins) || 64);
      }
      if (payload.includePixels) {
        result.currentSlicePixelGrid = getSlicePixelGrid(viewID, dataID, Number(payload.pixelWidth) || 64, Number(payload.pixelHeight) || 64);
      }
      emitter?.emit('activeviewsnapshot', {
        requestId: payload.requestId,
        result,
      });
    } catch (err: any) {
      emitter?.emit('activeviewsnapshot', {
        requestId: payload.requestId,
        error: err?.message || String(err),
      });
    }
  }

  function sampleCurrentSliceRoi(payload: RoiSamplePayload = {}) {
    try {
      const { viewID, dataID } = getActiveViewData(payload);
      const view = viewID ? viewStore.getView(viewID) : null;
      const result: Record<string, any> = {
        activeViewID: viewID ?? null,
        activeViewDataID: dataID ?? null,
        activeView: view ? jsonClone(view) : null,
        capturedAt: Date.now(),
        currentSliceRoi: getSliceRoiSample(payload),
      };
      emitter?.emit('currentsliceroisample', {
        requestId: payload.requestId,
        result,
      });
    } catch (err: any) {
      emitter?.emit('currentsliceroisample', {
        requestId: payload.requestId,
        error: err?.message || String(err),
      });
    }
  }

  function getInstanceOrderedSlices(dataID: string) {
    const volumeKeyUID = loadDataStore.dataIDToVolumeKeyUID[dataID];
    const slices = volumeKeyUID ? loadDataStore.loadedByBus[volumeKeyUID]?.volumes?.[dataID]?.slices : null;
    if (!Array.isArray(slices) || !slices.length) {
      return null;
    }

    return slices
      .map((sliceInfo: any, sliceIndex: number) => {
        const parsedIndex = Number(sliceInfo?.i);
        const instanceNumber = Number(sliceInfo?.n);
        return {
          sliceIndex,
          order: Number.isFinite(parsedIndex)
            ? parsedIndex
            : Number.isFinite(instanceNumber)
              ? instanceNumber
              : sliceIndex,
        };
      })
      .sort((a, b) => a.order - b.order || a.sliceIndex - b.sliceIndex);
  }

  function getInstanceOrderedSliceIndex(dataID: string, currentSlice: number, delta: number) {
    const ordered = getInstanceOrderedSlices(dataID);
    if (!ordered) {
      return null;
    }
    const currentOrderIndex = ordered.findIndex(item => item.sliceIndex === Math.round(currentSlice));
    if (currentOrderIndex === -1) {
      return null;
    }
    const targetOrderIndex = Math.max(0, Math.min(ordered.length - 1, currentOrderIndex + Math.round(delta)));
    return ordered[targetOrderIndex]?.sliceIndex ?? null;
  }

  function normalizeDicomTagKey(tag: any) {
    const input = String(tag || '').trim();
    if (!input) {
      return '';
    }
    const namedTag = NAME_TO_TAG.get(input)
      || Array.from(NAME_TO_TAG.entries()).find(([name]) => name.toLowerCase() === input.toLowerCase())?.[1];
    if (namedTag) {
      return namedTag.toLowerCase();
    }
    const compact = input.toLowerCase().replace(/[()\s,|]/g, '');
    if (/^[0-9a-f]{8}$/.test(compact)) {
      return `${compact.slice(0, 4)}|${compact.slice(4)}`;
    }
    return input.toLowerCase();
  }

  function normalizeTagValue(value: any) {
    if (Array.isArray(value)) {
      return value.join('\\');
    }
    return String(value ?? '').trim();
  }

  function dicomTagValueMatches(actual: any, expected: any, match: 'equals' | 'contains' = 'equals') {
    const actualText = normalizeTagValue(actual);
    const expectedText = normalizeTagValue(expected);
    const actualNumber = Number(actualText);
    const expectedNumber = Number(expectedText);
    if (match === 'contains') {
      return actualText.toLowerCase().includes(expectedText.toLowerCase());
    }
    if (Number.isFinite(actualNumber) && Number.isFinite(expectedNumber)) {
      return actualNumber === expectedNumber;
    }
    return actualText.toLowerCase() === expectedText.toLowerCase();
  }

  function getDicomTagValueForSlice(dataID: string, sliceIndex: number, tagKey: string) {
    const image = imageCacheStore.imageById[dataID];
    if (!image || typeof (image as any).getDicomMetadata !== 'function') {
      return undefined;
    }
    let pairs: any;
    try {
      pairs = (image as any).getDicomMetadata(sliceIndex);
    } catch {
      return undefined;
    }
    if (!Array.isArray(pairs)) {
      return undefined;
    }
    const normalizedTagKey = normalizeDicomTagKey(tagKey);
    const pair = pairs.find(([tag]: [string, any]) => normalizeDicomTagKey(tag) === normalizedTagKey);
    return pair?.[1];
  }

  function getDicomWindowLevelForSlice(dataID: string, sliceIndex: number) {
    const WindowWidth = normalizeTagValue(getDicomTagValueForSlice(dataID, sliceIndex, 'WindowWidth'));
    const WindowLevel = normalizeTagValue(getDicomTagValueForSlice(dataID, sliceIndex, 'WindowLevel'));
    const [windowLevel] = getWindowLevels({ WindowWidth, WindowLevel });
    return windowLevel || null;
  }

  function setWindowLevel(payload: { width?: number; level?: number; widthDelta?: number; levelDelta?: number; widthScale?: number; reset?: boolean; applyDicom?: boolean; viewID?: string; dataID?: string } = {}) {
    const { viewID, dataID } = getActiveViewData(payload);
    if (!viewID || !dataID) {
      console.warn('[volview] set-window-level ignored: no active view/data');
      return;
    }

    if (payload.reset) {
      windowingStore.resetConfig(viewID, dataID);
      return;
    }

    if (payload.applyDicom) {
      const sliceConfig = viewSliceStore.getConfig(viewID, dataID);
      const dicomWindowLevel = getDicomWindowLevelForSlice(dataID, sliceConfig.slice);
      if (!dicomWindowLevel) {
        console.warn('[volview] set-window-level ignored: no DICOM window/level for current slice');
        return;
      }
      windowingStore.updateConfig(viewID, dataID, dicomWindowLevel, true);
      return;
    }

    const currentConfig = windowingStore.getConfig(viewID, dataID);
    const currentWidth = Number(currentConfig.width ?? 1);
    const currentLevel = Number(currentConfig.level ?? 0.5);
    const width = Number(payload.width);
    const level = Number(payload.level);
    const widthDelta = Number(payload.widthDelta);
    const levelDelta = Number(payload.levelDelta);
    const widthScale = Number(payload.widthScale);
    const patch: Record<string, number> = {};
    if (Number.isFinite(width)) {
      patch.width = Math.max(width, 1e-6);
    }
    if (Number.isFinite(level)) {
      patch.level = level;
    }
    if (Number.isFinite(widthDelta)) {
      patch.width = Math.max(currentWidth + widthDelta, 1e-6);
    }
    if (Number.isFinite(levelDelta)) {
      patch.level = currentLevel + levelDelta;
    }
    if (Number.isFinite(widthScale) && widthScale > 0) {
      patch.width = Math.max(currentWidth * widthScale, 1e-6);
    }
    if (!Object.keys(patch).length) {
      console.warn('[volview] set-window-level ignored: payload requires width/level/delta/scale/reset/applyDicom', payload);
      return;
    }
    windowingStore.updateConfig(viewID, dataID, patch, true);
  }

  function findSliceIndexByDicomTag(dataID: string, currentSlice: number, maxSlice: number, payload: { dicomTag?: string; tag?: string; value?: string | number; match?: 'equals' | 'contains'; direction?: 'first' | 'last' | 'forward' | 'backward' | 'nearest' }) {
    const tag = payload.dicomTag || payload.tag;
    if (!tag || payload.value === undefined || payload.value === null) {
      return null;
    }
    const image = imageCacheStore.imageById[dataID];
    const chunkCount = typeof (image as any)?.getChunks === 'function' ? (image as any).getChunks().length : 0;
    const count = Number.isFinite(maxSlice) ? maxSlice + 1 : chunkCount;
    if (!count || count < 1) {
      return null;
    }

    const matches = Array.from({ length: count }, (_, sliceIndex) => sliceIndex)
      .filter(sliceIndex => dicomTagValueMatches(
        getDicomTagValueForSlice(dataID, sliceIndex, tag),
        payload.value,
        payload.match || 'equals'
      ));
    if (!matches.length) {
      return null;
    }

    const direction = payload.direction || 'first';
    if (direction === 'nearest') {
      return matches.slice().sort((a, b) => Math.abs(a - currentSlice) - Math.abs(b - currentSlice) || a - b)[0];
    }

    const ordered = getInstanceOrderedSlices(dataID)
      || Array.from({ length: count }, (_, sliceIndex) => ({ sliceIndex, order: sliceIndex }));
    const orderedMatches = ordered.filter(item => matches.includes(item.sliceIndex));
    if (direction === 'last') {
      return orderedMatches[orderedMatches.length - 1]?.sliceIndex ?? null;
    }
    if (direction === 'forward' || direction === 'backward') {
      const currentOrderIndex = ordered.findIndex(item => item.sliceIndex === Math.round(currentSlice));
      if (currentOrderIndex !== -1) {
        const candidates = direction === 'forward'
          ? orderedMatches.filter(item => ordered.findIndex(orderItem => orderItem.sliceIndex === item.sliceIndex) > currentOrderIndex)
          : orderedMatches.filter(item => ordered.findIndex(orderItem => orderItem.sliceIndex === item.sliceIndex) < currentOrderIndex).reverse();
        return candidates[0]?.sliceIndex ?? null;
      }
    }
    return orderedMatches[0]?.sliceIndex ?? null;
  }

  function setActiveSlice(payload: { slice?: number; delta?: number; instanceDelta?: number; dicomTag?: string; tag?: string; value?: string | number; match?: 'equals' | 'contains'; direction?: 'first' | 'last' | 'forward' | 'backward' | 'nearest'; viewID?: string; dataID?: string } = {}) {
    const viewID = payload.viewID || activeView.value;
    const dataID = payload.dataID || (viewID ? viewStore.getView(viewID)?.dataID : currentImageID.value);
    if (!viewID || !dataID) {
      console.warn('[volview] set-slice ignored: no active view/data');
      return;
    }

    const config = viewSliceStore.getConfig(viewID, dataID);
    const delta = Number(payload.delta);
    const slice = Number(payload.slice);
    const instanceDelta = Number(payload.instanceDelta);
    const hasDelta = Number.isFinite(delta);
    const hasSlice = Number.isFinite(slice);
    const hasInstanceDelta = Number.isFinite(instanceDelta);
    const hasDicomTag = !!(payload.dicomTag || payload.tag);
    if (!hasDelta && !hasSlice && !hasInstanceDelta && !hasDicomTag) {
      console.warn('[volview] set-slice ignored: payload requires slice, delta, instanceDelta, or dicomTag', payload);
      return;
    }

    const dicomTagSlice = hasDicomTag
      ? findSliceIndexByDicomTag(dataID, config.slice, config.max, payload)
      : null;
    if (hasDicomTag && dicomTagSlice === null && !hasDelta && !hasSlice && !hasInstanceDelta) {
      console.warn('[volview] set-slice ignored: no matching DICOM tag slice', payload);
      return;
    }
    const instanceOrderedSlice = hasInstanceDelta
      ? getInstanceOrderedSliceIndex(dataID, config.slice, instanceDelta)
      : null;
    const nextSlice = dicomTagSlice ?? instanceOrderedSlice ?? (hasDelta
      ? config.slice + delta
      : hasInstanceDelta
        ? config.slice + instanceDelta
        : slice);
    viewSliceStore.updateConfig(viewID, dataID, {
      slice: Math.round(nextSlice),
    });
  }

  const activeSliceConfig = computed(() => {
    if (!activeView.value || !currentImageID.value) {
      return null;
    }
    return viewSliceStore.getConfig(activeView.value, currentImageID.value);
  });

  const activeWindowConfig = computed(() => {
    if (!activeView.value || !currentImageID.value) {
      return null;
    }
    return windowingStore.getConfig(activeView.value, currentImageID.value);
  });

  const activeLayoutState = computed(() => ({
    currentName: viewStore.currentLayoutName ?? null,
    activeViewMaximized: !!viewStore.isActiveViewMaximized,
    visibleViewIDs: getVisibleViewIDs(),
  }));

  function jsonClone(value: any) {
    if (value == null) {
      return value;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  function serializeFile(file: any) {
    if (!file || typeof file !== 'object') {
      return null;
    }
    return {
      name: file.name ?? '',
      size: file.size ?? 0,
      type: file.type ?? '',
      lastModified: file.lastModified ?? null,
    };
  }

  function serializeSliceMetadata(metadata: any) {
    if (!metadata) {
      return metadata;
    }
    const clone = jsonClone({ ...metadata, file: undefined }) || {};
    if (metadata.file) {
      clone.file = serializeFile(metadata.file);
    }
    return clone;
  }

  function serializeDicomTags(dataID: string | null | undefined, sliceIndex: number | null | undefined) {
    const image = dataID ? imageCacheStore.imageById[dataID] : null;
    if (!image || typeof (image as any).getDicomMetadata !== 'function') {
      return null;
    }
    const chunkIndex = Number.isFinite(sliceIndex) ? sliceIndex as number : 0;
    let pairs: any;
    try {
      pairs = (image as any).getDicomMetadata(chunkIndex);
    } catch {
      return null;
    }
    if (!Array.isArray(pairs)) {
      return null;
    }
    const raw: Record<string, any> = Object.create(null);
    const named: Record<string, any> = Object.create(null);
    for (const [tag, value] of pairs) {
      raw[tag] = jsonClone(value);
      const name = TAG_TO_NAME.get(String(tag).toLowerCase());
      if (name) {
        named[name] = raw[tag];
      }
    }
    return {
      source: 'DicomChunkImage.getDicomMetadata',
      dataID,
      slice: chunkIndex,
      count: pairs.length,
      raw,
      named,
    };
  }

  function emitFrontendState(activeViewID?: string | null, dataID?: string | null) {
    const view = activeViewID ? viewStore.getView(activeViewID) : null;
    const sliceConfig = activeViewID && dataID ? viewSliceStore.getConfig(activeViewID, dataID) : null;
    const windowLevelConfig = activeViewID && dataID ? windowingStore.getConfig(activeViewID, dataID) : null;
    const sliceIndex = sliceConfig?.slice ?? loadDataStore.currentSliceMetadata?.slice ?? null;
    emitter?.emit('frontendstate', {
      activeViewID: activeViewID ?? null,
      activeViewDataID: dataID ?? null,
      activeView: view ? jsonClone(view) : null,
      views: viewStore.getAllViews().map(viewInfo => jsonClone(viewInfo)).filter(Boolean),
      layout: {
        activeViewMaximized: !!viewStore.isActiveViewMaximized,
        visibleViewIDs: getVisibleViewIDs(),
      },
      currentImage: {
        dataID: dataID ?? null,
        loading: !!isImageLoading.value,
        metadata: jsonClone(currentImageMetadata.value),
      },
      currentSlice: {
        config: jsonClone(sliceConfig),
        metadata: serializeSliceMetadata(loadDataStore.currentSliceMetadata),
        dicomTags: serializeDicomTags(dataID, sliceIndex),
      },
      windowLevel: {
        config: jsonClone(windowLevelConfig),
        dicom: dataID && sliceIndex !== null ? jsonClone(getDicomWindowLevelForSlice(dataID, sliceIndex)) : null,
      },
      updatedAt: Date.now(),
    });
  }

  return {
    handlers,
    start,
  };
}
