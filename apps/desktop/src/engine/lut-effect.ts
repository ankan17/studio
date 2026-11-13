// Spike S1: a look as a WebGL2 effect on <Video>. The LUT is a 3D texture; intensity mixes original and graded in the shader.
import {generateLut, LOOKS, trueVariant} from "@studio/schema";
import {createEffect} from "remotion";

const SIZE = 33;
type Params = {lutId: string; intensity: number};
type State = {gl: WebGL2RenderingContext; program: WebGLProgram; src: WebGLTexture; luts: Map<string, WebGLTexture>; uIntensity: WebGLUniformLocation | null};

const VERT = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
uniform sampler2D src;
uniform sampler3D lut;
uniform float intensity;
out vec4 outColor;
const float N = ${SIZE}.0;
void main() {
  vec4 c = texture(src, uv);
  vec3 graded = texture(lut, c.rgb * ((N - 1.0) / N) + 0.5 / N).rgb;
  vec3 rgb = mix(c.rgb, graded, intensity);
  outColor = vec4(rgb * c.a, c.a); // the target canvas is premultiplied
}`;

const lutData = (lutId: string) => {
  const base = lutId.replace(/-true$/, "");
  const look = LOOKS[base];
  if (!look) throw new Error(`unknown look ${lutId}`);
  return generateLut(lutId.endsWith("-true") ? trueVariant(look) : look, SIZE);
};

const compile = (gl: WebGL2RenderingContext, type: number, text: string) => {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, text);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`LUT shader: ${gl.getShaderInfoLog(s)}`);
  return s;
};

export const lutLook = createEffect<Params, State>({
  type: "studio/lut",
  label: "Look",
  documentationLink: null,
  backend: "webgl2",
  calculateKey: (p) => `${p.lutId}:${p.intensity}`,
  schema: {intensity: {type: "number", min: 0, max: 1, step: 0.01, default: 1, hiddenFromList: false}},
  validateParams: (p) => {
    if (!(p.intensity >= 0 && p.intensity <= 1)) throw new Error("intensity must be 0..1");
  },
  setup: (target) => {
    const gl = target.getContext("webgl2");
    if (!gl) throw new Error("no webgl2");
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`LUT program: ${gl.getProgramInfoLog(program)}`);
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "src"), 0);
    gl.uniform1i(gl.getUniformLocation(program, "lut"), 1);
    const src = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, src);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return {gl, program, src, luts: new Map(), uIntensity: gl.getUniformLocation(program, "intensity")};
  },
  apply: ({source, state, params, width, height, flipSourceY}) => {
    const {gl} = state;
    let lut = state.luts.get(params.lutId);
    if (!lut) {
      lut = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_3D, lut);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); // Remotion leaves it on; texImage3D refuses either flag
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, SIZE, SIZE, SIZE, 0, gl.RGB, gl.FLOAT, lutData(params.lutId));
      for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, k, gl.LINEAR);
      for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, k, gl.CLAMP_TO_EDGE);
      state.luts.set(params.lutId, lut);
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(state.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipSourceY);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, lut);
    gl.uniform1f(state.uIntensity, params.intensity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const g = globalThis as {__lutApplies?: number};
    g.__lutApplies = (g.__lutApplies ?? 0) + 1; // spike: the script reads this to get graded frames per second
    gl.activeTexture(gl.TEXTURE0);
  },
  cleanup: ({gl, program, src, luts}) => {
    gl.deleteProgram(program);
    gl.deleteTexture(src);
    for (const t of luts.values()) gl.deleteTexture(t);
  },
});
