import { join } from '@/src/utils/path';

const base = import.meta.env.BASE_URL;

const fullUrl = (relative) =>
  window.__webpack_public_path__ ? window.__webpack_public_path__ + (window.__webpack_public_path__.endsWith('/') || `${relative}`.startsWith('/') ? '' : '/') + relative :
  new URL(join(base, relative), document.location.origin).href;

const itkConfig = {
  pipelineWorkerUrl: fullUrl('/itk/itk-wasm-pipeline.min.worker.js'),
  imageIOUrl: fullUrl('/itk/image-io'),
  meshIOUrl: fullUrl('/itk/mesh-io'),
  pipelinesUrl: fullUrl('/itk/pipelines'),
};

export default itkConfig;
