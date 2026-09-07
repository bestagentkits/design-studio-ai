import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { DesignPage, Theme } from "../shared/schema";
import { resolveColor } from "../shared/render";

export function SceneView({
  page,
  theme,
  selected,
  onSelect,
}: {
  page: DesignPage;
  theme: Theme;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!host.current) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      setError(
        "WebGL is unavailable. Enable hardware acceleration to preview this 3D scene. You can still edit scene properties.",
      );
      return;
    }
    setError("");
    const element = host.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(resolveColor(page.background, theme));
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(5, 4, 7);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.5, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 2));
    const light = new THREE.DirectionalLight(0xffffff, 4);
    light.position.set(3, 6, 4);
    light.castShadow = true;
    scene.add(light);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      new THREE.MeshStandardMaterial({
        color: resolveColor(page.background, theme),
        roughness: 0.9,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.01;
    ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(20, 20, 0xbab6b0, 0xdedbd5);
    grid.position.y = -1;
    scene.add(grid);
    const objects: THREE.Object3D[] = [];
    let disposed = false;
    for (const node of page.nodes.filter(
      (n) => n.type === "model3d" && n.visible !== false,
    )) {
      const color = resolveColor(
        String(node.style?.fill || node.data?.color || "$accent"),
        theme,
      );
      const material = new THREE.MeshStandardMaterial({
        color,
        metalness: Number(node.data?.metalness ?? 0.15),
        roughness: Number(node.data?.roughness ?? 0.35),
        transparent: (node.opacity ?? 1) < 1,
        opacity: node.opacity ?? 1,
      });
      const finish = (object: THREE.Object3D) => {
        if (disposed) {
          disposeObject(object);
          return;
        }
        object.position.set(
          (node.x + node.width / 2 - page.width / 2) / 240,
          (page.height / 2 - node.y - node.height / 2) / 240,
          Number(node.data?.z || 0),
        );
        object.rotation.set(
          (Number(node.data?.rotationX || 0) * Math.PI) / 180,
          (Number(node.data?.rotationY || 0) * Math.PI) / 180,
          ((node.rotation || 0) * Math.PI) / 180,
        );
        object.scale.set(
          node.width / 400,
          node.height / 400,
          Number(node.data?.depth || node.width) / 400,
        );
        object.traverse((child) => {
          child.userData.nodeId = node.id;
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        scene.add(object);
        objects.push(object);
        if (selected === node.id) {
          const helper = new THREE.BoxHelper(object, 0xd77654);
          helper.userData.helper = true;
          scene.add(helper);
        }
      };
      if (node.src) {
        new GLTFLoader().load(
          node.src,
          (gltf) => {
            const box = new THREE.Box3().setFromObject(gltf.scene),
              size = box.getSize(new THREE.Vector3()),
              center = box.getCenter(new THREE.Vector3());
            gltf.scene.position.sub(center);
            const holder = new THREE.Group();
            holder.add(gltf.scene);
            holder.scale.setScalar(2 / Math.max(size.x, size.y, size.z, 0.001));
            const wrapper = new THREE.Group();
            wrapper.add(holder);
            finish(wrapper);
          },
          undefined,
          () => {
            if (!disposed)
              setError(
                `Could not load “${node.name}”. Import a self-contained GLB file and try again.`,
              );
          },
        );
      } else {
        const geometryName = String(
          node.data?.geometry || node.data?.shape || "box",
        );
        const geometry =
          geometryName === "sphere"
            ? new THREE.SphereGeometry(1, 48, 32)
            : geometryName === "torus"
              ? new THREE.TorusGeometry(0.8, 0.3, 24, 64)
              : geometryName === "torusKnot"
                ? new THREE.TorusKnotGeometry(0.7, 0.23, 100, 20)
                : geometryName === "cone"
                  ? new THREE.ConeGeometry(1, 1.7, 48)
                  : geometryName === "cylinder"
                    ? new THREE.CylinderGeometry(0.8, 0.8, 1.6, 48)
                    : new THREE.BoxGeometry(1.6, 1.6, 1.6);
        finish(new THREE.Mesh(geometry, material));
      }
    }
    const resize = () => {
      const width = element.clientWidth,
        height = element.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const raycaster = new THREE.Raycaster();
    const select = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = raycaster.intersectObjects(objects, true)[0];
      if (hit?.object.userData.nodeId)
        onSelect(String(hit.object.userData.nodeId));
    };
    renderer.domElement.addEventListener("click", select);
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("click", select);
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [page, theme, selected]);
  return (
    <div className="scene-view" ref={host}>
      {error && (
        <p className="scene-error" role="alert">
          {error}
        </p>
      )}
      <span className="scene-help">
        Drag to orbit · Scroll to zoom · Click an object to select
      </span>
    </div>
  );
}
function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const material of materials) {
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    }
  });
}
