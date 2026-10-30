import { EXHIBITS } from "./exhibits.js";
export function arrangement({
  THREE: T,
  canvas,
  camera,
  controls,
  getRoot,
  notify,
}) {
  const panel = document.createElement("details");
  panel.id = "arrangement";
  panel.innerHTML = `<summary>Расстановка</summary><label>Вариант<select id="layout-variant"><option>Как есть</option></select></label><button id="layout-edit">Изменить расстановку</button><div id="layout-tools" hidden><label>Экспонат<select id="layout-object"></select></label><label>Поверхность<select id="layout-shelf"></select></label><button id="layout-place">Поставить в центр</button><label>Поворот, °<input id="layout-angle" type="number" step="15" value="0"></label><label><input id="layout-visible" type="checkbox" checked>Показывать экспонат</label><label>Название варианта<input id="layout-name" maxlength="80" placeholder="Новая расстановка"></label><button id="layout-save">Сохранить как вариант</button><p>Перетащите экспонат на полку. Красная рамка — поставить нельзя. Escape — отменить перенос.</p></div><p id="layout-status" role="status"></p>`;
  document.body.append(panel);
  const $ = (id) => panel.querySelector("#layout-" + id),
    items = new Map(),
    surfaces = [],
    walls = [],
    original = {};
  let variants = [],
    editing = false,
    drag = null,
    helper = null;
  const box = (o) => new T.Box3().setFromObject(o, true),
    state = () =>
      Object.fromEntries(
        [...items].map(([id, o]) => [
          id,
          {
            position: o.position.toArray(),
            quaternion: o.quaternion.toArray(),
            visible: o.visible,
          },
        ]),
      );
  function apply(s) {
    for (const [id, v] of Object.entries(s)) {
      const o = items.get(id);
      if (o) {
        o.position.fromArray(v.position);
        o.quaternion.fromArray(v.quaternion);
        o.visible = v.visible;
      }
    }
    getRoot().updateMatrixWorld(true);
    sync();
  }
  function sync() {
    const o = items.get($("object").value);
    if (o) {
      document.querySelectorAll("#exhibits-list input").forEach((input, i) => {
        input.checked = items.get(EXHIBITS[i][0])?.visible ?? false;
      });
      $("visible").checked = o.visible;
      $("angle").value = Math.round(
        T.MathUtils.radToDeg(
          new T.Euler().setFromQuaternion(
            o.quaternion
              .clone()
              .multiply(
                new T.Quaternion()
                  .fromArray(original[$("object").value].quaternion)
                  .invert(),
              ),
            "YXZ",
          ).y,
        ),
      );
    }
  }
  function cancel() {
    if (!drag) return;
    drag.object.position.copy(drag.position);
    drag.object.quaternion.copy(drag.quaternion);
    drag = null;
    controls.enabled = true;
    if (helper) {
      getRoot().remove(helper);
      helper.geometry.dispose();
      helper.material.dispose();
      helper = null;
    }
  }
  function mode(on) {
    cancel();
    editing = on;
    $("tools").hidden = !on;
    $("edit").textContent = on
      ? "Завершить расстановку"
      : "Изменить расстановку";
    canvas.dataset.arranging = String(on);
    if (on) document.querySelector("#reset").click();
  }
  function populate() {
    const select = $("variant");
    select.replaceChildren(new Option("Как есть", ""));
    variants.forEach((v, i) => select.add(new Option(v.name, String(i))));
  }
  function overlap(a, b) {
    return (
      a.min.x < b.max.x - 1e-5 &&
      a.max.x > b.min.x + 1e-5 &&
      a.min.y < b.max.y - 1e-5 &&
      a.max.y > b.min.y + 1e-5 &&
      a.min.z < b.max.z - 1e-5 &&
      a.max.z > b.min.z + 1e-5
    );
  }
  function valid(o, s) {
    const b = box(o),
      p = s.bounds,
      eps = 1e-5;
    if (
      b.min.x < p.min.x - eps ||
      b.max.x > p.max.x + eps ||
      b.min.z < p.min.z - eps ||
      b.max.z > p.max.z + eps
    )
      return false;
    return ![
      ...walls,
      ...surfaces.filter((x) => x !== s).map((x) => x.object),
      ...[...items.values()].filter((x) => x !== o && x.visible),
    ].some((x) => overlap(b, box(x)));
  }
  function place(o, s, point) {
    const b = box(o),
      c = b.getCenter(new T.Vector3()),
      delta = new T.Vector3(
        point.x - c.x,
        s.bounds.max.y - b.min.y,
        point.z - c.z,
      );
    const world = o.getWorldPosition(new T.Vector3()).add(delta);
    o.position.copy(o.parent.worldToLocal(world));
    getRoot().updateMatrixWorld(true);
    return valid(o, s);
  }
  function feedback(ok) {
    $("status").textContent = ok
      ? "Можно поставить"
      : "Не помещается: край, стенка, полка или соседний экспонат";
    if (helper) {
      helper.box.copy(box(drag.object));
      helper.material.color.set(ok ? 0xc4552d : 0xff3333);
    }
  }
  const ray = new T.Raycaster();
  function pointer(e) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(
      new T.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      ),
      camera,
    );
  }
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (!editing || e.button !== 0) return;
      pointer(e);
      const hit = ray.intersectObjects(
        [...items.values()].filter((o) => o.visible),
        true,
      )[0];
      if (!hit) return;
      const entry = [...items].find(([, o]) => {
        let n = hit.object;
        while (n) {
          if (n === o) return true;
          n = n.parent;
        }
        return false;
      });
      if (!entry) return;
      e.stopImmediatePropagation();
      $("object").value = entry[0];
      sync();
      const o = entry[1];
      drag = {
        object: o,
        position: o.position.clone(),
        quaternion: o.quaternion.clone(),
        ok: false,
        id: e.pointerId,
      };
      controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      helper = new T.Box3Helper(box(o), 0xc4552d);
      getRoot().add(helper);
    },
    { capture: true },
  );
  canvas.addEventListener(
    "pointermove",
    (e) => {
      if (!drag) return;
      e.stopImmediatePropagation();
      pointer(e);
      let best = null;
      for (const s of surfaces) {
        const half = box(drag.object).getSize(new T.Vector3()).y / 2;
        const p = ray.ray.intersectPlane(
          new T.Plane(new T.Vector3(0, 1, 0), -s.bounds.max.y - half),
          new T.Vector3(),
        );
        if (!p) continue;
        const c = s.bounds.getCenter(new T.Vector3());
        c.y += half;
        const projected = c.clone().project(camera),
          r = canvas.getBoundingClientRect(),
          distance = Math.abs(
            ((1 - projected.y) * r.height) / 2 + r.top - e.clientY,
          );
        if (!best || distance < best.distance) best = { s, p, distance };
      }
      if (best) {
        drag.ok = place(drag.object, best.s, best.p);
        $("shelf").value = best.s.name;
        feedback(drag.ok);
      }
    },
    { capture: true },
  );
  canvas.addEventListener(
    "pointerup",
    (e) => {
      if (!drag) return;
      e.stopImmediatePropagation();
      if (drag.ok) {
        drag.position.copy(drag.object.position);
        drag.quaternion.copy(drag.object.quaternion);
        $("status").textContent = "Перемещено. Сохраните вариант.";
      }
      cancel();
    },
    { capture: true },
  );
  canvas.addEventListener("pointercancel", cancel);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") cancel();
  });
  $("edit").onclick = () => mode(!editing);
  $("object").onchange = sync;
  $("visible").onchange = () => {
    items.get($("object").value).visible = $("visible").checked;
    sync();
  };
  $("place").onclick = () => {
    const o = items.get($("object").value),
      s = surfaces.find((x) => x.name === $("shelf").value),
      previous = o.position.clone();
    if (!place(o, s, s.bounds.getCenter(new T.Vector3()))) {
      o.position.copy(previous);
      getRoot().updateMatrixWorld(true);
      notify("Здесь экспонат не помещается.");
    } else $("status").textContent = "Перемещено. Сохраните вариант.";
  };
  $("angle").onchange = () => {
    const o = items.get($("object").value),
      prev = o.quaternion.clone(),
      pos = o.position.clone(),
      b = box(o),
      s = surfaces.find((s) => Math.abs(s.bounds.max.y - b.min.y) < 0.002);
    const angle = Number($("angle").value);
    if (!Number.isFinite(angle) || !s) return sync();
    o.quaternion
      .setFromAxisAngle(new T.Vector3(0, 1, 0), T.MathUtils.degToRad(angle))
      .multiply(
        new T.Quaternion().fromArray(original[$("object").value].quaternion),
      );
    if (!place(o, s, b.getCenter(new T.Vector3()))) {
      o.quaternion.copy(prev);
      o.position.copy(pos);
      notify("Для такого поворота недостаточно места.");
    }
    sync();
  };
  $("save").onclick = () => {
    const name = $("name").value.trim();
    if (!name) return notify("Введите название варианта.");
    const next = [...variants, { name, items: state() }];
    try {
      localStorage.setItem("heritage:layouts:v1", JSON.stringify(next));
      variants = next;
      populate();
      $("variant").value = String(variants.length - 1);
      $("status").textContent = "Вариант сохранён в этом браузере.";
    } catch {
      notify("Не удалось сохранить вариант.");
    }
  };
  $("variant").onchange = () => {
    cancel();
    apply(
      $("variant").value === ""
        ? original
        : variants[Number($("variant").value)].items,
    );
    $("status").textContent = "Расстановка загружена.";
  };
  return {
    load(gltf) {
      items.clear();
      surfaces.length = 0;
      walls.length = 0;
      gltf.scene.traverse((o) => {
        const n =
          gltf.parser.json.nodes[gltf.parser.associations.get(o)?.nodes]?.name;
        if (EXHIBITS.some(([id]) => id === n)) items.set(n, o);
        if (/^Полка [123]$/.test(n) || n === "Тумба")
          surfaces.push({ name: n, object: o, bounds: box(o) });
        if (/^Стенка /.test(n) || n === "Верх") walls.push(o);
      });
      Object.assign(original, state());
      for (const [id, o] of items)
        o.userData.layoutOriginal = o.matrixWorld.clone();
      $("object").replaceChildren(
        ...EXHIBITS.map(([id, title]) => new Option(title, id)),
      );
      $("shelf").replaceChildren(
        ...surfaces.map((s) => new Option(s.name, s.name)),
      );
      try {
        variants = JSON.parse(
          localStorage.getItem("heritage:layouts:v1") || "[]",
        ).filter(
          (v) =>
            v &&
            typeof v.name === "string" &&
            [...items.keys()].every((id) => {
              const x = v.items?.[id];
              return (
                x &&
                x.position?.length === 3 &&
                x.quaternion?.length === 4 &&
                [...x.position, ...x.quaternion].every(Number.isFinite) &&
                typeof x.visible === "boolean"
              );
            }),
        );
      } catch {
        variants = [];
      }
      populate();
      sync();
    },
    bind(position) {
      const p = getRoot().localToWorld(new T.Vector3(...position));
      let best = null;
      for (const [id, o] of items) {
        const distance = box(o).distanceToPoint(p);
        if (!best || distance < best.distance) best = { id, o, distance };
      }
      return best && best.distance < 0.15
        ? { exhibit: best.id, local: best.o.worldToLocal(p).toArray() }
        : null;
    },
    resolve(p, value = p.position) {
      const o = items.get(p.anchor?.exhibit);
      if (!o) return { position: value, visible: true };
      const world = getRoot().localToWorld(new T.Vector3(...value));
      world
        .applyMatrix4(o.userData.layoutOriginal.clone().invert())
        .applyMatrix4(o.matrixWorld);
      return {
        position: getRoot().worldToLocal(world).toArray(),
        visible: o.visible,
      };
    },
    bindPoint(p) {
      if (!p.anchor) {
        const anchor = this.bind(p.position);
        if (anchor) {
          const o = items.get(anchor.exhibit);
          const canonical = (value) => {
            const world = getRoot().localToWorld(new T.Vector3(...value));
            world
              .applyMatrix4(o.matrixWorld.clone().invert())
              .applyMatrix4(o.userData.layoutOriginal);
            return getRoot().worldToLocal(world).toArray();
          };
          p.position = canonical(p.position);
          if (p.view)
            p.view = {
              position: canonical(p.view.position),
              target: canonical(p.view.target),
            };
          p.anchor = anchor;
        }
      }
      return p;
    },
  };
}
