const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
async function setup() {
  const T = await import("three");
  const elements = new Map();
  class El {
    constructor() {
      this.value = "";
      this.checked = true;
      this.dataset = {};
      this.handlers = {};
    }
    querySelector(s) {
      if (!elements.has(s)) elements.set(s, new El());
      return elements.get(s);
    }
    replaceChildren(...c) {
      this.children = c;
      this.value = c[0]?.value ?? "";
    }
    add(o) {
      this.children.push(o);
    }
    addEventListener(n, f) {
      this.handlers[n] = f;
    }
    click() {
      this.onclick?.();
    }
    setPointerCapture() {}
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1000, height: 800 };
    }
  }
  const canvas = new El(),
    doc = new El();
  doc.createElement = () => new El();
  doc.body = new El();
  doc.body.append = () => {};
  doc.querySelectorAll = () => [];
  const store = new Map();
  const context = vm.createContext({
    document: doc,
    Option: class {
      constructor(name, value) {
        this.name = name;
        this.value = value;
      }
    },
    localStorage: {
      getItem: (k) => store.get(k),
      setItem: (k, v) => store.set(k, v),
    },
    EXHIBITS: [
      ["cup", "Cup"],
      ["fish", "Fish"],
    ],
  });
  vm.runInContext(
    fs
      .readFileSync(require.resolve("../arrangement.js"), "utf8")
      .replace(/^import .*?;\r?\n/, "")
      .replace("export ", ""),
    context,
  );
  const root = new T.Group(),
    objects = [],
    names = [];
  function add(name, x, y, z, w, h, d) {
    const o = new T.Mesh(new T.BoxGeometry(w, h, d));
    o.position.set(x, y, z);
    root.add(o);
    names.push({ name });
    objects.push(o);
    return o;
  }
  const cup = add("cup", -0.7, 0.2, 0, 0.2, 0.4, 0.2),
    fish = add("fish", 0.7, 0.2, 0, 0.3, 0.4, 0.3);
  add("Тумба", 0, -0.05, 0, 2, 0.1, 1);
  add("Полка 1", 0, 0.95, 0, 2, 0.1, 1);
  add("Полка 2", 0, 1.5, 0, 2, 0.1, 1);
  add("Полка 3", 0, 2.5, 0, 2, 0.1, 1);
  add("Стенка задняя", 0, 1, 0.55, 2, 3, 0.1);
  root.updateMatrixWorld(true);
  const controls = { enabled: true },
    messages = [];
  const layout = context.arrangement({
    THREE: T,
    canvas,
    camera: new T.PerspectiveCamera(),
    controls,
    getRoot: () => root,
    notify: (m) => messages.push(m),
  });
  layout.load({
    scene: root,
    parser: {
      json: { nodes: names },
      associations: new Map(objects.map((o, nodes) => [o, { nodes }])),
    },
  });
  const $ = (id) => doc.querySelector("#layout-" + id);
  return { T, root, cup, fish, layout, $, store, messages };
}
test("snap bottoms to each of four surfaces; reject height, overlap and restore variants", async () => {
  const s = await setup(),
    { $, T, cup, fish } = s;
  $("object").value = "cup";
  for (const name of ["Тумба", "Полка 1", "Полка 2", "Полка 3"]) {
    $("shelf").value = name;
    $("place").click();
    const shelf = s.root.children.find(
      (o) =>
        o ===
        s.root.children[
          ["Тумба", "Полка 1", "Полка 2", "Полка 3"].indexOf(name) + 2
        ],
    );
    assert.ok(
      Math.abs(
        new T.Box3().setFromObject(cup).min.y -
          new T.Box3().setFromObject(shelf).max.y,
      ) < 1e-6,
    );
  }
  $("name").value = "Saved";
  $("save").click();
  const saved = cup.position.clone();
  $("variant").value = "";
  $("variant").onchange();
  assert.equal(cup.position.x, -0.7);
  $("variant").value = "0";
  $("variant").onchange();
  assert.ok(cup.position.equals(saved));
  $("object").value = "fish";
  $("shelf").value = "Полка 3";
  const before = fish.position.clone();
  $("place").click();
  assert.ok(fish.position.equals(before));
  cup.scale.y = 5;
  $("object").value = "cup";
  $("shelf").value = "Полка 1";
  const prev = cup.position.clone();
  $("place").click();
  assert.ok(cup.position.equals(prev));
});
test("bound annotation and camera follow translation and rotation; hiding object hides point", async () => {
  const { T, cup, layout, root } = await setup();
  const p = {
    position: [-0.7, 0.2, 0],
    view: { position: [-2, 0.4, 0], target: [-0.7, 0.2, 0] },
  };
  layout.bindPoint(p);
  assert.equal(p.anchor.exhibit, "cup");
  cup.position.x += 0.4;
  cup.rotateY(Math.PI / 2);
  root.updateMatrixWorld(true);
  const result = layout.resolve(p);
  assert.ok(new T.Vector3(...result.position).distanceTo(cup.position) < 1e-6);
  assert.notDeepEqual(
    layout.resolve(p, p.view.position).position,
    p.view.position,
  );
  cup.visible = false;
  assert.equal(layout.resolve(p).visible, false);
});
