import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import "./styles.css";

const canvas = document.querySelector("#scene");
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x9bd5dc, 0.0027);

const camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.1, 2500);
camera.position.set(31, 13, 43);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  canvas,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.maxDistance = 125;
controls.minDistance = 12;
controls.maxPolarAngle = Math.PI * 0.51;
controls.minPolarAngle = Math.PI * 0.06;
controls.target.set(0, 0.6, -12);

const sunDirection = new THREE.Vector3(-0.44, 0.72, 0.54).normalize();
const sunLight = new THREE.DirectionalLight(0xfff2c2, 2.9);
sunLight.position.copy(sunDirection).multiplyScalar(120);
scene.add(sunLight);
scene.add(new THREE.HemisphereLight(0xaad9ff, 0x0c4d4e, 1.25));

const skyUniforms = {
  uSunDirection: { value: sunDirection },
  uTopColor: { value: new THREE.Color("#6db7dd") },
  uHorizonColor: { value: new THREE.Color("#d4f0ea") },
  uDuskColor: { value: new THREE.Color("#ffd08c") }
};

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(900, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: skyUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorldDirection;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldDirection = normalize(worldPosition.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDirection;
      uniform vec3 uTopColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uDuskColor;
      varying vec3 vWorldDirection;

      void main() {
        float horizon = smoothstep(-0.2, 0.72, vWorldDirection.y);
        float sun = pow(max(dot(normalize(vWorldDirection), uSunDirection), 0.0), 520.0);
        float warm = pow(max(dot(normalize(vWorldDirection), uSunDirection), 0.0), 7.0);
        vec3 color = mix(uHorizonColor, uTopColor, horizon);
        color = mix(color, uDuskColor, warm * 0.28);
        color += vec3(1.0, 0.86, 0.55) * sun * 3.8;
        gl_FragColor = vec4(color, 1.0);
      }
    `
  })
);
scene.add(sky);

const waterUniforms = {
  uTime: { value: 0 },
  uWaveHeight: { value: 1.95 },
  uChop: { value: 0.8 },
  uFoamAmount: { value: 0.92 },
  uReflectivity: { value: 0.72 },
  uCausticAmount: { value: 0.12 },
  uWindAngle: { value: THREE.MathUtils.degToRad(35) },
  uDeepColor: { value: new THREE.Color("#042a36") },
  uShallowColor: { value: new THREE.Color("#1bb4a0") },
  uHorizonColor: { value: new THREE.Color("#bfeee7") },
  uSkyColor: { value: new THREE.Color("#74b8dc") },
  uSunColor: { value: new THREE.Color("#fff3bd") },
  uSunDirection: { value: sunDirection },
  uOpacity: { value: 0.87 }
};

const waterMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  extensions: {
    derivatives: true
  },
  uniforms: waterUniforms,
  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uWaveHeight;
    uniform float uChop;
    uniform float uWindAngle;

    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying float vHeight;
    varying float vFoam;
    varying float vWaveEnergy;
    varying vec2 vUv;

    const float TAU = 6.28318530718;

    vec2 rotate2(vec2 value, float angle) {
      float s = sin(angle);
      float c = cos(angle);
      return mat2(c, -s, s, c) * value;
    }

    float hash(vec2 point) {
      point = fract(point * vec2(127.1, 311.7));
      point += dot(point, point + 37.41);
      return fract(point.x * point.y);
    }

    float noise(vec2 point) {
      vec2 i = floor(point);
      vec2 f = fract(point);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
      );
    }

    float fbm(vec2 point) {
      float value = 0.0;
      float amplitude = 0.5;
      mat2 spin = mat2(0.72, -0.69, 0.69, 0.72);
      for (int i = 0; i < 4; i++) {
        value += amplitude * noise(point);
        point = spin * point * 2.03 + 11.9;
        amplitude *= 0.53;
      }
      return value;
    }

    float waveEnergy(vec2 coord, vec2 wind, vec2 crossWind) {
      float broad = fbm(coord * 0.011 + wind * uTime * 0.012 - crossWind * uTime * 0.007);
      float broken = fbm(coord * 0.032 - wind * uTime * 0.028 + crossWind * uTime * 0.018);
      float energy = mix(0.5, 1.42, smoothstep(0.2, 0.92, broad));
      energy += (broken - 0.5) * 0.34;
      return clamp(energy, 0.42, 1.55);
    }

    vec2 domainWarp(vec2 coord, vec2 wind, vec2 crossWind) {
      float wideA = fbm(coord * 0.014 + vec2(2.7, 8.1) + wind * uTime * 0.015);
      float wideB = fbm(coord * 0.017 + vec2(9.4, -3.8) - crossWind * uTime * 0.013);
      vec2 warp = vec2(wideA - 0.5, wideB - 0.5) * 26.0;
      warp += crossWind * sin(dot(coord, wind) * 0.033 + uTime * 0.14) * 10.0;
      warp += wind * sin(dot(coord, crossWind) * 0.029 - uTime * 0.12) * 7.0;
      return coord + warp;
    }

    vec3 gerstner(vec3 point, vec2 direction, float amplitude, float wavelength, float speed, float chop) {
      float frequency = TAU / wavelength;
      float phase = frequency * dot(direction, point.xy) + uTime * speed;
      float wave = sin(phase);
      float crest = cos(phase);
      float horizontal = chop * amplitude;
      return vec3(direction.x * horizontal * crest, direction.y * horizontal * crest, amplitude * wave);
    }

    vec3 displace(vec3 point) {
      vec2 wind = vec2(cos(uWindAngle), sin(uWindAngle));
      vec2 crossWind = vec2(-wind.y, wind.x);
      vec2 obliqueA = normalize(wind * 0.45 + crossWind * 0.9);
      vec2 obliqueB = normalize(wind * -0.28 + crossWind * 0.96);
      vec2 coord = point.xy;
      float energy = waveEnergy(coord, wind, crossWind);
      float chopEnergy = mix(0.72, 1.34, fbm(coord * 0.065 + obliqueA * uTime * 0.04));
      vec3 wavePoint = vec3(domainWarp(coord, wind, crossWind), point.z);
      vec3 offset = vec3(0.0);
      offset += gerstner(wavePoint, wind, 1.1 * energy, 96.0, 0.46, 0.86 * chopEnergy);
      offset += gerstner(wavePoint, rotate2(wind, 1.18), 1.0 * mix(0.8, 1.18, energy), 74.0, 0.58, 0.78 * chopEnergy);
      offset += gerstner(wavePoint, rotate2(wind, -1.54), 0.88 * mix(0.78, 1.22, energy), 58.0, 0.72, 0.68);
      offset += gerstner(wavePoint, rotate2(wind, 2.34), 0.56 * mix(0.66, 1.28, chopEnergy), 34.0, 1.02, 0.5);
      offset += gerstner(wavePoint, rotate2(wind, -2.36), 0.34 * mix(0.66, 1.22, chopEnergy), 22.0, 1.42, 0.34);
      offset += gerstner(wavePoint, crossWind, 0.26 * mix(0.7, 1.35, energy), 17.0, -1.72, 0.26);
      offset += gerstner(wavePoint, obliqueA, 0.12 * chopEnergy, 9.5, -2.0, 0.13);
      offset += gerstner(wavePoint, obliqueB, 0.08 * chopEnergy, 6.8, 2.5, 0.09);
      float crossing =
        sin(dot(wavePoint.xy, wind) * 0.18 + uTime * 0.42) *
        sin(dot(wavePoint.xy, crossWind) * 0.16 - uTime * 0.48) * 0.34;
      float diamond =
        sin(dot(wavePoint.xy, obliqueA) * 0.28 - uTime * 0.72 + sin(dot(wavePoint.xy, obliqueB) * 0.11)) *
        sin(dot(wavePoint.xy, obliqueB) * 0.24 + uTime * 0.62) * 0.2;
      float crossRipple =
        sin(dot(wavePoint.xy, crossWind) * 0.92 - uTime * 1.2) * 0.04 +
        sin(dot(wavePoint.xy, obliqueA) * 1.42 + uTime * 1.75) * 0.03 +
        sin(dot(wavePoint.xy, obliqueB) * 1.9 - uTime * 2.1) * 0.018;
      offset.z += (crossing + diamond + crossRipple) * mix(0.72, 1.25, energy);
      return point + offset * uWaveHeight;
    }

    void main() {
      vec3 displaced = displace(position);
      vec2 wind = vec2(cos(uWindAngle), sin(uWindAngle));
      vec2 crossWind = vec2(-wind.y, wind.x);

      float sampleSize = 1.15;
      vec3 displacedX = displace(position + vec3(sampleSize, 0.0, 0.0));
      vec3 displacedY = displace(position + vec3(0.0, sampleSize, 0.0));
      vec3 tangentX = displacedX - displaced;
      vec3 tangentY = displacedY - displaced;
      vec3 normal = normalize(cross(tangentX, tangentY));

      float slope = 1.0 - clamp(normal.z, 0.0, 1.0);
      float crest = smoothstep(1.35, 4.2, displaced.z);
      vFoam = smoothstep(0.16, 0.38, slope * uChop) * crest;
      vHeight = displaced.z;
      vWaveEnergy = waveEnergy(position.xy, wind, crossWind);
      vNormal = normalMatrix * normal;
      vUv = uv;

      vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uFoamAmount;
    uniform float uReflectivity;
    uniform float uCausticAmount;
    uniform float uWindAngle;
    uniform float uOpacity;
    uniform vec3 uDeepColor;
    uniform vec3 uShallowColor;
    uniform vec3 uHorizonColor;
    uniform vec3 uSkyColor;
    uniform vec3 uSunColor;
    uniform vec3 uSunDirection;

    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying float vHeight;
    varying float vFoam;
    varying float vWaveEnergy;
    varying vec2 vUv;

    float hash(vec2 point) {
      point = fract(point * vec2(123.34, 456.21));
      point += dot(point, point + 45.32);
      return fract(point.x * point.y);
    }

    float noise(vec2 point) {
      vec2 i = floor(point);
      vec2 f = fract(point);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
      );
    }

    float fbm(vec2 point) {
      float value = 0.0;
      float amplitude = 0.5;
      mat2 spin = mat2(0.8, -0.6, 0.6, 0.8);
      for (int i = 0; i < 5; i++) {
        value += amplitude * noise(point);
        point = spin * point * 2.04 + 18.7;
        amplitude *= 0.52;
      }
      return value;
    }

    float caustic(vec2 point) {
      vec2 p = point * 0.18;
      float a = sin(p.x * 17.0 + uTime * 1.25 + sin(p.y * 7.0));
      float b = sin((p.x + p.y) * 12.0 - uTime * 1.65);
      float c = sin(length(p) * 21.0 - uTime * 1.1);
      float lines = abs(a + b + c) / 3.0;
      return pow(1.0 - lines, 4.2);
    }

    vec2 rotate2(vec2 value, float angle) {
      float s = sin(angle);
      float c = cos(angle);
      return mat2(c, -s, s, c) * value;
    }

    void main() {
      vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
      vec3 normal = normalize(vNormal);
      vec2 wind = vec2(cos(uWindAngle), sin(uWindAngle));
      vec2 crossWind = vec2(-wind.y, wind.x);
      vec2 rippleFlowA = rotate2(wind, 1.35);
      vec2 rippleFlowB = rotate2(wind, -1.75);
      float broadPatch = fbm(vWorldPosition.xz * 0.018 + wind * uTime * 0.018 - crossWind * uTime * 0.011);
      float colorPatch = fbm(vWorldPosition.xz * 0.043 + vec2(6.7, -4.2) - rippleFlowA * uTime * 0.026);
      float sparklePatch = smoothstep(0.36, 0.88, fbm(vWorldPosition.xz * 0.052 + rippleFlowB * uTime * 0.036));
      float roughPatch = mix(0.62, 1.34, fbm(vWorldPosition.xz * 0.072 - wind * uTime * 0.05 + crossWind * uTime * 0.024));

      float rippleA = fbm(vWorldPosition.xz * 0.26 + wind * uTime * 0.08 + crossWind * uTime * 0.035);
      float rippleB = fbm(vWorldPosition.xz * 0.78 + rippleFlowA * uTime * 0.16 - wind * uTime * 0.05);
      float rippleC = fbm(vWorldPosition.xz * 1.18 + rippleFlowB * uTime * 0.24 + crossWind * uTime * 0.09);
      float microRipple =
        sin(dot(vWorldPosition.xz, rippleFlowA) * 2.8 + uTime * 3.1) * 0.55 +
        sin(dot(vWorldPosition.xz, rippleFlowB) * 3.6 - uTime * 3.7) * 0.45;
      normal = normalize(normal + vec3(
        ((rippleA - 0.5) * 0.13 + (rippleC - 0.5) * crossWind.x * 0.08 + microRipple * 0.016) * roughPatch,
        0.0,
        ((rippleB - 0.5) * 0.13 + (rippleC - 0.5) * crossWind.y * 0.08 - microRipple * 0.01) * roughPatch
      ));

      float facing = clamp(dot(normal, viewDirection), 0.0, 1.0);
      float fresnel = pow(1.0 - facing, 3.25);
      vec3 reflected = mix(uHorizonColor, uSkyColor, clamp(reflect(-viewDirection, normal).y * 0.52 + 0.48, 0.0, 1.0));
      float sunGlitter = pow(max(dot(reflect(-uSunDirection, normal), viewDirection), 0.0), 240.0);
      sunGlitter += pow(max(dot(reflect(-uSunDirection, normal), viewDirection), 0.0), 36.0) * 0.14;
      sunGlitter *= mix(0.28, 1.72, sparklePatch) * mix(0.7, 1.2, clamp(vWaveEnergy, 0.0, 1.35));

      float depthTint = smoothstep(-1.4, 2.5, vHeight) * 0.35 + smoothstep(24.0, 145.0, length(cameraPosition.xz - vWorldPosition.xz)) * 0.65;
      depthTint = clamp(depthTint + (1.0 - vWaveEnergy) * 0.2 + (broadPatch - 0.5) * 0.22, 0.0, 1.0);
      vec3 body = mix(uShallowColor, uDeepColor, depthTint);
      vec3 coolPatch = mix(vec3(0.0, 0.12, 0.17), vec3(0.02, 0.24, 0.2), colorPatch);
      body = mix(body, body + coolPatch, 0.22 + (1.0 - depthTint) * 0.18);
      body *= mix(0.82, 1.12, smoothstep(0.2, 0.88, broadPatch));
      body += vec3(0.055, 0.22, 0.19) * caustic(vWorldPosition.xz + normal.xz * 5.0) * (1.0 - depthTint) * 0.48 * uCausticAmount;
      body += vec3(0.02, 0.1, 0.08) * rippleA * mix(0.55, 1.25, vWaveEnergy);

      float reflectionAmount = clamp((0.08 + fresnel * 0.74 + uReflectivity * 0.24) * mix(0.72, 1.16, sparklePatch), 0.0, 0.9);
      vec3 color = mix(body, reflected, reflectionAmount);
      color += uSunColor * sunGlitter * (1.35 + uReflectivity);

      float foamNoise = fbm(vWorldPosition.xz * 0.58 + wind * uTime * 0.1 + crossWind * uTime * 0.055);
      float crossFoamNoise = fbm(vWorldPosition.xz * 0.9 + rippleFlowA * uTime * 0.18 - rippleFlowB * uTime * 0.08);
      float crestMask = smoothstep(1.3, 4.8, vHeight);
      float streaks = smoothstep(0.66, 0.92, foamNoise) * smoothstep(0.48, 0.9, crossFoamNoise) * vFoam;
      float crestBreak = smoothstep(2.8, 6.4, vHeight) * smoothstep(0.48, 0.88, max(foamNoise, crossFoamNoise));
      float fineFoam = smoothstep(0.82, 0.97, fbm(vWorldPosition.xz * 1.36 - wind * uTime * 0.22 + crossWind * uTime * 0.16));
      float foamPatch = mix(0.48, 1.42, smoothstep(0.46, 1.26, vWaveEnergy) * smoothstep(0.28, 0.92, max(broadPatch, crossFoamNoise)));
      float foam = clamp((streaks * 1.15 + crestBreak * 0.34 + fineFoam * vFoam * crestMask * 0.28) * uFoamAmount * foamPatch, 0.0, 1.0);
      vec3 foamColor = vec3(0.86, 0.98, 0.97);
      color = mix(color, foamColor, foam * 0.72);

      float horizonFog = smoothstep(72.0, 220.0, length(cameraPosition.xz - vWorldPosition.xz));
      color = mix(color, uHorizonColor, horizonFog * 0.42);

      gl_FragColor = vec4(color, clamp(uOpacity + foam * 0.12 - fresnel * 0.06, 0.72, 0.98));
    }
  `
});

const water = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200, 360, 360), waterMaterial);
water.rotation.x = -Math.PI * 0.5;
water.renderOrder = 2;
scene.add(water);

const floorMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uSand: { value: new THREE.Color("#8fb889") },
    uReef: { value: new THREE.Color("#0c6e67") },
    uCaustic: { value: new THREE.Color("#dffced") }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorldPosition;

    void main() {
      vUv = uv;
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform vec3 uSand;
    uniform vec3 uReef;
    uniform vec3 uCaustic;
    varying vec2 vUv;
    varying vec3 vWorldPosition;

    float hash(vec2 point) {
      point = fract(point * vec2(41.7, 289.1));
      point += dot(point, point + 19.19);
      return fract(point.x * point.y);
    }

    float noise(vec2 point) {
      vec2 i = floor(point);
      vec2 f = fract(point);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
      );
    }

    float caustic(vec2 point) {
      vec2 p = point * 0.16;
      float a = sin(p.x * 18.0 + uTime * 1.4);
      float b = sin((p.x - p.y) * 13.0 - uTime * 1.1);
      float c = sin(length(p + 3.0) * 20.0 + uTime * 0.9);
      return pow(1.0 - abs(a + b + c) / 3.0, 5.5);
    }

    void main() {
      float reefMask = smoothstep(0.42, 0.86, noise(vWorldPosition.xz * 0.024));
      float grain = noise(vWorldPosition.xz * 0.35);
      float light = caustic(vWorldPosition.xz);
      vec3 base = mix(uSand, uReef, reefMask * 0.72);
      base *= 0.74 + grain * 0.18;
      base += uCaustic * light * 0.38;
      float vignette = smoothstep(410.0, 85.0, length(vWorldPosition.xz));
      gl_FragColor = vec4(base * vignette, 1.0);
    }
  `
});

const seaFloor = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200, 24, 24), floorMaterial);
seaFloor.position.y = -8;
seaFloor.rotation.x = -Math.PI * 0.5;
seaFloor.renderOrder = 1;
scene.add(seaFloor);

const horizonGroup = new THREE.Group();
scene.add(horizonGroup);

function addRock({ x, z, scale, color, rotation }) {
  const rock = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 2),
    new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: 0.92,
      metalness: 0.02
    })
  );
  rock.position.set(x, -4.5 + scale[1] * 0.28, z);
  rock.scale.set(scale[0], scale[1], scale[2]);
  rock.rotation.set(rotation[0], rotation[1], rotation[2]);
  horizonGroup.add(rock);
}

[
  { x: 78, z: -126, scale: [26, 17, 22], color: "#655d53", rotation: [0.2, 0.8, -0.08] },
  { x: 104, z: -142, scale: [18, 13, 18], color: "#796e61", rotation: [-0.1, 1.6, 0.14] },
  { x: 135, z: -118, scale: [34, 22, 25], color: "#544f49", rotation: [0.16, 0.25, 0.04] },
  { x: -108, z: -168, scale: [31, 20, 24], color: "#57635f", rotation: [0.18, -0.45, 0.1] },
  { x: -72, z: -148, scale: [17, 12, 16], color: "#6f746a", rotation: [-0.08, 0.9, -0.11] }
].forEach(addRock);

function createBoat() {
  const boat = new THREE.Group();
  boat.position.set(4, 1, -24);
  boat.rotation.y = -0.2;
  boat.scale.setScalar(1.55);
  boat.userData.floatOffset = 4.25;

  const hullShape = new THREE.Shape();
  hullShape.moveTo(-2.25, 0.18);
  hullShape.lineTo(-1.5, -0.68);
  hullShape.lineTo(1.5, -0.68);
  hullShape.lineTo(2.25, 0.18);
  hullShape.lineTo(1.28, 0.66);
  hullShape.lineTo(-1.28, 0.66);
  hullShape.closePath();

  const hullGeometry = new THREE.ExtrudeGeometry(hullShape, {
    depth: 6.8,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.16,
    bevelThickness: 0.18
  });
  hullGeometry.center();

  const hull = new THREE.Mesh(
    hullGeometry,
    new THREE.MeshStandardMaterial({
      color: "#0e7280",
      roughness: 0.58,
      metalness: 0.04
    })
  );
  hull.scale.set(0.9, 0.9, 1);
  boat.add(hull);

  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 0.16, 4.2),
    new THREE.MeshStandardMaterial({ color: "#211c18", roughness: 0.7 })
  );
  rail.position.set(0, 0.76, -0.2);
  boat.add(rail);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(2.35, 1.45, 2.15),
    new THREE.MeshStandardMaterial({ color: "#ece6d5", roughness: 0.82 })
  );
  cabin.position.set(0, 1.28, 0.55);
  boat.add(cabin);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(2.7, 0.18, 2.55),
    new THREE.MeshStandardMaterial({ color: "#d97a2c", roughness: 0.6 })
  );
  roof.position.set(0, 2.1, 0.55);
  boat.add(roof);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.05, 4.8, 10),
    new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.35 })
  );
  mast.position.set(0.95, 3.45, 0.65);
  boat.add(mast);

  scene.add(boat);
  return boat;
}

const boat = createBoat();

const presets = {
  reef: {
    wind: 35,
    height: 1.05,
    chop: 0.75,
    foam: 0.92,
    reflectivity: 0.72,
    deep: "#042a36",
    shallow: "#1bb4a0",
    sky: "#74b8dc",
    horizon: "#bfeee7",
    floorY: -8,
    exposure: 1.05,
    fog: "#9bd5dc",
    opacity: 0.86,
    floorVisible: true,
    caustics: 1
  },
  open: {
    wind: 14,
    height: 1.95,
    chop: 1.04,
    foam: 0.92,
    reflectivity: 0.93,
    deep: "#052849",
    shallow: "#0c8fb3",
    sky: "#86bad7",
    horizon: "#d6ebe5",
    floorY: -58,
    exposure: 1,
    fog: "#b2d3dc",
    opacity: 0.97,
    floorVisible: false,
    caustics: 0.06
  },
  storm: {
    wind: -62,
    height: 2.7,
    chop: 1.28,
    foam: 1.34,
    reflectivity: 0.96,
    deep: "#061c2a",
    shallow: "#16666e",
    sky: "#879da6",
    horizon: "#bcc5c3",
    floorY: -34,
    exposure: 0.82,
    fog: "#91a4a9",
    opacity: 0.98,
    floorVisible: false,
    caustics: 0.03
  },
  night: {
    wind: 82,
    height: 1.3,
    chop: 0.58,
    foam: 0.48,
    reflectivity: 1.05,
    deep: "#020e21",
    shallow: "#0b5263",
    sky: "#253b67",
    horizon: "#798ca0",
    floorY: -16,
    exposure: 0.68,
    fog: "#25364b",
    opacity: 0.94,
    floorVisible: false,
    caustics: 0.02
  }
};

const controlInputs = {
  wind: document.querySelector("#wind"),
  height: document.querySelector("#height"),
  chop: document.querySelector("#chop"),
  foam: document.querySelector("#foam"),
  reflectivity: document.querySelector("#reflectivity")
};

function writeUniformsFromControls() {
  waterUniforms.uWindAngle.value = THREE.MathUtils.degToRad(Number(controlInputs.wind.value));
  waterUniforms.uWaveHeight.value = Number(controlInputs.height.value);
  waterUniforms.uChop.value = Number(controlInputs.chop.value);
  waterUniforms.uFoamAmount.value = Number(controlInputs.foam.value);
  waterUniforms.uReflectivity.value = Number(controlInputs.reflectivity.value);
}

Object.values(controlInputs).forEach((input) => {
  input.addEventListener("input", () => {
    document.querySelector(".preset.is-active")?.classList.remove("is-active");
    writeUniformsFromControls();
  });
});

function applyPreset(name) {
  const preset = presets[name];
  controlInputs.wind.value = preset.wind;
  controlInputs.height.value = preset.height;
  controlInputs.chop.value = preset.chop;
  controlInputs.foam.value = preset.foam;
  controlInputs.reflectivity.value = preset.reflectivity;
  writeUniformsFromControls();

  waterUniforms.uDeepColor.value.set(preset.deep);
  waterUniforms.uShallowColor.value.set(preset.shallow);
  waterUniforms.uSkyColor.value.set(preset.sky);
  waterUniforms.uHorizonColor.value.set(preset.horizon);
  skyUniforms.uTopColor.value.set(preset.sky);
  skyUniforms.uHorizonColor.value.set(preset.horizon);
  scene.fog.color.set(preset.fog);
  renderer.toneMappingExposure = preset.exposure;
  seaFloor.position.y = preset.floorY;
  seaFloor.visible = preset.floorVisible;
  waterUniforms.uOpacity.value = preset.opacity;
  waterUniforms.uCausticAmount.value = preset.caustics;

  document.querySelectorAll(".preset").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.preset === name);
  });
}

document.querySelectorAll(".preset").forEach((button) => {
  button.addEventListener("click", () => applyPreset(button.dataset.preset));
});

applyPreset("open");

function rotate2(x, y, angle) {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  return [x * c - y * s, x * s + y * c];
}

function sampleWaveHeight(x, z, time) {
  const height = waterUniforms.uWaveHeight.value;
  const windAngle = waterUniforms.uWindAngle.value;
  const wind = [Math.cos(windAngle), Math.sin(windAngle)];
  const crossWind = [-wind[1], wind[0]];
  const obliqueA = normalize2(wind[0] * 0.45 + crossWind[0] * 0.9, wind[1] * 0.45 + crossWind[1] * 0.9);
  const obliqueB = normalize2(wind[0] * -0.28 + crossWind[0] * 0.96, wind[1] * -0.28 + crossWind[1] * 0.96);
  const waves = [
    { dir: wind, amp: 1.1, length: 96, speed: 0.46 },
    { dir: rotate2(wind[0], wind[1], 1.18), amp: 1.0, length: 74, speed: 0.58 },
    { dir: rotate2(wind[0], wind[1], -1.54), amp: 0.88, length: 58, speed: 0.72 },
    { dir: rotate2(wind[0], wind[1], 2.34), amp: 0.56, length: 34, speed: 1.02 },
    { dir: rotate2(wind[0], wind[1], -2.36), amp: 0.34, length: 22, speed: 1.42 },
    { dir: crossWind, amp: 0.26, length: 17, speed: -1.72 },
    { dir: obliqueA, amp: 0.12, length: 9.5, speed: -2.0 },
    { dir: obliqueB, amp: 0.08, length: 6.8, speed: 2.5 }
  ];

  const gerstnerHeight = waves.reduce((total, wave) => {
    const frequency = Math.PI * 2 / wave.length;
    const phase = frequency * (wave.dir[0] * x + wave.dir[1] * z) + time * wave.speed;
    return total + Math.sin(phase) * wave.amp * height;
  }, 0);
  const crossing =
    Math.sin((wind[0] * x + wind[1] * z) * 0.18 + time * 0.42) *
    Math.sin((crossWind[0] * x + crossWind[1] * z) * 0.16 - time * 0.48) * 0.34;
  const diamond =
    Math.sin((obliqueA[0] * x + obliqueA[1] * z) * 0.28 - time * 0.72 + Math.sin((obliqueB[0] * x + obliqueB[1] * z) * 0.11)) *
    Math.sin((obliqueB[0] * x + obliqueB[1] * z) * 0.24 + time * 0.62) * 0.2;
  const crossRipple =
    Math.sin((crossWind[0] * x + crossWind[1] * z) * 0.92 - time * 1.2) * 0.04 +
    Math.sin((obliqueA[0] * x + obliqueA[1] * z) * 1.42 + time * 1.75) * 0.03 +
    Math.sin((obliqueB[0] * x + obliqueB[1] * z) * 1.9 - time * 2.1) * 0.018;

  return gerstnerHeight + (crossing + diamond + crossRipple) * height;
}

function normalize2(x, y) {
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
}

const clock = new THREE.Clock();

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener("resize", resize);

function tick() {
  const elapsed = clock.getElapsedTime();
  waterUniforms.uTime.value = elapsed;
  floorMaterial.uniforms.uTime.value = elapsed;
  sky.rotation.y = elapsed * 0.006;
  const boatHeight = sampleWaveHeight(boat.position.x, boat.position.z, elapsed);
  const boatHeightForward = sampleWaveHeight(boat.position.x, boat.position.z - 5.2, elapsed);
  const boatHeightSide = sampleWaveHeight(boat.position.x + 5.2, boat.position.z, elapsed);
  boat.position.y = boatHeight + boat.userData.floatOffset;
  boat.rotation.x = THREE.MathUtils.lerp(boat.rotation.x, (boatHeightForward - boatHeight) * 0.08, 0.05);
  boat.rotation.z = THREE.MathUtils.lerp(boat.rotation.z, -(boatHeightSide - boatHeight) * 0.08, 0.05);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

tick();
