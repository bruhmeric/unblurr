/* ============================================================
 * Untrace · worker.js — Dedicated Worker entry
 * Receives {id, buffer, name, options}, transfers result back.
 * ============================================================ */
'use strict';
importScripts('signatures.js', 'parsers.js', 'synthid.js', 'engine.js');

self.onmessage = async function (ev) {
  const msg = ev.data;
  if (!msg || msg.type !== 'process') return;
  const { id, buffer, name, options } = msg;
  const post = (m, transfer) => self.postMessage(m, transfer || []);
  try {
    post({ id, type: 'progress', stage: 'scan' });
    const opts = Object.assign({}, options, {
      onStage: function (stage) { post({ id, type: 'progress', stage: stage }); },
    });
    const result = await self.UntraceEngine.processFile(buffer, name, opts);
    const out = result.outputBuffer; // Uint8Array over its own buffer
    delete result.outputBuffer;      // don't clone it into JSON path
    post({ id, type: 'done', result: result, outputBuffer: out },
      out && out.buffer ? [out.buffer] : []);
  } catch (err) {
    post({ id, type: 'error', message: (err && err.message) || String(err) });
  }
};
