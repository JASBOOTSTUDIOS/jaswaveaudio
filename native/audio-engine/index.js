'use strict'

/**
 * Loader del addon nativo. Si no está compilado, exports.isAvailable === false.
 */
let binding = null
try {
  binding = require('./build/Release/jaswave_audio.node')
} catch {
  try {
    binding = require('./build/Debug/jaswave_audio.node')
  } catch {
    binding = null
  }
}

module.exports = {
  isAvailable: () => binding != null,
  raw: binding,
  initialize: (cfg) => binding && binding.initialize(cfg),
  shutdown: () => binding && binding.shutdown(),
  loadBuffer: (...a) => binding && binding.loadBuffer(...a),
  unloadBuffer: (...a) => binding && binding.unloadBuffer(...a),
  setGraph: (...a) => binding && binding.setGraph(...a),
  transportPlay: () => binding && binding.transportPlay(),
  transportPause: () => binding && binding.transportPause(),
  transportStop: () => binding && binding.transportStop(),
  transportSeek: (...a) => binding && binding.transportSeek(...a),
  getPlayheadSeconds: () => (binding ? binding.getPlayheadSeconds() : 0),
  isPlaying: () => (binding ? binding.isPlaying() : false),
  getMeterPeak: () => (binding ? binding.getMeterPeak() : 0),
}
