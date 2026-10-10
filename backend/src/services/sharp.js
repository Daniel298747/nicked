// sharp is a native module only needed during analysis. Loading it on first use keeps
// the API (and the Vercel function, which never analyses video) from depending on it.
let loaded = null;
export const loadSharp = () => (loaded ??= import('sharp').then((m) => m.default));
