/*!
 * colour.js — colour conversions, the cube's palette, and reading pixels.
 *
 * A palette here is six hex colours, one per face position, because a cube's
 * colours are the owner's to state rather than ours to assume: the Japanese
 * scheme swaps blue and yellow, and pastel, neon and re-stickered cubes are
 * common. The same six colours are used to draw the cube and to recognise it.
 *
 * Deciding which sticker is which colour is not here — that is recognise.js,
 * which looks at all 54 at once and corrects each photo's lighting. What lives
 * here is the groundwork: sRGB to linear light (where a lighting change is a
 * plain multiplier), Lab (where distance roughly matches what the eye
 * notices), and averaging the middle of a region while throwing away glare.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.RS = root.RS || {}; root.RS.Colour = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /*
   * A cube's colours are the user's to state, not ours to assume. Plenty of
   * cubes are not the Western scheme — the Japanese layout swaps blue and
   * yellow, and pastel, neon and sticker-replaced cubes are common. So a
   * palette is six hex colours, one per face position, and it is used for
   * both drawing the cube and recognising it.
   */
  var PRESETS = {
    western: {
      label: 'Standard',
      note: 'White up, yellow down, green front, blue back, red right, orange left.',
      colours: { U: '#f3f5f8', R: '#e02f3c', F: '#18b55c', D: '#ffd21f', L: '#ff8114', B: '#1f6df0' }
    },
    japanese: {
      label: 'Japanese',
      note: 'The older scheme: blue opposite white, yellow opposite green.',
      colours: { U: '#f3f5f8', R: '#e02f3c', F: '#18b55c', D: '#1f6df0', L: '#ff8114', B: '#ffd21f' }
    },
    pastel: {
      label: 'Pastel',
      note: 'For softer stickers, which the standard colours read badly.',
      colours: { U: '#f7f4ef', R: '#f2808c', F: '#8fd6a6', D: '#ffe9a3', L: '#ffc08a', B: '#a8c7f0' }
    }
  };

  var FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];

  function defaultPalette() {
    var out = {};
    FACE_ORDER.forEach(function (f) { out[f] = PRESETS.western.colours[f]; });
    return out;
  }

  /** Accepts "#abc", "abc", "#aabbcc"; returns a normalised "#aabbcc" or null. */
  function normaliseHex(text) {
    if (typeof text !== 'string') return null;
    var hex = text.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    return '#' + hex.toLowerCase();
  }

  /**
   * Is this palette usable? Six colours that a camera can tell apart. Two
   * near-identical faces cannot be distinguished by any amount of cleverness,
   * so say so rather than producing a confident wrong answer.
   */
  function checkPalette(palette) {
    var missing = FACE_ORDER.filter(function (f) { return !normaliseHex(palette[f]); });
    if (missing.length) {
      return { ok: false, error: 'Face ' + missing.join(', ') + ' needs a colour.' };
    }
    var labs = FACE_ORDER.map(function (f) {
      var rgb = hexToRgb(normaliseHex(palette[f]));
      return { face: f, lab: rgbToLab(rgb.r, rgb.g, rgb.b) };
    });
    var worst = null;
    for (var i = 0; i < labs.length; i++) {
      for (var j = i + 1; j < labs.length; j++) {
        var d = labDistance(labs[i].lab, labs[j].lab);
        if (!worst || d < worst.d) worst = { d: d, a: labs[i].face, b: labs[j].face };
      }
    }
    if (worst && worst.d < 12) {
      return {
        ok: false,
        error: 'The ' + worst.a + ' and ' + worst.b + ' colours are too alike to tell apart.',
        hint: 'Pick colours further apart, or photograph those two faces especially evenly.'
      };
    }
    return { ok: true, closest: worst ? Math.round(worst.d) : null };
  }

  function hexToRgb(hex) {
    hex = hex.trim();
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16)
    };
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var h = 0;
    if (d > 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
  }

  /** sRGB bytes to linear light, where a lighting change is a multiplier. */
  function srgbToLinear(s) {
    function lin(c) {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    return [lin(s.r), lin(s.g), lin(s.b)];
  }

  function linearToSrgb(lin) {
    function enc(c) {
      c = c < 0 ? 0 : c > 1 ? 1 : c;
      return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
    }
    return { r: enc(lin[0]), g: enc(lin[1]), b: enc(lin[2]) };
  }

  /** Lab straight from linear light, as [L, a, b]. */
  function linearToLab(lin) {
    var x = (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047;
    var y = (lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722);
    var z = (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883;
    function f(t) { return t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t) + 16 / 116; }
    var fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function rgbToLab(r, g, b) {
    function lin(c) {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    var R = lin(r), G = lin(g), B = lin(b);
    var x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    var y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
    var z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    function f(t) { return t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t) + 16 / 116; }
    var fx = f(x), fy = f(y), fz = f(z);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }


  /**
   * Lightness is the least trustworthy channel under room lighting, so it
   * counts for less than the two colour channels.
   */
  function labDistance(p, q) {
    var dL = (p.L - q.L) * 0.25, da = p.a - q.a, db = p.b - q.b;
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  /**
   * Is this frame good enough to read? Dark frames are the one case the
   * matching genuinely cannot rescue: at low exposure, sensor noise is large
   * next to the colour itself. Better to say so than to guess.
   */
  function frameQuality(samples) {
    var sum = 0, min = 1;
    samples.forEach(function (s) {
      var v = Math.max(s.r, s.g, s.b) / 255;
      sum += v;
      if (v < min) min = v;
    });
    var mean = sum / samples.length;
    return {
      brightness: mean,
      darkest: min,
      tooDark: mean < 0.3 || min < 0.12,
      message: mean < 0.3 ? 'Too dark to read colours reliably — find brighter light.'
        : (min < 0.12 ? 'One sticker is in shadow — even out the light on the face.' : null)
    };
  }

  // Enough names to describe any sticker in words. Used only for telling the
  // user which face to hold up, never for recognition.
  var NAMED = [
    ['white', '#f4f5f8'], ['cream', '#f4ecd8'], ['grey', '#9aa0ad'], ['black', '#1c1f26'],
    ['yellow', '#ffd21f'], ['orange', '#ff8114'], ['red', '#e02f3c'], ['pink', '#f2808c'],
    ['purple', '#8b5cf6'], ['blue', '#1f6df0'], ['cyan', '#22c3d6'], ['green', '#18b55c'],
    ['lime', '#9fd63a'], ['brown', '#8a5a2b']
  ];

  /** The closest everyday name for a colour, for describing it in a sentence. */
  function nameOf(hex) {
    var normalised = normaliseHex(hex);
    if (!normalised) return 'that';
    var rgb = hexToRgb(normalised);
    var lab = rgbToLab(rgb.r, rgb.g, rgb.b);
    var best = NAMED[0][0], bestD = Infinity;
    NAMED.forEach(function (entry) {
      var c = hexToRgb(entry[1]);
      var d = labDistance(lab, rgbToLab(c.r, c.g, c.b));
      if (d < bestD) { bestD = d; best = entry[0]; }
    });
    return best;
  }

  /**
   * Nearest palette colour to one sample, for live feedback while aiming.
   * A per-sticker guess like this is only ever a hint — the real read is the
   * balanced solve in recognise.js, which sees all 54 at once.
   */
  function nearestFace(sample, palette) {
    var lab = rgbToLab(sample.r, sample.g, sample.b);
    var best = null, bestD = Infinity;
    FACE_ORDER.forEach(function (face) {
      var hex = normaliseHex(palette[face]);
      if (!hex) return;
      var rgb = hexToRgb(hex);
      var d = labDistance(lab, rgbToLab(rgb.r, rgb.g, rgb.b));
      if (d < bestD) { bestD = d; best = face; }
    });
    // Too dark to call: a black frame is nearest to everything equally.
    if (Math.max(sample.r, sample.g, sample.b) < 34) return null;
    return best;
  }

  // ------------------------------------------------------- sampling a frame

  /**
   * Average the middle of a region, throwing away the brightest and darkest
   * pixels so a glare spot or a sticker edge cannot drag the reading.
   */
  function sampleRegion(pixels, width, height, x0, y0, w, h) {
    var samples = [];
    var stepX = Math.max(1, (w / 10) | 0), stepY = Math.max(1, (h / 10) | 0);
    for (var y = y0; y < y0 + h; y += stepY) {
      if (y < 0 || y >= height) continue;
      for (var x = x0; x < x0 + w; x += stepX) {
        if (x < 0 || x >= width) continue;
        var i = (y * width + x) * 4;
        samples.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
      }
    }
    if (!samples.length) return { r: 0, g: 0, b: 0 };
    samples.sort(function (p, q) {
      return (p[0] + p[1] + p[2]) - (q[0] + q[1] + q[2]);
    });
    var lo = Math.floor(samples.length * 0.25), hi = Math.ceil(samples.length * 0.75);
    var r = 0, g = 0, b = 0, n = 0;
    for (var k = lo; k < hi; k++) { r += samples[k][0]; g += samples[k][1]; b += samples[k][2]; n++; }
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  }

  return {
    PRESETS: PRESETS, FACE_ORDER: FACE_ORDER,
    defaultPalette: defaultPalette, normaliseHex: normaliseHex, checkPalette: checkPalette,
    rgbToHsv: rgbToHsv, rgbToLab: rgbToLab, labDistance: labDistance,
    srgbToLinear: srgbToLinear, linearToSrgb: linearToSrgb, linearToLab: linearToLab,
    nearestFace: nearestFace, nameOf: nameOf,
    sampleRegion: sampleRegion, frameQuality: frameQuality,
    hexToRgb: hexToRgb
  };
});
