// Voxel terrarium scene — Three.js
// Exposes window.Terrarium with: init, growPlant(n), dropRock(), spawnFirefly(n), setWPM(wpm), reset()

(function () {
  const BOX_W = 9;        // voxels wide (x)
  const BOX_D = 5;        // voxels deep (z)
  const BOX_H = 10;       // voxels tall (y)
  const VOX = 1;          // voxel size

  // color palette (hex for three.js)
  const COL = {
    soil:     0x3a2516,
    soilDark: 0x2a1a10,
    pebble:   0x4a3a2a,
    moss:     [0x5fa85a, 0x7bc06a, 0x4a8f4a, 0x8dd57a, 0x6fc8a8, 0x98d460],
    fernStem: 0x2f6b3a,
    fernLeaf: [0x4aa055, 0x5fbe6a, 0x3b8a48, 0x7ecf6a, 0x82b84a],
    flower:   [0xff6fa8, 0xffcf6b, 0xff9acb, 0xf2f2f2, 0xb88cff, 0xff8a5a, 0xffd94a, 0x8fd6ff, 0xffb0d0],
    mushroomCap:  [0xd8452a, 0xe67a3a, 0xc28adf, 0xf0c248, 0xeee6d0],
    mushroomStem: 0xf2ead0,
    stalkBlue:    [0x6a9cff, 0x9bb8ff],
    daisy:        { petal: 0xffffff, centre: 0xf5c842, stem: 0x3d7a3a },
    allium:       { floret: [0xc084fc, 0xa855f7, 0x9333ea, 0xd8b4fe], stem: 0x4a7c4e },
    rock:     [0x5a5a66, 0x6e6e78, 0x4a4a54],
    glass:    0xbfd8e8,
    fireflyCore: 0xffe8a0,
    fireflyGlow: 0xfff2c2,
  };

  let scene, camera, renderer, clock;
  let terrariumGroup, plantsGroup, rocksGroup, firefliesGroup, particleGroup;
  let glassMesh, soilGroup;
  // dimension of terrarium interior in world units
  let INTERIOR = { x: BOX_W, y: BOX_H, z: BOX_D };

  // dynamic elements
  const plants = [];       // { mesh, baseX, baseZ, heightVox, kind, crushed }
  const rocks = [];        // physics-ish rocks
  const fireflies = [];    // { mesh, light, phase, home }
  const particles = [];    // small floating specks (dust)
  const crushAnims = [];   // animating smashed-plant fragments

  let camShake = 0;
  let currentWPM = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ---- Geometry caches ----
  const voxGeo = new THREE.BoxGeometry(VOX, VOX, VOX);
  const smallLeafGeo = new THREE.BoxGeometry(VOX * 0.8, VOX * 0.22, VOX * 0.8);
  const tallLeafGeo = new THREE.BoxGeometry(VOX * 0.22, VOX * 0.9, VOX * 0.22);
  const mossMatCache = {};
  function mossMat(hex) {
    if (!mossMatCache[hex]) mossMatCache[hex] = new THREE.MeshLambertMaterial({ color: hex });
    return mossMatCache[hex];
  }

  // ---- Init scene ----
  function init(container) {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x1a1838, 0.016);

    const w = container.clientWidth, h = container.clientHeight;
    camera = new THREE.PerspectiveCamera(36, w / h, 0.1, 200);
    positionCamera();

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.36;
    container.appendChild(renderer.domElement);

    clock = new THREE.Clock();

    // --- Lighting ---
    // Warm key from upper-right — main sun through glass
    const key = new THREE.DirectionalLight(0xffe4b0, 1.87);
    key.position.set(8, 10, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 50;
    key.shadow.camera.left = -12;
    key.shadow.camera.right = 12;
    key.shadow.camera.top = 12;
    key.shadow.camera.bottom = -12;
    key.shadow.bias = -0.001;
    scene.add(key);

    // Front fill — soft neutral from camera direction so plants read clearly
    const front = new THREE.DirectionalLight(0xd0e8ff, 0.94);
    front.position.set(0, 4, 18);
    scene.add(front);

    // Cool blue-purple fill from upper-left for colour contrast
    const fill = new THREE.DirectionalLight(0x8fa8ff, 0.64);
    fill.position.set(-8, 8, 4);
    scene.add(fill);

    // Ambient — lifted significantly so shadows aren't jet-black
    const amb = new THREE.AmbientLight(0x9090c0, 1.19);
    scene.add(amb);

    // Hemisphere: warm sky above, warm earth below
    const bounce = new THREE.HemisphereLight(0xc0c8ff, 0x7a6040, 0.77);
    scene.add(bounce);

    // Interior point light — sits inside the box, warms soil & plants from within
    const interior = new THREE.PointLight(0xffe8c0, 1.53, 14, 1.5);
    interior.position.set(0, -BOX_H / 2 + 3, 0);
    scene.add(interior);

    // Rim light from behind — catches glass edges and plant silhouettes
    const rim = new THREE.DirectionalLight(0xffd0a0, 0.51);
    rim.position.set(0, 6, -14);
    scene.add(rim);

    // --- Terrarium group ---
    terrariumGroup = new THREE.Group();
    // Lift the whole terrarium up in world space so the wooden base sits above
    // the prompt bar at the bottom of the viewport.
    terrariumGroup.position.y = 2.2;
    scene.add(terrariumGroup);

    buildBase();
    buildGlass();
    buildSoil();

    plantsGroup = new THREE.Group();
    rocksGroup = new THREE.Group();
    firefliesGroup = new THREE.Group();
    particleGroup = new THREE.Group();
    terrariumGroup.add(plantsGroup, rocksGroup, firefliesGroup, particleGroup);

    buildDust();

    // subtle ground plane for shadow outside box? skip to keep focus on box.

    window.addEventListener('resize', onResize);
    animate();
  }

  function positionCamera() {
    // Frame the whole terrarium including the wooden base and soil/moss layer.
    // The terrariumGroup is lifted by +2.2 in world space, so we aim at its
    // vertical center (~midpoint of the box: -1 local + 2.2 group = ~1.2 world).
    // Camera is pulled back and raised slightly for a gentle 3/4 front view.
    camera.position.set(0, 4.5, 26);
    camera.lookAt(0, 1.2, 0);
  }

  function onResize() {
    const container = renderer.domElement.parentElement;
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  // --- Build wooden base ---
  function buildBase() {
    const baseGroup = new THREE.Group();
    const baseH = 0.55;
    const baseW = BOX_W + 1.2;
    const baseD = BOX_D + 1.2;

    // wooden plank look via 2 boxes
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9, metalness: 0 });
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x2a1e12, roughness: 0.95, metalness: 0 });

    const top = new THREE.Mesh(new THREE.BoxGeometry(baseW, baseH, baseD), wood);
    top.position.y = -BOX_H / 2 - baseH / 2 + 0.01;
    top.receiveShadow = true;
    baseGroup.add(top);

    const lip = new THREE.Mesh(new THREE.BoxGeometry(baseW - 0.15, 0.1, baseD - 0.15), woodDark);
    lip.position.y = top.position.y + baseH / 2 + 0.05;
    baseGroup.add(lip);

    // tiny feet
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.35), woodDark);
      foot.position.set(sx * (baseW / 2 - 0.4), top.position.y - baseH / 2 - 0.12, sz * (baseD / 2 - 0.4));
      baseGroup.add(foot);
    });

    terrariumGroup.add(baseGroup);
  }

  // --- Glass box ---
  function buildGlass() {
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xaad0e0,
      transparent: true,
      opacity: 0.12,
      roughness: 0.05,
      metalness: 0,
      transmission: 0.0, // keep cheap — use opacity instead
      ior: 1.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const box = new THREE.Mesh(new THREE.BoxGeometry(BOX_W, BOX_H, BOX_D), glassMat);
    box.renderOrder = 10;
    // we'll show only edges + faint faces
    terrariumGroup.add(box);
    glassMesh = box;

    // glass edges (brass frame)
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(BOX_W, BOX_H, BOX_D));
    const frameMat = new THREE.LineBasicMaterial({ color: 0xc99a5a, transparent: true, opacity: 0.85 });
    const frame = new THREE.LineSegments(edges, frameMat);
    terrariumGroup.add(frame);

    // Thicker frame posts at corners (voxel-style brass tubes)
    const postMat = new THREE.MeshStandardMaterial({ color: 0xb8874a, roughness: 0.35, metalness: 0.7 });
    const postGeo = new THREE.BoxGeometry(0.2, BOX_H + 0.05, 0.2);
    const corners = [
      [-BOX_W / 2, BOX_D / 2], [BOX_W / 2, BOX_D / 2],
      [-BOX_W / 2, -BOX_D / 2], [BOX_W / 2, -BOX_D / 2],
    ];
    corners.forEach(([x, z]) => {
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(x, 0, z);
      terrariumGroup.add(p);
    });

    // Top and bottom horizontal frames
    const hGeoX = new THREE.BoxGeometry(BOX_W + 0.05, 0.2, 0.2);
    const hGeoZ = new THREE.BoxGeometry(0.2, 0.2, BOX_D + 0.05);
    [BOX_H / 2, -BOX_H / 2].forEach(y => {
      // front/back
      [BOX_D / 2, -BOX_D / 2].forEach(z => {
        const b = new THREE.Mesh(hGeoX, postMat);
        b.position.set(0, y, z); terrariumGroup.add(b);
      });
      [BOX_W / 2, -BOX_W / 2].forEach(x => {
        const b = new THREE.Mesh(hGeoZ, postMat);
        b.position.set(x, y, 0); terrariumGroup.add(b);
      });
    });
  }

  // --- Voxel soil floor ---
  function buildSoil() {
    soilGroup = new THREE.Group();
    const mat1 = new THREE.MeshLambertMaterial({ color: COL.soil });
    const mat2 = new THREE.MeshLambertMaterial({ color: COL.soilDark });
    const mat3 = new THREE.MeshLambertMaterial({ color: COL.pebble });

    const soilY = -BOX_H / 2 + VOX / 2;
    for (let ix = 0; ix < BOX_W; ix++) {
      for (let iz = 0; iz < BOX_D; iz++) {
        const m = Math.random() < 0.15 ? mat2 : (Math.random() < 0.08 ? mat3 : mat1);
        const v = new THREE.Mesh(voxGeo, m);
        v.position.set(
          -BOX_W / 2 + VOX / 2 + ix,
          soilY,
          -BOX_D / 2 + VOX / 2 + iz
        );
        v.receiveShadow = true;
        soilGroup.add(v);
      }
    }

    // scatter a few pebbles on top
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Mesh(
        new THREE.BoxGeometry(VOX * 0.5, VOX * 0.35, VOX * 0.5),
        mat3
      );
      p.position.set(
        rand(-BOX_W / 2 + 0.5, BOX_W / 2 - 0.5),
        soilY + 0.45,
        rand(-BOX_D / 2 + 0.5, BOX_D / 2 - 0.5)
      );
      p.rotation.y = rand(0, Math.PI);
      p.castShadow = true;
      soilGroup.add(p);
    }

    terrariumGroup.add(soilGroup);
  }

  // --- Floating dust specks ---
  function buildDust() {
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.04, 0.04),
        new THREE.MeshBasicMaterial({ color: 0xffddaa, transparent: true, opacity: 0.35 })
      );
      m.position.set(
        rand(-BOX_W / 2 + 0.5, BOX_W / 2 - 0.5),
        rand(-BOX_H / 2 + 1, BOX_H / 2 - 1),
        rand(-BOX_D / 2 + 0.5, BOX_D / 2 - 0.5)
      );
      particleGroup.add(m);
      particles.push({
        mesh: m,
        base: m.position.clone(),
        phase: Math.random() * Math.PI * 2,
        speed: rand(0.2, 0.5),
      });
    }
  }

  // --- Plants ---
  // Plant creation: given a target height (voxels), build a stack.
  // kind: 'moss' (low bushy), 'fern' (tall with fronds), 'sprout' (tiny starter)
  function createPlant(gridX, gridZ, kind, heightVox) {
    const group = new THREE.Group();
    const baseX = -BOX_W / 2 + VOX / 2 + gridX;
    const baseZ = -BOX_D / 2 + VOX / 2 + gridZ;
    const soilTop = -BOX_H / 2 + VOX;

    group.position.set(baseX, soilTop, baseZ);
    plantsGroup.add(group);

    const plant = {
      group, gridX, gridZ, kind, heightVox: 0, targetHeight: heightVox,
      crushed: false, blocks: [], growTimer: 0, swayPhase: Math.random() * Math.PI * 2,
    };
    plants.push(plant);
    return plant;
  }

  function addPlantBlock(plant, yOffset, kind, colorHex) {
    let mesh;
    if (kind === 'moss') {
      const m = mossMat(colorHex || pick(COL.moss));
      mesh = new THREE.Mesh(voxGeo, m);
      mesh.scale.set(0.95, 0.85, 0.95);
    } else if (kind === 'fernStem') {
      const m = mossMat(COL.fernStem);
      mesh = new THREE.Mesh(new THREE.BoxGeometry(VOX * 0.22, VOX, VOX * 0.22), m);
    } else if (kind === 'fernFrond') {
      const m = mossMat(colorHex || pick(COL.fernLeaf));
      mesh = new THREE.Mesh(new THREE.BoxGeometry(VOX * 1.3, VOX * 0.2, VOX * 0.4), m);
    } else if (kind === 'flower') {
      const m = mossMat(colorHex || pick(COL.flower));
      mesh = new THREE.Mesh(new THREE.BoxGeometry(VOX * 0.45, VOX * 0.45, VOX * 0.45), m);
    } else if (kind === 'flowerPetal') {
      // cross-shaped flower head made of 4 petals
      const m = mossMat(colorHex || pick(COL.flower));
      mesh = new THREE.Mesh(new THREE.BoxGeometry(VOX * 0.9, VOX * 0.18, VOX * 0.3), m);
    } else if (kind === 'mushroomStem') {
      const m = mossMat(COL.mushroomStem);
      mesh = new THREE.Mesh(new THREE.BoxGeometry(VOX * 0.35, VOX * 0.5, VOX * 0.35), m);
    } else if (kind === 'mushroomCap') {
      const m = mossMat(colorHex || pick(COL.mushroomCap));
      mesh = new THREE.Mesh(new THREE.BoxGeometry(VOX * 0.85, VOX * 0.35, VOX * 0.85), m);
    } else if (kind === 'mushroomDot') {
      const m = mossMat(0xffffff);
      mesh = new THREE.Mesh(new THREE.BoxGeometry(VOX * 0.18, VOX * 0.1, VOX * 0.18), m);
    } else if (kind === 'stalk') {
      const m = mossMat(colorHex || pick(COL.stalkBlue));
      mesh = new THREE.Mesh(new THREE.BoxGeometry(VOX * 0.3, VOX, VOX * 0.3), m);
    } else if (kind === 'stalkBud') {
      const m = mossMat(colorHex || pick(COL.flower));
      mesh = new THREE.Mesh(new THREE.BoxGeometry(VOX * 0.55, VOX * 0.55, VOX * 0.55), m);
    } else if (kind === 'daisyStem') {
      const m = mossMat(colorHex || COL.daisy.stem);
      mesh = new THREE.Mesh(new THREE.BoxGeometry(VOX * 0.18, VOX, VOX * 0.18), m);
    } else if (kind === 'daisyCentre') {
      const m = mossMat(COL.daisy.centre);
      mesh = new THREE.Mesh(new THREE.BoxGeometry(VOX * 0.38, VOX * 0.38, VOX * 0.38), m);
    } else if (kind === 'daisyPetal') {
      const m = mossMat(COL.daisy.petal);
      mesh = new THREE.Mesh(new THREE.BoxGeometry(VOX * 0.72, VOX * 0.14, VOX * 0.22), m);
    } else if (kind === 'alliumStem') {
      const m = mossMat(colorHex || COL.allium.stem);
      mesh = new THREE.Mesh(new THREE.BoxGeometry(VOX * 0.16, VOX, VOX * 0.16), m);
    } else if (kind === 'alliumFloret') {
      const m = mossMat(colorHex || pick(COL.allium.floret));
      mesh = new THREE.Mesh(new THREE.BoxGeometry(VOX * 0.22, VOX * 0.22, VOX * 0.22), m);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.y = yOffset;
    // start scaled to 0 for pop animation
    const origScale = mesh.scale.clone();
    mesh.userData.origScale = origScale.clone();
    mesh.scale.set(0.01, 0.01, 0.01);
    plant.group.add(mesh);
    plant.blocks.push({ mesh, origScale, age: 0 });
    return mesh;
  }

  // -- Public: grow plants based on word count  --
  // Called once per correct word. We grow EXISTING plants OR add a new sprout.
  function growPlant(wordIndex) {
    // Strategy: we keep a pool of plant slots across the soil grid.
    // Each correct word either (a) extends an under-grown plant or (b) seeds a new plant.

    // Find candidate grid cells not occupied OR plants not yet full height.
    const growableSoil = [];
    for (let x = 0; x < BOX_W; x++) {
      for (let z = 0; z < BOX_D; z++) {
        const occ = plants.find(p => p.gridX === x && p.gridZ === z && !p.crushed);
        if (!occ) growableSoil.push({ x, z });
      }
    }
    const growables = plants.filter(p => !p.crushed && p.heightVox < p.targetHeight);

    // Prefer extending an existing plant 60% of the time if available
    if (growables.length > 0 && (Math.random() < 0.55 || growableSoil.length === 0)) {
      const p = pick(growables);
      extendPlant(p);
    } else if (growableSoil.length > 0) {
      const { x, z } = pick(growableSoil);
      const r = Math.random();
      let kind, h;
      // Plant kind distribution for variety
      if (r < 0.28)      { kind = 'moss';     h = 1 + ((Math.random() * 2) | 0); } // 1-3
      else if (r < 0.46) { kind = 'fern';     h = 3 + ((Math.random() * 3) | 0); } // 3-6
      else if (r < 0.58) { kind = 'flower';   h = 2 + ((Math.random() * 3) | 0); } // 2-5
      else if (r < 0.68) { kind = 'mushroom'; h = 1; }                              // squat
      else if (r < 0.78) { kind = 'stalk';    h = 4 + ((Math.random() * 3) | 0); } // 4-7 tall
      else if (r < 0.89) { kind = 'daisy';    h = 2 + ((Math.random() * 2) | 0); } // 2-4 short
      else               { kind = 'allium';   h = 4 + ((Math.random() * 3) | 0); } // 4-7 tall globe
      const pl = createPlant(x, z, kind, h);
      // Assign a stable color to this plant
      if (kind === 'flower')   pl.tint = pick(COL.flower);
      if (kind === 'mushroom') pl.tint = pick(COL.mushroomCap);
      if (kind === 'stalk')    { pl.tint = pick(COL.stalkBlue); pl.budColor = pick(COL.flower); }
      if (kind === 'fern')     pl.tint = pick(COL.fernLeaf);
      extendPlant(pl);
    } else {
      // everything full — just extend tallest one further
      const any = plants.filter(p => !p.crushed);
      if (any.length) {
        const p = pick(any);
        p.targetHeight = Math.min(p.targetHeight + 1, BOX_H - 2);
        extendPlant(p);
      }
    }
  }

  function extendPlant(plant) {
    const y = plant.heightVox;
    const yOffset = VOX / 2 + y * VOX;

    if (plant.kind === 'moss') {
      addPlantBlock(plant, yOffset, 'moss');
      if (plant.heightVox + 1 >= plant.targetHeight && Math.random() < 0.22) {
        addPlantBlock(plant, yOffset + VOX * 0.5, 'flower', pick(COL.flower));
      }
    } else if (plant.kind === 'fern') {
      addPlantBlock(plant, yOffset, 'fernStem');
      if (y >= 1) {
        const frond = addPlantBlock(plant, yOffset, 'fernFrond', plant.tint);
        frond.rotation.y = rand(0, Math.PI);
        frond.position.y = yOffset + (Math.random() - 0.5) * 0.1;
      }
      if (plant.heightVox + 1 >= plant.targetHeight) {
        for (let i = 0; i < 2; i++) {
          const f = addPlantBlock(plant, yOffset + VOX * 0.3, 'fernFrond', plant.tint);
          f.rotation.y = (Math.PI / 2) * i + rand(-0.3, 0.3);
        }
      }
    } else if (plant.kind === 'flower') {
      // Green stem with a colorful cross-petal bloom at top
      addPlantBlock(plant, yOffset, 'fernStem');
      // tiny leaf partway up
      if (y === 1 || y === 2) {
        const leaf = addPlantBlock(plant, yOffset, 'fernFrond', 0x5fbe6a);
        leaf.scale.set(0.6, 1, 0.6);
        leaf.rotation.y = rand(0, Math.PI);
      }
      if (plant.heightVox + 1 >= plant.targetHeight) {
        // bloom head: center bud + 2 petals crossed
        addPlantBlock(plant, yOffset + VOX * 0.35, 'flower', plant.tint);
        const p1 = addPlantBlock(plant, yOffset + VOX * 0.35, 'flowerPetal', plant.tint);
        const p2 = addPlantBlock(plant, yOffset + VOX * 0.35, 'flowerPetal', plant.tint);
        p2.rotation.y = Math.PI / 2;
      }
    } else if (plant.kind === 'mushroom') {
      // Single squat mushroom: stem + cap + white dots
      addPlantBlock(plant, yOffset - VOX * 0.05, 'mushroomStem');
      const cap = addPlantBlock(plant, yOffset + VOX * 0.35, 'mushroomCap', plant.tint);
      // dots on top of cap
      for (let i = 0; i < 3; i++) {
        const d = addPlantBlock(plant, yOffset + VOX * 0.55, 'mushroomDot');
        d.position.x = rand(-0.3, 0.3);
        d.position.z = rand(-0.3, 0.3);
      }
      plant.heightVox = plant.targetHeight; // finish in one burst
      if (onGrowthCb) onGrowthCb(plant);
      return;
    } else if (plant.kind === 'stalk') {
      // Tall colored stalk with a glowing bud at top
      addPlantBlock(plant, yOffset, 'stalk', plant.tint);
      if (y % 2 === 1 && y >= 1) {
        const leaf = addPlantBlock(plant, yOffset, 'fernFrond', plant.tint);
        leaf.scale.set(0.7, 0.8, 0.7);
        leaf.rotation.y = rand(0, Math.PI);
      }
      if (plant.heightVox + 1 >= plant.targetHeight) {
        addPlantBlock(plant, yOffset + VOX * 0.55, 'stalkBud', plant.budColor);
      }
    } else if (plant.kind === 'daisy') {
      // Short stem, then white petals + yellow centre bloom at top
      addPlantBlock(plant, yOffset, 'daisyStem');
      if (plant.heightVox + 1 >= plant.targetHeight) {
        // Centre bud
        addPlantBlock(plant, yOffset + VOX * 0.55, 'daisyCentre');
        // 4 petals in a cross, rotated 45° each pair
        for (let i = 0; i < 4; i++) {
          const p = addPlantBlock(plant, yOffset + VOX * 0.55, 'daisyPetal');
          p.rotation.y = (Math.PI / 4) * i;
          p.position.y = yOffset + VOX * 0.54;
        }
      }
    } else if (plant.kind === 'allium') {
      // Tall thin stem topped with a sphere of tiny purple florets
      addPlantBlock(plant, yOffset, 'alliumStem');
      if (plant.heightVox + 1 >= plant.targetHeight) {
        // Sphere cluster of florets at tip — 3 layers
        const offsets = [
          [0, 0], [0.28, 0], [-0.28, 0], [0, 0.28], [0, -0.28],
          [0.2, 0.2], [-0.2, 0.2], [0.2, -0.2], [-0.2, -0.2],
          [0.14, 0], [-0.14, 0], [0, 0.14], [0, -0.14],
        ];
        offsets.forEach(([ox, oz]) => {
          const oy = Math.sqrt(Math.max(0, 0.3 * 0.3 - ox * ox - oz * oz));
          const f = addPlantBlock(plant, yOffset + VOX * 0.7 + oy, 'alliumFloret', pick(COL.allium.floret));
          f.position.x += ox;
          f.position.z += oz;
        });
      }
    }
    plant.heightVox++;

    if (onGrowthCb) onGrowthCb(plant);
  }

  let onGrowthCb = null;
  function setOnGrowth(fn) { onGrowthCb = fn; }

  // --- Rocks: drop from above with gravity, squish plants they hit ---
  function dropRock(nearGridX) {
    const gridX = typeof nearGridX === 'number'
      ? clamp(nearGridX, 0, BOX_W - 1)
      : (Math.random() * BOX_W) | 0;
    const gridZ = (Math.random() * BOX_D) | 0;

    const sizes = [
      [VOX * 0.9, VOX * 0.75, VOX * 0.9],
      [VOX * 1.1, VOX * 0.9, VOX * 1.0],
      [VOX * 0.75, VOX * 0.65, VOX * 0.85],
    ];
    const [w, h, d] = pick(sizes);
    const mat = new THREE.MeshStandardMaterial({
      color: pick(COL.rock),
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const wx = -BOX_W / 2 + VOX / 2 + gridX + rand(-0.1, 0.1);
    const wz = -BOX_D / 2 + VOX / 2 + gridZ + rand(-0.1, 0.1);
    mesh.position.set(wx, BOX_H / 2 - 0.5, wz);
    mesh.rotation.set(rand(-0.3, 0.3), rand(0, Math.PI), rand(-0.3, 0.3));
    rocksGroup.add(mesh);

    const rock = {
      mesh,
      vy: -0.02,
      vx: rand(-0.015, 0.015),
      vz: rand(-0.01, 0.01),
      rotV: new THREE.Vector3(rand(-0.05, 0.05), rand(-0.05, 0.05), rand(-0.05, 0.05)),
      landed: false,
      landY: -BOX_H / 2 + VOX + h / 2 + rand(0, 0.1),
      gridX, gridZ,
      settleTimer: 0,
    };
    rocks.push(rock);
    return rock;
  }

  function crushPlantsAt(gridX, gridZ) {
    // Crush the plant at exact cell and neighbors with splat
    const victims = plants.filter(p => !p.crushed &&
      Math.abs(p.gridX - gridX) <= 0 &&
      Math.abs(p.gridZ - gridZ) <= 0 &&
      p.heightVox > 0);
    victims.forEach(v => crushPlant(v));
  }

  function crushPlant(plant) {
    plant.crushed = true;
    // animate blocks squishing and falling apart
    plant.blocks.forEach((b, i) => {
      const m = b.mesh;
      crushAnims.push({
        mesh: m, group: plant.group,
        vy: rand(-0.02, 0.02),
        vx: rand(-0.03, 0.03),
        vz: rand(-0.03, 0.03),
        rotV: new THREE.Vector3(rand(-0.1, 0.1), rand(-0.1, 0.1), rand(-0.1, 0.1)),
        life: 0, maxLife: 1.4,
      });
    });
    // remove from plants after a bit so new plant can grow here
    setTimeout(() => {
      plantsGroup.remove(plant.group);
      const idx = plants.indexOf(plant);
      if (idx >= 0) plants.splice(idx, 1);
    }, 1400);
  }

  // --- Fireflies: glowing pointlights that wander ---
  function spawnFirefly(n) {
    n = n || 1;
    for (let i = 0; i < n; i++) {
      if (fireflies.length > 18) return; // cap
      const coreGeo = new THREE.SphereGeometry(0.08, 8, 8);
      const coreMat = new THREE.MeshBasicMaterial({ color: COL.fireflyCore });
      const core = new THREE.Mesh(coreGeo, coreMat);

      // glow halo (additive sprite)
      const spriteMat = new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color: COL.fireflyGlow,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const halo = new THREE.Sprite(spriteMat);
      halo.scale.set(0.9, 0.9, 0.9);
      core.add(halo);

      const light = new THREE.PointLight(0xffd880, 0.6, 3.0, 2);
      core.add(light);

      core.position.set(
        rand(-BOX_W / 2 + 0.5, BOX_W / 2 - 0.5),
        rand(-BOX_H / 2 + 2, BOX_H / 2 - 1),
        rand(-BOX_D / 2 + 0.3, BOX_D / 2 - 0.3)
      );
      firefliesGroup.add(core);
      fireflies.push({
        mesh: core, halo, light,
        phase: Math.random() * Math.PI * 2,
        speed: rand(0.4, 0.8),
        target: core.position.clone(),
        retargetIn: 0,
        flickerPhase: Math.random() * Math.PI * 2,
      });
    }
  }

  let _glowTex = null;
  function makeGlowTexture() {
    if (_glowTex) return _glowTex;
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, 'rgba(255,240,180,1)');
    grd.addColorStop(0.3, 'rgba(255,220,140,0.6)');
    grd.addColorStop(1, 'rgba(255,210,120,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    _glowTex = new THREE.CanvasTexture(c);
    return _glowTex;
  }

  // --- set WPM, maintain firefly count proportional ---
  function setWPM(wpm) {
    currentWPM = wpm;
    let targetFlies = 0;
    if (wpm >= 40) targetFlies = 2;
    if (wpm >= 55) targetFlies = 5;
    if (wpm >= 70) targetFlies = 9;
    if (wpm >= 90) targetFlies = 14;
    if (wpm >= 110) targetFlies = 18;

    while (fireflies.length < targetFlies) spawnFirefly(1);
    // fade out excess
    while (fireflies.length > targetFlies) {
      const f = fireflies.pop();
      fadeAndRemoveFirefly(f);
    }
  }

  function fadeAndRemoveFirefly(f) {
    const start = performance.now();
    const initIntensity = f.light.intensity;
    const step = () => {
      const t = (performance.now() - start) / 600;
      if (t >= 1) { firefliesGroup.remove(f.mesh); return; }
      f.light.intensity = initIntensity * (1 - t);
      f.halo.material.opacity = 1 - t;
      requestAnimationFrame(step);
    };
    step();
  }

  // --- Reset: clear plants, rocks, flies ---
  function reset() {
    plants.forEach(p => plantsGroup.remove(p.group));
    plants.length = 0;
    rocks.forEach(r => rocksGroup.remove(r.mesh));
    rocks.length = 0;
    fireflies.forEach(f => firefliesGroup.remove(f.mesh));
    fireflies.length = 0;
    crushAnims.length = 0;
    currentWPM = 0;
  }

  function shake(amount) {
    camShake = Math.min(camShake + (amount || 0.35), 0.8);
  }

  // --- Animation loop ---
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.getElapsedTime();

    // Plant growth animation (scale in)
    plants.forEach(p => {
      p.blocks.forEach(b => {
        if (b.age < 1) {
          b.age = Math.min(1, b.age + dt * 4);
          const e = easeOutBack(b.age);
          b.mesh.scale.set(
            b.origScale.x * e,
            b.origScale.y * e,
            b.origScale.z * e
          );
        }
      });
      // sway top blocks
      const sway = Math.sin(t * 1.3 + p.swayPhase) * 0.015;
      p.group.rotation.z = sway;
    });

    // Rocks physics
    for (let i = rocks.length - 1; i >= 0; i--) {
      const r = rocks[i];
      if (!r.landed) {
        r.vy -= 0.025; // gravity (per-frame, feels punchy)
        r.mesh.position.x += r.vx;
        r.mesh.position.y += r.vy;
        r.mesh.position.z += r.vz;
        r.mesh.rotation.x += r.rotV.x;
        r.mesh.rotation.y += r.rotV.y;
        r.mesh.rotation.z += r.rotV.z;
        if (r.mesh.position.y <= r.landY) {
          r.mesh.position.y = r.landY;
          r.landed = true;
          r.vy = 0;
          // crush plants at this grid cell
          crushPlantsAt(r.gridX, r.gridZ);
          shake(0.5);
          if (onRockLandCb) onRockLandCb(r);
        }
      } else {
        // settle: slow rot decay
        r.mesh.rotation.x += r.rotV.x * 0.05;
        r.mesh.rotation.y += r.rotV.y * 0.05;
        r.rotV.multiplyScalar(0.92);
        r.settleTimer += dt;
      }
    }

    // Crush debris
    for (let i = crushAnims.length - 1; i >= 0; i--) {
      const c = crushAnims[i];
      c.life += dt;
      c.vy -= 0.03 * dt * 60;
      c.mesh.position.x += c.vx;
      c.mesh.position.y += c.vy;
      c.mesh.position.z += c.vz;
      c.mesh.rotation.x += c.rotV.x;
      c.mesh.rotation.z += c.rotV.z;
      // compress scale down
      const s = 1 - c.life / c.maxLife;
      c.mesh.scale.multiplyScalar(0.96);
      if (c.life > c.maxLife) {
        crushAnims.splice(i, 1);
      }
    }

    // Fireflies: wander with retargeting
    fireflies.forEach(f => {
      f.retargetIn -= dt;
      if (f.retargetIn <= 0) {
        f.target.set(
          rand(-BOX_W / 2 + 0.7, BOX_W / 2 - 0.7),
          rand(-BOX_H / 2 + 2, BOX_H / 2 - 0.8),
          rand(-BOX_D / 2 + 0.4, BOX_D / 2 - 0.4)
        );
        f.retargetIn = rand(1.8, 3.5);
      }
      const p = f.mesh.position;
      p.x += (f.target.x - p.x) * 0.015 * f.speed;
      p.y += (f.target.y - p.y) * 0.015 * f.speed;
      p.z += (f.target.z - p.z) * 0.015 * f.speed;

      // flicker
      const flick = 0.6 + 0.4 * (Math.sin(t * 6 + f.flickerPhase) * 0.5 + 0.5);
      f.light.intensity = 0.55 * flick;
      f.halo.material.opacity = 0.85 * flick;
      f.halo.scale.setScalar(0.85 + 0.18 * flick);
    });

    // Dust specks
    particles.forEach(pt => {
      pt.mesh.position.y = pt.base.y + Math.sin(t * pt.speed + pt.phase) * 0.15;
      pt.mesh.position.x = pt.base.x + Math.cos(t * pt.speed * 0.5 + pt.phase) * 0.08;
    });

    // Camera shake
    if (camShake > 0) {
      camera.position.x = rand(-camShake, camShake) * 0.15;
      camera.position.y = 4.5 + rand(-camShake, camShake) * 0.1;
      camShake *= 0.85;
      if (camShake < 0.01) {
        camShake = 0;
        camera.position.set(0, 4.5, 26);
      }
    }

    // (camera breathe removed — caused subpixel aliasing on front voxels)

    renderer.render(scene, camera);
  }

  let onRockLandCb = null;
  function setOnRockLand(fn) { onRockLandCb = fn; }

  function easeOutBack(x) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }

  // --- Query state for results summary ---
  function snapshot() {
    return {
      plantCount: plants.filter(p => !p.crushed).length,
      rockCount: rocks.length,
      fireflyCount: fireflies.length,
      totalHeight: plants.filter(p => !p.crushed).reduce((s, p) => s + p.heightVox, 0),
    };
  }

  window.Terrarium = {
    init, growPlant, dropRock, spawnFirefly, setWPM, reset, shake,
    setOnGrowth, setOnRockLand, snapshot,
  };
})();
