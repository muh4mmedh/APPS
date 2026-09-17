/*!
 * scanner.js — camera access and reading colours out of a video frame.
 *
 * The one thing worth being careful about here is that the pixels sampled are
 * the pixels under the grid the user can see. The video is displayed with
 * `object-fit: cover`, so part of the frame is cropped, and the preview may be
 * mirrored. Rather than duplicating that geometry, this measures the real
 * on-screen position of each grid cell and maps it back through the same crop,
 * so what you line up is what gets read.
 */
(function (root, factory) {
  var Colour = (typeof module === 'object' && module.exports)
    ? require('./colour.js') : root.RS.Colour;
  var api = factory(Colour);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.RS = root.RS || {}; root.RS.Scanner = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Colour) {
  'use strict';

  // Read only the middle of each cell, so sticker edges and the black gaps
  // between them never reach the average.
  var CELL_INSET = 0.62;
  var WORK_WIDTH = 480;   // frames are downscaled before reading; plenty, and fast

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function Scanner() {
    this.stream = null;
    this.facing = 'environment';
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  Scanner.prototype.start = function (video, facing) {
    var self = this;
    if (!supported()) return Promise.reject(new Error('no-camera-api'));
    this.stop();
    this.facing = facing || this.facing;
    var constraints = {
      audio: false,
      video: {
        facingMode: { ideal: this.facing },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };
    return navigator.mediaDevices.getUserMedia(constraints)
      .catch(function () {
        // Some desktops reject facingMode outright; any camera will do.
        return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      })
      .then(function (stream) {
        self.stream = stream;
        video.srcObject = stream;
        video.setAttribute('playsinline', '');
        video.muted = true;
        return video.play().catch(function () { /* autoplay can be blocked; the frame still arrives */ });
      })
      .then(function () { return self.waitForFrame(video); });
  };

  Scanner.prototype.waitForFrame = function (video) {
    return new Promise(function (resolve) {
      if (video.videoWidth > 0) return resolve(true);
      var tries = 0;
      var timer = setInterval(function () {
        if (video.videoWidth > 0 || ++tries > 60) {
          clearInterval(timer);
          resolve(video.videoWidth > 0);
        }
      }, 50);
    });
  };

  Scanner.prototype.stop = function () {
    if (!this.stream) return;
    this.stream.getTracks().forEach(function (t) { t.stop(); });
    this.stream = null;
  };

  Scanner.prototype.isRunning = function () { return !!this.stream; };

  /** True when more than one camera is on the device, so switching is useful. */
  Scanner.prototype.hasMultipleCameras = function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return Promise.resolve(false);
    }
    return navigator.mediaDevices.enumerateDevices().then(function (devices) {
      return devices.filter(function (d) { return d.kind === 'videoinput'; }).length > 1;
    }).catch(function () { return false; });
  };

  /**
   * Read the nine cells under the grid.
   *
   * video    - the <video> element on screen
   * cells    - nine elements laid over it, in reading order
   * mirrored - whether the preview is flipped horizontally
   *
   * Returns nine {r,g,b} samples, or null if no frame is available yet.
   */
  Scanner.prototype.readCells = function (video, cells, mirrored) {
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;

    var scaleDown = Math.min(1, WORK_WIDTH / vw);
    var cw = Math.max(1, Math.round(vw * scaleDown));
    var ch = Math.max(1, Math.round(vh * scaleDown));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    this.ctx.drawImage(video, 0, 0, cw, ch);
    var frame = this.ctx.getImageData(0, 0, cw, ch);

    // `object-fit: cover` scales the frame up until it covers the element and
    // crops the overflow evenly, so undo exactly that.
    var box = video.getBoundingClientRect();
    var cover = Math.max(box.width / vw, box.height / vh);
    var offsetX = (box.width - vw * cover) / 2;
    var offsetY = (box.height - vh * cover) / 2;

    var samples = [];
    for (var i = 0; i < cells.length; i++) {
      var r = cells[i].getBoundingClientRect();
      var inset = (1 - CELL_INSET) / 2;
      var left = r.left - box.left + r.width * inset;
      var top = r.top - box.top + r.height * inset;
      var w = r.width * CELL_INSET;
      var h = r.height * CELL_INSET;

      var sx = (left - offsetX) / cover;
      var sy = (top - offsetY) / cover;
      var sw = w / cover;
      var sh = h / cover;
      if (mirrored) sx = vw - sx - sw;

      samples.push(Colour.sampleRegion(
        frame.data, cw, ch,
        Math.round(sx * scaleDown), Math.round(sy * scaleDown),
        Math.max(2, Math.round(sw * scaleDown)), Math.max(2, Math.round(sh * scaleDown))
      ));
    }
    return samples;
  };

  return { Scanner: Scanner, supported: supported };
});
