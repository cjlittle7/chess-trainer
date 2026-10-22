// Settings you can change without rebuilding the app.
// tomatoCounterUrl: the address of your counter service for the Study Break page (see tools/tomato-counter-worker.js and the README).
// Leave it empty and the page only counts tomatoes on this device.
window.APP_CONFIG = {
  tomatoCounterUrl: "https://tomato-counter.calvin-593.workers.dev/",
  // tomatoSyncMs: 600000,   // how often (ms) unsent tomatoes are uploaded; default 10 minutes
};
