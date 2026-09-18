/*!
 * photo.js — reading a cube face out of a still photograph.
 *
 * A still photo beats a live feed for this. With a live camera you are holding
 * a cube in one hand, a phone in the other, and trying to line nine squares up
 * with a moving image — and whatever it grabs, it grabs. With a photo you take
 * your time, then drag the corners until the grid sits on the face, and you can
 * see the colours it is reading while you do it.
 *
 * Dragging four corners rather than a fixed square matters, because a cube
 * photographed by hand is never a neat square on screen: it is a slight
 * trapezoid, tilted a few degrees. Each cell is read from its own little quad
 * interpolated between those corners, and only the middle of each cell, with
 * the lightest and darkest pixels thrown away so a glare spot or a sticker
 * edge cannot decide the colour.
 */
(function (root, factory) {
  var Colour = (typeof module === 'object' && module.exports)
    ? require('./colour.js') : root.RS.Colour;
  var api = factory(Colour);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.RS = root.RS || {}; root.RS.Photo = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Colour) {
  'use strict';

  // Photos off a phone are far larger than needed; this is plenty to read
  // nine flat colours from and keeps dragging responsive.
  var MAX_EDGE = 900;
  // Read the middle of each cell only.
  var CELL_INSET = 0.3;
  var GRID = 4;   // sample points per axis within a cell

  /** Corners as fractions of the image, in the order the handles appear. */
  function defaultCorners() {
    // Set for the common framing, where the face nearly fills the photo.
    // Being a little inside the stickers is safer than a little outside.
    return [
      { x: 0.16, y: 0.16 },  // top left
      { x: 0.84, y: 0.16 },  // top right
      { x: 0.84, y: 0.84 },  // bottom right
      { x: 0.16, y: 0.84 }   // bottom left
    ];
  }

  function lerp(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  /** Point at (u, v) across the quad, both 0..1. */
  function onQuad(corners, u, v) {
    var top = lerp(corners[0], corners[1], u);
    var bottom = lerp(corners[3], corners[2], u);
    return lerp(top, bottom, v);
  }

  /**
   * Holds one decoded photo, downscaled, with its pixels ready to sample.
   * Kept around so dragging a corner re-reads from memory rather than
   * re-decoding a multi-megabyte JPEG each frame.
   */
  function Sheet(canvas, width, height) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;
    this.pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  }

  /** Nine colours under the grid, in reading order. */
  Sheet.prototype.read = function (corners) {
    var samples = [];
    for (var row = 0; row < 3; row++) {
      for (var col = 0; col < 3; col++) {
        // This cell's own quad, inset so only its middle is read.
        var u0 = (col + CELL_INSET) / 3, u1 = (col + 1 - CELL_INSET) / 3;
        var v0 = (row + CELL_INSET) / 3, v1 = (row + 1 - CELL_INSET) / 3;

        var values = [];
        for (var a = 0; a < GRID; a++) {
          for (var b = 0; b < GRID; b++) {
            var u = u0 + (u1 - u0) * (a / (GRID - 1 || 1));
            var v = v0 + (v1 - v0) * (b / (GRID - 1 || 1));
            var point = onQuad(corners, u, v);
            var x = Math.round(point.x * (this.width - 1));
            var y = Math.round(point.y * (this.height - 1));
            if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
            var i = (y * this.width + x) * 4;
            values.push([this.pixels[i], this.pixels[i + 1], this.pixels[i + 2]]);
          }
        }
        samples.push(trimmedMean(values));
      }
    }
    return samples;
  };

  /**
   * Average the middle half by brightness. A sticker is one flat colour, so
   * the outliers are glare, a shadow, or the black gap between stickers —
   * none of which are the colour we want.
   */
  function trimmedMean(values) {
    if (!values.length) return { r: 0, g: 0, b: 0 };
    values.sort(function (p, q) {
      return (p[0] + p[1] + p[2]) - (q[0] + q[1] + q[2]);
    });
    var lo = Math.floor(values.length * 0.25);
    var hi = Math.max(lo + 1, Math.ceil(values.length * 0.75));
    var r = 0, g = 0, b = 0, n = 0;
    for (var i = lo; i < hi; i++) {
      r += values[i][0]; g += values[i][1]; b += values[i][2]; n++;
    }
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  }

  /**
   * Decode a File (or anything drawable) into a Sheet.
   * Resolves with null if it is not an image the browser can read.
   */
  function load(file) {
    return new Promise(function (resolve, reject) {
      if (!file || (file.type && file.type.indexOf('image/') !== 0)) {
        reject(new Error('not-an-image'));
        return;
      }
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        try {
          resolve(fromDrawable(image, image.naturalWidth, image.naturalHeight));
        } catch (err) {
          reject(err);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('could-not-decode'));
      };
      image.src = url;
    });
  }

  function fromDrawable(drawable, naturalWidth, naturalHeight) {
    var scale = Math.min(1, MAX_EDGE / Math.max(naturalWidth, naturalHeight));
    var width = Math.max(1, Math.round(naturalWidth * scale));
    var height = Math.max(1, Math.round(naturalHeight * scale));
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(drawable, 0, 0, width, height);
    return new Sheet(canvas, width, height);
  }

  /** A data URL of the photo, for showing it back and for storing it. */
  Sheet.prototype.toDataUrl = function (quality) {
    return this.canvas.toDataURL('image/jpeg', quality || 0.82);
  };

  /**
   * Is the grid sitting on something that looks like a cube face? Nine flat,
   * clearly different patches do; a grid half off the cube usually does not.
   * Advice rather than a gate — the user can see the colours and decide.
   */
  function gridAdvice(samples) {
    var quality = Colour.frameQuality(samples);
    if (quality.message) return { level: 'warn', message: quality.message };

    // How close the two most similar of the nine are. A face has at most
    // nine of six colours, so some will match — but if everything matches,
    // the grid is probably on one flat area rather than across the face.
    var labs = samples.map(function (s) { return Colour.rgbToLab(s.r, s.g, s.b); });
    var distinct = 0;
    for (var i = 0; i < labs.length; i++) {
      var unique = true;
      for (var j = 0; j < i; j++) {
        if (Colour.labDistance(labs[i], labs[j]) < 12) { unique = false; break; }
      }
      if (unique) distinct++;
    }
    if (distinct < 2) {
      return {
        level: 'warn',
        message: 'All nine squares read the same colour — is the grid on the cube?'
      };
    }
    return { level: 'ok', message: null, distinct: distinct };
  }

  return {
    load: load, fromDrawable: fromDrawable, Sheet: Sheet,
    defaultCorners: defaultCorners, onQuad: onQuad, gridAdvice: gridAdvice,
    MAX_EDGE: MAX_EDGE
  };
});
