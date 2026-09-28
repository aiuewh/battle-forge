/**
 * 3D 战棋棋子 —— 程序化雕刻工厂（Three.js，无外部模型资产）
 *
 * 第二代建模：彻底告别"球锥柱拼积木"——
 * - 有机形体（躯干/颈/头颅）用 Marching Cubes 元球融合成一块连续皮肤（sculptBlobs）
 * - 尾巴/四肢/触须用沿样条线的变径圆管（sweepTube），带自然锥度与弯曲
 * - 长袍/胸甲等回转体用旋转成形（lathe）
 * - 岩石/水晶用沿法线的伪噪声位移（roughen）
 * - 全部几何焊接顶点 + 平滑法线，单模型 3-8 万三角面
 * 所有模型共坐一尊战棋底座：石质圆台 + 阵营色环（敌红 / 友绿 / 玩家金 / 中立琥珀）
 * 统一坐标：+Z 朝镜头、Y 向上、y=0 为底座底面。
 */
import * as THREE from 'three';
import type { CreatureKind } from '@/lib/engine/types';
import { sculptBlobs, sweepTube, lathe, roughen, ball, type Blob } from './sculpt';

export type TokenKind = CreatureKind | 'ally';

type Vec3 = [number, number, number];

interface MatOpts {
  rough?: number;
  metal?: number;
  emissive?: number;
  emissiveIntensity?: number;
  opacity?: number;
  side?: THREE.Side;
}

function mat(color: number, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: o.rough ?? 0.62,
    metalness: o.metal ?? 0.12,
  });
  if (o.emissive !== undefined) {
    m.emissive = new THREE.Color(o.emissive);
    m.emissiveIntensity = o.emissiveIntensity ?? 1;
  }
  if (o.opacity !== undefined) {
    m.transparent = true;
    m.opacity = o.opacity;
  }
  if (o.side !== undefined) m.side = o.side;
  return m;
}

/** 快捷建 mesh */
function M(geo: THREE.BufferGeometry, material: THREE.Material, pos: Vec3 = [0, 0, 0], rot: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.scale.set(...scale);
  return mesh;
}

const lowCyl = (rt: number, rb: number, h: number, seg = 14) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r: number, h: number, seg = 12) => new THREE.ConeGeometry(r, h, seg);

/** 底座：石质圆台 + 阵营色环（材质句柄存 userData.ringMat 供运行时换色） */
function buildBase(group: THREE.Group): void {
  const stone = mat(0x3b3630, { rough: 0.9, metal: 0.04 });
  group.add(M(lowCyl(1.02, 1.18, 0.2, 24), stone, [0, 0.1, 0]));
  group.add(M(lowCyl(1.02, 1.02, 0.05, 24), mat(0x544c42, { rough: 0.9 }), [0, 0.225, 0]));
  const ringMat = mat(0x8b2237, { rough: 0.32, metal: 0.5, emissive: 0x8b2237, emissiveIntensity: 0.22 });
  group.add(M(new THREE.TorusGeometry(0.92, 0.05, 10, 40), ringMat, [0, 0.26, 0], [Math.PI / 2, 0, 0]));
  group.userData.ringMat = ringMat;
}

/** 阵营环色（敌红 / 友绿 / 玩家金 / 中立琥珀） */
export function ringColorFor(attitude: 0 | 1 | 2, isPlayer: boolean): number {
  if (isPlayer) return 0xf5c542;
  if (attitude === 2) return 0xc4392b;
  if (attitude === 1) return 0xe3ba55;
  return 0x3ecf6a;
}

/** 三角面片（翼膜/披风）：顶点按 [i0,i1,i2, ...] 索引 */
function fan(points: Vec3[], indices: number[], material: THREE.Material): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  const flat: number[] = [];
  for (const i of indices) flat.push(...points[i]);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

// ---------------------------------------------------------------- 龙类（元球一体：蹲坐躯干+颈+头）
function buildDragon(g: THREE.Group): void {
  const scaleM = mat(0x9a3227, { rough: 0.55 });
  const belly = mat(0xd8a05a, { rough: 0.7 });
  const hornM = mat(0xe8d8b0, { rough: 0.4, metal: 0.2 });
  const membrane = mat(0x6e1f1a, { rough: 0.75, side: THREE.DoubleSide, opacity: 0.97 });
  // 躯干+后腿+胸+颈+头 一体融合（多球链，相邻场叠加成连续皮肤）
  const blobs: Blob[] = [
    { p: [0.48, 0.5, -0.18], r: 0.3 },
    { p: [-0.48, 0.5, -0.18], r: 0.3 },
    { p: [0, 0.82, -0.05], r: 0.44 },
    { p: [0, 1.1, 0.02], r: 0.46 },
    { p: [0, 1.32, 0.08], r: 0.4 },
    { p: [0, 0.98, 0.28], r: 0.34 },
    { p: [0, 1.5, 0.2], r: 0.25 },
    { p: [0, 1.8, 0.35], r: 0.2 },
    { p: [0, 2.08, 0.52], r: 0.23 },
    { p: [0, 2.05, 0.8], r: 0.14 },
    { p: [0.3, 0.5, 0.32], r: 0.13 },
    { p: [-0.3, 0.5, 0.32], r: 0.13 },
    // 眼窝（负球）+ 鼻孔
    { p: [0.15, 2.14, 0.62], r: 0.05, neg: true },
    { p: [-0.15, 2.14, 0.62], r: 0.05, neg: true },
    { p: [0.045, 2.1, 0.9], r: 0.025, neg: true },
    { p: [-0.045, 2.1, 0.9], r: 0.025, neg: true },
  ];
  g.add(M(sculptBlobs(blobs, { res: 40 }), scaleM));
  // 前爪趾（每爪三根前伸趾）
  const clawM = mat(0xe8d8b0, { rough: 0.35 });
  for (const s of [1, -1] as const) {
    for (const dz of [0.09, 0, -0.09]) {
      g.add(M(sweepTube(
        [[s * 0.3, 0.44, 0.38], [s * 0.32 + dz * 0.3, 0.4, 0.52], [s * 0.33 + dz * 0.5, 0.38, 0.62]],
        [0.05, 0.04, 0.03], 10, 7,
      ), scaleM));
      g.add(M(cone(0.028, 0.08, 8), clawM, [s * 0.335 + dz * 0.62, 0.37, 0.68], [1.7, 0, -s * dz * 2]));
    }
  }
  // 腹部色板（贴合胸腹的浅色层）
  g.add(M(sculptBlobs([
    { p: [0, 0.95, 0.3], r: 0.28 },
    { p: [0, 1.2, 0.28], r: 0.26 },
  ], { res: 26 }), belly));
  // 膜翼（多翼指凹弧）+ 翼骨
  const wing = (s: 1 | -1): THREE.Mesh => fan(
    [
      [0, 0, 0],
      [s * 0.75, 0.62, -0.28],
      [s * 1.18, 0.55, -0.52],
      [s * 0.98, 0.28, -0.5],
      [s * 1.32, 0.02, -0.72],
      [s * 0.95, -0.12, -0.62],
      [s * 1.12, -0.42, -0.74],
      [s * 0.5, -0.42, -0.4],
      [s * 0.34, -0.55, -0.22],
    ],
    [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6, 0, 6, 7, 0, 7, 8],
    membrane,
  );
  const boneM = mat(0x7a241c, { rough: 0.45 });
  const wingArm = (s: 1 | -1): void => {
    g.add(M(sweepTube(
      [[s * 0.3, 1.52, 0.02], [s * 0.85, 1.9, -0.28], [s * 1.28, 1.62, -0.55], [s * 1.05, 1.1, -0.68]],
      [0.06, 0.05, 0.04, 0.025], 16, 8,
    ), boneM));
  };
  const wl = wing(1);
  wl.position.set(0.34, 1.5, 0.02);
  wl.rotation.set(0.16, -0.24, 0.12);
  const wr = wing(-1);
  wr.position.set(-0.34, 1.5, 0.02);
  wr.rotation.set(0.16, 0.24, -0.12);
  g.add(wl, wr);
  wingArm(1);
  wingArm(-1);
  // 背脊棘刺列
  const spikes: Array<[number, number, number]> = [
    [0, 1.66, -0.1], [0, 1.36, -0.28], [0, 1.05, -0.4], [0, 0.76, -0.56], [0, 0.54, -0.82],
  ];
  for (const [sx, sy, sz] of spikes) {
    g.add(M(cone(0.06, 0.17, 8), hornM, [sx, sy, sz], [-0.9, 0, 0]));
  }
  // 双角（两段弯）+ 眼（入窝）
  g.add(M(cone(0.06, 0.42, 10), hornM, [0.15, 2.5, 0.3], [-0.85, 0, 0.35]));
  g.add(M(cone(0.06, 0.42, 10), hornM, [-0.15, 2.5, 0.3], [-0.85, 0, -0.35]));
  const eye = mat(0xffb020, { emissive: 0xff9010, emissiveIntensity: 1.9, rough: 0.25 });
  g.add(M(ball(0.045, 10), eye, [0.148, 2.14, 0.63]));
  g.add(M(ball(0.045, 10), eye, [-0.148, 2.14, 0.63]));
  // 尾（变径样条管）+ 尾尖
  g.add(M(sweepTube(
    [[0, 0.72, -0.45], [0, 0.6, -0.85], [0, 0.46, -1.2], [0, 0.4, -1.45]],
    [0.19, 0.14, 0.09, 0.03], 20, 12,
  ), scaleM));
  g.add(M(cone(0.09, 0.24, 8), hornM, [0, 0.38, -1.56], [1.75, 0, 0]));
}

// ---------------------------------------------------------------- 飞龙（直立瘦长，S 颈）
function buildWyvern(g: THREE.Group): void {
  const scaleM = mat(0x55703a, { rough: 0.55 });
  const belly = mat(0xb8c48a, { rough: 0.7 });
  const hornM = mat(0xd8d0b0, { rough: 0.4 });
  const membrane = mat(0x3a5230, { rough: 0.75, side: THREE.DoubleSide, opacity: 0.97 });
  // 躯干+颈+头一体
  const blobs: Blob[] = [
    { p: [0, 1.1, 0], r: 0.36 },
    { p: [0, 1.42, 0.02], r: 0.33 },
    { p: [0, 1.66, 0.08], r: 0.26 },
    { p: [0, 1.92, 0.14], r: 0.17 },
    { p: [0, 2.22, 0.3], r: 0.15 },
    { p: [0, 2.46, 0.46], r: 0.19 },
    { p: [0, 2.43, 0.72], r: 0.1 },
    // 右腿：大腿→膝→胫→踝→脚掌（前伸），球距压在融合半径内，从躯干皮肤里长出来
    { p: [0.28, 0.98, 0.06], r: 0.19 },
    { p: [0.295, 0.8, 0.08], r: 0.15 },
    { p: [0.31, 0.62, 0.1], r: 0.125 },
    { p: [0.315, 0.48, 0.13], r: 0.105 },
    { p: [0.32, 0.34, 0.16], r: 0.1 },
    { p: [0.33, 0.2, 0.22], r: 0.095 },
    { p: [0.34, 0.17, 0.33], r: 0.075 },
    // 左腿
    { p: [-0.28, 0.98, 0.06], r: 0.19 },
    { p: [-0.295, 0.8, 0.08], r: 0.15 },
    { p: [-0.31, 0.62, 0.1], r: 0.125 },
    { p: [-0.315, 0.48, 0.13], r: 0.105 },
    { p: [-0.32, 0.34, 0.16], r: 0.1 },
    { p: [-0.33, 0.2, 0.22], r: 0.095 },
    { p: [-0.34, 0.17, 0.33], r: 0.075 },
    // 眼窝（负球挖坑）
    { p: [0.115, 2.52, 0.56], r: 0.05, neg: true },
    { p: [-0.115, 2.52, 0.56], r: 0.05, neg: true },
    // 鼻孔
    { p: [0.045, 2.46, 0.78], r: 0.03, neg: true },
    { p: [-0.045, 2.46, 0.78], r: 0.03, neg: true },
  ];
  g.add(M(sculptBlobs(blobs, { res: 46 }), scaleM));
  g.add(M(sculptBlobs([
    { p: [0, 1.28, 0.14], r: 0.22 },
    { p: [0, 1.55, 0.14], r: 0.18 },
  ], { res: 26 }), belly));
  // 脚趾：每脚三根前伸趾管 + 弯爪
  const clawM = mat(0x2c2620, { rough: 0.35 });
  for (const s of [1, -1] as const) {
    for (const dz of [0.1, 0, -0.1]) {
      const bx = s * 0.34;
      const bz = 0.32;
      const tz = 0.46 + dz * 0.6;
      const tx = s * 0.35 + dz * 0.25;
      g.add(M(sweepTube(
        [[bx, 0.16, bz], [(bx + tx) / 2, 0.13, (bz + tz) / 2], [tx, 0.1, tz]],
        [0.042, 0.03, 0.024], 10, 7,
      ), scaleM));
      g.add(M(cone(0.032, 0.1, 8), clawM, [tx + dz * 0.1, 0.075, tz + 0.07], [1.75, 0, -s * dz * 2]));
    }
  }
  // 展开膜翼（加密翼指凹缘）+ 前缘双翼骨
  const wing = (s: 1 | -1): THREE.Mesh => fan(
    [
      [0, 0, 0],                        // 肩根
      [s * 0.55, 0.72, -0.14],          // 前缘中
      [s * 1.05, 0.68, -0.3],           // 前缘外
      [s * 1.38, 0.32, -0.46],          // 翼尖 1
      [s * 1.08, 0.1, -0.42],           // 凹
      [s * 1.28, -0.18, -0.5],          // 翼尖 2
      [s * 0.88, -0.32, -0.42],         // 凹
      [s * 0.98, -0.58, -0.48],         // 翼尖 3
      [s * 0.42, -0.52, -0.28],         // 后缘根
      [s * 0.12, -0.32, -0.12],         // 腋
    ],
    [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6, 0, 6, 7, 0, 7, 8, 0, 8, 9],
    membrane,
  );
  for (const s of [1, -1] as const) {
    const w = wing(s);
    w.position.set(s * 0.24, 1.62, 0);
    w.rotation.set(0.1, s * -0.42, s * 0.08);
    g.add(w);
    g.add(M(sweepTube(
      [[s * 0.24, 1.6, 0], [s * 0.72, 2.05, -0.12], [s * 1.15, 1.98, -0.3], [s * 1.42, 1.9, -0.44]],
      [0.05, 0.04, 0.03, 0.015], 16, 8,
    ), scaleM));
    g.add(M(sweepTube(
      [[s * 0.3, 1.7, -0.04], [s * 0.85, 1.72, -0.24], [s * 1.28, 1.42, -0.46]],
      [0.032, 0.026, 0.014], 12, 7,
    ), scaleM));
  }
  // 头冠棘 + 眼 + 长尾
  g.add(M(cone(0.045, 0.32, 8), hornM, [0.1, 2.68, 0.14], [-0.6, 0, 0.3]));
  g.add(M(cone(0.045, 0.32, 8), hornM, [-0.1, 2.68, 0.14], [-0.6, 0, -0.3]));
  const eye = mat(0xffd020, { emissive: 0xffb010, emissiveIntensity: 1.8, rough: 0.25 });
  g.add(M(ball(0.045, 10), eye, [0.12, 2.52, 0.56]));
  g.add(M(ball(0.045, 10), eye, [-0.12, 2.52, 0.56]));
  g.add(M(sweepTube(
    [[0, 0.95, -0.3], [0, 0.62, -0.8], [0, 0.42, -1.3], [0, 0.36, -1.55]],
    [0.13, 0.09, 0.055, 0.02], 20, 12,
  ), scaleM));
}

// ---------------------------------------------------------------- 恶魔（壮硕一体躯+弯角）
function buildDemon(g: THREE.Group): void {
  const skin = mat(0xa03028, { rough: 0.58 });
  const dark = mat(0x3a1a14, { rough: 0.5, metal: 0.3 });
  const fang = mat(0xe8dcc0, { rough: 0.35 });
  // 躯干+胸肌+肩+颈+颅 一体
  const blobs: Blob[] = [
    { p: [0, 1.18, 0], r: 0.48 },
    { p: [0, 1.44, 0.04], r: 0.44 },
    { p: [0.18, 1.5, 0.3], r: 0.19 },
    { p: [-0.18, 1.5, 0.3], r: 0.19 },
    { p: [0.58, 1.64, 0], r: 0.24 },
    { p: [-0.58, 1.64, 0], r: 0.24 },
    { p: [0, 1.86, 0.05], r: 0.17 },
    { p: [0, 2.02, 0.08], r: 0.26 },
    // 眉骨眼窝（负球）
    { p: [0.15, 2.08, 0.3], r: 0.055, neg: true },
    { p: [-0.15, 2.08, 0.3], r: 0.055, neg: true },
  ];
  g.add(M(sculptBlobs(blobs, { res: 40 }), skin));
  // 腰布（旋转成形短裙）
  g.add(M(lathe([[0.18, 1.02], [0.38, 0.9], [0.42, 0.66], [0.4, 0.52]], 20), dark));
  // 粗臂（变径管）+ 爪
  for (const s of [1, -1] as const) {
    g.add(M(sweepTube(
      [[s * 0.62, 1.62, 0.02], [s * 0.74, 1.15, 0.06], [s * 0.8, 0.66, 0.1]],
      [0.13, 0.11, 0.09], 16, 10,
    ), skin));
    g.add(M(cone(0.1, 0.26, 8), fang, [s * 0.81, 0.52, 0.1], [Math.PI, 0, s * 0.15]));
  }
  // 腿蹄
  for (const s of [1, -1] as const) {
    g.add(M(sweepTube(
      [[s * 0.28, 0.7, 0], [s * 0.3, 0.35, 0.02], [s * 0.31, 0.14, 0.04]],
      [0.17, 0.15, 0.13], 12, 10,
    ), dark));
  }
  // 大弯角（管状渐细双弯）
  for (const s of [1, -1] as const) {
    g.add(M(sweepTube(
      [[s * 0.22, 2.18, 0], [s * 0.4, 2.4, -0.04], [s * 0.58, 2.56, -0.14], [s * 0.68, 2.62, -0.28]],
      [0.085, 0.06, 0.04, 0.012], 16, 9,
    ), dark));
  }
  // 獠牙 + 眼
  g.add(M(cone(0.045, 0.2, 8), fang, [0.13, 1.82, 0.32], [Math.PI - 0.15, 0, 0.12]));
  g.add(M(cone(0.045, 0.2, 8), fang, [-0.13, 1.82, 0.32], [Math.PI - 0.15, 0, -0.12]));
  const eye = mat(0xffc020, { emissive: 0xffa010, emissiveIntensity: 2.0, rough: 0.25 });
  g.add(M(ball(0.06, 12), eye, [0.15, 2.02, 0.3]));
  g.add(M(ball(0.06, 12), eye, [-0.15, 2.02, 0.3]));
}

// ---------------------------------------------------------------- 亡灵（骷髅：融合头骨+分节骨架）
function buildUndead(g: THREE.Group): void {
  const bone = mat(0xd5c9a8, { rough: 0.55 });
  const dark = mat(0x14141c, { rough: 0.9 });
  const rust = mat(0x7a6a52, { rough: 0.45, metal: 0.6 });
  const glow = mat(0x7fe0ff, { emissive: 0x40b8e0, emissiveIntensity: 2.0, rough: 0.25 });
  // 头骨一体（颅+颧+下颌融合+真眼窝凹坑）
  g.add(M(sculptBlobs([
    { p: [0, 1.98, 0.02], r: 0.27 },
    { p: [0, 1.8, 0.1], r: 0.17 },
    { p: [0, 1.94, -0.14], r: 0.2 },
    { p: [0.12, 2.02, 0.22], r: 0.075, neg: true },
    { p: [-0.12, 2.02, 0.22], r: 0.075, neg: true },
    { p: [0, 1.87, 0.26], r: 0.05, neg: true },   // 鼻腔
  ], { res: 34 }), bone));
  // 幽光瞳（嵌在眼窝深处）
  g.add(M(ball(0.04, 10), glow, [0.12, 2.01, 0.24]));
  g.add(M(ball(0.04, 10), glow, [-0.12, 2.01, 0.24]));
  // 牙列
  for (let i = -1; i <= 1; i++) {
    g.add(M(cone(0.026, 0.09, 6), bone, [i * 0.075, 1.73, 0.24], [Math.PI, 0, 0]));
  }
  // 脊柱（变径管）+ 骨盆
  g.add(M(sweepTube(
    [[0, 0.72, 0], [0, 1.0, 0.01], [0, 1.3, 0.02], [0, 1.58, 0.02]],
    [0.05, 0.055, 0.05, 0.045], 12, 8,
  ), bone));
  g.add(M(ball(0.19, 14), bone, [0, 0.64, 0], [0, 0, 0], [1.15, 0.55, 0.8]));
  // 胸腔（高段弧肋 ×3）+ 胸骨暗腔
  g.add(M(ball(0.24, 16), dark, [0, 1.3, 0.0], [0, 0, 0], [1, 1.15, 0.75]));
  for (let i = 0; i < 3; i++) {
    const r = 0.28 - i * 0.045;
    g.add(M(new THREE.TorusGeometry(r, 0.034, 8, 20, Math.PI * 1.25), bone,
      [0, 1.16 + i * 0.19, 0.02], [Math.PI / 2, 0.42, 0], [1, 0.82, 1]));
  }
  // 锁骨 + 肩关节
  g.add(M(lowCyl(0.04, 0.04, 0.72, 10), bone, [0, 1.6, 0.02], [0, 0, Math.PI / 2]));
  g.add(M(ball(0.07, 10), bone, [0.36, 1.6, 0.02]));
  g.add(M(ball(0.07, 10), bone, [-0.36, 1.6, 0.02]));
  // 臂骨（双段变径）+ 腿骨
  for (const s of [1, -1] as const) {
    g.add(M(sweepTube(
      [[s * 0.4, 1.58, 0.02], [s * 0.46, 1.25, 0.06], [s * 0.48, 0.92, 0.1]],
      [0.045, 0.04, 0.035], 12, 8,
    ), bone));
    g.add(M(sweepTube(
      [[s * 0.15, 0.6, 0.02], [s * 0.16, 0.35, 0.03], [s * 0.16, 0.12, 0.03]],
      [0.05, 0.045, 0.04], 10, 8,
    ), bone));
  }
  // 锈剑
  const sword = new THREE.Group();
  sword.position.set(0.56, 0.95, 0.12);
  sword.rotation.set(0.1, 0, -0.3);
  sword.add(M(lowCyl(0.03, 0.032, 0.3, 8), rust, [0, -0.12, 0]));
  sword.add(M(lowCyl(0.065, 0.065, 0.055, 10), rust, [0, 0.06, 0]));
  sword.add(M(cone(0.065, 1.0, 4), mat(0x9a9484, { rough: 0.3, metal: 0.75 }), [0, 0.6, 0], [0, Math.PI / 4, 0], [1, 1, 0.35]));
  g.add(sword);
}

// ---------------------------------------------------------------- 精怪（小仙灵：融合圆头+尖耳+膜翼）
function buildFey(g: THREE.Group): void {
  const skin = mat(0x8a6fc0, { rough: 0.5 });
  const leaf = mat(0x5aa86a, { rough: 0.65 });
  const petal = mat(0x6fc07e, { rough: 0.6 });
  const hairM = mat(0x2a2140, { rough: 0.75 });
  const wingM = mat(0xaee4ff, { rough: 0.2, side: THREE.DoubleSide, opacity: 0.55, emissive: 0x4a90b8, emissiveIntensity: 0.4 });
  const glow = mat(0xffe9a0, { emissive: 0xffd870, emissiveIntensity: 1.6, rough: 0.25 });
  // 大头一体（颅+颊）
  g.add(M(sculptBlobs([
    { p: [0, 1.5, 0.02], r: 0.3 },
    { p: [0.1, 1.44, 0.22], r: 0.11 },
    { p: [-0.1, 1.44, 0.22], r: 0.11 },
  ], { res: 32 }), skin));
  // 尖长耳（细弯锥）
  g.add(M(cone(0.06, 0.42, 8), skin, [0.35, 1.62, 0], [0, 0, -1.2]));
  g.add(M(cone(0.06, 0.42, 8), skin, [-0.35, 1.62, 0], [0, 0, 1.2]));
  // 发盖 + 发髻
  g.add(M(ball(0.27, 18), hairM, [0, 1.6, -0.08], [0.5, 0, 0], [1.05, 0.6, 1.0]));
  g.add(M(ball(0.1, 12), hairM, [0, 1.82, -0.2]));
  // 大而亮的眼
  g.add(M(ball(0.06, 12), glow, [0.115, 1.52, 0.27]));
  g.add(M(ball(0.06, 12), glow, [-0.115, 1.52, 0.27]));
  // 裙衣（旋转成形）+ 花瓣边
  g.add(M(lathe([[0.06, 0.26], [0.14, 0.4], [0.24, 0.62], [0.27, 0.85], [0.24, 0.98]], 20), leaf));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(M(ball(0.05, 10), petal, [Math.cos(a) * 0.25, 0.3, Math.sin(a) * 0.25]));
  }
  // 细臂 + 托光尘
  g.add(M(sweepTube(
    [[0.16, 0.95, 0.06], [0.3, 0.98, 0.22], [0.36, 1.02, 0.36]],
    [0.042, 0.038, 0.032], 12, 8,
  ), skin));
  g.add(M(sweepTube(
    [[-0.16, 0.95, 0.02], [-0.26, 0.94, 0.1], [-0.3, 0.95, 0.18]],
    [0.042, 0.038, 0.032], 12, 8,
  ), skin));
  g.add(M(ball(0.09, 12), glow, [0.38, 1.08, 0.44]));
  // 双对膜翼
  const wing = (s: 1 | -1, sc: number): THREE.Mesh => fan(
    [[0, 0, 0], [s * 0.62 * sc, 0.5 * sc, -0.2 * sc], [s * 0.78 * sc, 0.05 * sc, -0.3 * sc], [s * 0.3 * sc, -0.42 * sc, -0.12 * sc]],
    [0, 1, 2, 0, 2, 3],
    wingM,
  );
  const w1 = wing(1, 1);
  w1.position.set(0.14, 1.16, -0.1);
  w1.rotation.set(0.3, -0.35, 0.5);
  const w2 = wing(-1, 1);
  w2.position.set(-0.14, 1.16, -0.1);
  w2.rotation.set(0.3, 0.35, -0.5);
  const w3 = wing(1, 0.62);
  w3.position.set(0.12, 0.9, -0.14);
  w3.rotation.set(0.5, -0.5, 0.7);
  const w4 = wing(-1, 0.62);
  w4.position.set(-0.12, 0.9, -0.14);
  w4.rotation.set(0.5, 0.5, -0.7);
  g.add(w1, w2, w3, w4);
}

// ---------------------------------------------------------------- 邪信徒（旋转成形长袍+兜帽）
function buildCultist(g: THREE.Group): void {
  const robe = mat(0x6e1f2a, { rough: 0.72 });
  const robeDark = mat(0x4a141c, { rough: 0.75 });
  const inner = mat(0x0c0709, { rough: 0.95 });
  const trim = mat(0xc8a050, { rough: 0.3, metal: 0.6 });
  const eye = mat(0xff3020, { emissive: 0xd01808, emissiveIntensity: 2.0, rough: 0.25 });
  const hand = mat(0xb08a68, { rough: 0.65 });
  // 长袍主体（底摆→束腰→胸→肩 的光滑回转面）
  g.add(M(lathe([
    [0.62, 0.0], [0.52, 0.28], [0.4, 0.62], [0.34, 0.92], [0.35, 1.14], [0.3, 1.38], [0.22, 1.52],
  ], 24), robe));
  // 束腰金环 + 斜披胸带
  g.add(M(new THREE.TorusGeometry(0.335, 0.035, 8, 24), trim, [0, 1.1, 0], [Math.PI / 2, 0, 0]));
  g.add(M(sweepTube(
    [[-0.26, 1.42, 0.24], [0.02, 1.18, 0.32], [0.26, 0.96, 0.24]],
    [0.05, 0.055, 0.05], 12, 8,
  ), robeDark));
  // 肩部隆起
  g.add(M(ball(0.16, 14), robe, [0.28, 1.5, 0]));
  g.add(M(ball(0.16, 14), robe, [-0.28, 1.5, 0]));
  // 兜帽（回转罩壳，前倾）+ 帽内阴影 + 红眼
  g.add(M(lathe([
    [0.3, 1.5], [0.34, 1.72], [0.28, 1.92], [0.16, 2.06], [0.03, 2.12],
  ], 20), robe, [0, 0, -0.02], [0.14, 0, 0]));
  g.add(M(ball(0.19, 16), inner, [0, 1.88, 0.13], [0, 0, 0], [1, 0.92, 0.85]));
  g.add(M(ball(0.042, 10), eye, [0.08, 1.9, 0.29]));
  g.add(M(ball(0.042, 10), eye, [-0.08, 1.9, 0.29]));
  // 双手捧禁忌典籍
  const book = new THREE.Group();
  book.position.set(0, 1.12, 0.4);
  book.rotation.set(-0.5, 0, 0);
  book.add(M(new THREE.BoxGeometry(0.44, 0.1, 0.32), robeDark));
  book.add(M(new THREE.BoxGeometry(0.4, 0.06, 0.28), mat(0xd8ccb0, { rough: 0.8 }), [0, 0.03, 0]));
  book.add(M(new THREE.BoxGeometry(0.08, 0.12, 0.08), trim, [0, 0, 0]));
  g.add(book);
  g.add(M(ball(0.075, 12), hand, [0.23, 1.08, 0.42]));
  g.add(M(ball(0.075, 12), hand, [-0.23, 1.08, 0.42]));
  // 颈前念珠
  g.add(M(ball(0.042, 10), mat(0xd8ccb0, { rough: 0.4 }), [0, 1.5, 0.24]));
  g.add(M(ball(0.042, 10), mat(0xd8ccb0, { rough: 0.4 }), [0, 1.4, 0.28]));
  g.add(M(cone(0.05, 0.14, 8), trim, [0, 1.28, 0.31], [Math.PI, 0, 0]));
}

// ---------------------------------------------------------------- 野兽（狼：整只一体融合+管状四肢）
function buildBeast(g: THREE.Group): void {
  const fur = mat(0x7d6a50, { rough: 0.82 });
  const furDark = mat(0x52422c, { rough: 0.85 });
  const jaw = mat(0x9a8a75, { rough: 0.75 });
  const tooth = mat(0xe8e2d0, { rough: 0.35 });
  const clawM = mat(0x2c2620, { rough: 0.4, metal: 0.25 });
  const eye = mat(0xffc830, { emissive: 0xd89010, emissiveIntensity: 1.8, rough: 0.25 });
  // 头/颈/肩/躯干/臀 完全连续的一块皮肤（吻部双节拉长）
  g.add(M(sculptBlobs([
    { p: [-0.45, 0.78, 0], r: 0.34 },
    { p: [-0.2, 0.84, 0], r: 0.37 },
    { p: [0, 0.86, 0], r: 0.38 },
    { p: [0.42, 0.95, 0], r: 0.32 },
    { p: [0.66, 1.02, 0], r: 0.21 },
    { p: [0.88, 1.08, 0], r: 0.23 },
    { p: [1.08, 1.03, 0], r: 0.13 },
    { p: [1.28, 0.99, 0], r: 0.085 },
    { p: [0.98, 0.94, 0], r: 0.09 },
    // 眼窝（负球）
    { p: [0.97, 1.16, 0.13], r: 0.048, neg: true },
    { p: [0.97, 1.16, -0.13], r: 0.048, neg: true },
  ], { res: 44, bound: 3.8 }), fur));
  // 背鬃（棘列）
  const mane: Array<[number, number]> = [[0.42, 1.28], [0.14, 1.3], [-0.14, 1.26], [-0.42, 1.18], [-0.66, 1.04]];
  for (const [mx, my] of mane) {
    g.add(M(cone(0.07, 0.2, 8), furDark, [mx, my, 0]));
  }
  // 立耳 + 獠牙
  g.add(M(cone(0.065, 0.22, 8), furDark, [0.86, 1.34, 0.13], [-0.2, 0, -0.25]));
  g.add(M(cone(0.065, 0.22, 8), furDark, [0.86, 1.34, -0.13], [-0.2, 0, -0.25]));
  g.add(M(cone(0.024, 0.09, 6), tooth, [1.34, 0.94, 0.05], [Math.PI, 0, 0]));
  g.add(M(cone(0.024, 0.09, 6), tooth, [1.34, 0.94, -0.05], [Math.PI, 0, 0]));
  // 鼻头
  g.add(M(ball(0.038, 10), furDark, [1.36, 1.0, 0]));
  // 琥珀眼（嵌入眼窝）
  g.add(M(ball(0.038, 10), eye, [0.99, 1.15, 0.135]));
  g.add(M(ball(0.038, 10), eye, [0.99, 1.15, -0.135]));
  // 四腿（带膝弯的变径管）+ 爪尖
  const leg = (px: number, pz: number, front: boolean): void => {
    g.add(M(sweepTube(
      [[px, front ? 0.72 : 0.62, pz], [px + (front ? 0.04 : -0.06), 0.38, pz + (pz > 0 ? 0.04 : -0.04)], [px + (front ? 0.08 : -0.12), 0.12, pz + (pz > 0 ? 0.06 : -0.06)]],
      [0.075, 0.06, 0.05], 12, 9,
    ), fur));
    g.add(M(cone(0.028, 0.09, 6), clawM, [px + (front ? 0.11 : -0.15), 0.08, pz + (pz > 0 ? 0.09 : -0.09)], [1.5, 0, 0]));
  };
  leg(0.42, 0.22, true);
  leg(0.42, -0.22, true);
  leg(-0.44, 0.22, false);
  leg(-0.44, -0.22, false);
  // 尾（后翘弯管）
  g.add(M(sweepTube(
    [[-0.72, 0.92, 0], [-1.0, 1.05, 0], [-1.2, 1.22, 0]],
    [0.09, 0.06, 0.02], 12, 9,
  ), fur));
}

// ---------------------------------------------------------------- 构装体（噪声岩石躯+符文）
function buildConstruct(g: THREE.Group): void {
  const stone = mat(0x7a7d82, { rough: 0.88, metal: 0.05 });
  const stoneDark = mat(0x565a60, { rough: 0.9 });
  const moss = mat(0x5a6b52, { rough: 0.88 });
  const core = mat(0x40e0ff, { emissive: 0x20b8e0, emissiveIntensity: 2.0, rough: 0.2 });
  // 岩石躯干（细分盒 + 噪声位移出采石感）
  const torso = roughen(new THREE.BoxGeometry(1.06, 0.78, 0.78, 6, 5, 5), 0.045, 4.2);
  g.add(M(torso, stone, [0, 1.06, 0], [0, 0.12, 0]));
  const chest = roughen(new THREE.BoxGeometry(0.86, 0.5, 0.68, 5, 4, 4), 0.04, 4.8);
  g.add(M(chest, stoneDark, [0, 1.6, 0], [0, -0.1, 0]));
  g.add(M(ball(0.14, 12), moss, [0.34, 1.26, 0.3], [0.4, 0.3, 0]));
  g.add(M(ball(0.12, 12), moss, [-0.3, 0.86, -0.26], [0.3, 0.5, 0.2]));
  // 无颈岩头（噪声面）+ 发光眼条
  const head = roughen(new THREE.BoxGeometry(0.5, 0.36, 0.46, 4, 3, 4), 0.035, 5);
  g.add(M(head, stone, [0, 2.0, 0.02], [0, 0.08, 0]));
  g.add(M(new THREE.BoxGeometry(0.3, 0.05, 0.02), core, [0, 2.02, 0.245]));
  // 胸前符文核心 + 环刻 + 臂部刻线
  g.add(M(new THREE.OctahedronGeometry(0.2, 1), core, [0, 1.28, 0.42]));
  g.add(M(new THREE.TorusGeometry(0.26, 0.028, 8, 24), stoneDark, [0, 1.28, 0.42], [0.3, 0, 0]));
  // 巨臂（渐粗管）+ 拳石 + 刻线
  for (const s of [1, -1] as const) {
    g.add(M(sweepTube(
      [[s * 0.68, 1.5, 0], [s * 0.74, 1.0, 0.02], [s * 0.78, 0.55, 0.04]],
      [0.16, 0.14, 0.13], 14, 10,
    ), stone));
    const fist = roughen(new THREE.BoxGeometry(0.34, 0.3, 0.34, 3, 3, 3), 0.03, 5);
    g.add(M(fist, stoneDark, [s * 0.79, 0.36, 0.04]));
    g.add(M(new THREE.BoxGeometry(0.045, 0.28, 0.02), core, [s * 0.74, 1.02, 0.16]));
  }
  // 短粗腿 + 背刺
  for (const s of [1, -1] as const) {
    g.add(M(lowCyl(0.2, 0.26, 0.4, 10), stoneDark, [s * 0.3, 0.24, 0]));
  }
  g.add(M(cone(0.1, 0.34, 8), stoneDark, [0.2, 1.74, -0.4], [-0.9, 0, 0]));
  g.add(M(cone(0.1, 0.28, 8), stoneDark, [-0.16, 1.5, -0.42], [-1.1, 0, 0]));
}

// ---------------------------------------------------------------- 人形敌（持斧蛮兵：回转甲+管状肢）
function buildHumanoid(g: THREE.Group): void {
  const skin = mat(0xb08a68, { rough: 0.65 });
  const armor = mat(0x6e4a34, { rough: 0.7 });
  const iron = mat(0x8a8e96, { rough: 0.32, metal: 0.7 });
  const wood = mat(0x5a4430, { rough: 0.8 });
  const rope = mat(0x3a2a1c, { rough: 0.85 });
  // 腿（管）+ 靴
  for (const s of [1, -1] as const) {
    g.add(M(sweepTube(
      [[s * 0.16, 0.78, 0], [s * 0.17, 0.42, 0.01], [s * 0.17, 0.12, 0.02]],
      [0.095, 0.085, 0.08], 10, 8,
    ), armor));
    g.add(M(cone(0.11, 0.16, 10), iron, [s * 0.17, 0.08, 0.06], [1.7, 0, 0]));
  }
  // 躯干（回转皮甲）+ 腰带
  g.add(M(lathe([[0.16, 0.6], [0.26, 0.78], [0.29, 1.0], [0.27, 1.2], [0.22, 1.32]], 20), armor));
  g.add(M(new THREE.TorusGeometry(0.24, 0.04, 8, 20), rope, [0, 0.66, 0], [Math.PI / 2, 0, 0]));
  // 肩甲 + 臂
  g.add(M(ball(0.13, 14), iron, [0.3, 1.28, 0], [0, 0, 0], [1, 0.75, 1]));
  g.add(M(ball(0.13, 14), iron, [-0.3, 1.28, 0], [0, 0, 0], [1, 0.75, 1]));
  g.add(M(sweepTube(
    [[0.3, 1.26, 0.02], [0.42, 1.0, 0.14], [0.5, 0.78, 0.24]],
    [0.075, 0.065, 0.055], 12, 9,
  ), skin));
  g.add(M(sweepTube(
    [[-0.3, 1.26, 0], [-0.38, 1.0, 0.02], [-0.42, 0.78, 0.04]],
    [0.075, 0.065, 0.055], 12, 9,
  ), skin));
  // 战斧（柄+缠绳+双刃）
  const axe = new THREE.Group();
  axe.position.set(0.62, 1.06, 0.3);
  axe.rotation.set(0.25, 0, -0.45);
  axe.add(M(lowCyl(0.032, 0.036, 1.0, 10), wood, [0, 0.32, 0]));
  for (const hy of [0.0, 0.1, 0.2]) {
    axe.add(M(new THREE.TorusGeometry(0.042, 0.013, 6, 12), rope, [0, hy - 0.12, 0], [Math.PI / 2, 0, 0]));
  }
  axe.add(M(cone(0.19, 0.32, 4), iron, [0.15, 0.72, 0], [0, 0, -Math.PI / 2], [1, 1, 0.4]));
  axe.add(M(cone(0.19, 0.32, 4), iron, [-0.15, 0.72, 0], [0, 0, Math.PI / 2], [1, 1, 0.4]));
  g.add(axe);
  // 头 + 战盔 + 胡须
  g.add(M(ball(0.22, 18), skin, [0, 1.56, 0.02]));
  g.add(M(ball(0.23, 18), iron, [0, 1.66, -0.02], [0.1, 0, 0], [1.05, 0.72, 1.05]));
  g.add(M(cone(0.055, 0.16, 8), iron, [0, 1.86, 0]));
  g.add(M(ball(0.13, 14), mat(0x5a3a22, { rough: 0.85 }), [0, 1.44, 0.14], [0.4, 0, 0], [1.1, 0.6, 0.7]));
  const eye = mat(0x1c1410, { rough: 0.35 });
  g.add(M(ball(0.032, 8), eye, [0.085, 1.6, 0.2]));
  g.add(M(ball(0.032, 8), eye, [-0.085, 1.6, 0.2]));
}

// ---------------------------------------------------------------- 未知生物（水晶簇群）
function buildGeneric(g: THREE.Group): void {
  const crystal = mat(0x9a6ad0, { rough: 0.15, metal: 0.1, emissive: 0x6a3aa8, emissiveIntensity: 0.7, opacity: 0.94 });
  const crystalHi = mat(0xc8a8f0, { rough: 0.12, emissive: 0x9a6ad0, emissiveIntensity: 0.9, opacity: 0.94 });
  const rock = mat(0x4a4448, { rough: 0.9 });
  // 底部碎岩环（噪声多面体）
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const rk = roughen(new THREE.IcosahedronGeometry(0.14 + (i % 2) * 0.05, 1), 0.06, 6);
    g.add(M(rk, rock, [Math.cos(a) * 0.62, 0.26, Math.sin(a) * 0.62], [a, a * 2, 0]));
  }
  // 主水晶柱（棱柱锥+轻噪声棱面）+ 簇生
  const main = roughen(cone(0.3, 1.5, 7), 0.025, 3.5);
  g.add(M(main, crystal, [0, 1.15, 0], [0.12, 0.4, 0.1]));
  g.add(M(roughen(cone(0.16, 0.9, 6), 0.03, 4), crystalHi, [0.4, 0.82, 0.14], [0.4, 0, -0.35]));
  g.add(M(roughen(cone(0.14, 0.7, 6), 0.03, 4), crystalHi, [-0.36, 0.76, -0.1], [-0.3, 0.8, 0.4]));
  g.add(M(roughen(cone(0.1, 0.5, 6), 0.03, 4), crystal, [-0.05, 0.68, 0.4], [-0.5, 0, 0.2]));
  // 悬浮碎晶 + 符环
  g.add(M(new THREE.OctahedronGeometry(0.08, 0), crystalHi, [0.3, 1.7, 0.1]));
  g.add(M(new THREE.OctahedronGeometry(0.06, 0), crystal, [-0.26, 1.5, -0.16]));
  g.add(M(new THREE.TorusGeometry(0.42, 0.018, 6, 28), crystalHi, [0, 1.05, 0], [Math.PI / 2.4, 0, 0.3]));
}

// ---------------------------------------------------------------- 友方（英勇冒险者：回转胸甲+高举长剑）
function buildAlly(g: THREE.Group): void {
  const skin = mat(0xd8ac82, { rough: 0.62 });
  const armor = mat(0x4a8a5f, { rough: 0.45, metal: 0.35 });
  const armorDark = mat(0x2e5e3e, { rough: 0.62 });
  const cloak = mat(0x2e6e46, { rough: 0.8, side: THREE.DoubleSide });
  const steel = mat(0xd8dce2, { rough: 0.22, metal: 0.8 });
  const gold = mat(0xe8c060, { rough: 0.28, metal: 0.65 });
  // 腿（管）+ 甲靴
  for (const s of [1, -1] as const) {
    g.add(M(sweepTube(
      [[s * 0.15, 0.8, 0], [s * 0.16, 0.44, 0.01], [s * 0.16, 0.14, 0.02]],
      [0.095, 0.085, 0.08], 10, 8,
    ), armorDark));
    g.add(M(cone(0.11, 0.16, 10), steel, [s * 0.16, 0.09, 0.06], [1.7, 0, 0]));
  }
  // 挺拔胸甲（回转成形）+ 金腰带扣
  g.add(M(lathe([[0.15, 0.62], [0.24, 0.8], [0.265, 1.0], [0.24, 1.22], [0.185, 1.34]], 22), armor));
  g.add(M(new THREE.TorusGeometry(0.2, 0.035, 8, 22), gold, [0, 0.68, 0], [Math.PI / 2, 0, 0]));
  g.add(M(ball(0.075, 12), gold, [0, 0.68, 0.21]));
  // 肩甲（金边球壳）
  g.add(M(ball(0.14, 16), armor, [0.27, 1.3, 0], [0, 0, 0], [1, 0.72, 1]));
  g.add(M(ball(0.14, 16), armor, [-0.27, 1.3, 0], [0, 0, 0], [1, 0.72, 1]));
  // 披风（细分弧面）
  const cape = fan(
    [[0, 0, 0], [0.4, 0.62, -0.1], [0.52, 0.1, -0.28], [0.3, -0.62, -0.34], [0, -0.78, -0.4], [-0.3, -0.62, -0.34], [-0.52, 0.1, -0.28], [-0.4, 0.62, -0.1]],
    [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6, 0, 6, 7],
    cloak,
  );
  cape.position.set(0, 1.6, -0.14);
  cape.rotation.x = 0.22;
  g.add(cape);
  // 右臂高举 + 长剑（金护手宝石柄）
  g.add(M(sweepTube(
    [[0.26, 1.28, 0.02], [0.4, 1.28, 0.05], [0.47, 1.5, 0.08]],
    [0.07, 0.06, 0.055], 12, 9,
  ), armor));
  const sword = new THREE.Group();
  sword.position.set(0.5, 1.66, 0.1);
  sword.rotation.set(0.08, 0, -0.16);
  sword.add(M(lowCyl(0.045, 0.045, 0.26, 10), gold, [0, -0.1, 0]));
  sword.add(M(ball(0.035, 10), mat(0x60c8ff, { emissive: 0x3090d0, emissiveIntensity: 1.2 }), [0, -0.24, 0]));
  sword.add(M(lowCyl(0.085, 0.085, 0.05, 12), gold, [0, 0.05, 0]));
  sword.add(M(cone(0.065, 1.15, 4), steel, [0, 0.66, 0], [0, Math.PI / 4, 0], [1, 1, 0.32]));
  g.add(sword);
  // 左臂 + 肩盾（放射金纹）
  g.add(M(sweepTube(
    [[-0.26, 1.26, 0.02], [-0.36, 1.05, 0.1], [-0.44, 0.92, 0.16]],
    [0.07, 0.06, 0.055], 12, 9,
  ), armor));
  const shield = new THREE.Group();
  shield.position.set(-0.48, 1.0, 0.18);
  shield.rotation.set(0.08, 0.3, 0.12);
  shield.add(M(lowCyl(0.3, 0.34, 0.07, 24), armorDark, [0, 0, 0], [Math.PI / 2 - 0.12, 0, 0]));
  shield.add(M(cone(0.15, 0.13, 12), gold, [0, -0.02, 0.12], [Math.PI / 2 - 0.12, 0, 0]));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    shield.add(M(new THREE.BoxGeometry(0.045, 0.18, 0.018), gold,
      [Math.cos(a) * 0.16, Math.sin(a) * 0.16 * Math.cos(0.12), 0.1 + Math.sin(a) * 0.16 * Math.sin(0.12)],
      [Math.PI / 2 - 0.12, 0, -a + Math.PI / 2]));
  }
  g.add(shield);
  // 头 + 半盔（金环+顶饰）+ 眼
  g.add(M(ball(0.21, 18), skin, [0, 1.6, 0.02]));
  g.add(M(ball(0.22, 18), steel, [0, 1.7, -0.01], [0.16, 0, 0], [1.04, 0.76, 1.04]));
  g.add(M(new THREE.TorusGeometry(0.19, 0.032, 8, 24), gold, [0, 1.7, 0.02], [1.35, 0, 0], [1, 0.9, 1]));
  g.add(M(cone(0.045, 0.18, 8), gold, [0, 1.94, -0.02]));
  const eye = mat(0x241a12, { rough: 0.3 });
  g.add(M(ball(0.03, 8), eye, [0.082, 1.6, 0.19]));
  g.add(M(ball(0.03, 8), eye, [-0.082, 1.6, 0.19]));
}

// ---------------------------------------------------------------- 装配表
const BUILDERS: Record<TokenKind, (g: THREE.Group) => void> = {
  dragon: buildDragon,
  wyvern: buildWyvern,
  demon: buildDemon,
  undead: buildUndead,
  fey: buildFey,
  cultist: buildCultist,
  beast: buildBeast,
  construct: buildConstruct,
  humanoid: buildHumanoid,
  generic: buildGeneric,
  ally: buildAlly,
};

export const TOKEN_KINDS = Object.keys(BUILDERS) as TokenKind[];

/** 构建一尊完整棋子（底座 + 生物形体）。每次调用全新实例，供 stage 缓存复用 */
export function buildToken(kind: TokenKind): THREE.Group {
  const g = new THREE.Group();
  buildBase(g);
  const body = new THREE.Group();
  BUILDERS[kind](body);
  body.position.y = 0.24; // 立在底座顶面
  g.add(body);
  g.userData.body = body;
  return g;
}
