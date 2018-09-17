'use strict';

export type EVCb<T> = (err: any, val: T) => void;

export const r2gSmokeTest = function () {
  // r2g command line app uses this exported function
  return true;
};




