import nj from "@d4c/numjs";

export function arrayRange(arr) {
  const narr = nj.array(arr);

  return [narr.min(), narr.max()];
}
