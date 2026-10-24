/*
 * The Solidity compiler, off the main thread. A classic worker so it can load the official soljson build with
 * importScripts (from this origin: /api/solc?v=…). One compiler version per worker: the page starts a new
 * worker to switch versions.
 *
 * In:  { id, version, input }            (input: the compiler's standard JSON, as a string)
 * Out: { id, output } or { id, error }   (output: the compiler's JSON output, as a string)
 */
var ready = null;
var version = null;
function load(v) {
  if (ready) return ready;
  version = v;
  ready = new Promise(function (resolve, reject) {
    try {
      importScripts('/api/solc?v=' + encodeURIComponent(v));
      var M = self.Module;
      var done = function () {
        resolve(M.cwrap('solidity_compile', 'string', ['string', 'number', 'number']));
      };
      if (M.calledRun) done();
      else M.onRuntimeInitialized = done;
    } catch (error) {
      reject(error);
    }
  });
  return ready;
}
self.onmessage = function (event) {
  var msg = event.data || {};
  if (version !== null && msg.version !== version) {
    self.postMessage({ id: msg.id, error: 'This worker has solc ' + version + ' loaded; start a new one for ' + msg.version });
    return;
  }
  load(msg.version).then(
    function (compile) {
      self.postMessage({ id: msg.id, output: compile(msg.input, 0, 0) });
    },
    function (error) {
      self.postMessage({ id: msg.id, error: 'Could not load solc ' + msg.version + ': ' + String((error && error.message) || error) });
    }
  );
};
