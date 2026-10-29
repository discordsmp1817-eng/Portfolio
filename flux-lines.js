/* ============================================================================
   FluxLines — vanilla JS / WebGL2 background
   Glowing flux lines tracing a churning magnetic fluid. The cursor "magnet"
   reveals and curls them; clicking sends a swirl through the field.

   NOTE: This is a plain-JS implementation written to match the props and
   behaviour of React Bits' <FluxLines />. It is not a copy of that component's
   source, so the look is close but not pixel-identical.

   Usage:
     new FluxLines(containerElement, {
       colors: ['#ffffff', '#ffffff', '#ffffff'],
       glow: 2, rimWidth: 0.2, lineWidth: 1,
       flowDirection: 'down',          // 'up' | 'down' | 'left' | 'right'
       mouseInteraction: true,
       clickSwirl: true,
       eventTarget: someElement        // optional: element that receives pointer events
     });
   ========================================================================== */
(function () {
  'use strict';

  const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2  uRes;
uniform float uTime;
uniform float uDpr;
uniform vec2  uMouse;      // 0..1, y up
uniform float uMouseAmt;   // 0..1 pointer presence (smoothed)
uniform float uMouseOn;    // 1 when mouseInteraction is enabled
uniform vec3  uClick;      // xy = 0..1 position, z = start time (-1 = none)
uniform vec3  uC0;
uniform vec3  uC1;
uniform vec3  uC2;
uniform float uGlow;
uniform float uRim;
uniform float uLineW;      // line width in CSS px
uniform float uDensity;    // number of contour lines
uniform vec2  uFlow;       // flow direction (unit vector, y up)
uniform float uReveal;     // 0..1 intro reveal

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = r * p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(asp, 1.0) * 2.0;
  float t = uTime;

  // Drifting, churning domain
  vec2 q = p * 0.9 - uFlow * t * 0.12;
  vec2 w = vec2(
    fbm(q + vec2(0.0, t * 0.05)),
    fbm(q + vec2(5.2, 1.3) - vec2(t * 0.04, 0.0))
  );
  vec2 q2 = q + 1.4 * (w - 0.45);

  // Cursor magnet: pulls and curls the field, and reveals the lines nearby
  vec2 m = (uMouse - 0.5) * vec2(asp, 1.0) * 2.0;
  vec2 dm = p - m;
  float r2 = dot(dm, dm);
  float magnet = uMouseOn * uMouseAmt * exp(-r2 * 2.2);
  q2 += magnet * (vec2(-dm.y, dm.x) * 1.3 - dm * 0.35);

  // Click swirl: a decaying twist around the click point
  float clickGlow = 0.0;
  if (uClick.z >= 0.0) {
    vec2 c = (uClick.xy - 0.5) * vec2(asp, 1.0) * 2.0;
    vec2 d = p - c;
    float age = max(t - uClick.z, 0.0);
    float fall = exp(-dot(d, d) * 2.2) * exp(-age * 1.1) * smoothstep(0.0, 0.15, age);
    float ang = fall * 4.0;
    float ca = cos(ang);
    float sa = sin(ang);
    vec2 dr = vec2(ca * d.x - sa * d.y, sa * d.x + ca * d.y);
    q2 += (dr - d) * 0.9;
    clickGlow = fall;
  }

  // Scalar field -> contour lines
  float f = fbm(q2 * 1.15 + 3.7);
  float v = f * uDensity;
  float fw = max(fwidth(v), 1e-4);
  float dist = abs(fract(v + 0.5) - 0.5);
  float px = dist / fw;                         // distance to line in device px

  float lw = uLineW * uDpr;
  float core = 1.0 - smoothstep(0.5 * lw - 0.75, 0.5 * lw + 0.75, px);
  float halo = exp(-px * 0.16 / uDpr) * 0.22 * uGlow;

  // Per-line variation (brightness + colour)
  float idx = floor(v + 0.5);
  float amp = 0.55 + 0.45 * hash(vec2(idx, 3.1));
  float ci = mod(idx, 3.0);
  vec3 col = ci < 0.5 ? uC0 : (ci < 1.5 ? uC1 : uC2);

  // Visibility: dim by default, revealed by the cursor / clicks
  float base = mix(1.0, 0.35 + 0.65 * magnet, uMouseOn);
  base += clickGlow * 0.6;

  // Soft rim so the effect blends into neighbouring sections
  float e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float rim = smoothstep(0.0, max(uRim, 0.001), e);

  // Intro reveal sweep (top to bottom)
  float sweep = clamp(uReveal * 1.6 - (1.0 - uv.y) * 0.6, 0.0, 1.0);

  float a = clamp((core + halo) * amp * base * rim * sweep, 0.0, 1.0);
  outColor = vec4(col * a, a);   // premultiplied alpha
}`;

  function hexToRgb(hex) {
    let h = String(hex || '#ffffff').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    if (isNaN(n)) return [1, 1, 1];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[FluxLines] shader error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  class FluxLines {
    constructor(container, options) {
      this.container = container;
      this.o = Object.assign({
        colors: ['#ffffff', '#ffffff', '#ffffff'],
        glow: 2,
        rimWidth: 0.2,
        lineWidth: 1,
        flowDirection: 'down',
        mouseInteraction: true,
        clickSwirl: true,
        density: 16,
        speed: 1,
        eventTarget: null
      }, options || {});

      this.ready = false;
      this.visible = false;
      this.raf = 0;
      this.time = 0;
      this.lastNow = 0;
      this.revealStart = null;
      this.mouse = [0.5, 0.5];
      this.mouseTarget = [0.5, 0.5];
      this.mouseAmt = 0;
      this.mouseAmtTarget = 0;
      this.click = [0.5, 0.5, -1];
      this.reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      this._init();
    }

    _init() {
      const canvas = document.createElement('canvas');
      canvas.className = 'flux-lines-canvas';
      const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
      if (!gl) return; // WebGL2 unavailable: leave the background empty

      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return;

      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn('[FluxLines] link error:', gl.getProgramInfoLog(prog));
        return;
      }

      this.canvas = canvas;
      this.gl = gl;
      this.prog = prog;
      this.u = {};
      ['uRes', 'uTime', 'uDpr', 'uMouse', 'uMouseAmt', 'uMouseOn', 'uClick', 'uC0', 'uC1', 'uC2',
        'uGlow', 'uRim', 'uLineW', 'uDensity', 'uFlow', 'uReveal'
      ].forEach(n => { this.u[n] = gl.getUniformLocation(prog, n); });

      gl.useProgram(prog);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);

      const cols = (this.o.colors && this.o.colors.length ? this.o.colors : ['#ffffff']).map(hexToRgb);
      const c = i => cols[i % cols.length];
      gl.uniform3fv(this.u.uC0, c(0));
      gl.uniform3fv(this.u.uC1, c(1));
      gl.uniform3fv(this.u.uC2, c(2));
      gl.uniform1f(this.u.uGlow, this.o.glow);
      gl.uniform1f(this.u.uRim, this.o.rimWidth);
      gl.uniform1f(this.u.uLineW, this.o.lineWidth);
      gl.uniform1f(this.u.uDensity, this.o.density);
      gl.uniform1f(this.u.uMouseOn, this.o.mouseInteraction && !this.reduceMotion ? 1 : 0);

      const dirs = { down: [0, -1], up: [0, 1], left: [-1, 0], right: [1, 0] };
      const d = dirs[this.o.flowDirection] || dirs.down;
      gl.uniform2fv(this.u.uFlow, d);

      this.container.appendChild(canvas);

      this._resize = this._resize.bind(this);
      this._loop = this._loop.bind(this);
      this._onMove = this._onMove.bind(this);
      this._onLeave = this._onLeave.bind(this);
      this._onDown = this._onDown.bind(this);

      this.ro = new ResizeObserver(this._resize);
      this.ro.observe(this.container);
      this._resize();

      this.io = new IntersectionObserver((entries) => {
        this.visible = entries[0].isIntersecting;
        if (this.visible) {
          if (this.revealStart === null) this.revealStart = this.time;
          this._start();
        } else {
          this._stop();
        }
      }, { threshold: 0 });
      this.io.observe(this.container);

      const target = this.o.eventTarget || this.container;
      this.target = target;
      if (!this.reduceMotion) {
        if (this.o.mouseInteraction) {
          target.addEventListener('pointermove', this._onMove);
          target.addEventListener('pointerleave', this._onLeave);
        }
        if (this.o.clickSwirl) {
          target.addEventListener('pointerdown', this._onDown);
        }
      }

      this.ready = true;

      if (this.reduceMotion) {
        // Single static frame
        this.time = 6;
        this.revealStart = -100;
        this._draw();
      }
    }

    _resize() {
      const rect = this.container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      this.dpr = dpr;
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this.gl.viewport(0, 0, w, h);
      this.gl.uniform2f(this.u.uRes, w, h);
      this.gl.uniform1f(this.u.uDpr, dpr);
      if (this.reduceMotion) this._draw();
    }

    _pointerToUv(e) {
      const r = this.container.getBoundingClientRect();
      return [
        Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
        Math.min(Math.max(1 - (e.clientY - r.top) / r.height, 0), 1)
      ];
    }

    _onMove(e) {
      this.mouseTarget = this._pointerToUv(e);
      this.mouseAmtTarget = 1;
    }

    _onLeave() {
      this.mouseAmtTarget = 0;
    }

    _onDown(e) {
      const p = this._pointerToUv(e);
      this.click = [p[0], p[1], this.time];
    }

    _start() {
      if (this.reduceMotion || this.raf) return;
      this.lastNow = performance.now();
      this.raf = requestAnimationFrame(this._loop);
    }

    _stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    }

    _loop(now) {
      this.raf = 0;
      const dt = Math.min((now - this.lastNow) / 1000, 0.05);
      this.lastNow = now;
      this.time += dt * this.o.speed;

      // Smooth pointer follow
      this.mouse[0] += (this.mouseTarget[0] - this.mouse[0]) * 0.12;
      this.mouse[1] += (this.mouseTarget[1] - this.mouse[1]) * 0.12;
      this.mouseAmt += (this.mouseAmtTarget - this.mouseAmt) * 0.08;

      this._draw();
      if (this.visible) this.raf = requestAnimationFrame(this._loop);
    }

    _draw() {
      const gl = this.gl;
      const rev = this.revealStart === null ? 0 : Math.min(Math.max((this.time - this.revealStart) / 2.4, 0), 1);
      const eased = rev * rev * (3 - 2 * rev);
      gl.uniform1f(this.u.uTime, this.time);
      gl.uniform2f(this.u.uMouse, this.mouse[0], this.mouse[1]);
      gl.uniform1f(this.u.uMouseAmt, this.mouseAmt);
      gl.uniform3f(this.u.uClick, this.click[0], this.click[1], this.click[2]);
      gl.uniform1f(this.u.uReveal, eased);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    destroy() {
      this._stop();
      if (this.ro) this.ro.disconnect();
      if (this.io) this.io.disconnect();
      if (this.target) {
        this.target.removeEventListener('pointermove', this._onMove);
        this.target.removeEventListener('pointerleave', this._onLeave);
        this.target.removeEventListener('pointerdown', this._onDown);
      }
      if (this.canvas) this.canvas.remove();
      if (this.gl) {
        const ext = this.gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
    }
  }

  window.FluxLines = FluxLines;
})();