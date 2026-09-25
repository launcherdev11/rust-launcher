import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from "three";
import type { SkinViewer } from "skinview3d";

const LAYER_GROUP_NAME = "skin-layer-3d";
const ALPHA_THRESHOLD = 8;
const EXTRUDE = 0.55;

type FaceId = "front" | "back" | "left" | "right" | "top" | "bottom";

type PartSpec = {
  u: number;
  v: number;
  w: number;
  h: number;
  d: number;
  offset: { x: number; y: number; z: number };
  parent: Object3D;
  hide: Object3D;
};

function samplePixel(
  data: Uint8ClampedArray,
  texW: number,
  x: number,
  y: number,
): { r: number; g: number; b: number; a: number } | null {
  if (x < 0 || y < 0 || x >= texW) return null;
  const i = (y * texW + x) * 4;
  const a = data[i + 3] ?? 0;
  if (a < ALPHA_THRESHOLD) return null;
  return {
    r: (data[i] ?? 0) / 255,
    g: (data[i + 1] ?? 0) / 255,
    b: (data[i + 2] ?? 0) / 255,
    a: a / 255,
  };
}

function faceUv(
  u: number,
  v: number,
  w: number,
  h: number,
  d: number,
  face: FaceId,
): { x: number; y: number; fw: number; fh: number } {
  switch (face) {
    case "top":
      return { x: u + d, y: v, fw: w, fh: d };
    case "bottom":
      return { x: u + d + w, y: v, fw: w, fh: d };
    case "left":
      return { x: u, y: v + d, fw: d, fh: h };
    case "front":
      return { x: u + d, y: v + d, fw: w, fh: h };
    case "right":
      return { x: u + d + w, y: v + d, fw: d, fh: h };
    case "back":
      return { x: u + d + w + d, y: v + d, fw: w, fh: h };
  }
}

function appendBox(
  positions: number[],
  colors: number[],
  indices: number[],
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  r: number,
  g: number,
  b: number,
) {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const base = positions.length / 3;
  const corners: [number, number, number][] = [
    [cx - hx, cy - hy, cz - hz],
    [cx + hx, cy - hy, cz - hz],
    [cx + hx, cy + hy, cz - hz],
    [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz],
    [cx + hx, cy - hy, cz + hz],
    [cx + hx, cy + hy, cz + hz],
    [cx - hx, cy + hy, cz + hz],
  ];
  for (const [x, y, z] of corners) {
    positions.push(x, y, z);
    colors.push(r, g, b);
  }
  const faces = [
    [0, 1, 2, 0, 2, 3],
    [5, 4, 7, 5, 7, 6],
    [4, 0, 3, 4, 3, 7],
    [1, 5, 6, 1, 6, 2],
    [3, 2, 6, 3, 6, 7],
    [4, 5, 1, 4, 1, 0],
  ];
  for (const face of faces) {
    for (const idx of face) indices.push(base + idx);
  }
}

function buildFacePixels(
  data: Uint8ClampedArray,
  texW: number,
  scale: number,
  u: number,
  v: number,
  w: number,
  h: number,
  d: number,
  face: FaceId,
  offset: { x: number; y: number; z: number },
  positions: number[],
  colors: number[],
  indices: number[],
) {
  const uv = faceUv(u, v, w, h, d, face);
  const halfW = w / 2;
  const halfH = h / 2;
  const halfD = d / 2;
  const e = EXTRUDE;

  for (let py = 0; py < uv.fh; py++) {
    for (let px = 0; px < uv.fw; px++) {
      const sx = Math.floor((uv.x + px) * scale);
      const sy = Math.floor((uv.y + py) * scale);
      const pixel = samplePixel(
        data,
        texW,
        sx + Math.floor(scale / 2),
        sy + Math.floor(scale / 2),
      );
      if (!pixel) continue;

      let cx = 0;
      let cy = 0;
      let cz = 0;
      let bx = 1;
      let by = 1;
      let bz = 1;

      switch (face) {
        case "front":
          cx = offset.x + (px + 0.5 - halfW);
          cy = offset.y + (halfH - (py + 0.5));
          cz = offset.z + halfD + e / 2;
          bx = 1;
          by = 1;
          bz = e;
          break;
        case "back":
          cx = offset.x + (halfW - (px + 0.5));
          cy = offset.y + (halfH - (py + 0.5));
          cz = offset.z - halfD - e / 2;
          bx = 1;
          by = 1;
          bz = e;
          break;
        case "right":
          cx = offset.x + halfW + e / 2;
          cy = offset.y + (halfH - (py + 0.5));
          cz = offset.z + (halfD - (px + 0.5));
          bx = e;
          by = 1;
          bz = 1;
          break;
        case "left":
          cx = offset.x - halfW - e / 2;
          cy = offset.y + (halfH - (py + 0.5));
          cz = offset.z + (px + 0.5 - halfD);
          bx = e;
          by = 1;
          bz = 1;
          break;
        case "top":
          cx = offset.x + (px + 0.5 - halfW);
          cy = offset.y + halfH + e / 2;
          cz = offset.z + (py + 0.5 - halfD);
          bx = 1;
          by = e;
          bz = 1;
          break;
        case "bottom":
          cx = offset.x + (px + 0.5 - halfW);
          cy = offset.y - halfH - e / 2;
          cz = offset.z + (py + 0.5 - halfD);
          bx = 1;
          by = e;
          bz = 1;
          break;
      }

      appendBox(positions, colors, indices, cx, cy, cz, bx, by, bz, pixel.r, pixel.g, pixel.b);
    }
  }
}

function buildPartMesh(
  data: Uint8ClampedArray,
  texW: number,
  scale: number,
  spec: PartSpec,
): Mesh | null {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const faces: FaceId[] = ["front", "back", "left", "right", "top", "bottom"];

  for (const face of faces) {
    buildFacePixels(
      data,
      texW,
      scale,
      spec.u,
      spec.v,
      spec.w,
      spec.h,
      spec.d,
      face,
      spec.offset,
      positions,
      colors,
      indices,
    );
  }

  if (indices.length === 0) return null;

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new MeshStandardMaterial({
    vertexColors: true,
    side: DoubleSide,
    roughness: 0.85,
    metalness: 0.02,
    flatShading: true,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = LAYER_GROUP_NAME;
  mesh.frustumCulled = false;
  return mesh;
}

function clearLayer3D(root: Object3D) {
  const toRemove: Object3D[] = [];
  root.traverse((obj) => {
    if (obj.name === LAYER_GROUP_NAME) toRemove.push(obj);
  });
  for (const obj of toRemove) {
    obj.parent?.remove(obj);
    if (obj instanceof Mesh) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        for (const m of obj.material) m.dispose();
      } else {
        obj.material.dispose();
      }
    }
  }
}

export function applySkinLayer3D(viewer: SkinViewer): void {
  const skin = viewer.playerObject.skin;
  clearLayer3D(skin);

  const canvas = viewer.skinCanvas;
  if (!canvas.width || !canvas.height) {
    skin.setOuterLayerVisible(true);
    return;
  }

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    skin.setOuterLayerVisible(true);
    return;
  }

  const scale = Math.max(1, Math.round(canvas.width / 64));
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const texW = canvas.width;
  const slim = skin.modelType === "slim";
  const armW = slim ? 3 : 4;

  const headParent = skin.head.outerLayer.parent ?? skin.head;
  const bodyParent = skin.body.outerLayer.parent ?? skin.body;
  const rightArmParent = skin.rightArm.outerLayer.parent ?? skin.rightArm;
  const leftArmParent = skin.leftArm.outerLayer.parent ?? skin.leftArm;
  const rightLegParent = skin.rightLeg.outerLayer.parent ?? skin.rightLeg;
  const leftLegParent = skin.leftLeg.outerLayer.parent ?? skin.leftLeg;

  const specs: PartSpec[] = [
    {
      u: 32,
      v: 0,
      w: 8,
      h: 8,
      d: 8,
      offset: { x: 0, y: 4, z: 0 },
      parent: headParent,
      hide: skin.head.outerLayer,
    },
    {
      u: 16,
      v: 32,
      w: 8,
      h: 12,
      d: 4,
      offset: { x: 0, y: 0, z: 0 },
      parent: bodyParent,
      hide: skin.body.outerLayer,
    },
    {
      u: 40,
      v: 32,
      w: armW,
      h: 12,
      d: 4,
      offset: { x: 0, y: 0, z: 0 },
      parent: rightArmParent,
      hide: skin.rightArm.outerLayer,
    },
    {
      u: 48,
      v: 48,
      w: armW,
      h: 12,
      d: 4,
      offset: { x: 0, y: 0, z: 0 },
      parent: leftArmParent,
      hide: skin.leftArm.outerLayer,
    },
    {
      u: 0,
      v: 32,
      w: 4,
      h: 12,
      d: 4,
      offset: { x: 0, y: 0, z: 0 },
      parent: rightLegParent,
      hide: skin.rightLeg.outerLayer,
    },
    {
      u: 0,
      v: 48,
      w: 4,
      h: 12,
      d: 4,
      offset: { x: 0, y: 0, z: 0 },
      parent: leftLegParent,
      hide: skin.leftLeg.outerLayer,
    },
  ];

  let any = false;
  for (const spec of specs) {
    const mesh = buildPartMesh(data, texW, scale, spec);
    if (!mesh) {
      spec.hide.visible = true;
      continue;
    }
    spec.hide.visible = false;
    spec.parent.add(mesh);
    any = true;
  }

  if (!any) {
    skin.setOuterLayerVisible(true);
  }
}

export function removeSkinLayer3D(viewer: SkinViewer): void {
  clearLayer3D(viewer.playerObject.skin);
  viewer.playerObject.skin.setOuterLayerVisible(true);
}
