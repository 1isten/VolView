import { type Ref, computed, watch } from 'vue';
import { NAME_TO_TAG, TAG_TO_NAME } from '@/src/core/dicomTags';
import { getWindowLevels } from '@/src/store/datasets-dicom';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useLoadDataStore } from '@/src/store/load-data';
import { useCircleStore } from '@/src/store/tools/circles';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useSegmentGroupStore, LABELMAP_BACKGROUND_VALUE } from '@/src/store/segmentGroups';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { useViewStore } from '@/src/store/views';
import { indexPointToWorld, worldPointToIndex } from '@/src/utils/imageSpace';
import { get2DViewingVectors } from '@/src/utils/getViewingVectors';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import {
  computeEllipseMeasurements,
  computePolygonMeasurements,
  computeRectangleMeasurements,
} from '@/src/utils/roiStats';
import type { LPSAxis } from '@/src/types/lps';
import type { SegmentMask } from '@/src/types/segment';
import type { Vector3 } from '@kitware/vtk.js/types';
import { vec3 } from 'gl-matrix';
import { distance2BetweenPoints } from '@kitware/vtk.js/Common/Core/Math';

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

type AnnotationType = 'ruler' | 'rectangle' | 'circle' | 'polygon';

type AnnotationPayload = {
  requestId?: string;
  action?: 'create' | 'update' | 'delete' | 'list';
  annotation?: Record<string, any>;
  annotationId?: string;
  id?: string;
  type?: AnnotationType;
  viewID?: string;
  dataID?: string;
};

type SegmentationPayload = {
  requestId?: string;
  action?: 'list' | 'applyMask' | 'apply' | 'create' | 'update' | 'deleteGroup' | 'deleteSegment' | 'updateSegment';
  segmentGroupId?: string;
  segmentGroupID?: string;
  groupId?: string;
  id?: string;
  name?: string;
  groupName?: string;
  segmentGroupName?: string;
  newSegmentGroup?: boolean;
  createNewGroup?: boolean;
  reuseSegmentGroup?: boolean;
  segmentValue?: number;
  value?: number;
  segment?: Partial<SegmentMask> & { value?: number };
  mask?: any;
  rows?: any[];
  roi?: any;
  threshold?: Record<string, any>;
  min?: number;
  max?: number;
  seed?: RoiPoint;
  connectedComponent?: boolean;
  connectivity?: 4 | 8;
  mode?: 'add' | 'replace' | 'erase';
  overwrite?: boolean;
  overwriteExisting?: boolean;
  maxPixels?: number;
  viewID?: string;
  dataID?: string;
  component?: number;
};

type VolumePayload = {
  requestId?: string;
  action?: 'info' | 'chunk' | 'scan';
  origin?: [number, number, number] | { i?: number; j?: number; k?: number; x?: number; y?: number; z?: number };
  size?: [number, number, number] | { i?: number; j?: number; k?: number; x?: number; y?: number; z?: number; width?: number; height?: number; depth?: number };
  stride?: number | [number, number, number] | { i?: number; j?: number; k?: number; x?: number; y?: number; z?: number };
  maxVoxels?: number;
  maxBytes?: number;
  maxChunkVoxels?: number;
  maxChunkBytes?: number;
  maxScanVoxels?: number;
  maxTotalVoxels?: number;
  bins?: number;
  includeValues?: boolean;
  includeSlices?: boolean;
  perSlice?: boolean;
  maxSliceSummaries?: number;
  min?: number;
  max?: number;
  threshold?: { name?: string; min?: number; max?: number; gt?: number; gte?: number; lt?: number; lte?: number; exclusiveMin?: boolean; exclusiveMax?: boolean };
  thresholds?: Array<{ name?: string; min?: number; max?: number; gt?: number; gte?: number; lt?: number; lte?: number; exclusiveMin?: boolean; exclusiveMax?: boolean }>;
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
  const rulerStore = useRulerStore();
  const rectangleStore = useRectangleStore();
  const circleStore = useCircleStore();
  const polygonStore = usePolygonStore();
  const segmentGroupStore = useSegmentGroupStore();
  const paintStore = usePaintToolStore();
  const viewStore = useViewStore();
  const viewSliceStore = useViewSliceStore();
  const windowingStore = useWindowingStore();
  const activeView = computed(() => viewStore.activeView);
  let emitter: BridgeEmitter | null = null;
  let started = false;
  let cineTimer: ReturnType<typeof setInterval> | null = null;
  let cineDirection: 'forward' | 'backward' | 'pingpong' = 'forward';
  let cineReverse = false;

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
    onmanageannotation(payload: AnnotationPayload) {
      manageAnnotation(payload);
    },
    onmanagesegmentation(payload: SegmentationPayload) {
      manageSegmentation(payload);
    },
    onreadvolume(payload: VolumePayload) {
      readVolume(payload);
    },
    onplaycine(payload: { fps?: number; direction?: 'forward' | 'backward' | 'pingpong'; viewID?: string; dataID?: string }) {
      startCine(payload);
    },
    onstopcine() {
      stopCine();
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

  function stopCine() {
    if (cineTimer !== null) {
      clearInterval(cineTimer);
      cineTimer = null;
      cineReverse = false;
    }
  }

  function startCine(payload: { fps?: number; direction?: 'forward' | 'backward' | 'pingpong'; viewID?: string; dataID?: string } = {}) {
    stopCine();

    const { viewID, dataID } = getActiveViewData(payload);
    const view = viewID ? viewStore.getView(viewID) : null;
    if (!viewID || !dataID || !view || view.type === '3D') {
      console.warn('[volview] play-cine ignored: requires an active 2D pane');
      return;
    }

    const sliceConfig = viewSliceStore.getConfig(viewID, dataID);
    if (!sliceConfig) {
      console.warn('[volview] play-cine ignored: no slice config');
      return;
    }

    const fps = Math.max(1, Math.min(60, Math.round(payload.fps || 10)));
    const intervalMs = Math.round(1000 / fps);
    cineDirection = payload.direction || 'forward';
    cineReverse = false;

    const minSlice = sliceConfig.min ?? 0;
    const maxSlice = sliceConfig.max ?? 1;

    cineTimer = setInterval(() => {
      const currentConfig = viewSliceStore.getConfig(viewID, dataID);
      if (!currentConfig) {
        stopCine();
        return;
      }
      const currentSlice = Math.round(currentConfig.slice ?? 0);
      let nextSlice: number;

      switch (cineDirection) {
        case 'backward':
          nextSlice = currentSlice - 1;
          if (nextSlice < minSlice) nextSlice = maxSlice;
          break;
        case 'pingpong':
          if (cineReverse) {
            nextSlice = currentSlice - 1;
            if (nextSlice <= minSlice) {
              nextSlice = minSlice + 1;
              cineReverse = false;
            }
          } else {
            nextSlice = currentSlice + 1;
            if (nextSlice >= maxSlice) {
              nextSlice = maxSlice - 1;
              cineReverse = true;
            }
          }
          break;
        case 'forward':
        default:
          nextSlice = currentSlice + 1;
          if (nextSlice > maxSlice) nextSlice = minSlice;
          break;
      }

      viewSliceStore.updateConfig(viewID, dataID, { slice: nextSlice });
    }, intervalMs);
  }

  function getVisibleViewIDs() {
    return viewStore.visibleViews
      .map((viewInfo: any) => viewInfo?.id)
      .filter((id: any) => !!id);
  }

  function get2DViewOrientation(view: any): LPSAxis {
    const orientation = String(view?.options?.orientation || view?.name || 'Axial');
    if (orientation === 'Sagittal' || orientation === 'Coronal' || orientation === 'Axial') {
      return orientation;
    }
    return 'Axial';
  }

  function getPlaneAxisIndex(view: any, metadata: any) {
    const orientation = get2DViewOrientation(view);
    const { viewDirection } = get2DViewingVectors(orientation);
    const viewAxis = getLPSAxisFromDir(viewDirection);
    const mapped = metadata?.lpsOrientation?.[viewAxis];
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
      measurementUnits: getMeasurementUnits('rectangle'),
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

  function getAnnotationStore(type: AnnotationType) {
    switch (type) {
      case 'ruler':
        return rulerStore as any;
      case 'rectangle':
        return rectangleStore as any;
      case 'circle':
        return circleStore as any;
      case 'polygon':
        return polygonStore as any;
      default:
        return null;
    }
  }

  function findAnnotationById(annotationId: string) {
    const stores: Array<{ type: AnnotationType; store: any }> = [
      { type: 'ruler', store: rulerStore },
      { type: 'rectangle', store: rectangleStore },
      { type: 'circle', store: circleStore },
      { type: 'polygon', store: polygonStore },
    ];
    for (const entry of stores) {
      if (entry.store?.toolByID?.[annotationId]) {
        return {
          type: entry.type,
          store: entry.store,
          tool: entry.store.toolByID[annotationId],
        };
      }
    }
    return null;
  }

  function getAnnotationSliceContext(payload: { viewID?: string; dataID?: string } = {}) {
    const { viewID, dataID } = getActiveViewData(payload);
    const view = viewID ? viewStore.getView(viewID) : null;
    if (!viewID || !dataID || !view || view.type === '3D') {
      throw new Error('Annotation management requires an active 2D VolView pane with image data');
    }
    const image = imageCacheStore.imageById[dataID];
    const imageData = image?.getVtkImageData?.();
    const metadata = image?.getImageMetadata?.();
    if (!imageData || !metadata?.lpsOrientation || !metadata?.indexToWorld) {
      throw new Error('Annotation management requires image metadata and index/world transforms');
    }
    const dimensions = imageData.getDimensions?.() || [];
    const orientation = get2DViewOrientation(view);
    const { viewDirection } = get2DViewingVectors(orientation);
    const viewAxis = getLPSAxisFromDir(viewDirection);
    const axisIndex = Number(metadata.lpsOrientation?.[viewAxis]);
    if (!Number.isFinite(axisIndex)) {
      throw new Error(`Unable to resolve slice axis for view ${orientation}`);
    }
    const xAxis = (axisIndex + 1) % 3;
    const yAxis = (axisIndex + 2) % 3;
    const sliceConfig = viewSliceStore.getConfig(viewID, dataID);
    const slice = Math.max(0, Math.min((dimensions[axisIndex] || 1) - 1, Math.round(sliceConfig?.slice ?? 0)));
    const planeNormal = metadata.lpsOrientation?.[viewDirection];
    if (!planeNormal) {
      throw new Error(`Unable to resolve plane orientation for view ${orientation}`);
    }
    const originIndex = vec3.fromValues(0, 0, 0);
    originIndex[axisIndex] = slice;
    const planeOrigin = Array.from(indexPointToWorld(imageData, originIndex));
    const pointToWorld = (x: number, y: number) => {
      const ijk = vec3.fromValues(0, 0, 0);
      ijk[axisIndex] = slice;
      ijk[xAxis] = x;
      ijk[yAxis] = y;
      return Array.from(indexPointToWorld(imageData, ijk)) as Vector3;
    };
    const pointToPlaneIndex = (point: Vector3): [number, number] => {
      const ijk = worldPointToIndex(imageData, point as any);
      return [Number(ijk[xAxis]), Number(ijk[yAxis])];
    };
    return {
      viewID,
      dataID,
      view,
      imageData,
      metadata,
      axisIndex,
      xAxis,
      yAxis,
      slice,
      frameOfReference: {
        planeNormal: Array.from(planeNormal) as Vector3,
        planeOrigin: Array.from(planeOrigin) as Vector3,
      },
      pointToWorld,
      pointToPlaneIndex,
    };
  }

  function getPlanePoint(value: any, keys: string[] = ['x', 'y']): [number, number] | null {
    if (Array.isArray(value) && value.length >= 2) {
      const x = Number(value[0]);
      const y = Number(value[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
      return null;
    }
    if (value && typeof value === 'object') {
      const x = Number((value as any)[keys[0]]);
      const y = Number((value as any)[keys[1]]);
      if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
    }
    return null;
  }

  function getStylePatch(annotation: Record<string, any>) {
    const patch: Record<string, any> = {};
    for (const key of ['color', 'strokeWidth', 'fillColor', 'fillOpacity', 'hidden', 'label', 'name', 'metadata']) {
      if (Object.prototype.hasOwnProperty.call(annotation, key)) {
        patch[key] = annotation[key];
      }
    }
    return patch;
  }

  function getGeometryPatch(type: AnnotationType, annotation: Record<string, any>, context: ReturnType<typeof getAnnotationSliceContext>, existingTool?: any) {
    if (type === 'polygon') {
      const pointsInput = Array.isArray(annotation.points) ? annotation.points : Array.isArray(annotation.polygon) ? annotation.polygon : null;
      if (!pointsInput) return {};
      const points = pointsInput
        .map((point: any) => getPlanePoint(point))
        .filter((point: [number, number] | null): point is [number, number] => !!point)
        .map(([x, y]) => context.pointToWorld(x, y));
      if (points.length < 3) {
        throw new Error('Polygon annotation requires at least three points');
      }
      return { points };
    }

    const first = getPlanePoint(annotation.firstPoint ?? annotation.point1 ?? annotation.start, ['x', 'y']);
    const second = getPlanePoint(annotation.secondPoint ?? annotation.point2 ?? annotation.end, ['x', 'y']);
    const x = Number(annotation.x ?? annotation.left ?? annotation.x1);
    const y = Number(annotation.y ?? annotation.top ?? annotation.y1);
    const width = Number(annotation.width);
    const height = Number(annotation.height);
    const x2 = Number(annotation.x2 ?? annotation.right);
    const y2 = Number(annotation.y2 ?? annotation.bottom);
    const cx = Number(annotation.cx ?? annotation.centerX);
    const cy = Number(annotation.cy ?? annotation.centerY);
    const radius = Number(annotation.radius);
    const rx = Number(annotation.rx ?? annotation.radiusX);
    const ry = Number(annotation.ry ?? annotation.radiusY);

    let p1 = first;
    let p2 = second;

    if (!p1 || !p2) {
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height)) {
        p1 = [x, y];
        p2 = [x + width, y + height];
      } else if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(x2) && Number.isFinite(y2)) {
        p1 = [x, y];
        p2 = [x2, y2];
      }
    }

    if (!p1 || !p2) {
      if (Number.isFinite(cx) && Number.isFinite(cy)) {
        if (Number.isFinite(radius)) {
          p1 = [cx - radius, cy - radius];
          p2 = [cx + radius, cy + radius];
        } else if (Number.isFinite(rx) && Number.isFinite(ry)) {
          p1 = [cx - rx, cy - ry];
          p2 = [cx + rx, cy + ry];
        }
      }
    }

    if (!p1 || !p2) {
      if (existingTool?.firstPoint && existingTool?.secondPoint) {
        const fallback1 = context.pointToPlaneIndex(existingTool.firstPoint);
        const fallback2 = context.pointToPlaneIndex(existingTool.secondPoint);
        p1 = p1 || fallback1;
        p2 = p2 || fallback2;
      }
    }

    if (!p1 || !p2) {
      return {};
    }

    return {
      firstPoint: context.pointToWorld(p1[0], p1[1]),
      secondPoint: context.pointToWorld(p2[0], p2[1]),
    };
  }

  function getAnnotationMeasurements(type: AnnotationType, tool: any, imageData: any) {
    if (!imageData || !tool) return null;
    if (type === 'ruler') {
      if (!tool.firstPoint || !tool.secondPoint) return null;
      return {
        length: Math.sqrt(distance2BetweenPoints(tool.firstPoint, tool.secondPoint)),
      };
    }
    if (type === 'rectangle') {
      if (!tool.firstPoint || !tool.secondPoint) return null;
      return compactMeasurements(computeRectangleMeasurements(imageData, tool.firstPoint, tool.secondPoint));
    }
    if (type === 'circle') {
      if (!tool.firstPoint || !tool.secondPoint) return null;
      return compactMeasurements(computeEllipseMeasurements(imageData, tool.firstPoint, tool.secondPoint));
    }
    if (type === 'polygon') {
      if (!Array.isArray(tool.points) || tool.points.length < 3) return null;
      return compactMeasurements(computePolygonMeasurements(imageData, tool.points));
    }
    return null;
  }

  function toPlainPoint(point: any) {
    if (!point || typeof point.length !== 'number') return null;
    const values = Array.from(point).slice(0, 3).map(Number);
    if (values.length < 3 || values.some(value => !Number.isFinite(value))) return null;
    return values as Vector3;
  }

  function getPlaneBounds(points: Array<{ x: number; y: number } | null | undefined>) {
    const validPoints = points.filter((point): point is { x: number; y: number } => !!point
      && Number.isFinite(point.x)
      && Number.isFinite(point.y));
    if (!validPoints.length) return null;
    const xs = validPoints.map(point => point.x);
    const ys = validPoints.map(point => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return {
      x,
      y,
      width: Math.max(...xs) - x,
      height: Math.max(...ys) - y,
    };
  }

  function getImagePlaneGeometry(type: AnnotationType, points: {
    firstPoint?: { x: number; y: number } | null;
    secondPoint?: { x: number; y: number } | null;
    points?: Array<{ x: number; y: number }>;
  }) {
    const bounds = getPlaneBounds([
      points.firstPoint,
      points.secondPoint,
      ...(points.points || []),
    ]);
    const result: Record<string, any> = {
      coordinateSystem: 'current-slice-image-plane-index',
      units: 'index-pixels',
      bounds,
    };
    if (points.firstPoint && points.secondPoint) {
      const width = Math.abs(points.secondPoint.x - points.firstPoint.x);
      const height = Math.abs(points.secondPoint.y - points.firstPoint.y);
      if (type === 'ruler') {
        result.length = Math.sqrt((width ** 2) + (height ** 2));
      } else {
        result.width = width;
        result.height = height;
      }
      if (type === 'circle') {
        result.center = {
          x: (points.firstPoint.x + points.secondPoint.x) / 2,
          y: (points.firstPoint.y + points.secondPoint.y) / 2,
        };
        result.radiusX = width / 2;
        result.radiusY = height / 2;
      }
    }
    return result;
  }

  function getMeasurementUnits(type: AnnotationType) {
    if (type === 'ruler') {
      return { length: 'mm' };
    }
    return {
      width: 'mm',
      height: 'mm',
      area: 'mm^2',
      perimeter: 'mm',
      scalar: 'image scalar units',
    };
  }

  function serializeAnnotation(type: AnnotationType, tool: any, context?: ReturnType<typeof getAnnotationSliceContext>) {
    const imageData = tool?.imageID ? imageCacheStore.getVtkImageData(tool.imageID) : null;
    const toPlane = (point: Vector3) => {
      if (!point || !context || tool?.imageID !== context.dataID) return null;
      const [x, y] = context.pointToPlaneIndex(point);
      return { x, y };
    };
    const imagePlaneFirstPoint = tool?.firstPoint ? toPlane(tool.firstPoint) : null;
    const imagePlaneSecondPoint = tool?.secondPoint ? toPlane(tool.secondPoint) : null;
    const imagePlanePoints = Array.isArray(tool?.points)
      ? tool.points.map((point: Vector3) => toPlane(point)).filter(Boolean) as Array<{ x: number; y: number }>
      : undefined;
    return {
      id: tool?.id,
      type,
      imageID: tool?.imageID,
      slice: tool?.slice,
      hidden: !!tool?.hidden,
      placing: !!tool?.placing,
      label: tool?.label ?? null,
      labelName: tool?.labelName ?? null,
      color: tool?.color ?? null,
      strokeWidth: tool?.strokeWidth ?? null,
      fillColor: tool?.fillColor ?? null,
      fillOpacity: tool?.fillOpacity ?? null,
      firstPoint: toPlainPoint(tool?.firstPoint),
      secondPoint: toPlainPoint(tool?.secondPoint),
      points: Array.isArray(tool?.points) ? tool.points.map(toPlainPoint).filter(Boolean) : undefined,
      imagePlane: {
        coordinateSystem: 'current-slice-image-plane-index',
        units: 'index-pixels',
        firstPoint: imagePlaneFirstPoint,
        secondPoint: imagePlaneSecondPoint,
        points: imagePlanePoints,
        geometry: getImagePlaneGeometry(type, {
          firstPoint: imagePlaneFirstPoint,
          secondPoint: imagePlaneSecondPoint,
          points: imagePlanePoints,
        }),
      },
      measurementUnits: getMeasurementUnits(type),
      measurements: getAnnotationMeasurements(type, tool, imageData),
    };
  }

  function listAnnotations(payload: AnnotationPayload = {}) {
    const context = getAnnotationSliceContext(payload);
    const requestedType = normalizeText(payload.type) as AnnotationType;
    const allowAllTypes = !requestedType || !['ruler', 'rectangle', 'circle', 'polygon'].includes(requestedType);
    const candidates: Array<{ type: AnnotationType; store: any }> = [
      { type: 'ruler', store: rulerStore },
      { type: 'rectangle', store: rectangleStore },
      { type: 'circle', store: circleStore },
      { type: 'polygon', store: polygonStore },
    ];
    const annotations = candidates
      .filter(entry => allowAllTypes || entry.type === requestedType)
      .flatMap(entry => (entry.store.tools || [])
        .filter((tool: any) => tool?.imageID === context.dataID)
        .map((tool: any) => serializeAnnotation(entry.type, tool, context)));

    return {
      activeViewID: context.viewID,
      activeViewDataID: context.dataID,
      viewOrientation: (context.view.options as any)?.orientation ?? context.view.name ?? null,
      annotations,
      count: annotations.length,
    };
  }

  function createAnnotation(payload: AnnotationPayload = {}) {
    const context = getAnnotationSliceContext(payload);
    const annotation = (payload.annotation || {}) as Record<string, any>;
    const type = normalizeText(annotation.type || payload.type) as AnnotationType;
    if (!['ruler', 'rectangle', 'circle', 'polygon'].includes(type)) {
      throw new Error('Annotation create requires type: ruler, rectangle, circle, or polygon');
    }
    const store = getAnnotationStore(type);
    if (!store) {
      throw new Error(`Unsupported annotation type: ${type}`);
    }
    const patch = {
      imageID: context.dataID,
      slice: context.slice,
      placing: false,
      frameOfReference: context.frameOfReference,
      ...getStylePatch(annotation),
      ...getGeometryPatch(type, annotation, context),
    };
    const annotationId = store.addTool(patch);
    const tool = store.toolByID[annotationId];
    return {
      action: 'create',
      annotation: serializeAnnotation(type, tool, context),
    };
  }

  function updateAnnotation(payload: AnnotationPayload = {}) {
    const annotation = (payload.annotation || {}) as Record<string, any>;
    const annotationId = String(payload.annotationId || payload.id || annotation.id || '');
    if (!annotationId) {
      throw new Error('Annotation update requires annotationId');
    }
    const found = findAnnotationById(annotationId);
    if (!found) {
      throw new Error(`Annotation not found: ${annotationId}`);
    }
    const context = getAnnotationSliceContext(payload);
    const patch: Record<string, any> = {
      ...getStylePatch(annotation),
      ...getGeometryPatch(found.type, annotation, context, found.tool),
    };
    const hasPatch = Object.keys(patch).length > 0;
    if (hasPatch) {
      const geometryKeys = ['firstPoint', 'secondPoint', 'points'];
      if (geometryKeys.some(key => Object.prototype.hasOwnProperty.call(patch, key))) {
        patch.slice = context.slice;
        patch.frameOfReference = context.frameOfReference;
        patch.imageID = context.dataID;
      }
      found.store.updateTool(annotationId, patch);
    }
    return {
      action: 'update',
      annotation: serializeAnnotation(found.type, found.store.toolByID[annotationId], context),
      updated: hasPatch,
    };
  }

  function deleteAnnotation(payload: AnnotationPayload = {}) {
    const annotation = (payload.annotation || {}) as Record<string, any>;
    const annotationId = String(payload.annotationId || payload.id || annotation.id || '');
    if (!annotationId) {
      throw new Error('Annotation delete requires annotationId');
    }
    const found = findAnnotationById(annotationId);
    if (!found) {
      throw new Error(`Annotation not found: ${annotationId}`);
    }
    found.store.removeTool(annotationId);
    return {
      action: 'delete',
      annotationId,
      type: found.type,
      deleted: true,
    };
  }

  function manageAnnotation(payload: AnnotationPayload = {}) {
    try {
      const action = normalizeText(payload.action || payload.annotation?.action || 'list');
      let result: any;
      switch (action) {
        case 'create':
          result = createAnnotation(payload);
          break;
        case 'update':
          result = updateAnnotation(payload);
          break;
        case 'delete':
          result = deleteAnnotation(payload);
          break;
        case 'list':
          result = listAnnotations(payload);
          break;
        default:
          throw new Error(`Unsupported annotation action: ${action}`);
      }
      emitter?.emit('annotationresult', jsonClone({
        requestId: payload.requestId,
        result: {
          ...result,
          capturedAt: Date.now(),
        },
      }));
    } catch (err: any) {
      emitter?.emit('annotationresult', jsonClone({
        requestId: payload.requestId,
        error: err?.message || String(err),
      }));
    }
  }

  function getVolumeContext(payload: VolumePayload = {}) {
    const { viewID, dataID } = getActiveViewData(payload);
    const view = viewID ? viewStore.getView(viewID) : null;
    if (!dataID) {
      throw new Error('Volume access requires an active VolView image');
    }
    const image = imageCacheStore.imageById[dataID];
    const imageData = image?.getVtkImageData?.();
    const scalars = imageData?.getPointData?.().getScalars?.();
    const values = scalars?.getData?.();
    const metadata = image?.getImageMetadata?.();
    if (!imageData || !scalars || !values?.length) {
      throw new Error('Volume access requires scalar vtkImageData');
    }
    const dimensions = imageData.getDimensions?.()?.slice?.(0, 3) || [0, 0, 0];
    const components = scalars.getNumberOfComponents?.() || 1;
    const component = clampNumber(payload.component, 0, 0, Math.max(0, components - 1));
    const scalarType = scalars.getDataType?.() || values.constructor?.name || 'unknown';
    const bytesPerScalar = Number((values as any).BYTES_PER_ELEMENT || 8);
    return {
      viewID: viewID ?? null,
      dataID,
      view,
      image,
      imageData,
      scalars,
      values,
      metadata,
      dimensions,
      components,
      component,
      scalarType,
      bytesPerScalar,
    };
  }

  function serializeVolumeInfo(context: ReturnType<typeof getVolumeContext>) {
    const { imageData, metadata, dimensions, components, scalarType, bytesPerScalar } = context;
    const voxelCount = Math.max(0, (dimensions[0] || 0) * (dimensions[1] || 0) * (dimensions[2] || 0));
    return {
      source: 'vtkImageData.scalars',
      coordinateSystem: 'image-index-ijk',
      units: 'index-voxels',
      dataID: context.dataID,
      viewID: context.viewID,
      viewName: context.view?.name ?? null,
      dimensions,
      spacing: imageData.getSpacing?.()?.slice?.(0, 3) ?? null,
      origin: imageData.getOrigin?.()?.slice?.(0, 3) ?? null,
      direction: imageData.getDirection?.()?.slice?.() ?? null,
      extent: imageData.getExtent?.()?.slice?.() ?? null,
      lpsOrientation: metadata?.lpsOrientation ?? null,
      scalarType,
      components,
      bytesPerScalar,
      voxelCount,
      scalarCount: context.values.length,
      rawBytes: context.values.length * bytesPerScalar,
      chunkLimits: {
        defaultMaxVoxels: 262144,
        maxVoxels: 1048576,
        defaultMaxBytes: 4 * 1024 * 1024,
        maxBytes: 16 * 1024 * 1024,
      },
    };
  }

  function vectorFromPayload(value: any, fallback: [number, number, number], keys: string[], aliases: string[] = []) {
    if (Array.isArray(value)) {
      return [0, 1, 2].map((index) => {
        const number = Number(value[index]);
        return Number.isFinite(number) ? number : fallback[index];
      }) as [number, number, number];
    }
    if (value && typeof value === 'object') {
      return keys.map((key, index) => {
        const alias = aliases[index];
        const number = Number(value[key] ?? (alias ? value[alias] : undefined));
        return Number.isFinite(number) ? number : fallback[index];
      }) as [number, number, number];
    }
    return [...fallback] as [number, number, number];
  }

  function strideFromPayload(value: any) {
    if (typeof value === 'number') {
      const stride = clampNumber(value, 1, 1, 64);
      return [stride, stride, stride] as [number, number, number];
    }
    const raw = vectorFromPayload(value, [1, 1, 1], ['i', 'j', 'k'], ['x', 'y', 'z']);
    return raw.map((item) => clampNumber(item, 1, 1, 64)) as [number, number, number];
  }

  function summarizeNumericValues(values: number[], bins = 64) {
    if (!values.length) return null;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const value of values) {
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
    }
    const mean = sum / values.length;
    const variance = values.reduce((acc, value) => acc + ((value - mean) ** 2), 0) / values.length;
    const binCount = Math.max(2, Math.min(256, Math.round(bins || 64)));
    const counts = Array.from({ length: binCount }, () => 0);
    const span = max - min || 1;
    for (const value of values) {
      const bin = Math.min(binCount - 1, Math.max(0, Math.floor(((value - min) / span) * binCount)));
      counts[bin] += 1;
    }
    return {
      min,
      max,
      mean,
      stddev: Math.sqrt(variance),
      sum,
      count: values.length,
      histogram: {
        bins: binCount,
        min,
        max,
        counts,
      },
    };
  }

  function getVolumeWindow(payload: VolumePayload, dimensions: number[], defaultDepth: 'slice' | 'volume') {
    const originRaw = vectorFromPayload(payload.origin, [0, 0, 0], ['i', 'j', 'k'], ['x', 'y', 'z']);
    const origin = originRaw.map((value, index) => clampNumber(value, 0, 0, Math.max(0, dimensions[index] - 1))) as [number, number, number];
    const defaultSize: [number, number, number] = [
      dimensions[0] - origin[0],
      dimensions[1] - origin[1],
      defaultDepth === 'volume' ? dimensions[2] - origin[2] : Math.min(1, dimensions[2] - origin[2]),
    ];
    const sizeRaw = vectorFromPayload(payload.size, defaultSize, ['i', 'j', 'k'], ['width', 'height', 'depth']);
    const size = sizeRaw.map((value, index) => clampNumber(value, defaultSize[index], 1, Math.max(1, dimensions[index] - origin[index]))) as [number, number, number];
    const stride = strideFromPayload(payload.stride);
    const sampleSize = size.map((value, index) => Math.ceil(value / stride[index])) as [number, number, number];
    const sourceRange = origin.map((value, index) => [value, value + size[index] - 1]) as [[number, number], [number, number], [number, number]];
    const sampledRange = origin.map((value, index) => [value, value + ((sampleSize[index] - 1) * stride[index])]) as [[number, number], [number, number], [number, number]];
    return {
      origin,
      size,
      stride,
      sourceRange,
      sourceExtentInclusive: [sourceRange[0][0], sourceRange[0][1], sourceRange[1][0], sourceRange[1][1], sourceRange[2][0], sourceRange[2][1]],
      sampledRange,
      sampledExtentInclusive: [sampledRange[0][0], sampledRange[0][1], sampledRange[1][0], sampledRange[1][1], sampledRange[2][0], sampledRange[2][1]],
      sampleSize,
      sampleVoxels: sampleSize[0] * sampleSize[1] * sampleSize[2],
    };
  }

  function createStatsAccumulator() {
    return {
      count: 0,
      min: Infinity,
      max: -Infinity,
      mean: 0,
      m2: 0,
      sum: 0,
    };
  }

  function addStatsValue(acc: ReturnType<typeof createStatsAccumulator>, value: number) {
    if (!Number.isFinite(value)) return;
    acc.count += 1;
    acc.min = Math.min(acc.min, value);
    acc.max = Math.max(acc.max, value);
    acc.sum += value;
    const delta = value - acc.mean;
    acc.mean += delta / acc.count;
    const delta2 = value - acc.mean;
    acc.m2 += delta * delta2;
  }

  function serializeStatsAccumulator(acc: ReturnType<typeof createStatsAccumulator>) {
    if (!acc.count) return null;
    return {
      min: acc.min,
      max: acc.max,
      mean: acc.mean,
      stddev: Math.sqrt(acc.m2 / acc.count),
      sum: acc.sum,
      count: acc.count,
    };
  }

  function normalizeScanThresholds(payload: VolumePayload = {}) {
    const thresholds = Array.isArray(payload.thresholds) ? payload.thresholds.slice() : [];
    if (payload.threshold) thresholds.unshift(payload.threshold);
    if (payload.min !== undefined || payload.max !== undefined) thresholds.unshift({ name: 'requested', min: payload.min, max: payload.max });
    return thresholds
      .map((threshold, index) => {
        const gt = toFiniteNumber(threshold?.gt);
        const gte = toFiniteNumber(threshold?.gte ?? threshold?.min);
        const lt = toFiniteNumber(threshold?.lt);
        const lte = toFiniteNumber(threshold?.lte ?? threshold?.max);
        if (gt === null && gte === null && lt === null && lte === null) return null;
        const lower = gt !== null ? gt : gte;
        const upper = lt !== null ? lt : lte;
        const lowerExclusive = gt !== null || Boolean(threshold?.exclusiveMin);
        const upperExclusive = lt !== null || Boolean(threshold?.exclusiveMax);
        const lowerLabel = lower === null ? null : `${lowerExclusive ? '>' : '>='}${lower}`;
        const upperLabel = upper === null ? null : `${upperExclusive ? '<' : '<='}${upper}`;
        const name = threshold?.name || [lowerLabel, upperLabel].filter(Boolean).join(' and ');
        return {
          index,
          name,
          min: lower,
          max: upper,
          lowerExclusive,
          upperExclusive,
          count: 0,
          boundingBox: null as null | { min: [number, number, number]; max: [number, number, number] },
        };
      })
      .filter(Boolean) as Array<{ index: number; name: string; min: number | null; max: number | null; lowerExclusive: boolean; upperExclusive: boolean; count: number; boundingBox: null | { min: [number, number, number]; max: [number, number, number] } }>;
  }

  function valueMatchesThreshold(value: number, threshold: { min: number | null; max: number | null; lowerExclusive?: boolean; upperExclusive?: boolean }) {
    const lowerMatch = threshold.min === null || (threshold.lowerExclusive ? value > threshold.min : value >= threshold.min);
    const upperMatch = threshold.max === null || (threshold.upperExclusive ? value < threshold.max : value <= threshold.max);
    return lowerMatch && upperMatch;
  }

  function addThresholdHit(threshold: { count: number; boundingBox: null | { min: [number, number, number]; max: [number, number, number] } }, i: number, j: number, k: number) {
    threshold.count += 1;
    if (!threshold.boundingBox) {
      threshold.boundingBox = { min: [i, j, k], max: [i, j, k] };
      return;
    }
    threshold.boundingBox.min = threshold.boundingBox.min.map((value, index) => Math.min(value, [i, j, k][index])) as [number, number, number];
    threshold.boundingBox.max = threshold.boundingBox.max.map((value, index) => Math.max(value, [i, j, k][index])) as [number, number, number];
  }

  function getVolumeChunk(payload: VolumePayload = {}) {
    const context = getVolumeContext(payload);
    const dimensions = context.dimensions;
    if (!dimensions.every((value) => value > 0)) {
      throw new Error('Volume chunk access requires non-empty image dimensions');
    }
    const window = getVolumeWindow(payload, dimensions, 'slice');
    const { origin, size, stride, sampleVoxels } = window;
    const maxVoxels = clampNumber(payload.maxVoxels, 262144, 1, 1048576);
    const maxBytes = clampNumber(payload.maxBytes, 4 * 1024 * 1024, 1024, 16 * 1024 * 1024);
    const rawBytes = sampleVoxels * context.bytesPerScalar;
    if (sampleVoxels > maxVoxels) {
      throw new Error(`Volume chunk requests ${sampleVoxels} voxels, over maxVoxels ${maxVoxels}`);
    }
    if (rawBytes > maxBytes) {
      throw new Error(`Volume chunk raw byte estimate ${rawBytes} exceeds maxBytes ${maxBytes}`);
    }

    const values: number[] = [];
    const dims = context.dimensions;
    const sourceValues = context.values;
    for (let kOffset = 0; kOffset < size[2]; kOffset += stride[2]) {
      const k = origin[2] + kOffset;
      for (let jOffset = 0; jOffset < size[1]; jOffset += stride[1]) {
        const j = origin[1] + jOffset;
        for (let iOffset = 0; iOffset < size[0]; iOffset += stride[0]) {
          const i = origin[0] + iOffset;
          values.push(Number(sourceValues[((k * dims[1] + j) * dims[0] + i) * context.components + context.component]));
        }
      }
    }
    const stats = summarizeNumericValues(values.filter(Number.isFinite), Number(payload.bins) || 64);
    return {
      ...serializeVolumeInfo(context),
      action: 'chunk',
      volumeAccessSemantics: {
        version: 1,
        boundedChunkOnly: true,
        order: 'x-fastest-then-y-then-z',
      },
      chunk: {
        ...window,
        sampleVoxels,
        rawBytes,
        maxVoxels,
        maxBytes,
        component: context.component,
        valuesIncluded: payload.includeValues !== false,
        valuesOrder: 'x-fastest-then-y-then-z',
      },
      valueRange: stats ? {
        min: stats.min,
        max: stats.max,
        mean: stats.mean,
        stddev: stats.stddev,
        sum: stats.sum,
        count: stats.count,
      } : null,
      histogram: stats?.histogram ?? null,
      values: payload.includeValues === false ? undefined : values,
    };
  }

  function getVolumeScan(payload: VolumePayload = {}) {
    const context = getVolumeContext(payload);
    const dimensions = context.dimensions;
    if (!dimensions.every((value) => value > 0)) {
      throw new Error('Volume scan requires non-empty image dimensions');
    }
    const scanWindow = getVolumeWindow(payload, dimensions, 'volume');
    const maxScanVoxels = clampNumber(payload.maxScanVoxels ?? payload.maxTotalVoxels, 50 * 1000 * 1000, 1, 100 * 1000 * 1000);
    if (scanWindow.sampleVoxels > maxScanVoxels) {
      throw new Error(`Volume scan requests ${scanWindow.sampleVoxels} sampled voxels, over maxScanVoxels ${maxScanVoxels}; increase stride or request a smaller source window`);
    }

    const maxChunkVoxels = clampNumber(payload.maxChunkVoxels ?? payload.maxVoxels, 262144, 1, 1048576);
    const maxChunkBytes = clampNumber(payload.maxChunkBytes ?? payload.maxBytes, 4 * 1024 * 1024, 1024, 16 * 1024 * 1024);
    const maxChunkSamples = Math.max(1, Math.min(maxChunkVoxels, Math.floor(maxChunkBytes / context.bytesPerScalar)));
    const samplesPerK = Math.max(1, scanWindow.sampleSize[0] * scanWindow.sampleSize[1]);
    const chunkSampleDepth = Math.max(1, Math.floor(maxChunkSamples / samplesPerK));
    const chunkCount = Math.ceil(scanWindow.sampleSize[2] / chunkSampleDepth);
    const chunkRawBytes = Math.min(maxChunkSamples, samplesPerK * chunkSampleDepth) * context.bytesPerScalar;
    const rawBytes = scanWindow.sampleVoxels * context.bytesPerScalar;
    const bins = Math.max(2, Math.min(256, Math.round(Number(payload.bins) || 64)));
    const sourceValues = context.values;
    const dims = context.dimensions;
    const globalStats = createStatsAccumulator();
    const thresholds = normalizeScanThresholds(payload);
    const sliceStats = new Map<number, ReturnType<typeof createStatsAccumulator>>();

    const visitSamples = (visitor: (value: number, i: number, j: number, k: number) => void) => {
      for (let kSampleChunkStart = 0; kSampleChunkStart < scanWindow.sampleSize[2]; kSampleChunkStart += chunkSampleDepth) {
        const kSampleChunkEnd = Math.min(scanWindow.sampleSize[2], kSampleChunkStart + chunkSampleDepth);
        for (let kSample = kSampleChunkStart; kSample < kSampleChunkEnd; kSample += 1) {
          const k = scanWindow.origin[2] + (kSample * scanWindow.stride[2]);
          for (let jSample = 0; jSample < scanWindow.sampleSize[1]; jSample += 1) {
            const j = scanWindow.origin[1] + (jSample * scanWindow.stride[1]);
            for (let iSample = 0; iSample < scanWindow.sampleSize[0]; iSample += 1) {
              const i = scanWindow.origin[0] + (iSample * scanWindow.stride[0]);
              visitor(Number(sourceValues[((k * dims[1] + j) * dims[0] + i) * context.components + context.component]), i, j, k);
            }
          }
        }
      }
    };

    visitSamples((value, i, j, k) => {
      if (!Number.isFinite(value)) return;
      addStatsValue(globalStats, value);
      let currentSliceStats = sliceStats.get(k);
      if (!currentSliceStats) {
        currentSliceStats = createStatsAccumulator();
        sliceStats.set(k, currentSliceStats);
      }
      addStatsValue(currentSliceStats, value);
      thresholds.forEach((threshold) => {
        if (valueMatchesThreshold(value, threshold)) {
          addThresholdHit(threshold, i, j, k);
        }
      });
    });

    const valueRange = serializeStatsAccumulator(globalStats);
    const histogramCounts = Array.from({ length: bins }, () => 0);
    if (valueRange) {
      const span = valueRange.max - valueRange.min || 1;
      visitSamples((value) => {
        if (!Number.isFinite(value)) return;
        const bin = Math.min(bins - 1, Math.max(0, Math.floor(((value - valueRange.min) / span) * bins)));
        histogramCounts[bin] += 1;
      });
    }

    const sliceSummaries = Array.from(sliceStats.entries())
      .flatMap(([k, stats]) => {
        const summary = serializeStatsAccumulator(stats);
        return summary ? [{ k, ...summary }] : [];
      })
      .sort((a, b) => a.k - b.k);
    const maxSliceSummaries = clampNumber(payload.maxSliceSummaries, 512, 0, 4096);
    const includeSliceSummaries = Boolean(payload.includeSlices || payload.perSlice);
    const sliceExtrema = sliceSummaries.length ? {
      lowestMin: sliceSummaries.reduce((best, item) => item.min < best.min ? item : best, sliceSummaries[0]),
      highestMax: sliceSummaries.reduce((best, item) => item.max > best.max ? item : best, sliceSummaries[0]),
      lowestMean: sliceSummaries.reduce((best, item) => item.mean < best.mean ? item : best, sliceSummaries[0]),
      highestMean: sliceSummaries.reduce((best, item) => item.mean > best.mean ? item : best, sliceSummaries[0]),
      highestStddev: sliceSummaries.reduce((best, item) => item.stddev > best.stddev ? item : best, sliceSummaries[0]),
    } : null;

    return {
      ...serializeVolumeInfo(context),
      action: 'scan',
      volumeAccessSemantics: {
        version: 2,
        boundedChunkOnly: true,
        statsOnly: true,
        order: 'x-fastest-then-y-then-z',
      },
      scan: {
        ...scanWindow,
        component: context.component,
        sampleVoxels: scanWindow.sampleVoxels,
        rawBytes,
        valuesIncluded: false,
        valuesOrder: 'x-fastest-then-y-then-z',
        maxScanVoxels,
        chunking: {
          axis: 'k',
          maxChunkVoxels,
          maxChunkBytes,
          maxChunkSamples,
          chunkSampleDepth,
          chunkCount,
          maxChunkRawBytes: chunkRawBytes,
        },
      },
      valueRange,
      histogram: valueRange ? {
        bins,
        min: valueRange.min,
        max: valueRange.max,
        counts: histogramCounts,
      } : null,
      thresholdCounts: thresholds.map((threshold) => ({
        name: threshold.name,
        min: threshold.min,
        max: threshold.max,
        lowerExclusive: threshold.lowerExclusive,
        upperExclusive: threshold.upperExclusive,
        count: threshold.count,
        fraction: globalStats.count ? threshold.count / globalStats.count : 0,
        boundingBox: threshold.boundingBox,
      })),
      sliceSummary: {
        sampledSliceCount: sliceSummaries.length,
        summariesIncluded: includeSliceSummaries && sliceSummaries.length <= maxSliceSummaries,
        maxSliceSummaries,
        extrema: sliceExtrema,
      },
      sliceSummaries: includeSliceSummaries && sliceSummaries.length <= maxSliceSummaries ? sliceSummaries : undefined,
    };
  }

  function readVolume(payload: VolumePayload = {}) {
    try {
      const action = normalizeText(payload.action || 'info');
      let result: any;
      switch (action) {
        case 'info':
          result = {
            action: 'info',
            volumeAccessSemantics: {
              version: 1,
              boundedChunkOnly: true,
            },
            ...serializeVolumeInfo(getVolumeContext(payload)),
          };
          break;
        case 'chunk':
          result = getVolumeChunk(payload);
          break;
        case 'scan':
          result = getVolumeScan(payload);
          break;
        default:
          throw new Error(`Unsupported volume action: ${action}`);
      }
      emitter?.emit('volumeresult', jsonClone({
        requestId: payload.requestId,
        result: {
          ...result,
          capturedAt: Date.now(),
        },
      }));
    } catch (err: any) {
      emitter?.emit('volumeresult', jsonClone({
        requestId: payload.requestId,
        error: err?.message || String(err),
      }));
    }
  }

  function getSegmentationSliceContext(payload: { viewID?: string; dataID?: string } = {}) {
    const { viewID, dataID } = getActiveViewData(payload);
    const view = viewID ? viewStore.getView(viewID) : null;
    if (!viewID || !dataID || !view || view.type === '3D') {
      throw new Error('Segmentation masks require an active 2D VolView pane with image data');
    }
    const image = imageCacheStore.imageById[dataID];
    const imageData = image?.getVtkImageData?.();
    const scalars = imageData?.getPointData?.().getScalars?.();
    const values = scalars?.getData?.();
    const metadata = image?.getImageMetadata?.();
    if (!imageData || !scalars || !values?.length || !metadata?.lpsOrientation || !metadata?.indexToWorld) {
      throw new Error('Segmentation masks require scalar image data and index/world transforms');
    }
    const dimensions = imageData.getDimensions?.() || [];
    const axisIndex = getPlaneAxisIndex(view, metadata);
    const xAxis = (axisIndex + 1) % 3;
    const yAxis = (axisIndex + 2) % 3;
    const sliceConfig = viewSliceStore.getConfig(viewID, dataID);
    const slice = Math.max(0, Math.min((dimensions[axisIndex] || 1) - 1, Math.round(sliceConfig?.slice ?? 0)));
    const components = scalars.getNumberOfComponents?.() || 1;
    const component = clampNumber((payload as SegmentationPayload).component, 0, 0, Math.max(0, components - 1));
    const sourceWidth = dimensions[xAxis] || 0;
    const sourceHeight = dimensions[yAxis] || 0;
    if (!sourceWidth || !sourceHeight) {
      throw new Error('Segmentation masks require a non-empty current slice plane');
    }
    return {
      viewID,
      dataID,
      view,
      imageData,
      values,
      dimensions,
      axisIndex,
      xAxis,
      yAxis,
      slice,
      sourceWidth,
      sourceHeight,
      components,
      component,
    };
  }

  function serializeSegment(segment?: SegmentMask | null) {
    if (!segment) return null;
    return {
      value: segment.value,
      name: segment.name,
      color: Array.from(segment.color || []),
      visible: segment.visible,
      locked: !!segment.locked,
    };
  }

  function serializeSegmentGroup(segmentGroupID: string) {
    const metadata = segmentGroupStore.metadataByID[segmentGroupID];
    const labelmap = segmentGroupStore.dataIndex[segmentGroupID];
    if (!metadata || !labelmap) return null;
    return {
      id: segmentGroupID,
      name: metadata.name,
      parentImage: metadata.parentImage,
      dimensions: labelmap.getDimensions?.()?.slice?.(0, 3) ?? null,
      segments: metadata.segments.order
        .map(value => serializeSegment(metadata.segments.byValue[value]))
        .filter(Boolean),
    };
  }

  function listSegmentGroups(payload: SegmentationPayload = {}) {
    const { dataID } = getActiveViewData(payload);
    const ids = dataID
      ? [...(segmentGroupStore.orderByParent[dataID] || [])]
      : Object.keys(segmentGroupStore.metadataByID);
    return {
      action: 'list',
      dataID: dataID ?? null,
      segmentGroups: ids
        .map(id => serializeSegmentGroup(id))
        .filter(Boolean),
    };
  }

  function parseSegmentColor(value: any, fallback: number[] = [255, 0, 0, 255]) {
    if (Array.isArray(value) && value.length >= 3) {
      return [0, 1, 2, 3].map((index) => {
        const channel = Number(value[index] ?? (index === 3 ? 255 : 0));
        return Math.max(0, Math.min(255, Number.isFinite(channel) ? Math.round(channel) : fallback[index]));
      }) as SegmentMask['color'];
    }
    if (typeof value === 'string') {
      const hex = value.trim().replace(/^#/, '');
      if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) {
        const color = [
          parseInt(hex.slice(0, 2), 16),
          parseInt(hex.slice(2, 4), 16),
          parseInt(hex.slice(4, 6), 16),
          hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255,
        ];
        return color as SegmentMask['color'];
      }
    }
    return fallback as SegmentMask['color'];
  }

  function getRequestedSegmentGroupID(payload: SegmentationPayload) {
    const value = payload.segmentGroupId ?? payload.segmentGroupID ?? payload.groupId ?? payload.id;
    return value == null ? '' : String(value);
  }

  function getOrCreateSegmentGroup(payload: SegmentationPayload, dataID: string, createNewDefault = false) {
    const requestedID = getRequestedSegmentGroupID(payload);
    let segmentGroupID = requestedID;
    if (segmentGroupID) {
      const metadata = segmentGroupStore.metadataByID[segmentGroupID];
      if (!metadata) {
        throw new Error(`Segment group not found: ${segmentGroupID}`);
      }
      if (metadata.parentImage !== dataID) {
        throw new Error(`Segment group ${segmentGroupID} is not attached to the active image`);
      }
    } else {
      const shouldCreateNew = payload.newSegmentGroup === true
        || payload.createNewGroup === true
        || (createNewDefault && payload.reuseSegmentGroup !== true);
      segmentGroupID = shouldCreateNew ? '' : segmentGroupStore.orderByParent[dataID]?.[0] || '';
      if (!segmentGroupID) {
        segmentGroupID = segmentGroupStore.newLabelmapFromImage(dataID) || '';
      }
    }
    if (!segmentGroupID || !segmentGroupStore.dataIndex[segmentGroupID]) {
      throw new Error(`Failed to create or find a segment group for image ${dataID}`);
    }
    const groupName = payload.segmentGroupName ?? payload.groupName;
    if (groupName) {
      segmentGroupStore.updateMetadata(segmentGroupID, { name: String(groupName) });
    }
    return segmentGroupID;
  }

  function getExistingSegmentGroup(payload: SegmentationPayload, dataID: string) {
    const requestedID = getRequestedSegmentGroupID(payload);
    const segmentGroupID = requestedID || segmentGroupStore.orderByParent[dataID]?.[0] || '';
    if (!segmentGroupID || !segmentGroupStore.metadataByID[segmentGroupID]) {
      throw new Error(requestedID ? `Segment group not found: ${requestedID}` : `No segment group exists for image ${dataID}`);
    }
    if (segmentGroupStore.metadataByID[segmentGroupID].parentImage !== dataID) {
      throw new Error(`Segment group ${segmentGroupID} is not attached to the active image`);
    }
    return segmentGroupID;
  }

  function getExplicitSegmentValue(payload: SegmentationPayload) {
    const value = payload.segmentValue ?? payload.value ?? payload.segment?.value;
    return value == null ? null : clampNumber(value, 1, 1, 255);
  }

  function getNextUnusedSegmentValue(segmentGroupID: string) {
    const segments = segmentGroupStore.metadataByID[segmentGroupID]?.segments;
    for (let value = 1; value <= 255; value++) {
      if (!segments?.byValue[value]) return value;
    }
    throw new Error(`Segment group ${segmentGroupID} has no unused segment values`);
  }

  function getSegmentValue(payload: SegmentationPayload, segmentGroupID?: string, allocateNew = false) {
    const explicitValue = getExplicitSegmentValue(payload);
    if (explicitValue !== null) return explicitValue;
    if (allocateNew && segmentGroupID) return getNextUnusedSegmentValue(segmentGroupID);
    return clampNumber(paintStore.activeSegment ?? 1, 1, 1, 255);
  }

  function ensureSegment(segmentGroupID: string, payload: SegmentationPayload, segmentValue: number, mode: string) {
    const metadata = segmentGroupStore.metadataByID[segmentGroupID];
    const existing = metadata.segments.byValue[segmentValue];
    const segmentPatch = payload.segment || {};
    if (!existing && mode === 'erase') {
      return null;
    }
    if (!existing) {
      return segmentGroupStore.addSegment(segmentGroupID, {
        value: segmentValue,
        name: String(segmentPatch.name || payload.name || `AI Segment ${segmentValue}`),
        color: parseSegmentColor(segmentPatch.color, [255, 0, 0, 255]),
        visible: segmentPatch.visible !== false,
        locked: !!segmentPatch.locked,
      });
    }
    const patch: Partial<Omit<SegmentMask, 'value'>> = {};
    if (segmentPatch.name || payload.name) patch.name = String(segmentPatch.name || payload.name);
    if (segmentPatch.color) patch.color = parseSegmentColor(segmentPatch.color, Array.from(existing.color || [255, 0, 0, 255]));
    if (typeof segmentPatch.visible === 'boolean') patch.visible = segmentPatch.visible;
    if (typeof segmentPatch.locked === 'boolean') patch.locked = segmentPatch.locked;
    if (Object.keys(patch).length) {
      segmentGroupStore.updateSegment(segmentGroupID, segmentValue, patch);
    }
    const segment = segmentGroupStore.metadataByID[segmentGroupID].segments.byValue[segmentValue];
    if (segment?.locked && mode !== 'erase') {
      throw new Error(`Segment ${segmentValue} is locked`);
    }
    return segment;
  }

  function normalizeMaskRows(payload: SegmentationPayload, sourceWidth: number, sourceHeight: number) {
    const mask = payload.mask && typeof payload.mask === 'object' ? payload.mask : payload;
    const rows = Array.isArray(mask.rows) ? mask.rows : Array.isArray(payload.rows) ? payload.rows : null;
    if (rows) {
      const height = rows.length;
      const width = Math.max(0, ...rows.map((row: any) => Array.isArray(row) ? row.length : 0));
      if (!width || !height) {
        throw new Error('Segmentation mask rows must be non-empty');
      }
      const x = clampNumber(mask.x ?? mask.left ?? mask.originX ?? 0, 0, 0, Math.max(0, sourceWidth - 1));
      const y = clampNumber(mask.y ?? mask.top ?? mask.originY ?? 0, 0, 0, Math.max(0, sourceHeight - 1));
      const clippedWidth = Math.max(0, Math.min(width, sourceWidth - x));
      const clippedHeight = Math.max(0, Math.min(height, sourceHeight - y));
      if (!clippedWidth || !clippedHeight) {
        throw new Error('Segmentation mask rows do not overlap the current slice');
      }
      return {
        source: 'mask.rows',
        inputSize: { width, height, pixels: width * height },
        boundingBox: { x, y, width: clippedWidth, height: clippedHeight },
        contains: (sourceX: number, sourceY: number) => !!rows[sourceY - y]?.[sourceX - x],
      };
    }

    const values = Array.isArray(mask.values) ? mask.values : null;
    if (values) {
      const width = clampNumber(mask.width, 0, 1, sourceWidth);
      const height = clampNumber(mask.height, 0, 1, sourceHeight);
      if (!width || !height || values.length < width * height) {
        throw new Error('Segmentation mask values require width, height, and width*height entries');
      }
      const x = clampNumber(mask.x ?? mask.left ?? mask.originX ?? 0, 0, 0, Math.max(0, sourceWidth - 1));
      const y = clampNumber(mask.y ?? mask.top ?? mask.originY ?? 0, 0, 0, Math.max(0, sourceHeight - 1));
      const clippedWidth = Math.max(0, Math.min(width, sourceWidth - x));
      const clippedHeight = Math.max(0, Math.min(height, sourceHeight - y));
      if (!clippedWidth || !clippedHeight) {
        throw new Error('Segmentation mask values do not overlap the current slice');
      }
      return {
        source: 'mask.values',
        inputSize: { width, height, pixels: width * height },
        boundingBox: { x, y, width: clippedWidth, height: clippedHeight },
        contains: (sourceX: number, sourceY: number) => !!values[(sourceY - y) * width + (sourceX - x)],
      };
    }

    const roi = mask.roi || payload.roi;
    if (roi) {
      const normalized = normalizeRoiShape({ roi } as RoiSamplePayload, sourceWidth, sourceHeight);
      return {
        source: `roi.${normalized.type}`,
        inputSize: { width: normalized.boundingBox.width, height: normalized.boundingBox.height, pixels: normalized.boundingBox.width * normalized.boundingBox.height },
        boundingBox: normalized.boundingBox,
        contains: (sourceX: number, sourceY: number) => normalized.contains(sourceX, sourceY),
        roi: {
          type: normalized.type,
          rectangle: 'rectangle' in normalized ? normalized.rectangle : undefined,
          ellipse: 'ellipse' in normalized ? normalized.ellipse : undefined,
          points: 'points' in normalized ? normalized.points : undefined,
          boundingBox: normalized.boundingBox,
        },
      };
    }

    throw new Error('Segmentation applyMask requires mask.rows, mask.values, or roi');
  }

  function applyCurrentSliceMask(payload: SegmentationPayload = {}) {
    const context = getSegmentationSliceContext(payload);
    const maxPixels = clampNumber(payload.maxPixels, 262144, 1, 1048576);
    const mask = normalizeMaskRows(payload, context.sourceWidth, context.sourceHeight);
    const candidatePixelCount = mask.boundingBox.width * mask.boundingBox.height;
    if (candidatePixelCount > maxPixels) {
      throw new Error(`Segmentation mask touches ${candidatePixelCount} candidate pixels, over maxPixels ${maxPixels}`);
    }

    const mode = normalizeText(payload.mode || 'add') || 'add';
    if (!['add', 'replace', 'erase'].includes(mode)) {
      throw new Error(`Unsupported segmentation mask mode: ${mode}`);
    }
    const explicitSegmentValue = getExplicitSegmentValue(payload);
    const createNewGroupByDefault = mode !== 'erase'
      && !getRequestedSegmentGroupID(payload)
      && explicitSegmentValue === null;
    const segmentGroupIDsBefore = [...(segmentGroupStore.orderByParent[context.dataID] || [])];
    const segmentGroupID = getOrCreateSegmentGroup(payload, context.dataID, createNewGroupByDefault);
    const createdSegmentGroup = !segmentGroupIDsBefore.includes(segmentGroupID);
    const segmentPatch = payload.segment || {};
    if (createdSegmentGroup && !payload.groupName && !payload.segmentGroupName && segmentPatch.name) {
      segmentGroupStore.updateMetadata(segmentGroupID, { name: String(segmentPatch.name) });
    }
    const segmentValue = createNewGroupByDefault && payload.reuseSegmentGroup !== true
      ? 1
      : getSegmentValue(payload, segmentGroupID, mode !== 'erase');
    const segment = ensureSegment(segmentGroupID, payload, segmentValue, mode);
    const labelmap = segmentGroupStore.dataIndex[segmentGroupID];
    const labelValues = labelmap.getPointData().getScalars().getData() as Uint8Array;
    const labelDims = labelmap.getDimensions();
    const labelJStride = labelDims[0];
    const labelKStride = labelDims[0] * labelDims[1];
    const overwriteExisting = payload.overwrite === true || payload.overwriteExisting === true;

    const sourceScalarAt = (x: number, y: number) => {
      const ijk = [0, 0, 0];
      ijk[context.axisIndex] = context.slice;
      ijk[context.xAxis] = x;
      ijk[context.yAxis] = y;
      return Number(context.values[((ijk[2] * context.dimensions[1] + ijk[1]) * context.dimensions[0] + ijk[0]) * context.components + context.component]);
    };
    const getMaskScalarValues = () => {
      const values: number[] = [];
      const { x, y, width, height } = mask.boundingBox;
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const sourceX = x + col;
          const sourceY = y + row;
          if (!mask.contains(sourceX, sourceY)) continue;
          const value = sourceScalarAt(sourceX, sourceY);
          if (Number.isFinite(value)) values.push(value);
        }
      }
      return values;
    };
    const percentile = (sortedValues: number[], percent: number) => {
      if (!sortedValues.length) return null;
      const clamped = Math.max(0, Math.min(100, percent));
      const index = (clamped / 100) * (sortedValues.length - 1);
      const lower = Math.floor(index);
      const upper = Math.ceil(index);
      if (lower === upper) return sortedValues[lower];
      const fraction = index - lower;
      return sortedValues[lower] * (1 - fraction) + sortedValues[upper] * fraction;
    };
    const getThresholdStats = () => {
      const values = getMaskScalarValues().sort((a, b) => a - b);
      if (!values.length) return null;
      const sum = values.reduce((acc, value) => acc + value, 0);
      const mean = sum / values.length;
      const variance = values.reduce((acc, value) => acc + ((value - mean) ** 2), 0) / values.length;
      return {
        count: values.length,
        min: values[0],
        max: values[values.length - 1],
        mean,
        median: percentile(values, 50),
        p25: percentile(values, 25),
        p75: percentile(values, 75),
        stddev: Math.sqrt(variance),
      };
    };
    const resolveThresholdValue = (spec: any, stats: ReturnType<typeof getThresholdStats>) => {
      const numeric = toFiniteNumber(spec);
      if (numeric !== null) return numeric;
      if (!stats || typeof spec !== 'string') return null;
      const text = normalizeText(spec).replace(/[_\s-]/g, '');
      if (text === 'mean' || text === 'average' || text === 'avg') return stats.mean;
      if (text === 'median' || text === 'p50') return stats.median;
      if (text === 'min' || text === 'minimum') return stats.min;
      if (text === 'max' || text === 'maximum') return stats.max;
      if (text === 'p25' || text === 'q1') return stats.p25;
      if (text === 'p75' || text === 'q3') return stats.p75;
      const percentileMatch = text.match(/^p(\d+(?:\.\d+)?)$/);
      if (percentileMatch) return percentile(getMaskScalarValues().sort((a, b) => a - b), Number(percentileMatch[1]));
      return null;
    };
    const thresholdInput = payload.threshold && typeof payload.threshold === 'object' ? payload.threshold : {};
    const thresholdMode = normalizeText(
      thresholdInput.mode
      ?? thresholdInput.direction
      ?? (thresholdInput.above !== undefined ? 'above' : thresholdInput.below !== undefined ? 'below' : '')
    );
    const needsThresholdStats = ['value', 'statistic', 'above', 'below', 'min', 'max'].some((key) => {
      const value = thresholdInput[key] ?? (key === 'min' ? payload.min : key === 'max' ? payload.max : undefined);
      return typeof value === 'string' && toFiniteNumber(value) === null;
    }) || ['above', 'below'].includes(thresholdMode) || !!thresholdInput.statistic;
    const thresholdStats = needsThresholdStats ? getThresholdStats() : null;
    const thresholdDelta = Number(thresholdInput.delta ?? 0);
    const finiteDelta = Number.isFinite(thresholdDelta) ? thresholdDelta : 0;
    const baseThresholdSpec = thresholdInput.value ?? thresholdInput.statistic ?? thresholdInput.above ?? thresholdInput.below;
    const minThreshold = (() => {
      if (thresholdMode === 'above') return resolveThresholdValue(baseThresholdSpec ?? 'mean', thresholdStats) ?? toFiniteNumber(payload.min);
      if (thresholdMode === 'below') return null;
      if (thresholdInput.min !== undefined || payload.min !== undefined) return resolveThresholdValue(thresholdInput.min ?? payload.min, thresholdStats);
      return null;
    })();
    const maxThreshold = (() => {
      if (thresholdMode === 'below') return resolveThresholdValue(baseThresholdSpec ?? 'mean', thresholdStats) ?? toFiniteNumber(payload.max);
      if (thresholdMode === 'above') return null;
      if (thresholdInput.max !== undefined || payload.max !== undefined) return resolveThresholdValue(thresholdInput.max ?? payload.max, thresholdStats);
      return null;
    })();
    const adjustedMinThreshold = minThreshold === null ? null : minThreshold + (thresholdMode === 'below' ? 0 : finiteDelta);
    const adjustedMaxThreshold = maxThreshold === null ? null : maxThreshold + (thresholdMode === 'below' ? finiteDelta : 0);
    const hasThreshold = adjustedMinThreshold !== null || adjustedMaxThreshold !== null;
    const passesThreshold = (x: number, y: number) => {
      if (!hasThreshold) return true;
      const value = sourceScalarAt(x, y);
      if (!Number.isFinite(value)) return false;
      const inRange = (adjustedMinThreshold === null || value >= adjustedMinThreshold)
        && (adjustedMaxThreshold === null || value <= adjustedMaxThreshold);
      return thresholdMode === 'outside' ? !inRange : inRange;
    };
    const maskKey = (x: number, y: number) => `${x},${y}`;
    const seedPoint = getPlanePoint(payload.seed);
    const useConnectedComponent = !!seedPoint || payload.connectedComponent === true;
    const connectivity = payload.connectivity === 8 ? 8 : 4;
    const connectedComponent = (() => {
      if (!useConnectedComponent) return null;
      if (!seedPoint) {
        throw new Error('connectedComponent segmentation requires seed: {x,y} or [x,y]');
      }
      const seedX = Math.round(seedPoint[0]);
      const seedY = Math.round(seedPoint[1]);
      const { x, y, width, height } = mask.boundingBox;
      const inBounds = (pointX: number, pointY: number) => pointX >= x
        && pointX < x + width
        && pointY >= y
        && pointY < y + height;
      const accepts = (pointX: number, pointY: number) => inBounds(pointX, pointY)
        && mask.contains(pointX, pointY)
        && passesThreshold(pointX, pointY);
      const pixels = new Set<string>();
      if (!accepts(seedX, seedY)) {
        return { seed: { x: seedX, y: seedY }, connectivity, found: false, pixelCount: 0, pixels };
      }
      const queue: Array<[number, number]> = [[seedX, seedY]];
      pixels.add(maskKey(seedX, seedY));
      const neighbors = connectivity === 8
        ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
        : [[1, 0], [-1, 0], [0, 1], [0, -1]];
      while (queue.length) {
        const [pointX, pointY] = queue.shift()!;
        for (const [dx, dy] of neighbors) {
          const nextX = pointX + dx;
          const nextY = pointY + dy;
          const key = maskKey(nextX, nextY);
          if (pixels.has(key) || !accepts(nextX, nextY)) continue;
          pixels.add(key);
          queue.push([nextX, nextY]);
        }
      }
      return { seed: { x: seedX, y: seedY }, connectivity, found: true, pixelCount: pixels.size, pixels };
    })();
    const labelOffsetAt = (x: number, y: number) => {
      const sourceIJK = vec3.fromValues(0, 0, 0);
      sourceIJK[context.axisIndex] = context.slice;
      sourceIJK[context.xAxis] = x;
      sourceIJK[context.yAxis] = y;
      const worldPoint = indexPointToWorld(context.imageData, sourceIJK);
      const labelIJK = Array.from(worldPointToIndex(labelmap, worldPoint as any)).map(value => Math.round(value));
      if (labelIJK.some((value, index) => value < 0 || value >= labelDims[index])) return null;
      return labelIJK[0] + labelIJK[1] * labelJStride + labelIJK[2] * labelKStride;
    };
    const isLockedLabel = (value: number) => {
      if (value === LABELMAP_BACKGROUND_VALUE) return false;
      return !!segmentGroupStore.metadataByID[segmentGroupID]?.segments.byValue[value]?.locked;
    };

    let maskPixelCount = 0;
    let painted = 0;
    let erased = 0;
    let unchanged = 0;
    let thresholdSkipped = 0;
    let lockedSkipped = 0;
    let outOfBoundsSkipped = 0;
    let existingSegmentSkipped = 0;
    let connectedComponentSkipped = 0;

    const { x, y, width, height } = mask.boundingBox;
    if (mode === 'replace') {
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const offset = labelOffsetAt(x + col, y + row);
          if (offset !== null && labelValues[offset] === segmentValue) {
            labelValues[offset] = LABELMAP_BACKGROUND_VALUE;
          }
        }
      }
    }

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const sourceX = x + col;
        const sourceY = y + row;
        if (!mask.contains(sourceX, sourceY)) continue;
        maskPixelCount += 1;
        if (!passesThreshold(sourceX, sourceY)) {
          thresholdSkipped += 1;
          continue;
        }
        if (connectedComponent && !connectedComponent.pixels.has(maskKey(sourceX, sourceY))) {
          connectedComponentSkipped += 1;
          continue;
        }
        const offset = labelOffsetAt(sourceX, sourceY);
        if (offset === null) {
          outOfBoundsSkipped += 1;
          continue;
        }
        const currentValue = labelValues[offset];
        if (isLockedLabel(currentValue)) {
          lockedSkipped += 1;
          continue;
        }
        const nextValue = mode === 'erase' ? LABELMAP_BACKGROUND_VALUE : segmentValue;
        if (mode !== 'erase'
          && !overwriteExisting
          && currentValue !== LABELMAP_BACKGROUND_VALUE
          && currentValue !== segmentValue) {
          existingSegmentSkipped += 1;
          continue;
        }
        if (currentValue === nextValue) {
          unchanged += 1;
          continue;
        }
        labelValues[offset] = nextValue;
        if (nextValue === LABELMAP_BACKGROUND_VALUE) erased += 1;
        else painted += 1;
      }
    }

    labelmap.modified();
    paintStore.setActiveSegmentGroup(segmentGroupID);
    if (mode !== 'erase') {
      paintStore.setActiveSegment(segmentValue);
    }

    return {
      action: 'applyMask',
      mode,
      segmentationSemantics: {
        version: 2,
        defaultCreatesIndependentGroup: true,
        preservesExistingLabelsByDefault: true,
      },
      createdSegmentGroup,
      segmentGroup: serializeSegmentGroup(segmentGroupID),
      segment: serializeSegment(segment || segmentGroupStore.metadataByID[segmentGroupID].segments.byValue[segmentValue]),
      currentSliceMask: {
        source: mask.source,
        coordinateSystem: 'current-slice-image-plane-index',
        units: 'index-pixels',
        dataID: context.dataID,
        viewID: context.viewID,
        viewName: context.view.name,
        orientation: (context.view.options as any)?.orientation ?? null,
        dimensions: context.dimensions.slice(0, 3),
        planeAxes: { x: context.xAxis, y: context.yAxis, slice: context.axisIndex },
        slice: context.slice,
        sourceSize: {
          width: context.sourceWidth,
          height: context.sourceHeight,
          pixels: context.sourceWidth * context.sourceHeight,
        },
        boundingBox: mask.boundingBox,
        roi: mask.roi,
        threshold: hasThreshold ? {
          mode: thresholdMode || 'between',
          min: adjustedMinThreshold,
          max: adjustedMaxThreshold,
          component: context.component,
          stats: thresholdStats,
        } : null,
        connectedComponent: connectedComponent ? {
          seed: connectedComponent.seed,
          connectivity: connectedComponent.connectivity,
          found: connectedComponent.found,
          pixelCount: connectedComponent.pixelCount,
        } : null,
        overwriteExisting,
        candidatePixelCount,
        maxPixels,
        maskPixelCount,
        painted,
        erased,
        unchanged,
        thresholdSkipped,
        lockedSkipped,
        outOfBoundsSkipped,
        existingSegmentSkipped,
        connectedComponentSkipped,
      },
    };
  }

  function updateSegmentationSegment(payload: SegmentationPayload = {}) {
    const { dataID } = getActiveViewData(payload);
    if (!dataID) throw new Error('Segmentation updateSegment requires an active image');
    const segmentGroupID = getOrCreateSegmentGroup(payload, dataID);
    const segmentValue = getSegmentValue(payload, segmentGroupID);
    ensureSegment(segmentGroupID, payload, segmentValue, 'add');
    return {
      action: 'updateSegment',
      segmentGroup: serializeSegmentGroup(segmentGroupID),
      segment: serializeSegment(segmentGroupStore.metadataByID[segmentGroupID].segments.byValue[segmentValue]),
    };
  }

  function deleteSegmentationSegment(payload: SegmentationPayload = {}) {
    const { dataID } = getActiveViewData(payload);
    if (!dataID) throw new Error('Segmentation deleteSegment requires an active image');
    const segmentGroupID = getExistingSegmentGroup(payload, dataID);
    const segmentValue = getSegmentValue(payload, segmentGroupID);
    segmentGroupStore.deleteSegment(segmentGroupID, segmentValue);
    return {
      action: 'deleteSegment',
      segmentGroupID,
      segmentValue,
      deleted: true,
    };
  }

  function deleteSegmentationGroup(payload: SegmentationPayload = {}) {
    const segmentGroupID = getRequestedSegmentGroupID(payload);
    if (!segmentGroupID) {
      throw new Error('Segmentation deleteGroup requires segmentGroupId');
    }
    if (!segmentGroupStore.metadataByID[segmentGroupID]) {
      throw new Error(`Segment group not found: ${segmentGroupID}`);
    }
    segmentGroupStore.removeGroup(segmentGroupID);
    return {
      action: 'deleteGroup',
      segmentGroupID,
      deleted: true,
    };
  }

  function manageSegmentation(payload: SegmentationPayload = {}) {
    try {
      const action = normalizeText(payload.action || 'list');
      let result: any;
      switch (action) {
        case 'apply':
        case 'applymask':
        case 'create':
        case 'update':
          result = applyCurrentSliceMask(payload);
          break;
        case 'updatesegment':
          result = updateSegmentationSegment(payload);
          break;
        case 'deletesegment':
          result = deleteSegmentationSegment(payload);
          break;
        case 'deletegroup':
          result = deleteSegmentationGroup(payload);
          break;
        case 'list':
          result = listSegmentGroups(payload);
          break;
        default:
          throw new Error(`Unsupported segmentation action: ${action}`);
      }
      emitter?.emit('segmentationresult', jsonClone({
        requestId: payload.requestId,
        result: {
          ...result,
          capturedAt: Date.now(),
        },
      }));
    } catch (err: any) {
      emitter?.emit('segmentationresult', jsonClone({
        requestId: payload.requestId,
        error: err?.message || String(err),
      }));
    }
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
