/* eslint-disable */

export function getROIStats(segmentGroupData, parentImageData, metadata, viewID, slicingMode, slice) {
  const nj = window.nj;
  if (!nj) {
    return null;
  }
  const jStat = window.jStat;
  if (!jStat) {
    return null;
  }

  const a = getNdArrayData(parentImageData, metadata, viewID, slicingMode, slice);
  const b = getNdArrayData(segmentGroupData, metadata, viewID, slicingMode, slice);
  const c = a && a.selection && b && b.selection ? nj.multiply(a, b) : null;
  if (!c) {
    return null;
  }

  const min = nj.min(c);
  const max = nj.max(c);
  const mean = nj.sum(c) / nj.sum(b); // const mean = nj.mean(c);
  const std = nj.std(c);

  const data = Array.from(c.flatten().selection.data);
  const stat = jStat(data);
  const median = stat.median();
  const skewness = stat.skewness();
  const kurtosis = stat.kurtosis();

  let similarity = isNaN(skewness) || isNaN(kurtosis) ? 'N/A' : '';
  if (similarity) {
    //
  } else if (Math.abs(skewness) <= 0.5 && Math.abs(kurtosis) <= 0.5) {
    similarity = 'Excellent';
  } else if (Math.abs(skewness) <= 1.0 && Math.abs(kurtosis) <= 1.0) {
    similarity = 'Good';
  } else if (Math.abs(skewness) <= 1.5 && Math.abs(kurtosis) <= 1.5) {
    similarity = 'Fair';
  } else {
    similarity = 'Poor';
  }

  return {
    data,
    min,
    max,
    median, 
    mean: isNaN(mean) ? null : mean,
    std,
    skewness: isNaN(skewness) ? null : skewness,
    kurtosis: isNaN(kurtosis) ? null : kurtosis,
    similarity,
  };
}

export function getNdArrayData(data, metadata, viewID, slicingMode, slice) {
  const nj = window.nj;
  if (!nj) {
    return null;
  }

  let type = 'array';
  if (data) {
    type = data.getPointData().getScalars().getDataType().replace('Array', '').toLowerCase();
    data = data.getPointData().getScalars().getData();
  } else {
    return null;
  }
  if (!metadata) {
    return data;
  }

  let dimx = metadata.dimensions[metadata.lpsOrientation.Sagittal];
  let dimy = metadata.dimensions[metadata.lpsOrientation.Coronal];
  let dimz = metadata.dimensions[metadata.lpsOrientation.Axial];
  let dims = [dimx, dimy, dimz];   // [x, y, z]
  let shape = [...dims].reverse(); // [z, y, x]
  let samplesPerPixel = data && data.length > 0 ? data.length / (dimx * dimy * dimz) : 0;
  if (samplesPerPixel !== 1) {
    shape[2] *= samplesPerPixel;
  }

  // 3D volume
  data = nj.array(data, type).reshape(shape);

  // 2D slice
  if (viewID && slicingMode) {
    const dim = 'IJK'.indexOf(slicingMode);
    const s = [slice, [...shape].reverse()[dim], shape[2]];
    switch (viewID) {
      case 'Sagittal': {
        s[0] *= samplesPerPixel;
        data = data.slice(null, null, s);
        break;
      }
      case 'Coronal': {
        data = data.slice(null, s, [0, s[2], samplesPerPixel]);
        break;
      }
      case 'Axial': {
        data = data.slice(s, null, [0, s[2], samplesPerPixel]);
        break;
      }
      default: {
        return null;
      }
    }
  }

  return data; // NumJs ndarray
}
