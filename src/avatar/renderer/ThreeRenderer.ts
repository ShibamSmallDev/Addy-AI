import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ParamValueMap } from "../types";
import type { IRenderer } from "./IRenderer";

const MODEL_PATH = "/models/addy.glb";

export class ThreeRenderer implements IRenderer {
  readonly type = "three" as const;

  private canvas: HTMLCanvasElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private modelRoot: THREE.Group | null = null;
  private faceMesh: THREE.Mesh | null = null;
  private haloMesh: THREE.Object3D | null = null;
  private companionMesh: THREE.Object3D | null = null;
  private emissiveMaterials: THREE.MeshStandardMaterial[] = [];

  private isReady = false;
  private time = 0;

  // Smoothing states for natural lerping
  private currentHeadRot = { x: 0, y: 0, z: 0 };
  private currentBlink = 0;
  private currentMouth = 0;
  private autoBlinkTimer = 0;
  private isAutoBlinking = false;
  private autoBlinkProgress = 0;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    const width = canvas.clientWidth || 512;
    const height = canvas.clientHeight || 512;

    // 1. WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    // 2. Scene
    this.scene = new THREE.Scene();

    // 3. Camera (Framed aesthetically for upper body & face of 1.60m character)
    this.camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 50);
    this.camera.position.set(0, 1.35, 1.35);
    this.camera.lookAt(0, 1.25, 0);

    // 4. Balanced Anime Studio 3-Point Lighting
    const ambientLight = new THREE.AmbientLight(0xdce7f5, 0.95);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
    keyLight.position.set(0.5, 2.2, 1.8);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xa5b4fc, 0.6);
    fillLight.position.set(-0.8, 1.5, 1.0);
    this.scene.add(fillLight);

    // Cyan rim light (ADDY's signature cyan accent)
    const cyanRim = new THREE.DirectionalLight(0x00e5ff, 1.6);
    cyanRim.position.set(-1.2, 1.8, -1.0);
    this.scene.add(cyanRim);

    // Violet rim light (ADDY's signature purple accent)
    const purpleRim = new THREE.DirectionalLight(0xa855f7, 1.4);
    purpleRim.position.set(1.2, 1.6, -1.0);
    this.scene.add(purpleRim);

    // 5. Load GLB
    try {
      await this.loadModel();
      this.isReady = true;
      console.log("[ThreeRenderer] ADDY 3D Anime Model loaded successfully.");
    } catch (err) {
      console.error("[ThreeRenderer] Failed to load model:", err);
      throw err;
    }
  }

  private async loadModel(): Promise<void> {
    const loader = new GLTFLoader();

    return new Promise((resolve, reject) => {
      loader.load(
        MODEL_PATH,
        (gltf) => {
          this.modelRoot = gltf.scene;

          // Calibrate materials and extract key meshes
          this.modelRoot.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;

              // Identify Face mesh for morph targets
              if (mesh.name.toLowerCase().includes("face") && mesh.morphTargetInfluences) {
                this.faceMesh = mesh;
              }

              // Identify Halo & Companion props
              if (mesh.name.includes("Prop_Halo")) {
                this.haloMesh = mesh;
              }
              if (mesh.name.includes("Prop_Companion")) {
                this.companionMesh = mesh;
              }

              // Enhance materials for anime aesthetic
              const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              materials.forEach((mat) => {
                if (mat instanceof THREE.MeshStandardMaterial) {
                  mat.roughness = Math.max(0.3, mat.roughness ?? 0.5);

                  // Emissive parts
                  if (
                    mat.name.includes("Emission_Cyan") ||
                    mat.name.includes("Light") ||
                    mesh.name.includes("HairClip") ||
                    mesh.name.includes("Pendant")
                  ) {
                    mat.emissive = new THREE.Color(0x00e5ff);
                    mat.emissiveIntensity = 1.4;
                    this.emissiveMaterials.push(mat);
                  } else if (mat.name.includes("Emission_Purple") || mat.name.includes("Halo")) {
                    mat.emissive = new THREE.Color(0xa855f7);
                    mat.emissiveIntensity = 1.2;
                    this.emissiveMaterials.push(mat);
                  } else if (mat.name.includes("Skin")) {
                    mat.color = new THREE.Color(0xf8e8e3);
                    mat.roughness = 0.85;
                  } else if (mat.name.includes("Cyber_White") || mat.name.includes("Jacket")) {
                    mat.color = new THREE.Color(0xf5f5fa);
                  } else if (mat.name.includes("Obsidian") || mat.name.includes("Inner")) {
                    mat.color = new THREE.Color(0x12141a);
                  }
                }
              });
            }
          });

          // Center & orient model
          this.modelRoot.position.set(0, 0, 0);
          this.scene?.add(this.modelRoot);
          resolve();
        },
        undefined,
        (err) => reject(err)
      );
    });
  }

  render(params: ParamValueMap, dt: number): void {
    if (!this.isReady || !this.renderer || !this.scene || !this.camera) return;

    this.time += dt;

    // 1. Natural Breathing Motion
    const breath = Math.sin(this.time * 2.2) * 0.003;
    if (this.modelRoot) {
      this.modelRoot.position.y = breath;
    }

    // 2. Head Rotation from parameters (smooth interpolation)
    const targetRotX = ((params.ParamAngleY ?? 0) * Math.PI) / 180 * 0.4;
    const targetRotY = ((params.ParamAngleX ?? 0) * Math.PI) / 180 * 0.6;
    const targetRotZ = (-(params.ParamAngleZ ?? 0) * Math.PI) / 180 * 0.3;

    this.currentHeadRot.x += (targetRotX - this.currentHeadRot.x) * Math.min(1, dt * 10);
    this.currentHeadRot.y += (targetRotY - this.currentHeadRot.y) * Math.min(1, dt * 10);
    this.currentHeadRot.z += (targetRotZ - this.currentHeadRot.z) * Math.min(1, dt * 10);

    if (this.modelRoot) {
      const idleSway = Math.sin(this.time * 0.8) * 0.015;
      this.modelRoot.rotation.y = this.currentHeadRot.y + idleSway;
      this.modelRoot.rotation.x = this.currentHeadRot.x;
      this.modelRoot.rotation.z = this.currentHeadRot.z;
    }

    // 3. Eye Blinking (both autonomous organic blinking + external parameter)
    this.autoBlinkTimer += dt;
    if (!this.isAutoBlinking && this.autoBlinkTimer > 3.8 + Math.random() * 2.5) {
      this.isAutoBlinking = true;
      this.autoBlinkTimer = 0;
      this.autoBlinkProgress = 0;
    }

    let blinkVal = 0;
    if (this.isAutoBlinking) {
      this.autoBlinkProgress += dt * 6.5; // ~150ms blink cycle
      if (this.autoBlinkProgress <= 0.5) {
        blinkVal = this.autoBlinkProgress * 2;
      } else if (this.autoBlinkProgress < 1.0) {
        blinkVal = 2 - this.autoBlinkProgress * 2;
      } else {
        blinkVal = 0;
        this.isAutoBlinking = false;
      }
    }

    if (params.ParamEyeLOpen !== undefined) {
      const paramBlink = Math.max(0, 1 - params.ParamEyeLOpen);
      blinkVal = Math.max(blinkVal, paramBlink);
    }
    this.currentBlink += (blinkVal - this.currentBlink) * Math.min(1, dt * 25);

    // 4. Lip-sync / Mouth Open
    const targetMouth = Math.min(1, Math.max(0, params.ParamMouthOpenY ?? 0));
    this.currentMouth += (targetMouth - this.currentMouth) * Math.min(1, dt * 18);

    // 5. Apply Morph Targets to Face Mesh
    if (this.faceMesh && this.faceMesh.morphTargetInfluences) {
      const influences = this.faceMesh.morphTargetInfluences;

      // target_36: Both eyes blink
      if (influences[36] !== undefined) {
        influences[36] = this.currentBlink;
      }
      // target_3: Mouth open (A viseme)
      if (influences[3] !== undefined) {
        influences[3] = this.currentMouth;
      }
      // target_2: Smile / Joy
      const smileVal = params.ParamBlush ? params.ParamBlush * 0.7 : 0;
      if (influences[2] !== undefined) {
        influences[2] = smileVal;
      }
    }

    // 6. Floating Cyber Halo and Satellite Companion Animation
    if (this.haloMesh) {
      this.haloMesh.rotation.y = this.time * 0.5;
      this.haloMesh.position.y = 1.68 + Math.sin(this.time * 1.8) * 0.02;
    }
    if (this.companionMesh) {
      this.companionMesh.position.y = 1.45 + Math.cos(this.time * 1.5) * 0.03;
      this.companionMesh.rotation.y = this.time * 0.8;
    }

    // 7. Render
    this.renderer.render(this.scene, this.camera);
  }

  resize(width: number, height: number): void {
    if (!this.renderer || !this.camera || !this.canvas) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  destroy(): void {
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
    this.modelRoot = null;
    this.faceMesh = null;
    this.haloMesh = null;
    this.companionMesh = null;
    this.isReady = false;
  }
}
