/**
 * 3D 图标徽章渲染台 —— SVG 矢量图标的真 3D 化（替代旧版 Canvas 2D 铁皮徽记）
 *
 * - EMBLEM_ASSETS 里的 path（大龙/小龙/恶魔）经 SVGLoader 解析为 Shape，
 *   ExtrudeGeometry 挤出厚度 + 斜角（bevel），配 PBR 金属材质与环境反射 —— 真立体徽章
 * - detail 层（恶魔的面部纹色）以薄片叠在正面，与主轮廓共用同一归一化变换保证对齐
 * - 无图标资产的族类回退为红色四棱锥（3D 版"红三角"）
 * - 管线与 token3d 相同：共享 WebGLRenderer 逐单位渲染为精灵拷入 2D 地图画布
 */
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CreatureKind } from '@/lib/engine/types';
import { EMBLEM_ASSETS, buildNewEmblem, type EmblemAsset } from '@/lib/engine/emblemAssets';

export type IconKind = CreatureKind | 'goblin' | 'orc';

export interface IconDrawOpts {
  /** 屏幕锚点：x 为中心线，groundY 为脚底（2D 画布 CSS 像素坐标） */
  x: number;
  groundY: number;
  /** 徽章屏幕高度（CSS 像素） */
  size: number;
  kind: IconKind;
  /** 转台角（弧度）与悬浮抬升（CSS 像素） */
  spin?: number;
  lift?: number;
  alpha?: number;
  /** 压扁（倒地）：1 = 正常 */
  squash?: number;
  /** 死亡灰化 */
  dead?: boolean;
}

/** 族类 → 徽章金属主色（detail 纹色直接用 asset 自带原色） */
const ICON_FACE: Record<string, number> = {
  dragon: 0xb0492e,
  wyvern: 0x5f7c40,
  demon: 0xc4392b,
  undead: 0xd5c9a8,
  fey: 0x8a6fc0,
  cultist: 0x8b2534,
  beast: 0x7d6a50,
  construct: 0x7a7d82,
  humanoid: 0x9aa0a8,
  generic: 0x9a6ad0,
  goblin: 0x6b9b3f,
  orc: 0x55a065,
};

/** 卡通材质族类（低金属度高饱和，贴参考图的平面卡通风；其余走金属徽章风） */
const TOON_ICONS = new Set<string>(['orc']);

/** 野怪（哥布林/地精等）名称二级映射：humanoid 且名字命中 → 哥布林专属徽章 */
const GOBLIN_NAME = /哥布林|地精|狗头人|小鬼|goblin|hobgoblin|kobold|\bimp\b/i;
/** 兽人系（獠牙怪兽脸）：humanoid 且名字命中 → 兽人专属徽章；剑立盾人形徽章不再泛用 */
const ORC_NAME = /兽人|半兽人|食人魔|巨魔|\borc\b|\borgre\b|\btroll\b/i;

export function resolveIconKind(kind: CreatureKind, name: string): IconKind {
  if (kind === 'humanoid') {
    if (GOBLIN_NAME.test(name)) return 'goblin';
    if (ORC_NAME.test(name)) return 'orc';
  }
  return kind;
}

const _svgLoader = new SVGLoader();
const VB = 1024;          // 素材 viewBox 边长
const TARGET = 2.0;       // 徽章世界尺寸
const S = TARGET / VB;    // viewBox → 世界 缩放

/** 单条 SVG path d 串 → Shape 列表 */
function dToShapes(d: string): THREE.Shape[] {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`;
  const shapes: THREE.Shape[] = [];
  for (const p of _svgLoader.parse(svg).paths) {
    shapes.push(...SVGLoader.createShapes(p));
  }
  return shapes;
}

/**
 * SVG → 徽章空间归一化：
 * 1) 平移 viewBox 中心到原点 2) y 翻转（SVG y 向下）并缩放 3) 修正翻转后的三角环绕
 * （ExtrudeGeometry 非索引：交换每三角的第二/三顶点后重算法线）
 */
function normalizeIcon(geo: THREE.BufferGeometry, depthVb: number): THREE.BufferGeometry {
  geo.translate(-VB / 2, -VB / 2, 0);
  geo.scale(S, -S, S);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  for (let i = 0; i < arr.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const tmp = arr[i + 3 + k];
      arr[i + 3 + k] = arr[i + 6 + k];
      arr[i + 6 + k] = tmp;
    }
  }
  pos.needsUpdate = true;
  geo.translate(0, 0, -(depthVb * S) / 2);
  geo.computeVertexNormals();
  return geo;
}

/** 一份资产 → 徽章 Group（主轮廓厚挤出 + accent 副色挤出 + detail 纹色薄片叠正面） */
function buildIconGroup(asset: EmblemAsset, faceColor: number, toon = false): THREE.Group {
  const group = new THREE.Group();
  const DEPTH = 460;      // 主轮廓挤出厚（viewBox 尺度 → 世界 ~0.9），侧面不至窄成纸片
  const DETAIL_DEPTH = 60;
  // 金属徽章：高金属度+环境反射；卡通徽章（兽人等贴参考图风）：近无金属高饱和
  const baseMat = toon
    ? { metalness: 0.06, roughness: 0.5 }
    : { metalness: 0.82, roughness: 0.3 };
  // 卡通件灯光已单独降档，SVG 原色即最终观感
  const tint = (hex: number) => new THREE.Color(hex);

  const baseShapes = asset.base.flatMap(d => dToShapes(d));
  const baseGeo = normalizeIcon(new THREE.ExtrudeGeometry(baseShapes, {
    depth: DEPTH,
    bevelEnabled: true,
    bevelThickness: 42,
    bevelSize: 34,
    bevelSegments: 3,
    curveSegments: 10,
  }), DEPTH);
  group.add(new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({
    color: tint(faceColor), ...baseMat, side: THREE.DoubleSide,
  })));

  // accent 副色挤出（如兽人的黄色獠牙）：与主体同厚同斜角，独立配色；
  // 前移一个 detail 厚度，压过正面薄片（獠牙盖在嘴线之前，与参考图层级一致）
  if (asset.accent?.base.length) {
    const accShapes = asset.accent.base.flatMap(d => dToShapes(d));
    const accGeo = normalizeIcon(new THREE.ExtrudeGeometry(accShapes, {
      depth: DEPTH,
      bevelEnabled: true,
      bevelThickness: 42,
      bevelSize: 34,
      bevelSegments: 3,
      curveSegments: 10,
    }), DEPTH);
    accGeo.translate(0, 0, DETAIL_DEPTH * S);
    const accHex = parseInt(asset.accent.color.replace('#', ''), 16) || 0xf0a832;
    group.add(new THREE.Mesh(accGeo, new THREE.MeshStandardMaterial({
      color: tint(accHex), metalness: toon ? 0.06 : 0.55, roughness: 0.42, side: THREE.DoubleSide,
    })));
  }

  // detail 纹色薄片：与主轮廓同一归一化变换（自然对齐），一半嵌入一半凸出；用素材原色
  if (asset.detail?.length) {
    asset.detail.forEach(it => {
      const dGeo = normalizeIcon(new THREE.ExtrudeGeometry(dToShapes(it.d), {
        depth: DETAIL_DEPTH, bevelEnabled: false, curveSegments: 10,
      }), DETAIL_DEPTH);
      // detail 中心 = base 正面 + detail 半厚：薄片一半悬浮一半嵌进正面
      dGeo.translate(0, 0, DEPTH * S / 2 + DETAIL_DEPTH * S / 2);
      const fillHex = parseInt(String(it.fill).replace('#', ''), 16) || 0xf44444;
      const m = new THREE.Mesh(dGeo, new THREE.MeshStandardMaterial({
        color: tint(fillHex), metalness: toon ? 0.05 : 0.4, roughness: 0.5, side: THREE.DoubleSide,
      }));
      m.renderOrder = 1;
      group.add(m);
    });
  }
  return group;
}

interface IconMeshes {
  group: THREE.Group;
}

const BASE_BOTTOM = -1.15; // 底座底面世界 y（buildMeshes 里底座的位置决定，锚定用）

class IconStage {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private cache = new Map<IconKind, IconMeshes>();
  /** 灯光引用：卡通徽章渲染时临时降强度（防材质色过曝），渲染后恢复 */
  private lights!: { hemi: THREE.HemisphereLight; key: THREE.DirectionalLight; rim: THREE.DirectionalLight; fill: THREE.DirectionalLight; amb: THREE.AmbientLight };

  constructor() {
    // 视野完整覆盖徽章+底座（总高约 2.3 世界单位），底座不被裁切
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 60);
    this.camera.position.set(0, 0.35, 6.4);
    this.camera.lookAt(0, 0.12, 0);

    const hemi = new THREE.HemisphereLight(0xbfd0f0, 0x4a3620, 0.8);
    const key = new THREE.DirectionalLight(0xfff0d8, 2.0);
    key.position.set(2.4, 3.4, 3.4);
    const rim = new THREE.DirectionalLight(0x7fa0e8, 1.2);
    rim.position.set(-3.2, 2.2, -3.4);
    const amb = new THREE.AmbientLight(0xffffff, 0.25);
    this.lights = { hemi, key, rim, fill: new THREE.DirectionalLight(0xffd8b0, 0.55), amb };
    this.scene.add(hemi, key, rim, this.lights.fill, amb);
  }

  /** 按徽章风格设灯光强度（卡通 0.4 防过曝 / 金属 1），返回恢复函数 */
  private setLightLevel(style: 'metal' | 'toon'): () => void {
    const f = style === 'toon' ? 0.75 : 1;
    const L = this.lights;
    const prev = { hemi: L.hemi.intensity, key: L.key.intensity, rim: L.rim.intensity, fill: L.fill.intensity, amb: L.amb.intensity };
    L.hemi.intensity = prev.hemi * f;
    L.key.intensity = prev.key * f;
    L.rim.intensity = prev.rim * f;
    L.fill.intensity = prev.fill * f;
    L.amb.intensity = prev.amb * f;
    return () => {
      L.hemi.intensity = prev.hemi;
      L.key.intensity = prev.key;
      L.rim.intensity = prev.rim;
      L.fill.intensity = prev.fill;
      L.amb.intensity = prev.amb;
    };
  }

  private ensureRenderer(): THREE.WebGLRenderer {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    return this.renderer;
  }

  private getMeshes(kind: IconKind): IconMeshes {
    let m = this.cache.get(kind);
    if (!m) {
      const group = new THREE.Group();
      // 哥布林/兽人（野怪二级映射）与各协议族类共用同一资产管线
      const asset: EmblemAsset | undefined = kind === 'goblin' || kind === 'orc'
        ? buildNewEmblem(kind)
        : EMBLEM_ASSETS[kind];
      if (asset) {
        group.add(buildIconGroup(asset, ICON_FACE[kind] ?? 0xb0492e, TOON_ICONS.has(kind)));
      } else {
        // 红色四棱锥（"红三角"的 3D 版）
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.82, 1.6, 4),
          new THREE.MeshStandardMaterial({ color: 0xb03a2a, metalness: 0.55, roughness: 0.35, flatShading: true }),
        );
        cone.position.y = 0.15;
        cone.rotation.y = Math.PI / 4;
        group.add(cone);
      }
      // 底座圆台 + 敌方阵营环
      const stone = new THREE.Mesh(
        new THREE.CylinderGeometry(0.92, 1.06, 0.2, 24),
        new THREE.MeshStandardMaterial({ color: 0x3b3630, roughness: 0.9, metalness: 0.04 }),
      );
      stone.position.y = -1.05;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.84, 0.05, 8, 36),
        new THREE.MeshStandardMaterial({ color: 0xc4392b, metalness: 0.5, roughness: 0.32, emissive: 0xc4392b, emissiveIntensity: 0.22 }),
      );
      ring.position.y = -0.94;
      ring.rotation.x = Math.PI / 2;
      group.add(stone, ring);
      m = { group };
      this.cache.set(kind, m);
    }
    return m;
  }

  /** 渲染一枚徽章/红锥并拷贝到 2D 画布（在地图 rAF 循环内同步调用） */
  drawIcon(ctx: CanvasRenderingContext2D, o: IconDrawOpts): void {
    const size = Math.max(8, o.size);
    const dpr = Math.min(2, window.devicePixelRatio || 1) * 1.6;
    const px = Math.ceil(size * dpr);

    const { group } = this.getMeshes(o.kind);
    group.rotation.y = o.spin ?? 0;
    const liftWorld = (o.lift ?? 0) > 0 ? (o.lift ?? 0) / size * 2.2 : 0;
    group.position.y = liftWorld;

    const renderer = this.ensureRenderer();
    renderer.setSize(px, px, false);
    this.scene.add(group);
    // 锚定点 = 底座底面中心（悬浮时随组整体抬升）——与地面贴合处
    let footRatio = 0.92;
    // 卡通徽章：降灯光 + 摘环境 IBL（RoomEnvironment 不受灯强控制，是材质色被冲淡的主因）
    const toon = TOON_ICONS.has(o.kind);
    const restoreLights = this.setLightLevel(toon ? 'toon' : 'metal');
    const prevEnv = this.scene.environment;
    if (toon) this.scene.environment = null;
    try {
      const p = new THREE.Vector3(0, BASE_BOTTOM + liftWorld, 0).project(this.camera);
      footRatio = Math.min(1.08, Math.max(0.15, (1 - p.y) / 2));
      renderer.render(this.scene, this.camera);
    } finally {
      this.scene.environment = prevEnv;
      restoreLights();
      this.scene.remove(group);
    }

    const h = size * 1.3;
    const w = h;
    ctx.save();
    if ((o.alpha ?? 1) < 1) ctx.globalAlpha = Math.max(0.05, o.alpha ?? 1);
    if (o.dead) ctx.filter = 'grayscale(0.95) brightness(0.75)';
    const sq = o.squash ?? 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(renderer.domElement, o.x - w / 2, o.groundY - footRatio * h * sq, w, h * sq);
    ctx.restore();
  }
}

let stage: IconStage | null = null;

/** 全局图标渲染台单例（惰性初始化，仅浏览器环境触达） */
export function getIconStage(): IconStage {
  if (!stage) stage = new IconStage();
  return stage;
}
