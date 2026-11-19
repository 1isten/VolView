import { useUrlSearchParams } from '@vueuse/core';
import { planLabelmapExport } from '@/src/segmentation/io/composition';
import {
  writeLabelmapParts,
  type ExportFile,
} from '@/src/segmentation/io/export';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import { useLoadDataStore } from '@/src/store/load-data';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import { saveLabelmapExport } from './saveLabelmapExport';

/**
 * PMT-ONLY: the Manual ROI window has no download UI. When it was opened with
 * `roi=true` and a `manualInputId`, hand the labelmap bytes to the Electron
 * host over the `savesegmentation` bus event instead of downloading; the host
 * saves the file and reports its path back.
 */
export async function saveSegmentationToHost(
  parentId: string,
  stem: string,
  format: string
) {
  const query = useUrlSearchParams();
  const roiMode = query.roi === 'true' || query.roi === '1';
  const manualInputId = `${query.manualInputId || ''}`;
  if (!roiMode || !('$electron' in window) || !manualInputId) {
    return saveLabelmapExport(parentId, stem, format);
  }

  const files: ExportFile[] = [];
  useSegmentationEditsStore().beforeRead();
  await writeLabelmapParts(
    { parentId, parts: planLabelmapExport(parentId).parts },
    stem,
    format,
    {
      deliver: (file) => {
        files.push(file);
      },
    }
  );
  const [file] = files;
  if (!file) throw new Error('No segmentation content to save');
  if (files.length > 1) {
    throw new Error(
      'Manual ROI saving expects a single labelmap file; split segments are not supported'
    );
  }

  const emitter = useLoadDataStore().$bus.emitter;
  emitter?.emit('savesegmentation', {
    manualInputId,
    fileContent: file.data,
    fileName: file.name,
    fileType: format,
    fileMime: FILE_EXT_TO_MIME[format],
    createdAt: Date.now(),
  });
}
