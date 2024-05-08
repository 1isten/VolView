import { getFileMimeType } from '@/src/io';
import { ImportHandler } from '@/src/io/import/common';
import { FILE_EXT_TO_MIME } from '../../mimeTypes';

/**
 * Transforms a file data source to have a mime type
 * @param dataSource
 */
const updateFileMimeType: ImportHandler = async (dataSource) => {
  let src = dataSource;
  const { fileSrc } = src;
  const isNifti = fileSrc && fileSrc.file && fileSrc.file.name && (fileSrc.file.name.toLowerCase().endsWith('.nii') || fileSrc.file.name.toLowerCase().endsWith('.nii.gz'));
  const isNiftiButWrongType = isNifti && fileSrc.fileType !== FILE_EXT_TO_MIME['nii.gz'];
  if (fileSrc && fileSrc.fileType === '' || isNiftiButWrongType) {
    console.log(fileSrc);
    const mime = await getFileMimeType(fileSrc.file);
    if (mime) {
      src = {
        ...src,
        fileSrc: {
          ...fileSrc,
          fileType: mime,
        },
      };
    }
  }
  return src;
};

export default updateFileMimeType;
