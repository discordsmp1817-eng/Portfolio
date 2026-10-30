/* ============================================================================
   Hyperspeed — vanilla JS / WebGL2 background
   A night highway at speed: winding road, streaking head/tail lights, light
   poles, dust, glow and road reflections. Hold the pointer down to boost.

   NOTE: This is a plain-JS implementation written to match the props and
   behaviour of React Bits' <Hyperspeed />. It is not a copy of that component's
   source (which is built on three.js + postprocessing), so the look is close
   in spirit but not identical.

   Usage:
     new Hyperspeed(containerElement, {
       curve: 'winding',        // 'winding' | 'wave' | 'straight'
       curvature: 1, speed: 1, boost: 3, fov: 90, boostFov: 130,
       lanes: 3, roadWidth: 10, medianWidth: 2, density: 40,
       trailLength: 1, lightSize: 1, poles: 20, dust: 100,
       glow: 0.6, reflections: 0.5, roadOpacity: 0.1, steer: 0.35,
       tailColors: [...], headColors: [...], poleColors: [...],
       interactive: true
     });
   ========================================================================== */
(function () {
  'use strict';

  var NEAR = 0.6;       // near clip distance (world units)
  var FAR = 320;        // how far ahead lights/poles/dust exist
  var BASE_SPEED = 60;  // world units per second at speed = 1

  var COMMON = [
    'const float CAM_H = 4.2;',
    'uniform float uCamZ;',
    'uniform float uCurvature;',
    'uniform float uSteer;',
    'uniform float uTanHalf;',
    'uniform float uAspect;',
    'uniform int uCurve;',
    'uniform vec2 uShift;',
    'float lat(float z) {',
    '  if (uCurve == 0) return 0.0;',
    '  if (uCurve == 2) return uCurvature * 20.0 * sin(z * 0.012);',
    '  return uCurvature * (18.0 * sin(z * 0.011) + 7.0 * sin(z * 0.027 + 1.3) + 3.0 * sin(z * 0.061 + 0.4));',
    '}',
    'float latD(float z) {',
    '  if (uCurve == 0) return 0.0;',
    '  if (uCurve == 2) return uCurvature * 20.0 * 0.012 * cos(z * 0.012);',
    '  return uCurvature * (18.0 * 0.011 * cos(z * 0.011) + 7.0 * 0.027 * cos(z * 0.027 + 1.3) + 3.0 * 0.061 * cos(z * 0.061 + 0.4));',
    '}',
    '// Lateral road offset at depth zr ahead of the camera (zero at the camera)',
    'float curveOff(float zr) {',
    '  float zc = uCamZ;',
    '  return lat(zc + zr) - lat(zc) - uSteer * latD(zc) * zr;',
    '}'
  ].join('\n');

  /* ---------------------------- Road (full-screen) ---------------------------- */
  var ROAD_VERT = [
    '#version 300 es',
    'void main() {',
    '  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));',
    '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var ROAD_FRAG = [
    '#version 300 es',
    'precision highp float;',
    COMMON,
    'out vec4 outColor;',
    'uniform vec2 uRes;',
    'uniform float uRoadW;',
    'uniform float uMedW;',
    'uniform float uLanes;',
    'uniform float uRoadOp;',
    'uniform float uGlow;',
    'uniform float uFar;',
    'uniform vec3 uHead;',
    'uniform vec3 uTail;',
    'float hash12(vec2 p) {',
    '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}',
    'void main() {',
    '  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;',
    '  vec2 n = ndc - uShift;',
    '  vec3 col = vec3(0.012, 0.012, 0.02);',
    '  // Horizon glow',
    '  float hz = exp(-abs(n.y) * 8.0);',
    '  col += mix(uTail, uHead, clamp(0.5 + 0.5 * n.x, 0.0, 1.0)) * hz * 0.06 * uGlow;',
    '',
    '  // Ground plane intersection (computed for all pixels to keep derivatives valid)',
    '  float ny = min(n.y, -0.0015);',
    '  float zr = CAM_H / (-ny * uTanHalf);',
    '  float x = n.x * uTanHalf * uAspect * zr;',
    '  float xr = x - curveOff(zr);',
    '  float zw = uCamZ + zr;',
    '  float ax = abs(xr);',
    '  float aa = max(fwidth(xr), 1e-4);',
    '  float half_ = uMedW * 0.5;',
    '  float W = uRoadW;',
    '  float fog = exp(-zr / (uFar * 0.35));',
    '  float ground = step(n.y, -0.0015);',
    '  vec3 side = xr < 0.0 ? uHead : uTail;',
    '',
    '  // Road surface',
    '  float onRoad = smoothstep(half_ - aa, half_ + aa, ax) * (1.0 - smoothstep(half_ + W - aa, half_ + W + aa, ax));',
    '  col += mix(vec3(0.55, 0.6, 0.8), side, 0.35) * 0.8 * uRoadOp * onRoad * fog * ground;',
    '',
    '  // Edge + median lines',
    '  float lw = 0.14;',
    '  float eD = min(abs(ax - (half_ + W)), abs(ax - half_));',
    '  float edge = 1.0 - smoothstep(lw * 0.5, lw * 0.5 + aa * 1.5, eD);',
    '  col += mix(vec3(0.9, 0.95, 1.0), side, 0.45) * edge * fog * 0.55 * ground;',
    '',
    '  // Dashed lane dividers',
    '  float laneW = W / uLanes;',
    '  float lx = (ax - half_) / laneW;',
    '  float inner = step(0.5, lx) * step(lx, uLanes - 0.5);',
    '  float ld = abs(lx - floor(lx + 0.5)) * laneW;',
    '  float dash = step(0.5, fract(zw * 0.1));',
    '  float lane = (1.0 - smoothstep(0.045, 0.045 + aa * 1.5, ld)) * inner * dash;',
    '  col += vec3(0.8, 0.85, 1.0) * lane * fog * 0.35 * ground;',
    '',
    '  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;',
    '  outColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ---------------------- Lights / poles / dust (instanced) ---------------------- */
  var LINE_VERT = [
    '#version 300 es',
    'precision highp float;',
    COMMON,
    'layout(location = 0) in vec3 aP0;',
    'layout(location = 1) in vec3 aP1;',
    'layout(location = 2) in vec4 aStyle;   // radius, alpha, -, -',
    'layout(location = 3) in vec3 aColor;',
    'uniform vec2 uRes;',
    'uniform float uMirror;',
    'uniform float uReflect;',
    'uniform float uFar;',
    'out vec2 vUV;',
    'out vec3 vColor;',
    'out float vAlpha;',
    'const vec2 CORNER[6] = vec2[6](vec2(0.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0), vec2(0.0, -1.0), vec2(1.0, 1.0), vec2(0.0, 1.0));',
    'const float NEAR = ' + NEAR.toFixed(2) + ';',
    'vec3 viewPos(vec3 p) {',
    '  return vec3(p.x + curveOff(p.z), uMirror > 0.5 ? -p.y : p.y, p.z);',
    '}',
    'vec2 project(vec3 v) {',
    '  return vec2(v.x / (v.z * uTanHalf * uAspect), (v.y - CAM_H) / (v.z * uTanHalf)) + uShift;',
    '}',
    'void main() {',
    '  int q = gl_VertexID / 6;',
    '  int c = gl_VertexID - q * 6;',
    '  vec2 cc = CORNER[c];',
    '  int row = q + int(cc.x);',
    '  float side = cc.y;',
    '',
    '  if (aP0.z < NEAR && aP1.z < NEAR) {',
    '    gl_Position = vec4(3.0, 3.0, 0.0, 1.0);',
    '    vUV = vec2(0.0); vColor = vec3(0.0); vAlpha = 0.0;',
    '    return;',
    '  }',
    '  vec3 q0 = aP0;',
    '  vec3 q1 = aP1;',
    '  if (aP0.z < NEAR) q0 = mix(aP0, aP1, (NEAR - aP0.z) / (aP1.z - aP0.z));',
    '  if (aP1.z < NEAR) q1 = mix(aP1, aP0, (NEAR - aP1.z) / (aP0.z - aP1.z));',
    '',
    '  vec3 v0 = viewPos(q0);',
    '  vec3 v1 = viewPos(q1);',
    '  vec2 s0 = project(v0);',
    '  vec2 s1 = project(v1);',
    '  float px = 1.2 / uRes.y;',
    '  float T0 = 3.0 * max(aStyle.x / (v0.z * uTanHalf), px);',
    '  float T1 = 3.0 * max(aStyle.x / (v1.z * uTanHalf), px);',
    '',
    '  vec2 a0 = vec2(s0.x * uAspect, s0.y);',
    '  vec2 a1 = vec2(s1.x * uAspect, s1.y);',
    '  vec2 d = a1 - a0;',
    '  float dl = length(d);',
    '  vec2 dir = dl > 1e-6 ? d / dl : vec2(0.0, 1.0);',
    '  vec2 nrm = vec2(-dir.y, dir.x);',
    '',
    '  vec2 pos;',
    '  float u;',
    '  if (row == 0)      { pos = a0 - dir * T0 + nrm * side * T0; u = -1.0; }',
    '  else if (row == 1) { pos = a0 + nrm * side * T0;            u = 0.0; }',
    '  else if (row == 2) { pos = a1 + nrm * side * T1;            u = 1.0; }',
    '  else               { pos = a1 + dir * T1 + nrm * side * T1; u = 2.0; }',
    '',
    '  float zm = 0.5 * (q0.z + q1.z);',
    '  float fade = smoothstep(0.8, 5.0, zm) * (1.0 - smoothstep(uFar * 0.7, uFar, zm));',
    '  vUV = vec2(u, side);',
    '  vColor = aColor;',
    '  vAlpha = aStyle.y * fade * (uMirror > 0.5 ? uReflect : 1.0);',
    '  gl_Position = vec4(pos.x / uAspect, pos.y, 0.0, 1.0);',
    '}'
  ].join('\n');

  var LINE_FRAG = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUV;',
    'in vec3 vColor;',
    'in float vAlpha;',
    'uniform float uGlow;',
    'out vec4 outColor;',
    'void main() {',
    '  float u = vUV.x;',
    '  float v = vUV.y;',
    '  float du = u < 0.0 ? u : (u > 1.0 ? u - 1.0 : 0.0);',
    '  float d = length(vec2(du, v));',
    '  float core = 1.0 - smoothstep(0.26, 0.38, d);',
    '  float halo = (exp(-d * d * 7.0) * 0.55 + exp(-d * d * 2.2) * 0.14) * uGlow;',
    '  float I = (core + halo) * vAlpha;',
    '  outColor = vec4(vColor * I, 1.0);',
    '}'
  ].join('\n');

  /* --------------------------------- helpers --------------------------------- */
  function hexToRgb(hex) {
    var h = String(hex || '#ffffff').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    if (isNaN(n)) return [1, 1, 1];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[Hyperspeed] shader error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function makeProgram(gl, vsrc, fsrc) {
    var vs = compile(gl, gl.VERTEX_SHADER, vsrc);
    var fs = compile(gl, gl.FRAGMENT_SHADER, fsrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn('[Hyperspeed] link error:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  function uniforms(gl, prog, names) {
    var o = {};
    names.forEach(function (n) { o[n] = gl.getUniformLocation(prog, n); });
    return o;
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  var STRIDE = 13; // p0(3) p1(3) style(4) color(3)

  /* ---------------------------------- class ---------------------------------- */
  function Hyperspeed(container, options) {
    this.container = container;
    this.o = Object.assign({
      curve: 'winding',
      curvature: 1,
      speed: 1,
      boost: 3,
      fov: 90,
      boostFov: 130,
      lanes: 3,
      roadWidth: 10,
      medianWidth: 2,
      density: 40,
      trailLength: 1,
      lightSize: 1,
      poles: 20,
      dust: 100,
      glow: 0.6,
      reflections: 0.5,
      roadOpacity: 0.1,
      steer: 0.35,
      tailColors: ['#d856bf', '#6750a2', '#c247ac'],
      headColors: ['#03b3c3', '#0e5ea5', '#324555'],
      poleColors: ['#03b3c3'],
      interactive: true,
      // What to do when the visitor's system has "reduce motion" turned on:
      //   'slow'   = keep animating, at a gentle quarter speed (default)
      //   'still'  = show a single still frame
      //   'ignore' = full animation regardless of the system setting
      reducedMotion: 'slow'
    }, options || {});

    this.ready = false;
    this.raf = 0;
    this.camZ = 0;
    this.camV = BASE_SPEED * this.o.speed;
    this.fov = this.o.fov;
    this.boosting = false;
    this.boostUntil = 0; // a quick click still gives a short burst of speed
    this.shift = [0, 0.2];
    this.shiftTarget = [0, 0.2];
    this.lastNow = 0;
    var prefers = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.calm = prefers && this.o.reducedMotion !== 'ignore';        // system asks for less motion
    this.reduceMotion = this.calm && this.o.reducedMotion === 'still'; // fully static
    this.motionScale = this.calm ? 0.25 : 1;
    this.status = 'init';

    this._init();
  }

  Hyperspeed.prototype._init = function () {
    var o = this.o;
    var canvas = document.createElement('canvas');
    canvas.className = 'hyperspeed-canvas';
    var gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' });
    if (!gl) { this._setStatus('no-webgl2', 'WebGL2 is not available in this browser'); return; }

    var road = makeProgram(gl, ROAD_VERT, ROAD_FRAG);
    var lines = makeProgram(gl, LINE_VERT, LINE_FRAG);
    if (!road || !lines) { this._setStatus('shader-error', 'a shader failed to compile, see the warning above'); return; }

    var shared = ['uCamZ', 'uCurvature', 'uSteer', 'uTanHalf', 'uAspect', 'uCurve', 'uShift'];
    this.canvas = canvas;
    this.gl = gl;
    this.road = road;
    this.lines = lines;
    this.ur = uniforms(gl, road, shared.concat(['uRes', 'uRoadW', 'uMedW', 'uLanes', 'uRoadOp', 'uGlow', 'uFar', 'uHead', 'uTail']));
    this.ul = uniforms(gl, lines, shared.concat(['uRes', 'uMirror', 'uReflect', 'uFar', 'uGlow']));

    // Static uniforms
    var curveType = { straight: 0, winding: 1, wave: 2 }[o.curve];
    if (curveType === undefined) curveType = 1;
    var head = o.headColors.map(hexToRgb);
    var tail = o.tailColors.map(hexToRgb);
    this.headRgb = head;
    this.tailRgb = tail;
    this.poleRgb = o.poleColors.map(hexToRgb);

    gl.useProgram(road);
    gl.uniform1i(this.ur.uCurve, curveType);
    gl.uniform1f(this.ur.uCurvature, o.curvature);
    gl.uniform1f(this.ur.uSteer, o.steer);
    gl.uniform1f(this.ur.uRoadW, o.roadWidth);
    gl.uniform1f(this.ur.uMedW, o.medianWidth);
    gl.uniform1f(this.ur.uLanes, o.lanes);
    gl.uniform1f(this.ur.uRoadOp, o.roadOpacity);
    gl.uniform1f(this.ur.uGlow, o.glow);
    gl.uniform1f(this.ur.uFar, FAR);
    gl.uniform3fv(this.ur.uHead, head[0]);
    gl.uniform3fv(this.ur.uTail, tail[0]);

    gl.useProgram(lines);
    gl.uniform1i(this.ul.uCurve, curveType);
    gl.uniform1f(this.ul.uCurvature, o.curvature);
    gl.uniform1f(this.ul.uSteer, o.steer);
    gl.uniform1f(this.ul.uFar, FAR);
    gl.uniform1f(this.ul.uGlow, o.glow);
    gl.uniform1f(this.ul.uReflect, o.reflections * 0.35);

    // Instance buffer + VAO
    this._buildScene();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    var bytes = STRIDE * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, bytes, 0);  gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, bytes, 12); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, bytes, 24); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, bytes, 40); gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);
    this.emptyVao = gl.createVertexArray();

    this.container.appendChild(canvas);

    var self = this;
    this._resize = function () { self._onResize(); };
    this._loop = function (now) { self._frame(now); };
    this._onMove = function (e) {
      self.shiftTarget[0] = (e.clientX / window.innerWidth - 0.5) * 0.08;
      self.shiftTarget[1] = 0.2 + (0.5 - e.clientY / window.innerHeight) * 0.05;
    };
    this._onDown = function () { self.boosting = true; self.boostUntil = performance.now() + 1400; };
    this._onUp = function () { self.boosting = false; };
    this._onVis = function () {
      if (document.hidden) { cancelAnimationFrame(self.raf); self.raf = 0; }
      else if (!self.raf && !self.reduceMotion) { self.lastNow = performance.now(); self.raf = requestAnimationFrame(self._loop); }
    };

    window.addEventListener('resize', this._resize);
    document.addEventListener('visibilitychange', this._onVis);
    if (o.interactive && !this.calm) {
      window.addEventListener('pointermove', this._onMove, { passive: true });
      window.addEventListener('pointerdown', this._onDown, { passive: true });
      window.addEventListener('pointerup', this._onUp, { passive: true });
      window.addEventListener('pointercancel', this._onUp, { passive: true });
      window.addEventListener('blur', this._onUp);
    }

    this._onResize();
    this.ready = true;
    this._setStatus(this.reduceMotion ? 'still' : (this.calm ? 'slow' : 'running'),
      this.calm ? 'your system has "reduce motion" turned on' : '');

    if (this.reduceMotion) {
      this._step(0.016);
      this._draw();
    } else {
      this.lastNow = performance.now();
      this.raf = requestAnimationFrame(this._loop);
    }
  };

  Hyperspeed.prototype._buildScene = function () {
    var o = this.o;
    var laneW = o.roadWidth / o.lanes;
    var half = o.medianWidth / 2;

    // Cars: two lights each. Left side = oncoming head lights, right side = tail lights.
    this.cars = [];
    for (var s = -1; s <= 1; s += 2) {
      var isHead = s < 0;
      var palette = isHead ? this.headRgb : this.tailRgb;
      for (var i = 0; i < o.density; i++) {
        var lane = Math.floor(Math.random() * o.lanes);
        this.cars.push({
          x: s * (half + (lane + 0.5) * laneW),
          y: rand(0.45, 0.75),
          z: rand(NEAR, FAR),
          v: isHead ? -rand(18, 44) : rand(6, 18),
          gap: rand(0.45, 0.65),
          size: rand(0.8, 1.2),
          color: palette[Math.floor(Math.random() * palette.length)]
        });
      }
    }

    // Light poles on both sides of the road
    this.poleList = [];
    var edge = half + o.roadWidth + 1.4;
    var spacing = FAR / Math.max(o.poles, 1);
    for (var side = -1; side <= 1; side += 2) {
      for (var p = 0; p < o.poles; p++) {
        this.poleList.push({
          x: side * edge,
          z: NEAR + p * spacing + (side > 0 ? spacing * 0.5 : 0),
          h: rand(5, 7),
          color: this.poleRgb[p % this.poleRgb.length]
        });
      }
    }

    // Dust
    this.dustList = [];
    for (var d = 0; d < o.dust; d++) {
      this.dustList.push({ x: rand(-28, 28), y: rand(0.3, 14), z: rand(NEAR, FAR) });
    }

    var count = this.cars.length * 2 + this.poleList.length * 2 + this.dustList.length;
    this.count = count;
    this.data = new Float32Array(count * STRIDE);
  };

  Hyperspeed.prototype._setStatus = function (status, detail) {
    this.status = status;
    if (this.container && this.container.dataset) this.container.dataset.status = status;
    if (status !== 'running') console.info('[Hyperspeed] ' + status + (detail ? ': ' + detail : ''));
  };

  Hyperspeed.prototype._onResize = function () {
    var gl = this.gl;
    var dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.25 : 1.5);
    var w = Math.max(1, Math.round(window.innerWidth * dpr));
    var h = Math.max(1, Math.round(window.innerHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    this.w = w;
    this.h = h;
    if (this.reduceMotion && this.ready) this._draw();
  };

  Hyperspeed.prototype._frame = function (now) {
    this.raf = 0;
    var dt = Math.min((now - this.lastNow) / 1000, 0.05);
    this.lastNow = now;
    try {
      this._step(dt);
      this._draw();
    } catch (err) {
      if (!this._errLogged) { console.warn('[Hyperspeed] render error:', err); this._errLogged = true; }
    }
    if (!document.hidden) this.raf = requestAnimationFrame(this._loop);
  };

  Hyperspeed.prototype._step = function (dt) {
    var o = this.o;
    var boosting = this.boosting || performance.now() < this.boostUntil;
    var targetV = BASE_SPEED * o.speed * this.motionScale * (boosting ? o.boost : 1);
    var targetFov = boosting ? o.boostFov : o.fov;
    this.camV += (targetV - this.camV) * Math.min(1, dt * 2.5);
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 3);
    this.camZ += this.camV * dt;
    this.shift[0] += (this.shiftTarget[0] - this.shift[0]) * Math.min(1, dt * 3);
    this.shift[1] += (this.shiftTarget[1] - this.shift[1]) * Math.min(1, dt * 3);

    var D = this.data;
    var k = 0;
    var span = FAR - NEAR;
    var camV = this.camV;
    var tl = o.trailLength;
    var ls = o.lightSize;
    var i, c;

    // Cars
    for (i = 0; i < this.cars.length; i++) {
      c = this.cars[i];
      var rel = c.v - camV;
      c.z += rel * dt;
      while (c.z < NEAR) c.z += span;
      var len = tl * (2.2 + 0.045 * Math.abs(rel));
      var r = 0.13 * ls * c.size;
      for (var l = -1; l <= 1; l += 2) {
        D[k++] = c.x + l * c.gap; D[k++] = c.y; D[k++] = c.z;
        D[k++] = c.x + l * c.gap; D[k++] = c.y; D[k++] = c.z + len;
        D[k++] = r; D[k++] = 1; D[k++] = 0; D[k++] = 0;
        D[k++] = c.color[0]; D[k++] = c.color[1]; D[k++] = c.color[2];
      }
    }

    // Poles (stick + bright cap)
    for (i = 0; i < this.poleList.length; i++) {
      var p = this.poleList[i];
      p.z -= camV * dt;
      while (p.z < NEAR) p.z += span;
      D[k++] = p.x; D[k++] = 0; D[k++] = p.z;
      D[k++] = p.x; D[k++] = p.h; D[k++] = p.z;
      D[k++] = 0.06; D[k++] = 0.85; D[k++] = 0; D[k++] = 0;
      D[k++] = p.color[0]; D[k++] = p.color[1]; D[k++] = p.color[2];

      D[k++] = p.x; D[k++] = p.h - 0.5; D[k++] = p.z;
      D[k++] = p.x; D[k++] = p.h; D[k++] = p.z;
      D[k++] = 0.16; D[k++] = 1; D[k++] = 0; D[k++] = 0;
      D[k++] = Math.min(p.color[0] + 0.4, 1); D[k++] = Math.min(p.color[1] + 0.4, 1); D[k++] = Math.min(p.color[2] + 0.4, 1);
    }

    // Dust
    var dlen = 0.4 + camV * 0.02;
    for (i = 0; i < this.dustList.length; i++) {
      var d = this.dustList[i];
      d.z -= camV * dt;
      while (d.z < NEAR) d.z += span;
      D[k++] = d.x; D[k++] = d.y; D[k++] = d.z;
      D[k++] = d.x; D[k++] = d.y; D[k++] = d.z + dlen;
      D[k++] = 0.035; D[k++] = 0.4; D[k++] = 0; D[k++] = 0;
      D[k++] = 0.85; D[k++] = 0.9; D[k++] = 1;
    }
  };

  Hyperspeed.prototype._setShared = function (loc, tanHalf, aspect) {
    var gl = this.gl;
    gl.uniform1f(loc.uCamZ, this.camZ);
    gl.uniform1f(loc.uTanHalf, tanHalf);
    gl.uniform1f(loc.uAspect, aspect);
    gl.uniform2f(loc.uShift, this.shift[0], this.shift[1]);
    gl.uniform2f(loc.uRes, this.w, this.h);
  };

  Hyperspeed.prototype._draw = function () {
    var gl = this.gl;
    var aspect = this.w / this.h;
    var tanHalf = Math.tan((this.fov * Math.PI / 180) / 2);

    // Road (opaque full-screen pass)
    gl.disable(gl.BLEND);
    gl.useProgram(this.road);
    this._setShared(this.ur, tanHalf, aspect);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Lights, poles and dust (additive)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.lines);
    this._setShared(this.ul, tanHalf, aspect);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data);

    gl.uniform1f(this.ul.uMirror, 0);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 18, this.count);
    if (this.o.reflections > 0) {
      gl.uniform1f(this.ul.uMirror, 1);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 18, this.count);
    }
    gl.bindVertexArray(null);

    if (!this._checked) {
      this._checked = true;
      var err = gl.getError();
      if (err) console.warn('[Hyperspeed] WebGL error code', err);
    }
  };

  Hyperspeed.prototype.destroy = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener('resize', this._resize);
    document.removeEventListener('visibilitychange', this._onVis);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
    window.removeEventListener('blur', this._onUp);
    if (this.canvas) this.canvas.remove();
    if (this.gl) {
      var ext = this.gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  };

  window.Hyperspeed = Hyperspeed;
})();