/**
 * 3D 棋子渲染台（TokenStage）—— 共享 WebGLRenderer 的精灵出图管线
 *
 * 用法：等距地图的 2D 绘制循环内逐单位调用 drawToken()，
 * 内部把该族类模型摆上转台 → WebGL 渲染一帧 → drawImage 拷进 2D 画布。
 * 单例模型按需缓存（渲染即拷贝像素，改变换再渲染下一个完全安全）。
 * 光照：暖主光 + 冷轮廓光 + 补光 + 天光，透明背景（阴影仍由 2D 侧椭圆投影统一负责）。
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CreatureKind } from '@/lib/engine/types';
import { buildToken, ringColorFor, type TokenKind } from './builders';

export interface TokenDrawOpts {
  /** 屏幕锚点：x 为中心线，groundY 为脚底（2D 画布 CSS 像素坐标） */
  x: number;
  groundY: number;
  /** 棋子屏幕高度（CSS 像素） */
  size: number;
  kind: TokenKind;
  attitude?: 0 | 1 | 2;
  isPlayer?: boolean;
  /** 转台角（弧度）与悬浮抬升（CSS 像素） */
  spin?: number;
  lift?: number;
  alpha?: number;
  /** 压扁（倒地）：1 = 正常 */
  squash?: number;
  /** 死亡灰化 */
  dead?: boolean;
}

class TokenStage {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private groups = new Map<TokenKind, THREE.Group>();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 60);
    this.camera.position.set(0, 2.75, 7.5);
    this.camera.lookAt(0, 1.1, 0);

    const hemi = new THREE.HemisphereLight(0xbfd0f0, 0x4a3620, 0.85);
    const key = new THREE.DirectionalLight(0xfff0d8, 2.1);
    key.position.set(2.6, 4.2, 3.2);
    const rim = new THREE.DirectionalLight(0x7fa0e8, 1.15);
    rim.position.set(-3.2, 2.6, -3.6);
    const fill = new THREE.DirectionalLight(0xffd8b0, 0.55);
    fill.position.set(-2.2, 1.2, 2.6);
    this.scene.add(hemi, key, rim, fill);
  }

  private ensureRenderer(): THREE.WebGLRenderer {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      this.renderer.setClearColor(0x000000, 0);
      // 电影级色调映射 + 环境反射：金属/眼睛/水晶的质感来源
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 0.95;
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    return this.renderer;
  }

  private getGroup(kind: TokenKind): THREE.Group {
    let g = this.groups.get(kind);
    if (!g) {
      g = buildToken(kind);
      this.groups.set(kind, g);
    }
    return g;
  }

  /** 渲染一尊棋子并拷贝到 2D 画布（在地图 rAF 循环内同步调用） */
  drawToken(ctx: CanvasRenderingContext2D, o: TokenDrawOpts): void {
    const size = Math.max(8, o.size);
    const dpr = Math.min(2, window.devicePixelRatio || 1) * 1.6; // 出图分辨率补偿，缩小绘制时保持锐利
    const px = Math.ceil(size * dpr);

    const group = this.getGroup(o.kind);
    const body = group.userData.body as THREE.Group | undefined;

    // 转台 + 悬浮（世界单位换算：模型全高约 2.6 对应屏幕 size）
    group.rotation.y = o.spin ?? 0;
    group.position.y = (o.lift ?? 0) > 0 ? (o.lift ?? 0) / size * 2.6 : 0;

    // 阵营环换色（材质为各族实例共享，直接改 color 即可）
    const ringMat = group.userData.ringMat as THREE.MeshStandardMaterial | undefined;
    if (ringMat) {
      const c = ringColorFor(o.attitude ?? (o.kind === 'ally' ? 0 : 2), !!o.isPlayer);
      ringMat.color.setHex(c);
      ringMat.emissive.setHex(c);
    }

    const renderer = this.ensureRenderer();
    renderer.setSize(px, px, false);
    this.scene.add(group);
    let footRatio = 0.9; // 模型脚底在渲染画面中的纵向占比（兜底）
    try {
      // 把脚底（含悬浮抬升）投到 NDC，得到它在画面中的精确锚点
      const p = new THREE.Vector3(0, group.position.y, 0).project(this.camera);
      footRatio = Math.min(1.05, Math.max(0.3, (1 - p.y) / 2));
      renderer.render(this.scene, this.camera);
    } finally {
      this.scene.remove(group);
    }

    // 拷贝进 2D 画布：脚底精确对齐 groundY，死亡灰化 + 压扁（压缩时脚底不动）
    const h = size * 1.5; // 画面纵向余量（转角时翼/角超出）
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

let stage: TokenStage | null = null;

/** 全局渲染台单例（惰性初始化，仅浏览器环境触达） */
export function getTokenStage(): TokenStage {
  if (!stage) stage = new TokenStage();
  return stage;
}

/** 族类兜底归一（供外部确保 kind 合法） */
export function toTokenKind(kind: CreatureKind | 'ally' | undefined, fallback: TokenKind = 'generic'): TokenKind {
  return kind ?? fallback;
}
