/**
 * 程序化雕刻工具集 —— 消除"基础几何体拼凑感"的核心
 *
 * - sculptBlobs(): Marching Cubes 元球融合 —— 多个球体场平滑融为一块连续皮肤，
 *   脖子/躯干/头颅一体成型（替代球叠球的拼积木）
 * - sweepTube(): 沿样条线的变径圆管 —— 尾巴/脖子/四肢的自然锥度与弯曲
 * - lathe(): 旋转成形 —— 长袍/胸甲等回转体轮廓
 * - roughen(): 沿法线的伪噪声位移 —— 岩石/水晶的不规则感
 * 所有几何输出为焊接顶点 + 平滑法线（高模质感）。
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';

type Vec3 = [number, number, number];

const _dummyMat = new THREE.MeshStandardMaterial();

export interface Blob {
  /** 目标空间坐标（模型局部系，y 向上） */
  p: Vec3;
  /** 半径；方向性形体靠相邻 blob 摆位实现（场叠加自然融合） */
  r: number;
  /** 负球：从形体上挖出凹坑（眼窝/口部），强度与正球一致 */
  neg?: boolean;
}

/**
 * 元球融合成连续曲面。
 * - bound: 目标空间包围盒边长（MC 输出域 [-1,1] ↔ 模型空间宽 bound），越大细节越少
 * - center: 包围盒中心对应的模型坐标（默认 [0,1.3,0]，覆盖 y∈[-0.4,3.0]）
 * - res: MC 网格分辨率（面数 ~ res² 级别；36 ≈ 2-4 万三角面）
 */
export function sculptBlobs(blobs: Blob[], opts: { res?: number; bound?: number; center?: Vec3 } = {}): THREE.BufferGeometry {
  const bound = opts.bound ?? 3.4;
  const center = opts.center ?? [0, 1.3, 0];
  const res = opts.res ?? 36;
  const sub = 12;
  const iso = 12; // 等值面阈值（three 默认 80，会把球缩到 36% 大小——必须显式压低）
  const mc = new MarchingCubes(res, _dummyMat, false, false, 220000);
  mc.isolation = iso;
  mc.reset();
  const k = 1 / bound;
  for (const b of blobs) {
    // addBall 输入域 [0,1]；表面条件 strength/dist² - sub = iso ⟹ 归一化表面半径恰为 r·k
    // 相邻 blob 场叠加自然融合成连续皮肤；负球由 addBall 内部的 sign 支持挖凹坑
    const rm = b.r * k;
    const sgn = b.neg ? -1 : 1;
    mc.addBall(
      0.5 + (b.p[0] - center[0]) * k,
      0.5 + (b.p[1] - center[1]) * k,
      0.5 + (b.p[2] - center[2]) * k,
      sgn * rm * rm * (sub + iso) * 1.5, // 负球加压 1.5× 保证凹坑足够深
      sub,
    );
  }
  mc.update();
  // three 0.186：MarchingCubes 本身即 Mesh，mc.geometry 即重建结果，顶点域 [-1,1]。
  // geometry buffer 按 maxPolyCount 预分配（含垃圾数据）——先按 drawRange 裁出有效三角形
  const src = mc.geometry;
  const posAttr = src.getAttribute('position') as THREE.BufferAttribute;
  const total = posAttr.count;
  const start = src.drawRange.start || 0;
  const rawCount = src.drawRange.count === Infinity ? total : src.drawRange.count;
  const count = Math.min(rawCount, total - start);
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(
    (posAttr.array as Float32Array).slice(start * 3, (start + count) * 3), 3,
  ));
  // 按位置焊接顶点 + 重算法线——保证跨面平滑
  geo = mergeVertices(geo, 1e-4);
  geo.computeVertexNormals();
  geo.scale(bound / 2, bound / 2, bound / 2);
  geo.translate(center[0], center[1], center[2]);
  return geo;
}

/**
 * 沿样条线的变径圆管（点列与半径列一一对应，Catmull-Rom 平滑过弯）。
 */
export function sweepTube(points: Vec3[], radii: number[], seg = 24, radial = 12): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const pos: number[] = [];
  const idx: number[] = [];
  const frames = curve.computeFrenetFrames(seg, false);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const c = curve.getPoint(t);
    const r = radii[Math.min(radii.length - 1, Math.round(t * (radii.length - 1)))];
    const N = frames.normals[Math.min(seg, i)];
    const B = frames.binormals[Math.min(seg, i)];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(
        c.x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * r,
        c.y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * r,
        c.z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * r,
      );
    }
  }
  const row = radial + 1;
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * row + j;
      idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return mergeVertices(geo, 1e-4);
}

/** 旋转成形（profile 为 [半径, 高度] 对，自下而上） */
export function lathe(profile: Array<[number, number]>, seg = 24): THREE.BufferGeometry {
  const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  geo.computeVertexNormals();
  return mergeVertices(geo, 1e-4);
}

/** 沿法线方向的伪噪声位移（有机不规则感；freq 越大细节越碎） */
export function roughen(geo: THREE.BufferGeometry, amp = 0.03, freq = 5.3): THREE.BufferGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n =
      Math.sin(x * freq * 2.1 + y * freq * 1.3) * 0.5 +
      Math.sin(y * freq * 1.7 + z * freq * 2.3) * 0.3 +
      Math.sin(z * freq * 2.9 + x * freq * 0.9) * 0.2;
    pos.setXYZ(i, x + nor.getX(i) * n * amp, y + nor.getY(i) * n * amp, z + nor.getZ(i) * n * amp);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** 高段平滑球（默认材质不再 flat，段数拉满出圆润轮廓） */
export function ball(r: number, seg = 24): THREE.SphereGeometry {
  return new THREE.SphereGeometry(r, seg, Math.max(10, Math.round(seg * 0.66)));
}
