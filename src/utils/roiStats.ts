import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { Vector3 } from '@kitware/vtk.js/types';
import { vec3 } from 'gl-matrix';
import { worldPointToIndex } from '@/src/utils/imageSpace';

export interface ROIStats {
  mean: number;
  median: number;
  sdev: number;
  sum: number;
  max: number;
  min: number;
  count: number;
}

export interface RectangleMeasurements extends ROIStats {
  area: number;
  perimeter: number;
  width: number;
  height: number;
}

export interface EllipseMeasurements extends ROIStats {
  area: number;
  perimeter: number;
}

function computeStats(values: number[]): ROIStats {
  const count = values.length;
  if (count === 0) {
    return { mean: 0, median: 0, sdev: 0, sum: 0, max: 0, min: 0, count: 0 };
  }

  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (let i = 0; i < count; i++) {
    const v = values[i];
    sum += v;
    if (v > max) max = v;
    if (v < min) min = v;
  }
  const mean = sum / count;

  let variance = 0;
  for (let i = 0; i < count; i++) {
    const d = values[i] - mean;
    variance += d * d;
  }
  const sdev = Math.sqrt(variance / count);

  // median via partial sort
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(count / 2);
  const median = count % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  return { mean, median, sdev, sum, max, min, count };
}

/**
 * Determine which IJK axis is the slice axis (the one where both points
 * have approximately the same index value) and return the axis indices
 * for the two in-plane axes and the slice axis.
 */
function detectSliceAxis(
  ijk1: vec3,
  ijk2: vec3
): { inPlane: [number, number]; sliceAxis: number } {
  const deltas = [
    Math.abs(ijk1[0] - ijk2[0]),
    Math.abs(ijk1[1] - ijk2[1]),
    Math.abs(ijk1[2] - ijk2[2]),
  ];
  // The slice axis has the smallest delta (should be ~0)
  let sliceAxis = 0;
  if (deltas[1] < deltas[sliceAxis]) sliceAxis = 1;
  if (deltas[2] < deltas[sliceAxis]) sliceAxis = 2;
  const inPlane = [0, 1, 2].filter((a) => a !== sliceAxis) as [number, number];
  return { inPlane, sliceAxis };
}

/**
 * Compute a flat voxel index from 3D IJK coordinates.
 * VTK uses column-major ordering: i varies fastest, then j, then k.
 */
function flatIndex(
  dims: [number, number, number],
  i: number,
  j: number,
  k: number
): number {
  return dims[0] * dims[1] * k + dims[0] * j + i;
}

/**
 * Collect voxel values inside an axis-aligned rectangle defined by two
 * diagonally opposite world-space corner points, on a single slice.
 * Works for any view orientation (Axial, Sagittal, Coronal).
 */
function collectRectValues(
  image: vtkImageData,
  p1: Vector3,
  p2: Vector3
): number[] {
  const dims = image.getDimensions() as [number, number, number];
  const scalars = image.getPointData().getScalars();
  const rawData = scalars.getData() as number[];
  const numComp = scalars.getNumberOfComponents();

  const ijk1 = worldPointToIndex(image, p1 as vec3);
  const ijk2 = worldPointToIndex(image, p2 as vec3);

  const { inPlane, sliceAxis } = detectSliceAxis(ijk1, ijk2);
  const [axisA, axisB] = inPlane;

  const aMin = Math.max(0, Math.min(Math.round(ijk1[axisA]), Math.round(ijk2[axisA])));
  const aMax = Math.min(dims[axisA] - 1, Math.max(Math.round(ijk1[axisA]), Math.round(ijk2[axisA])));
  const bMin = Math.max(0, Math.min(Math.round(ijk1[axisB]), Math.round(ijk2[axisB])));
  const bMax = Math.min(dims[axisB] - 1, Math.max(Math.round(ijk1[axisB]), Math.round(ijk2[axisB])));

  const sliceVal = Math.round(ijk1[sliceAxis]);
  if (sliceVal < 0 || sliceVal >= dims[sliceAxis]) return [];

  const values: number[] = [];
  const ijk: [number, number, number] = [0, 0, 0];
  ijk[sliceAxis] = sliceVal;

  for (let b = bMin; b <= bMax; b++) {
    ijk[axisB] = b;
    for (let a = aMin; a <= aMax; a++) {
      ijk[axisA] = a;
      const idx = flatIndex(dims, ijk[0], ijk[1], ijk[2]);
      values.push(rawData[idx * numComp]);
    }
  }
  return values;
}

/**
 * Collect voxel values inside an ellipse inscribed in the bounding box
 * defined by two diagonally opposite world-space corner points.
 * Works for any view orientation (Axial, Sagittal, Coronal).
 */
function collectEllipseValues(
  image: vtkImageData,
  p1: Vector3,
  p2: Vector3
): number[] {
  const dims = image.getDimensions() as [number, number, number];
  const scalars = image.getPointData().getScalars();
  const rawData = scalars.getData() as number[];
  const numComp = scalars.getNumberOfComponents();

  const ijk1 = worldPointToIndex(image, p1 as vec3);
  const ijk2 = worldPointToIndex(image, p2 as vec3);

  const { inPlane, sliceAxis } = detectSliceAxis(ijk1, ijk2);
  const [axisA, axisB] = inPlane;

  const aMin = Math.max(0, Math.min(Math.round(ijk1[axisA]), Math.round(ijk2[axisA])));
  const aMax = Math.min(dims[axisA] - 1, Math.max(Math.round(ijk1[axisA]), Math.round(ijk2[axisA])));
  const bMin = Math.max(0, Math.min(Math.round(ijk1[axisB]), Math.round(ijk2[axisB])));
  const bMax = Math.min(dims[axisB] - 1, Math.max(Math.round(ijk1[axisB]), Math.round(ijk2[axisB])));

  const sliceVal = Math.round(ijk1[sliceAxis]);
  if (sliceVal < 0 || sliceVal >= dims[sliceAxis]) return [];

  // Ellipse center and semi-axes along the two in-plane IJK axes
  const ca = (Math.round(ijk1[axisA]) + Math.round(ijk2[axisA])) / 2;
  const cb = (Math.round(ijk1[axisB]) + Math.round(ijk2[axisB])) / 2;
  const ra = Math.abs(Math.round(ijk1[axisA]) - Math.round(ijk2[axisA])) / 2;
  const rb = Math.abs(Math.round(ijk1[axisB]) - Math.round(ijk2[axisB])) / 2;

  if (ra < 0.5 || rb < 0.5) return [];

  const values: number[] = [];
  const ijk: [number, number, number] = [0, 0, 0];
  ijk[sliceAxis] = sliceVal;

  for (let b = bMin; b <= bMax; b++) {
    ijk[axisB] = b;
    const db = (b - cb) / rb;
    for (let a = aMin; a <= aMax; a++) {
      const da = (a - ca) / ra;
      if (da * da + db * db <= 1.0) {
        ijk[axisA] = a;
        const idx = flatIndex(dims, ijk[0], ijk[1], ijk[2]);
        values.push(rawData[idx * numComp]);
      }
    }
  }
  return values;
}

/**
 * Compute geometric measurements for a rectangle in world space.
 */
function computeRectGeometry(p1: Vector3, p2: Vector3) {
  const dx = Math.abs(p2[0] - p1[0]);
  const dy = Math.abs(p2[1] - p1[1]);
  const dz = Math.abs(p2[2] - p1[2]);

  // The rectangle lies in a 2D slice plane. Two of the three deltas
  // form the width/height; the third should be ~0 (the slice normal axis).
  // We pick the two largest deltas as width and height.
  const sorted = [dx, dy, dz].sort((a, b) => b - a);
  const width = sorted[0];
  const height = sorted[1];

  return {
    width,
    height,
    area: width * height,
    perimeter: 2 * (width + height),
  };
}

/**
 * Compute geometric measurements for an ellipse in world space.
 */
function computeEllipseGeometry(p1: Vector3, p2: Vector3) {
  const dx = Math.abs(p2[0] - p1[0]);
  const dy = Math.abs(p2[1] - p1[1]);
  const dz = Math.abs(p2[2] - p1[2]);

  const sorted = [dx, dy, dz].sort((a, b) => b - a);
  const rx = sorted[0] / 2;
  const ry = sorted[1] / 2;

  const area = Math.PI * rx * ry;
  // Ramanujan approximation for ellipse perimeter
  const h = ((rx - ry) * (rx - ry)) / ((rx + ry) * (rx + ry));
  const perimeter =
    Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));

  return { area, perimeter };
}

/**
 * Compute full measurements for a rectangle annotation.
 */
export function computeRectangleMeasurements(
  image: vtkImageData | null | undefined,
  p1: Vector3,
  p2: Vector3
): RectangleMeasurements | null {
  const geo = computeRectGeometry(p1, p2);

  if (!image) {
    return { ...geo, mean: 0, median: 0, sdev: 0, sum: 0, max: 0, min: 0, count: 0 };
  }

  const values = collectRectValues(image, p1, p2);
  const stats = computeStats(values);
  return { ...geo, ...stats };
}

/**
 * Compute full measurements for a circle/ellipse annotation.
 */
export function computeEllipseMeasurements(
  image: vtkImageData | null | undefined,
  p1: Vector3,
  p2: Vector3
): EllipseMeasurements | null {
  const geo = computeEllipseGeometry(p1, p2);

  if (!image) {
    return { ...geo, mean: 0, median: 0, sdev: 0, sum: 0, max: 0, min: 0, count: 0 };
  }

  const values = collectEllipseValues(image, p1, p2);
  const stats = computeStats(values);
  return { ...geo, ...stats };
}
