    import * as THREE from "three";
    import { OrbitControls } from "three/addons/controls/OrbitControls.js";
    import { moveCamera } from './cameraControls.js'
    import { getTopViewQuaternion, printToConsole } from './cameraControls.js'

    // -----------------------------
    // Scene setup
    // -----------------------------
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe9efef);

    // const camera = new THREE.PerspectiveCamera(
    //   45,
    //   window.innerWidth / window.innerHeight,
    //   0.01,
    //   1000
    // );
    // camera.position.set(0, 0, 1);

    const camera = new THREE.OrthographicCamera();
    // const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 1);
    camera.zoom = .225
    scene.add( camera );

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);

    // const ambient = new THREE.AmbientLight(0xffffff, 0.15);
    // scene.add(ambient);

    const dir1 = new THREE.DirectionalLight(0xffffff, .15);
    dir1.position.set(2, 3, 2);
    scene.add(dir1);

    const dir2 = new THREE.DirectionalLight(0xffffff, 0.15);
    dir2.position.set(-2, 2, -1);
    scene.add(dir2);

    const point = new THREE.PointLight( 0x9db7ca, 1, 1000 );
    point.position.set( 0, 0, -2 );
    point.castShadow = true
    scene.add( point );

    const point2 = new THREE.PointLight( 0xffffff, 1, 1000 );
    point2.position.set( 0, 0, -2 );
    point2.castShadow = true
    scene.add( point2 );

    // -----------------------------
    // CSV loading + grid rebuild
    // Expects rows: x,y,Q
    // -----------------------------
    async function loadQFieldCSV(path) {
      const text = await fetch(path).then(r => {
        if (!r.ok) throw new Error(`Failed to fetch ${path}`);
        return r.text();
      });

      const lines = text
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

      const rows = [];
      for (const line of lines) {
        const parts = line.split(",").map(s => s.trim());
        if (parts.length < 3) continue;

        const x = Number(parts[0]);
        const y = Number(parts[1]);
        const q = Number(parts[2]);

        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        rows.push([x, y, Number.isFinite(q) ? q : NaN]);
      }

      if (rows.length === 0) {
        throw new Error("CSV appears empty or malformed.");
      }

      const xVals = rows.map(r => r[0]);
      const yVals = rows.map(r => r[1]);

      const x1d = [...new Set(xVals)].sort((a, b) => a - b);
      const y1d = [...new Set(yVals)].sort((a, b) => a - b);

      const nx = x1d.length;
      const ny = y1d.length;

      const xIndex = new Map(x1d.map((v, i) => [v, i]));
      const yIndex = new Map(y1d.map((v, i) => [v, i]));

      const Q = Array.from({ length: ny }, () => Array(nx).fill(NaN));

      for (const [x, y, q] of rows) {
        const i = xIndex.get(x);
        const j = yIndex.get(y);
        Q[j][i] = q;
      }

      return { x1d, y1d, Q };
    }

    // -----------------------------
    // Crop away full-NaN border rows/cols
    // -----------------------------
    function cropNaNBorder(x1d, y1d, Q) {
      const ny = Q.length;
      const nx = Q[0].length;

      const rowAllNaN = Q.map(row => row.every(v => Number.isNaN(v)));
      const colAllNaN = Array.from({ length: nx }, (_, i) =>
        Q.every(row => Number.isNaN(row[i]))
      );

      let top = 0;
      while (top < ny && rowAllNaN[top]) top++;

      let bottom = ny - 1;
      while (bottom >= 0 && rowAllNaN[bottom]) bottom--;

      let left = 0;
      while (left < nx && colAllNaN[left]) left++;

      let right = nx - 1;
      while (right >= 0 && colAllNaN[right]) right--;

      if (top > bottom || left > right) {
        throw new Error("After cropping NaN border, no valid data remains.");
      }

      const xC = x1d.slice(left, right + 1);
      const yC = y1d.slice(top, bottom + 1);
      const QC = Q.slice(top, bottom + 1).map(row => row.slice(left, right + 1));

      return { x1d: xC, y1d: yC, Q: QC };
    }

    // -----------------------------
    // Simple colormap
    // -----------------------------
    function lerp(a, b, t) {
      return a + (b - a) * t;
    }

    function colorMap(t) {
      t = Math.max(0, Math.min(1, t));

      // light blue -> steel -> dark charcoal
      const stops = [
        // { t: 0.00, c: [0.169, 0.325, 0.416] },
        { t: 0.00, c: [0.047, 0.109, 0.207] },
        { t: 1.00, c: [0.082, 0.145, 0.259] }
        // { t: 1.00, c: [0.047, 0.149, 0.263] }
      ];

      let a = stops[0];
      let b = stops[stops.length - 1];
      for (let k = 0; k < stops.length - 1; k++) {
        if (t >= stops[k].t && t <= stops[k + 1].t) {
          a = stops[k];
          b = stops[k + 1];
          break;
        }
      }

      const u = (t - a.t) / (b.t - a.t || 1);
      return new THREE.Color(
        lerp(a.c[0], b.c[0], u),
        lerp(a.c[1], b.c[1], u),
        lerp(a.c[2], b.c[2], u)
      );
    }

    // -----------------------------
    // Build surface mesh
    // -----------------------------
    function buildSurfaceMesh(x1d, y1d, Q, zScale = 1.0) {
      const nx = x1d.length;
      const ny = y1d.length;

      const width = x1d[nx - 1] - x1d[0];
      const height = y1d[ny - 1] - y1d[0];

      const geom = new THREE.PlaneGeometry(width, height, nx - 1, ny - 1);

      // Put plane in XY with Z up
      geom.rotateX(-Math.PI / 2);

      const pos = geom.attributes.position;
      const colors = new Float32Array(pos.count * 3);

      let qMin = Infinity;
      let qMax = -Infinity;

      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const q = Q[j][i];
          if (Number.isFinite(q)) {
            if (q < qMin) qMin = q;
            if (q > qMax) qMax = q;
          }
        }
      }

      if (!Number.isFinite(qMin) || !Number.isFinite(qMax)) {
        throw new Error("No finite Q values found.");
      }

      const qRange = (qMax - qMin) || 1.0;

      // PlaneGeometry vertex order is row-major from top row to bottom row.
      // We map carefully so y increases upward in world coordinates.
      let idx = 0;
      for (let row = 0; row < ny; row++) {
        const j = ny - 1 - row; // flip to match geometry layout
        for (let i = 0; i < nx; i++) {
          let q = Q[j][i];
          if (!Number.isFinite(q)) q = qMin;

          const z = zScale * q;
          pos.setY(idx, z);

          const t = (q - qMin) / qRange;
          const c = colorMap(t);
          colors[3 * idx + 0] = c.r;
          colors[3 * idx + 1] = c.g;
          colors[3 * idx + 2] = c.b;

          idx++;
        }
      }

      geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      pos.needsUpdate = true;
      geom.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        roughness: 0.85,
        metalness: 0.0
      });

      const mesh = new THREE.Mesh(geom, mat);

      // Center the mesh in x,y according to actual grid midpoint
      const xMid = 0.5 * (x1d[0] + x1d[nx - 1]);
      const yMid = 0.5 * (y1d[0] + y1d[ny - 1]);
      mesh.position.set(xMid, 0, yMid);

      return { mesh, qMin, qMax };
    }

    // -----------------------------
    // Optional axes helper
    // -----------------------------
    function addAxes(size = 1) {
      const axes = new THREE.AxesHelper(size);
      scene.add(axes);
    }


    // -----------------------------
    // Debug Mode GUI
    // -----------------------------
    const camButton = document.getElementById('cameraValues')
    camButton.addEventListener('click', () => {
        printToConsole(camera)
    })

    const topViewButton = document.getElementById('topViewBtn')
    topViewButton.addEventListener('click', () => {
        moveCamera(camera, getTopViewQuaternion(point.position),point.position.clone().add(new THREE.Vector3(0, 2, 0)))
    })

    const pointIntensity1 = document.getElementById('pointIntensity1')
    pointIntensity1.addEventListener('input', () => {
        point.intensity = pointIntensity1.value
    })

    const pointIntensity2 = document.getElementById('pointIntensity2')
    pointIntensity2.addEventListener('input', () => {
        point2.intensity = pointIntensity2.value
    })

    const point1Color = document.getElementById('point1Color')
    const point2Color = document.getElementById('point2Color')

    point1Color.addEventListener('input', () => {
        point.color.set(point1Color.value)
    })

    point2Color.addEventListener('input', () => {
        point2.color.set(point2Color.value)
    })

    const directionalIntensity1 = document.getElementById('directionalIntensity1')
    directionalIntensity1.addEventListener("input", () => {
        dir1.intensity = directionalIntensity1.value
    })
    
    const directionalIntensity2 = document.getElementById('directionalIntensity2')
    directionalIntensity2.addEventListener("input", () => {
        dir2.intensity = directionalIntensity2.value
    })

    const directionalColor1 = document.getElementById('directionalColor1')
    directionalColor1.addEventListener('input', () => {
        dir1.color.set(directionalColor1.value)
    })

    const directionalColor2 = document.getElementById('directionalColor2')
    directionalColor2.addEventListener('input', () => {
        dir2.color.set(directionalColor2.value)
    })
    



    // -----------------------------
    // Main
    // -----------------------------
    let surfaceMesh = null;

    async function main() {
      try {
        let { x1d, y1d, Q } = await loadQFieldCSV("./data/Q.csv");
        ({ x1d, y1d, Q } = cropNaNBorder(x1d, y1d, Q));

        // Adjust this if your z range is too dramatic
        const zScale = 1.0;

        const { mesh, qMin, qMax } = buildSurfaceMesh(x1d, y1d, Q, zScale);
        surfaceMesh = mesh;
        scene.add(surfaceMesh);

        const xSpan = x1d[x1d.length - 1] - x1d[0];
        const ySpan = y1d[y1d.length - 1] - y1d[0];
        const span = Math.max(xSpan, ySpan);

        // addAxes(0.35 * span);

        camera.position.set(0.9 * span, 0.9 * span, 0.9 * span);
        controls.target.set(
          0.5 * (x1d[0] + x1d[x1d.length - 1]),
          0,
          0.5 * (y1d[0] + y1d[y1d.length - 1])
        );
        controls.update();

      } catch (err) {
        console.error(err);
      }
    }

    main();

    // -----------------------------
    // Render loop
    // -----------------------------
    function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // -----------------------------
    // Resize
    // -----------------------------
    window.addEventListener("resize", () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });