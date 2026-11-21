"use strict";

const SWORD_ANIMS = ["idle", "run", "jump", "attack", "skill", "hurt", "death"];
const PET_ANIMS = ["idle", "walk", "attack"];
const ENEMY_ANIMS = ["idle", "walk", "attack", "hurt", "death"];

const DUR = {
  idle: 1.6,
  run: 0.7,
  walk: 0.8,
  jump: 0.8,
  attack: 0.35,
  skill: 0.8,
  hurt: 0.35,
  death: 0.9,
};
const CLAMP = new Set(["jump"]);

const ANIM_FALLBACK = {
  run: ["walk"],
  walk: ["run"],
  jump: ["idle"],
  skill: ["attack"],
  attack: ["idle"],
  hurt: ["idle"],
  death: ["hurt", "idle"],
};

const SWORD_HEIGHT = 170;

const PET_HEIGHT = 80;
let GROUND_Y = 450;
const GRAVITY = 2000;

const EXT = /\.(png|webp|gif|jpe?g)$/i;
const SKIP_DIRS = /^(\.git|node_modules|godot)$/i;

const CRAWL_ROOTS = ["assets", "backgraund", "background"];

const BG_NAMES = [
  "00-sky.png",
  "01-sun.png",
  "02-mountains.png",
  "03-mountains.png",
  "04-hills.png",
  "05-ground.png",
];
const BG_PREFIXES = [
  "backgraund/mountain-range-sunset/layers",
  "assets/backgraund/mountain-range-sunset/layers",
  "background/mountain-range-sunset/layers",
  "assets/background/mountain-range-sunset/layers",

  "mountain-range-sunset/layers",
  "layers",
];
const BG_FLAT_PATHS = [
  "backgraund/mountain-range-sunset/mountain-range-sunset-flat.png",
  "assets/backgraund/mountain-range-sunset/mountain-range-sunset-flat.png",
  "background/mountain-range-sunset/mountain-range-sunset-flat.png",
  "assets/background/mountain-range-sunset/mountain-range-sunset-flat.png",
];

const BG_SPEEDS_6 = [0, 0.02, 0.1, 0.22, 0.45, 1];

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;
const W = canvas.width,
  H = canvas.height;

const keys = {};
let showReport = false;

let bgMode = "layers";

addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k))
    e.preventDefault();
  if (!e.repeat) {
    if (k === "r" || (k === "enter" && state !== "play")) restart();
    if (k === "h") showReport = !showReport;
    if (k === "c") letterbox = !letterbox;

    if (k === "g") showGuide = !showGuide;
    if (k === "m") toggleMusic();
    if (k === "b" && bgLayers.length && bgFlat)
      bgMode = bgMode === "layers" ? "flat" : "layers";
  }
  keys[k] = true;
  if (k === "[") {
    GROUND_Y -= 2;
    saveGround();
  }
  if (k === "]") {
    GROUND_Y += 2;
    saveGround();
  }
});

addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});
addEventListener("blur", () => {
  for (const k in keys) keys[k] = false;
});

const report = [];
const problems = [];
const urlMap = Object.create(null);

const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const mod = (a, b) => ((a % b) + b) % b;
const median = (arr) => {
  const s = arr.slice().sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

function loadImage(path) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = urlMap[path] || encodeURI(path);
  });
}
async function fetchJSON(path) {
  try {
    const r = await fetch(urlMap[path] || encodeURI(path));
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function listDir(path) {
  if (location.protocol === "file:") return null;
  try {
    const clean = path.replace(/\/+$/, "");
    const dirUrl = new URL(encodeURI(clean) + "/", document.baseURI);
    const r = await fetch(dirUrl.href);
    if (!r.ok) return null;
    if (!(r.headers.get("content-type") || "").includes("html")) return null;
    const html = await r.text();
    const abs = decodeURIComponent(dirUrl.pathname);
    const out = [];
    const re = /href\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html))) {
      let h = m[1];
      if (
        h.startsWith("?") ||
        h.startsWith("#") ||
        h.startsWith("..") ||
        /^[a-z]+:/i.test(h)
      )
        continue;
      try {
        h = decodeURIComponent(h);
      } catch {}
      if (h.startsWith("/")) {
        if (!h.startsWith(abs)) continue;
        h = h.slice(abs.length);
      }
      h = h.replace(/^\.\//, "");
      if (!h) continue;
      if (h.split("/").filter(Boolean).length !== 1) continue;
      out.push(h);
    }
    return out;
  } catch {
    return null;
  }
}
async function crawl(dir, depth, out) {
  if (depth > 8) return true;
  const list = await listDir(dir);
  if (!list) return false;
  await Promise.all(
    list.map(async (e) => {
      const name = e.replace(/\/$/, "");
      if (SKIP_DIRS.test(name)) return;
      const p = `${dir}/${name}`;
      if (e.endsWith("/")) {
        await crawl(p, depth + 1, out);
      } else if (/\.[a-z0-9]+$/i.test(name)) {
        out.push(p);
      } else {
        const isDir = await crawl(p, depth + 1, out);
        if (!isDir) out.push(p);
      }
    }),
  );
  return true;
}
function findFrameSize(root) {
  let found = null;
  const ok = (v) => typeof v === "number" && v >= 16 && v <= 1024;
  const KEY = /^(frame_?size|cell_?size|canvas_?size|tile_?size|size)$/i;
  (function rec(x) {
    if (found || !x || typeof x !== "object") return;
    if (ok(x.frame_width) && ok(x.frame_height)) {
      found = { fw: x.frame_width, fh: x.frame_height };
      return;
    }
    for (const k in x) {
      const v = x[k];
      if (KEY.test(k)) {
        if (ok(v)) {
          found = { fw: v, fh: v };
          return;
        }
        if (v && ok(v.width) && ok(v.height)) {
          found = { fw: v.width, fh: v.height };
          return;
        }
        if (Array.isArray(v) && ok(v[0]) && ok(v[1])) {
          found = { fw: v[0], fh: v[1] };
          return;
        }
      }
    }
    for (const k in x) rec(x[k]);
  })(root);
  return found;
}
function manifestPaths(root, base) {
  const out = [];
  (function rec(x) {
    if (typeof x === "string") {
      if (EXT.test(x)) {
        const clean = x.replace(/^\.?\//, "");
        out.push(clean.startsWith(base) ? clean : `${base}/${clean}`);
      }
    } else if (x && typeof x === "object") for (const k in x) rec(x[k]);
  })(root);
  return out;
}
function analyze(img) {
  const w = img.width,
    h = img.height;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  let data;
  try {
    data = g.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }
  const colCount = new Uint32Array(w),
    rowCount = new Uint32Array(h);
  const sat = new Uint32Array((w + 1) * (h + 1));
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3] > 8 ? 1 : 0;
      if (a) {
        colCount[x]++;
        rowCount[y]++;
        total++;
      }
      sat[(y + 1) * (w + 1) + x + 1] =
        a +
        sat[y * (w + 1) + x + 1] +
        sat[(y + 1) * (w + 1) + x] -
        sat[y * (w + 1) + x];
    }
  }
  return { w, h, data, colCount, rowCount, sat, total };
}

function cellPixels(info, x0, y0, cw, ch) {
  const W1 = info.w + 1,
    s = info.sat;
  return (
    s[(y0 + ch) * W1 + x0 + cw] -
    s[y0 * W1 + x0 + cw] -
    s[(y0 + ch) * W1 + x0] +
    s[y0 * W1 + x0]
  );
}

function detectGrid(info, hint) {
  const { w, h, colCount, rowCount, total } = info;
  if (!total) return { cols: 1, rows: 1, how: "empty" };

  if (hint && w % hint.fw === 0 && h % hint.fh === 0) {
    return { cols: w / hint.fw, rows: h / hint.fh, how: "json" };
  }

  const cands = [];
  for (let cols = 1; cols <= 64; cols++) {
    if (w % cols) continue;
    const cw = w / cols;
    if (cw < 32) continue;
    for (let rows = 1; rows <= 32; rows++) {
      if (h % rows) continue;
      const ch = h / rows;
      if (ch < 32) continue;
      const aspect = cw / ch;
      if (aspect < 0.5 || aspect > 2) continue;

      let cut = 0;
      for (let k = 1; k < cols; k++) {
        const x = k * cw;
        if (colCount[x - 1] > 0 && colCount[x] > 0)
          cut += Math.min(colCount[x - 1], colCount[x]);
      }
      for (let k = 1; k < rows; k++) {
        const y = k * ch;
        if (rowCount[y - 1] > 0 && rowCount[y] > 0)
          cut += Math.min(rowCount[y - 1], rowCount[y]);
      }
      let seenEmpty = false,
        ok = true,
        nonEmpty = 0;
      for (let r = 0; r < rows && ok; r++)
        for (let c = 0; c < cols; c++) {
          const has = cellPixels(info, c * cw, r * ch, cw, ch) >= 8;
          if (has) {
            if (seenEmpty) {
              ok = false;
              break;
            }
            nonEmpty++;
          } else seenEmpty = true;
        }
      if (!ok || nonEmpty < 1) continue;
      cands.push({
        cols,
        rows,
        cut: cut / total,
        nonEmpty,
        aspect,
        how: "auto",
      });
    }
  }
  if (!cands.length) return { cols: 1, rows: 1, how: "single" };

  for (const limit of [0.0005, 0.004]) {
    let tight = cands.filter((c) => c.cut <= limit);
    if (!tight.length) continue;
    const square = tight.filter((c) => c.aspect >= 0.85 && c.aspect <= 1.18);
    if (square.length) tight = square;
    return tight.reduce((a, b) => (b.nonEmpty > a.nonEmpty ? b : a));
  }
  cands.sort((a, b) => a.cut - b.cut || a.nonEmpty - b.nonEmpty);
  return cands[0];
}

function cellsFromImage(img, forceSingle, hint) {
  const info = analyze(img);
  const w = img.width,
    h = img.height;
  if (!info) {
    let cols = 1;
    if (!forceSingle && w >= h * 2 && w % h === 0) cols = w / h;
    const cw = w / cols;
    return {
      cells: Array.from({ length: cols }, (_, i) => ({
        img,
        sx: i * cw,
        sy: 0,
        sw: cw,
        sh: h,
        top: 0,
        bottom: h - 1,
        count: 1,
        flip: false,
      })),
      note: `${cols}x1 (no pixel access)`,
    };
  }
  const grid = forceSingle
    ? { cols: 1, rows: 1, how: "file" }
    : detectGrid(info, hint);
  const cw = w / grid.cols,
    ch = h / grid.rows;
  let cells = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const x0 = c * cw,
        y0 = r * ch;
      let top = ch,
        bottom = -1,
        count = 0;
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          if (info.data[((y0 + y) * w + x0 + x) * 4 + 3] > 8) {
            count++;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
          }
        }
      }
      if (count < 8) continue;
      cells.push({
        img,
        sx: x0,
        sy: y0,
        sw: cw,
        sh: ch,
        top,
        bottom,
        count,
        flip: false,
      });
    }
  }
  if (cells.length > 2) {
    const med = median(cells.map((c) => c.count));
    cells = cells.filter((c) => c.count >= med * 0.12);
  }
  return { cells, note: `${grid.cols}x${grid.rows} ${grid.how}` };
}

function cellsFromAtlas(img, exported) {
  const info = analyze(img);
  if (!info || !Array.isArray(exported.frames) || !exported.frames.length)
    return null;
  const cells = [];
  for (const frame of exported.frames) {
    const r = frame.rect;
    if (
      !r ||
      ![r.x, r.y, r.width, r.height].every(Number.isInteger) ||
      r.x < 0 ||
      r.y < 0 ||
      r.width <= 0 ||
      r.height <= 0 ||
      r.x + r.width > info.w ||
      r.y + r.height > info.h
    )
      return null;
    let top = r.height,
      bottom = -1,
      count = 0;
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        if (info.data[((r.y + y) * info.w + r.x + x) * 4 + 3] > 8) {
          count++;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    if (count >= 8) {
      cells.push({
        img,
        sx: r.x,
        sy: r.y,
        sw: r.width,
        sh: r.height,
        top,
        bottom,
        count,
        flip: false,
      });
    }
  }
  return cells.length ? cells : null;
}

function makeFinder(files, packTest) {
  const lastName = (p) => p.split("/").pop();
  const cand = files.filter((p) => {
    const lower = p.toLowerCase();
    const n = lastName(p);
    const imageLike = EXT.test(n) || !/\.[a-z0-9]+$/i.test(n);
    return (
      imageLike &&
      packTest(lower) &&
      !/\/godot\//.test(lower) &&
      !/(license|readme)/i.test(n)
    );
  });
  const stemOf = (p) =>
    lastName(p)
      .replace(/\.[^.]+$/, "")
      .toLowerCase();
  const parentOf = (p) => {
    const s = p.toLowerCase().split("/");
    return s[s.length - 2] || "";
  };
  const grandOf = (p) => {
    const s = p.toLowerCase().split("/");
    return s[s.length - 3] || "";
  };
  const pngFirst = (list) =>
    list
      .slice()
      .sort(
        (a, b) => /\.png$/i.test(b) - /\.png$/i.test(a) || naturalSort(a, b),
      );

  function find(name) {
    const [action, dir] = name.split("_");
    let r = cand.filter((p) => parentOf(p) === name);
    if (r.length) return r.sort(naturalSort);
    r = cand.filter((p) => stemOf(p) === name);
    if (r.length) return [pngFirst(r)[0]];
    r = cand.filter((p) => parentOf(p) === dir && grandOf(p) === action);
    if (r.length) return r.sort(naturalSort);
    r = cand.filter((p) => stemOf(p) === dir && parentOf(p) === action);
    if (r.length) return [pngFirst(r)[0]];
    r = cand.filter(
      (p) => stemOf(p).startsWith(name) || parentOf(p).startsWith(name),
    );
    if (r.length) return r.sort(naturalSort);
    return [];
  }
  return find;
}

async function guessFrames(base, name) {
  const aBase = `${base}/animations`;
  for (const ext of ["png", "gif", "webp", ""]) {
    const s = await loadImage(
      ext ? `${aBase}/${name}.${ext}` : `${aBase}/${name}`,
    );
    if (s) return [s];
  }
  const pad = (n, l) => String(n).padStart(l, "0");
  const patterns = [
    (n) => `frame_${pad(n, 3)}.png`,
    (n) => `frame_${pad(n, 2)}.png`,
    (n) => `frame_${n}.png`,
    (n) => `${pad(n, 3)}.png`,
    (n) => `${pad(n, 2)}.png`,
    (n) => `${n}.png`,
  ];
  for (const p of patterns)
    for (const start of [0, 1]) {
      const first = await loadImage(`${aBase}/${name}/${p(start)}`);
      if (!first) continue;
      const imgs = [first];
      for (let i = start + 1; i < 300; i++) {
        const im = await loadImage(`${aBase}/${name}/${p(i)}`);
        if (!im) break;
        imgs.push(im);
      }
      return imgs;
    }
  return [];
}

async function loadCharacter(
  label,
  files,
  packTest,
  base,
  anims,
  targetHeight,
) {
  const manifest = await fetchJSON(`${base}/character.json`);
  const hint = manifest ? findFrameSize(manifest) : null;
  let all = files;
  if (manifest)
    all = Array.from(new Set(files.concat(manifestPaths(manifest, base))));
  const find = makeFinder(all, packTest);

  const out = {};
  const notes = {};
  const durations = {};
  await Promise.all(
    anims.flatMap((a) =>
      ["east", "west"].map(async (d) => {
        const name = `${a}_${d}`;
        const exported = await fetchJSON(
          `${base}/animations/${name}/export.json`,
        );
        let imgs = [];
        if (all.length) {
          const paths = find(name);
          imgs = (await Promise.all(paths.map(loadImage))).filter(Boolean);
        }
        if (!imgs.length) imgs = await guessFrames(base, name);
        if (!imgs.length) {
          out[name] = [];
          return;
        }
        if (imgs.length === 1) {
          const atlasCells = exported
            ? cellsFromAtlas(imgs[0], exported)
            : null;
          if (atlasCells) {
            out[name] = atlasCells;
            notes[name] = "metadata";
            const duration = exported.total_duration_ms / 1000;
            if (Number.isFinite(duration) && duration > 0)
              durations[a] = duration;
          } else {
            const r = cellsFromImage(imgs[0], false, hint);
            out[name] = r.cells;
            notes[name] = r.note;
          }
        } else {
          out[name] = imgs.flatMap(
            (im) => cellsFromImage(im, true, null).cells,
          );
          notes[name] = `${imgs.length} files`;
        }
      }),
    ),
  );

  for (const a of anims) {
    const e = `${a}_east`,
      w = `${a}_west`;
    if (!out[w].length && out[e].length) {
      out[w] = out[e].map((f) => ({ ...f, flip: !f.flip }));
      notes[w] = "mirrored";
    }
    if (!out[e].length && out[w].length) {
      out[e] = out[w].map((f) => ({ ...f, flip: !f.flip }));
      notes[e] = "mirrored";
    }
  }

  for (const key of Object.keys(out)) {
    const fr = out[key];
    if (!fr.length) continue;
    const pad = median(fr.map((f) => f.sh - 1 - f.bottom));
    for (const f of fr)
      f.pad = key.startsWith("jump") ? f.sh - 1 - f.bottom : pad;
  }

  for (const a of anims) {
    const f = out[`${a}_east`];
    if (f.length)
      report.push(
        `OK  ${label} ${a}: ${f.length}f ${f[0].sw}x${f[0].sh} [${notes[`${a}_east`]}]`,
      );
    else {
      report.push(`MISSING ${label} ${a}`);
      problems.push(`${label} ${a}`);
    }
  }

  const ref = out.idle_east.length
    ? out.idle_east
    : Object.values(out).find((v) => v.length) || [];
  const meta = { pad: 0, scale: 1 };
  if (ref.length) {
    const bodyH = median(ref.map((f) => f.bottom - f.top + 1));
    meta.pad = median(ref.map((f) => f.sh - 1 - f.bottom));
    meta.scale = Math.min(8, Math.max(0.25, targetHeight / Math.max(1, bodyH)));
  }
  return { anims: out, meta, durations };
}

let bgLayers = [];
let bgFlat = null;
let bgCustom = null;
let showGuide = false;
let letterbox = false;

async function loadBackground(files) {
  bgCustom = null;
  const customPaths = [
    "backgraund/Sunset Ruins Battlefield.png",
    "assets/backgraund/Sunset Ruins Battlefield.png",
    "background/Sunset Ruins Battlefield.png",
    "assets/background/Sunset Ruins Battlefield.png",
    "Sunset Ruins Battlefield.png",
    ...files.filter((p) => /sunset ruins/i.test(p) && EXT.test(p)),
  ];
  for (const cp of customPaths) {
    const im = await loadImage(cp);
    if (im) {
      bgCustom = im;
      report.push(`OK  background: ${cp} (${im.width}x${im.height})`);
      detectCustomGround();
      return;
    }
  }
  report.push(
    "custom background not found: put 'Sunset Ruins Battlefield.png' in the backgraund folder",
  );

  let paths = files
    .filter(
      (p) =>
        EXT.test(p) &&
        /\/layers\//i.test(p) &&
        /background|sunset|mountain/i.test(p),
    )
    .sort(naturalSort);

  if (!paths.length) {
    for (const prefix of BG_PREFIXES) {
      if (await loadImage(`${prefix}/${BG_NAMES[0]}`)) {
        paths = BG_NAMES.map((n) => `${prefix}/${n}`);
        break;
      }
    }
  }
  const loadedAll = await Promise.all(
    paths.map(async (p) => ({ p, img: await loadImage(p) })),
  );
  const loaded = loadedAll.filter((x) => x.img);
  const n = loaded.length;
  bgLayers = loaded.map((x, i) => ({
    img: x.img,
    speed: n === 6 ? BG_SPEEDS_6[i] : n < 2 ? 0.3 : i / (n - 1),
  }));
  const failed = loadedAll
    .filter((x) => !x.img)
    .map((x) => x.p.split("/").pop());

  bgFlat = null;
  const flatPaths = BG_FLAT_PATHS.concat(
    files.filter(
      (p) =>
        /flat/i.test(p) && EXT.test(p) && /background|sunset|mountain/i.test(p),
    ),
  );
  for (const fp of flatPaths) {
    const flat = await loadImage(fp);
    if (flat) {
      bgFlat = flat;
      break;
    }
  }

  if (bgLayers.length >= 3) {
    bgMode = "layers";
    report.push(
      `OK  background: ${bgLayers.length} layers` +
        (bgFlat ? " (+flat, B toggles)" : ""),
    );
    if (failed.length) report.push(`    not loaded: ${failed.join(", ")}`);
    detectGround();
  } else if (bgFlat) {
    bgMode = "flat";
    report.push(
      `OK  background: flat image (only ${bgLayers.length} layers loaded)`,
    );
  } else if (bgLayers.length) {
    bgMode = "layers";
    report.push(`WARN background: only ${bgLayers.length} layer(s) loaded`);
    problems.push("background layers");
  } else {
    let why = "";
    try {
      const u = new URL(
        encodeURI(`${BG_PREFIXES[0]}/${BG_NAMES[0]}`),
        document.baseURI,
      );
      const r = await fetch(u.href);
      why = `HTTP ${r.status} for ${u.pathname}`;
    } catch (e) {
      why = "fetch failed: " + e.message;
    }
    report.push("MISSING background images -> using built-in sunset");
    report.push("  " + why);
    problems.push("background");
  }
}

function ridge(cam, speed, base, amp, color, seed) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) {
    const wx = x + cam * speed;
    const y =
      base -
      Math.abs(Math.sin(wx * 0.004 + seed)) * amp -
      Math.sin(wx * 0.011 + seed * 2.3) * amp * 0.25;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
}

function drawProceduralBackground(cam) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#3b2a5a");
  g.addColorStop(0.55, "#c9654a");
  g.addColorStop(0.8, "#f0a05a");
  g.addColorStop(1, "#5a3a2a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffd9a0";
  ctx.beginPath();
  ctx.arc(W * 0.72, GROUND_Y - 150, 46, 0, Math.PI * 2);
  ctx.fill();
  ridge(cam, 0.1, GROUND_Y - 40, 150, "#6a3f6b", 1.0);
  ridge(cam, 0.22, GROUND_Y - 15, 110, "#4a2c55", 2.7);
  ridge(cam, 0.45, GROUND_Y + 5, 60, "#2e1c3a", 4.1);
  ctx.fillStyle = "#24162e";
  ctx.fillRect(0, GROUND_Y + 2, W, H - GROUND_Y);
}

function detectGround() {
  const L = bgLayers[bgLayers.length - 1];
  if (!L) return;
  const info = analyze(L.img);
  if (!info || !info.total) return;
  const tops = [];
  const step = Math.max(1, Math.floor(info.w / 48));
  for (let x = 0; x < info.w; x += step) {
    for (let y = 0; y < info.h; y++) {
      if (info.data[(y * info.w + x) * 4 + 3] > 40) {
        tops.push(y);
        break;
      }
    }
  }
  if (tops.length < 12) return;
  const topCanvas = median(tops) * (H / info.h);
  if (topCanvas < H * 0.3 || topCanvas > H - 40) return;
  GROUND_Y = Math.round(topCanvas + (H - topCanvas) * 0.35);
}

function tileLayer(img, scroll, mirror) {
  const w = Math.max(1, Math.round(img.width * (H / img.height)));
  const s = Math.round(scroll);
  const t0 = Math.floor(s / w);
  const off = -(s - t0 * w);
  for (let t = t0, x = off; x < W; t++, x += w) {
    if (mirror && mod(t, 2) === 1) {
      ctx.save();
      ctx.translate(x + w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, w + 1, H);
      ctx.restore();
    } else {
      ctx.drawImage(img, x, 0, w + 1, H);
    }
  }
}

const embers = Array.from({ length: 70 }, () => ({
  x: Math.random() * 1400,
  y: Math.random() * 700,
  vx: 8 + Math.random() * 26,
  vy: 10 + Math.random() * 34,
  s: 1 + Math.random() * 2.2,
  f: 1 + Math.random() * 3,
  p: Math.random() * 6.28,
  par: 0.25 + Math.random() * 0.9,
  h: Math.floor(Math.random() * 90),
}));

function drawCinematicBackground(cam) {
  tileLayer(bgCustom, cam, true);
}

function detectCustomGround() {
  try {
    if (localStorage.getItem("groundY")) {
      GROUND_Y = parseFloat(localStorage.getItem("groundY"));
      return;
    }
  } catch {}
  const info = analyze(bgCustom);
  if (!info) return;
  const { w, h, data } = info;
  const lum = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * 4;
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    lum[y] = sum / Math.ceil(w / 4);
  }
  let best = -1,
    bestEdge = 0;
  for (let y = Math.floor(h * 0.55); y < Math.floor(h * 0.95); y++) {
    const e = Math.abs(lum[y] - lum[y - 3]);
    if (e > bestEdge) {
      bestEdge = e;
      best = y;
    }
  }
  if (best < 0) return;
  const top = best * (H / h);
  GROUND_Y = Math.round(top + (H - top) * 0.25);
}

function saveGround() {
  try {
    localStorage.setItem("groundY", String(GROUND_Y));
  } catch {}
}

function drawCinematicOverlay(cam) {
  if (!bgCustom) return;
  const t = performance.now() / 1000;
  for (const e of embers) {
    const x = mod(e.x - t * e.vx - cam * e.par, W + 60) - 30;
    const y = mod(e.y - t * e.vy, H + 60) - 30;
    const a = 0.25 + 0.55 * Math.max(0, Math.sin(t * e.f + e.p));
    ctx.fillStyle = `rgba(255,${150 + e.h},70,${a})`;
    ctx.fillRect(Math.round(x), Math.round(y), e.s, e.s);
  }
  const v = ctx.createRadialGradient(
    W / 2,
    H / 2,
    H * 0.35,
    W / 2,
    H / 2,
    W * 0.65,
  );
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(10,0,20,0.55)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  if (letterbox) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, 26);
    ctx.fillRect(0, H - 26, W, 26);
  }
}

function drawBackground(cam) {
  if (bgCustom) {
    drawCinematicBackground(cam);
    return;
  }
  if (bgMode === "flat" && bgFlat) {
    tileLayer(bgFlat, cam * 0.3, true);
    return;
  }
  if (!bgLayers.length) {
    drawProceduralBackground(cam);
    return;
  }
  for (const L of bgLayers) tileLayer(L.img, cam * L.speed, false);
}

let lightningFx = null;
const effects = [];
let flash = 0;

async function loadEffect(name) {
  const base = `assets/effects/effects-${name}`;
  const img = await loadImage(`${base}.png`);
  if (!img) return null;
  const meta = await fetchJSON(`${base}.json`);
  const num = (v) => typeof v === "number" && isFinite(v);
  const asRect = (o) => {
    const r = o && (o.frame || o.rect || o);
    if (!r) return null;
    const w = r.w ?? r.width,
      h = r.h ?? r.height;
    return num(r.x) && num(r.y) && num(w) && num(h)
      ? { x: r.x, y: r.y, w, h }
      : null;
  };
  let rects = [];
  if (meta && meta.frames && typeof meta.frames === "object") {
    const fr = meta.frames;
    const list = Array.isArray(fr)
      ? fr
      : Object.keys(fr)
          .sort(naturalSort)
          .map((k) => fr[k]);
    rects = list.map(asRect).filter(Boolean);
  }
  if (!rects.length && meta) {
    const size = findFrameSize(meta);
    const fw = size ? size.fw : meta.frameWidth || meta.tileWidth;
    const fh = size ? size.fh : meta.frameHeight || meta.tileHeight;
    if (num(fw) && num(fh) && fw > 0 && fh > 0) {
      const cols = Math.floor(img.width / fw),
        rows = Math.floor(img.height / fh);
      const count =
        [meta.frames, meta.frameCount, meta.frame_count, meta.count].find(
          (v) => num(v) && v > 0,
        ) || cols * rows;
      for (let i = 0; i < Math.min(count, cols * rows); i++) {
        rects.push({
          x: (i % cols) * fw,
          y: Math.floor(i / cols) * fh,
          w: fw,
          h: fh,
        });
      }
    }
  }
  if (!rects.length) {
    rects = cellsFromImage(img, false, null).cells.map((c) => ({
      x: c.sx,
      y: c.sy,
      w: c.sw,
      h: c.sh,
    }));
  }
  if (!rects.length) return null;
  return { img, rects, dur: Math.max(0.4, Math.min(0.9, rects.length / 24)) };
}

function addEffect(x) {
  effects.push({
    x,
    y: GROUND_Y + 4,
    t: 0,
    h: 300,
    seed: Math.random() * 1000,
  });
}

function drawEffect(e, cam) {
  const sx = Math.round(e.x - cam);
  const dur = lightningFx ? lightningFx.dur : 0.45;
  if (lightningFx) {
    const n = lightningFx.rects.length;
    const r = lightningFx.rects[Math.min(n - 1, Math.floor((e.t / dur) * n))];
    const s = e.h / r.h;
    ctx.drawImage(
      lightningFx.img,
      r.x,
      r.y,
      r.w,
      r.h,
      Math.round(sx - (r.w * s) / 2),
      Math.round(e.y - r.h * s),
      Math.round(r.w * s),
      Math.round(r.h * s),
    );
    return;
  }
  const k = Math.floor(e.t * 30);
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - e.t / dur);
  ctx.beginPath();
  ctx.moveTo(sx, 0);
  for (let y = 30; y < e.y; y += 30)
    ctx.lineTo(sx + Math.sin((y + k * 13) * 12.9898 + e.seed) * 16, y);
  ctx.lineTo(sx, e.y);
  ctx.strokeStyle = "#8fd0ff";
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/*  AUDIO: background music + sound effects (all from sound_effects/)  */
/* ------------------------------------------------------------------ */

const SOUND_DIR = "sound_effects/";
const SOUND_FILES = {
  sword: "swordsound.mp3",
  mushroom: "mushrom attack.mp3",
  goblin: "goblin_attack.mp3",
  golemAttack: "large-monster-attack.mp3",
  golemSpawn: "large_monester_apper.mp3",
  gameOver: "gameover.mp3",
  victory: "vectory.mp3",
};
const SOUND_VOLUME = {
  sword: 0.7,
  mushroom: 0.7,
  goblin: 0.7,
  golemAttack: 0.9,
  golemSpawn: 1.0,
  gameOver: 0.9,
  victory: 0.9,
};
const MUSIC_VOLUME = 0.35;
const MUSIC_VOLUME_DUCKED = 0.1;
const SOUND_MIN_GAP = 70;

const soundBank = {};
const soundLastPlayed = {};
const endSounds = [];

if (typeof Audio !== "undefined") {
  for (const name of Object.keys(SOUND_FILES)) {
    try {
      const a = new Audio(encodeURI(SOUND_DIR + SOUND_FILES[name]));
      a.preload = "auto";
      soundBank[name] = a;
    } catch {}
  }
}

function playSound(name, rate = 1) {
  const base = soundBank[name];
  if (!base) return null;
  const now = performance.now();
  if (now - (soundLastPlayed[name] || 0) < SOUND_MIN_GAP) return null;
  soundLastPlayed[name] = now;
  try {
    const a = base.cloneNode();
    a.volume = SOUND_VOLUME[name] ?? 0.8;
    a.playbackRate = rate;
    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
    return a;
  } catch {
    return null;
  }
}

function playEndSound(name) {
  const a = playSound(name);
  if (a) endSounds.push(a);
}
function stopEndSounds() {
  for (const a of endSounds) {
    try {
      a.pause();
      a.currentTime = 0;
    } catch {}
  }
  endSounds.length = 0;
}
function duckMusic(on) {
  if (music) music.volume = on ? MUSIC_VOLUME_DUCKED : MUSIC_VOLUME;
}

const MUSIC_PATHS = [
  SOUND_DIR + "backgroundmusic.mp3",
  "assets/lumine wave - Beyond the Blue.mp3",
  "lumine wave - Beyond the Blue.mp3",
];
let music = null,
  musicOn = true,
  musicTry = 0,
  musicFailed = false;

function playMusic() {
  if (music && musicOn) music.play().catch(() => {});
}
function startMusic() {
  if (music || musicFailed || typeof Audio === "undefined") return;
  music = new Audio();
  music.loop = true;
  music.volume = state === "play" ? MUSIC_VOLUME : MUSIC_VOLUME_DUCKED;
  music.addEventListener("error", () => {
    musicTry++;
    if (musicTry < MUSIC_PATHS.length) {
      music.src = encodeURI(MUSIC_PATHS[musicTry]);
      playMusic();
    } else {
      musicFailed = true;
      music = null;
      report.push("music file not found");
    }
  });
  music.src = encodeURI(MUSIC_PATHS[0]);
  playMusic();
}
function toggleMusic() {
  musicOn = !musicOn;
  if (!music) startMusic();
  else if (musicOn) playMusic();
  else music.pause();
}
addEventListener("keydown", startMusic);
addEventListener("pointerdown", startMusic);

class Actor {
  constructor(x, char) {
    this.x = x;
    this.y = GROUND_Y;
    this.vx = 0;
    this.vy = 0;
    this.facing = "east";
    this.anims = char.anims;
    this.meta = char.meta;
    this.durations = char.durations;
    this.anim = "idle";
    this.time = 0;
    this.once = false;
    this.done = false;
    this.onGround = true;
    this.alpha = 1;
    this.rise = 1;
    this.speedMul = 1;
  }
  get locked() {
    return this.once && !this.done;
  }
  dur() {
    return (this.durations[this.anim] || DUR[this.anim] || 1) * this.speedMul;
  }

  play(name, once = false) {
    if (this.anim === name) {
      if (!once) return;
      if (!this.done) return;
    }
    this.anim = name;
    this.once = once;
    this.done = false;
    this.time = 0;
  }
  force(name) {
    this.anim = name;
    this.once = true;
    this.done = false;
    this.time = 0;
  }

  frames() {
    const chain = [this.anim, ...(ANIM_FALLBACK[this.anim] || []), "idle"];
    for (const a of chain) {
      const f = this.anims[`${a}_${this.facing}`];
      if (f && f.length) return f;
    }
    return [];
  }

  tick(dt) {
    this.time += dt;
    if (this.once && this.time >= this.dur()) this.done = true;
  }

  currentFrame() {
    const f = this.frames();
    if (!f.length) return null;
    const p = this.time / this.dur();
    let i;
    if (this.once || CLAMP.has(this.anim))
      i = Math.min(f.length - 1, Math.floor(p * f.length));
    else i = Math.floor(mod(p, 1) * f.length);
    return f[Math.max(0, i)];
  }

  draw(cam, color) {
    const sx = this.x - cam;
    if (sx < -400 || sx > W + 400) return;
    const item = this.currentFrame();
    ctx.save();
    ctx.globalAlpha = this.alpha;
    if (!item) {
      ctx.fillStyle = color;
      ctx.fillRect(sx - 20, this.y - 60, 40, 60);
      ctx.restore();
      return;
    }
    const s = this.meta.scale;
    const w = item.sw * s,
      h = item.sh * s;
    let oy = 0;
    if (this.rise < 1) {
      ctx.beginPath();
      ctx.rect(sx - 400, -2000, 800, this.y + 2 + 2000);
      ctx.clip();
      oy = (1 - this.rise) * h * 0.9;
    }
    const padPx = item.pad !== undefined ? item.pad : this.meta.pad;
    ctx.translate(Math.round(sx), Math.round(this.y + padPx * s + oy));
    if (item.flip) ctx.scale(-1, 1);
    ctx.drawImage(
      item.img,
      item.sx,
      item.sy,
      item.sw,
      item.sh,
      Math.round(-w / 2),
      Math.round(-h),
      Math.round(w),
      Math.round(h),
    );
    ctx.restore();
  }
}

const particles = [];
const floaters = [];
let shake = 0;

function burst(x, y, n, col, spread = 160, up = 220) {
  for (let i = 0; i < n; i++) {
    particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * spread,
      vy: -Math.random() * up,
      life: 0.35 + Math.random() * 0.35,
      col,
      s: 2 + Math.random() * 3,
    });
  }
}
function floater(x, y, text, col = "#fff") {
  floaters.push({ x, y, text, col, t: 0 });
}

const PLAYER_HP = 100;
const SKILL_CD = 3.0;
const ENEMY_TYPES = {
  mushroom: {
    hp: 30,
    speed: 70,
    dmg: 8,
    range: 58,
    cd: 1.4,
    mul: 1.2,
    height: 90,
    half: 26,
    score: 10,
    name: "Mushroom",
  },
  goblin: {
    hp: 50,
    speed: 115,
    dmg: 12,
    range: 68,
    cd: 1.0,
    mul: 1.0,
    height: 120,
    half: 28,
    score: 20,
    name: "Goblin",
  },
  golem: {
    hp: 180,
    speed: 55,
    dmg: 26,
    range: 105,
    cd: 1.8,
    mul: 1.8,
    height: 230,
    half: 60,
    score: 100,
    name: "Golem",
  },
};
const WAVES = [
  { name: "Mushrooms", list: ["mushroom", "mushroom", "mushroom"] },
  { name: "Goblins", list: ["goblin", "goblin", "goblin"] },
  { name: "The Golem", list: ["golem"] },
];

class Player extends Actor {
  constructor(char) {
    super(0, char);
    this.moveSpeed = 280;
    this.air = 0;
    this.attacked = false;
    this.hp = PLAYER_HP;
    this.maxHp = PLAYER_HP;
    this.inv = 0;
    this.skillCd = 0;
    this.hitDone = true;
    this.dead = false;
  }

  hurt(dmg, dir) {
    if (this.dead || this.inv > 0) return;
    this.hp = Math.max(0, this.hp - dmg);
    this.inv = 0.9;
    this.vx = dir * 240;
    floater(this.x, this.y - 150, "-" + dmg, "#ff6b5a");
    burst(this.x, this.y - 70, 10, "#ff5544");
    shake = Math.max(shake, 0.25);
    if (this.hp <= 0) {
      this.dead = true;
      this.force("death");
    } else this.force("hurt");
  }

  lightning() {
    const dir = this.facing === "east" ? 1 : -1;
    const targets = enemies
      .filter((e) => e.alive() && Math.abs(e.x - this.x) < 360)
      .sort((a, b) => Math.abs(a.x - this.x) - Math.abs(b.x - this.x))
      .slice(0, 4);
    for (const e of targets) {
      e.hurt(35, e.x > this.x ? 1 : -1, 220);
      addEffect(e.x);
    }
    if (!targets.length) addEffect(this.x + dir * 170);
    flash = 0.22;
    shake = Math.max(shake, 0.15);
  }

  strike(kind) {
    if (kind === "skill") {
      this.lightning();
      return;
    }
    const reach = kind === "skill" ? 150 : 95;
    const dmg = kind === "skill" ? 40 : 18;
    const dir = this.facing === "east" ? 1 : -1;
    for (const e of enemies) {
      if (!e.alive()) continue;
      const dx = (e.x - this.x) * dir;
      if (dx > -25 && dx < reach + e.def.half)
        e.hurt(dmg, dir, kind === "skill" ? 220 : 110);
    }
    if (kind === "skill") shake = Math.max(shake, 0.12);
  }

  update(dt) {
    this.vy += GRAVITY * dt;
    this.y += this.vy * dt;
    if (this.y >= GROUND_Y) {
      this.y = GROUND_Y;
      this.vy = 0;
      this.onGround = true;
    } else this.onGround = false;

    this.attacked = false;
    this.inv = Math.max(0, this.inv - dt);
    this.skillCd = Math.max(0, this.skillCd - dt);
    this.alpha =
      this.inv > 0 && !this.dead && Math.floor(performance.now() / 60) % 2
        ? 0.45
        : 1;

    if (this.dead) {
      this.vx *= 0.9;
      this.x += this.vx * dt;
      this.tick(dt);
      return;
    }

    if (this.locked) {
      this.vx *= 0.85;
    } else {
      const L = keys["arrowleft"] || keys["a"];
      const R = keys["arrowright"] || keys["d"];
      this.vx = 0;
      if (L && !R) {
        this.vx = -this.moveSpeed;
        this.facing = "west";
      }
      if (R && !L) {
        this.vx = this.moveSpeed;
        this.facing = "east";
      }
      if ((keys["arrowup"] || keys["w"]) && this.onGround) {
        this.vy = -760;
        this.onGround = false;
        this.air = 0;
      }

      if (keys[" "] && this.onGround) {
        this.play("attack", true);
        this.attacked = true;
        this.hitDone = false;
      } else if (keys["x"] && this.onGround && this.skillCd <= 0) {
        this.play("skill", true);
        this.attacked = true;
        this.hitDone = false;
        this.skillCd = SKILL_CD;
      } else if (!this.onGround) this.play("jump");
      else if (this.vx !== 0) this.play("run");
      else this.play("idle");
    }

    this.x += this.vx * dt;
    if (this.anim === "jump")
      this.time =
        Math.max(0, Math.min(0.999, (this.vy + 760) / 1520)) * this.dur();
    else this.tick(dt);

    if (
      (this.anim === "attack" || this.anim === "skill") &&
      !this.hitDone &&
      this.time >= this.dur() * 0.15
    ) {
      this.hitDone = true;
      // sword swing sound (the lightning skill reuses it, deeper and slower)
      playSound("sword", this.anim === "skill" ? 0.7 : 1);
      this.strike(this.anim);
    }
    if (this.onGround && this.anim === "jump") this.play("idle");
  }
}

class Enemy extends Actor {
  constructor(type, x, char) {
    super(x, char);
    this.type = type;
    this.def = ENEMY_TYPES[type];
    this.hp = this.maxHp = this.def.hp;
    this.speedMul = this.def.mul;
    this.rise = 0;
    this.cd = 0.6 + Math.random() * 0.5;
    this.hitDone = true;
    this.dying = false;
    this.gone = false;
    this.removeIn = 0;
    this.facing = x < player.x ? "east" : "west";
  }
  alive() {
    return !this.dying && this.rise >= 1;
  }

  hurt(dmg, dir, kb) {
    if (this.dying || this.rise < 1) return;
    this.hp -= dmg;
    floater(this.x, this.y - this.def.height - 10, "-" + dmg, "#ffe27a");
    burst(this.x, this.y - this.def.height * 0.5, 8, "#ffe9a0");
    if (this.hp <= 0) {
      this.dying = true;
      this.vx = dir * 90;
      this.force("death");
      kills++;
      score += this.def.score;
      burst(this.x, this.y - this.def.height * 0.4, 18, "#ffb347", 260, 300);
      if (this.type === "golem") shake = Math.max(shake, 0.4);
    } else if (this.type !== "golem" || kb >= 200) {
      this.vx = dir * kb;
      this.force("hurt");
    }
  }

  tryHit() {
    const dx = this.x - player.x;
    if (
      !player.dead &&
      Math.abs(dx) < this.def.range + 22 &&
      player.y > GROUND_Y - 55
    ) {
      player.hurt(this.def.dmg, dx > 0 ? -1 : 1);
    }
    if (this.type === "golem") shake = Math.max(shake, 0.2);
  }

  update(dt) {
    if (this.dying) {
      this.x += this.vx * dt;
      this.vx *= 0.9;
      this.tick(dt);
      if (this.done) {
        this.removeIn += dt;
        if (this.removeIn > 0.6)
          this.alpha = Math.max(0, 1 - (this.removeIn - 0.6) / 0.6);
        if (this.removeIn > 1.2) this.gone = true;
      }
      return;
    }
    if (this.rise < 1) {
      this.rise = Math.min(1, this.rise + dt / 0.8);
      this.play("idle");
      this.tick(dt);

      return;
    }
    if (this.locked) {
      this.x += this.vx * dt;
      this.vx *= 0.85;
      this.tick(dt);

      if (
        this.anim === "attack" &&
        !this.hitDone &&
        this.time >= this.dur() * 0.5
      ) {
        this.hitDone = true;
        this.tryHit();
      }
      return;
    }
    this.cd -= dt;
    const dx = player.x - this.x;
    this.facing = dx > 0 ? "east" : "west";
    if (player.dead) {
      this.vx = 0;
      this.play("idle");
    } else if (Math.abs(dx) > this.def.range - 12) {
      this.vx = Math.sign(dx) * this.def.speed;
      this.play("walk");
    } else if (this.cd <= 0) {
      this.vx = 0;
      this.play("attack", true);
      // enemy attack sound: mushroom / goblin / golem each have their own
      playSound(this.type === "golem" ? "golemAttack" : this.type);
      this.hitDone = false;
      this.cd = this.def.cd;
    } else {
      this.vx = 0;
      this.play("idle");
    }
    this.x += this.vx * dt;
    this.tick(dt);
  }
}

class Pet extends Actor {
  constructor(x, char) {
    super(x, char);
    this.react = 0;
  }
  update(dt, player) {
    this.y = GROUND_Y;
    const behind = player.facing === "east" ? -1 : 1;
    const target = player.x + behind * 120;
    const dx = target - this.x;

    if (player.attacked) this.react = 0.15;
    if (this.react > 0) {
      this.react -= dt;
      if (this.react <= 0) {
        this.play("attack", true);
        let best = null,
          bd = 140;
        for (const e of enemies) {
          if (!e.alive()) continue;
          const d = Math.abs(e.x - this.x);
          if (d < bd) {
            bd = d;
            best = e;
          }
        }
        if (best) best.hurt(6, best.x > this.x ? 1 : -1, 40);
      }
    }

    if (this.locked) {
      this.vx = 0;
    } else {
      const dead = 14;
      if (Math.abs(dx) > dead) {
        this.vx = Math.sign(dx) * Math.min(340, Math.abs(dx) * 3.5);
        this.facing = dx > 0 ? "east" : "west";
        this.play("walk");
      } else {
        this.vx = 0;
        this.facing = player.facing;
        this.play("idle");
      }
    }
    this.x += this.vx * dt;
    this.tick(dt);
  }
}

let player = null,
  pet = null,
  swordChar = null,
  petChar = null,
  last = 0,
  started = false;
const enemyChars = {};
let enemies = [];
let state = "play";
let wave = 0,
  waveQueue = [],
  spawnTimer = 0,
  spawnSide = false;
let clearing = false,
  nextWaveT = 0,
  bannerText = "",
  bannerT = 0;
let kills = 0,
  score = 0,
  gameTime = 0,
  endT = 0,
  finalScore = 0;
let reportStart = 0;

function startWave(i) {
  wave = i;
  waveQueue = WAVES[i].list.slice();
  spawnTimer = 1.0;
  clearing = false;
  bannerText = `WAVE ${i + 1}/${WAVES.length}: ${WAVES[i].name}`;
  bannerT = 2.6;
}

function spawn(type) {
  spawnSide = !spawnSide;
  const x = player.x + (spawnSide ? 1 : -1) * (W / 2 - 70);
  enemies.push(new Enemy(type, x, enemyChars[type]));
  burst(x, GROUND_Y, 14, "#7a5a3a", 220, 160);
  if (type === "golem") {
    shake = Math.max(shake, 0.3);
    playSound("golemSpawn");
  }
}

function restart() {
  if (!swordChar || !petChar) return;
  stopEndSounds();
  duckMusic(false);
  player = new Player(swordChar);
  pet = new Pet(-120, petChar);
  enemies = [];
  effects.length = 0;
  flash = 0;
  particles.length = 0;
  floaters.length = 0;
  shake = 0;
  state = "play";
  kills = 0;
  score = 0;
  gameTime = 0;
  endT = 0;
  finalScore = 0;
  startWave(0);
}

function updateGame(dt) {
  player.update(dt);
  for (const e of enemies) e.update(dt);
  pet.update(dt, player);
  for (const f of effects) f.t += dt;
  for (let i = effects.length - 1; i >= 0; i--)
    if (effects[i].t > (lightningFx ? lightningFx.dur : 0.45))
      effects.splice(i, 1);
  flash = Math.max(0, flash - dt);

  for (let i = 0; i < enemies.length; i++)
    for (let j = i + 1; j < enemies.length; j++) {
      const a = enemies[i],
        b = enemies[j];
      if (a.dying || b.dying) continue;
      const min = (a.def.half + b.def.half) * 0.8,
        d = b.x - a.x;
      if (Math.abs(d) < min) {
        const push = (min - Math.abs(d)) * 0.5 * (d >= 0 ? 1 : -1);
        a.x -= push;
        b.x += push;
      }
    }
  enemies = enemies.filter((e) => !e.gone);

  for (const p of particles) {
    p.life -= dt;
    p.vy += 900 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  for (let i = particles.length - 1; i >= 0; i--)
    if (particles[i].life <= 0) particles.splice(i, 1);
  for (const f of floaters) {
    f.t += dt;
    f.y -= 40 * dt;
  }
  for (let i = floaters.length - 1; i >= 0; i--)
    if (floaters[i].t > 0.9) floaters.splice(i, 1);
  shake = Math.max(0, shake - dt);

  if (state === "play") {
    gameTime += dt;
    if (bannerT > 0) bannerT -= dt;
    if (player.dead && player.done) {
      state = "lose";
      endT = 0;
      duckMusic(true);
      playEndSound("gameOver");
      return;
    }

    if (waveQueue.length) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawn(waveQueue.shift());
        spawnTimer = 1.4;
      }
    } else if (!clearing && enemies.every((e) => e.dying)) {
      clearing = true;
      if (wave >= WAVES.length - 1) {
        state = "win";
        endT = 0;
        finalScore =
          score +
          Math.round(player.hp * 2) +
          Math.max(0, Math.round((120 - gameTime) * 2));
        duckMusic(true);
        playEndSound("victory");
      } else {
        nextWaveT = 2.4;
        player.hp = Math.min(player.maxHp, player.hp + 25);
        floater(player.x, player.y - 150, "+25 HP", "#7dff8a");
        bannerText = "WAVE CLEARED  +25 HP";
        bannerT = 2.4;
      }
    }
    if (clearing && state === "play") {
      nextWaveT -= dt;
      if (nextWaveT <= 0) startWave(wave + 1);
    }
  } else {
    endT += dt;
  }
}

function text(s, x, y, size = 14, col = "#fff", align = "left") {
  ctx.font = `${size}px Arial, sans-serif`;
  ctx.textAlign = align;
  ctx.fillStyle = col;
  ctx.fillText(s, x, y);
}
function bar(x, y, w, h, f, col) {
  ctx.fillStyle = "#222";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = col;
  ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, f))), h);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawHUD() {
  const p = player,
    top = letterbox ? 36 : 16;
  text("HP " + Math.ceil(p.hp), 16, top + 11);
  bar(64, top, 160, 12, p.hp / p.maxHp, "#d33");
  text(
    p.skillCd <= 0
      ? "Lightning (X): ready"
      : "Lightning (X): " + p.skillCd.toFixed(1) + "s",
    16,
    top + 34,
  );

  text(
    "Wave " + (wave + 1) + "/" + WAVES.length,
    W - 16,
    top + 11,
    14,
    "#fff",
    "right",
  );
  text("Kills " + kills, W - 16, top + 32, 14, "#fff", "right");

  const boss = enemies.find((e) => e.type === "golem" && !e.dying);
  if (boss) {
    text("Golem", W / 2, H - 52, 14, "#fff", "center");
    bar(W / 2 - 150, H - 46, 300, 10, boss.hp / boss.maxHp, "#d33");
  }
}

function drawEnemyBars(cam) {
  for (const e of enemies) {
    if (!e.alive() || e.type === "golem" || e.hp >= e.maxHp) continue;
    bar(
      Math.round(e.x - cam - 22),
      Math.round(e.y - e.def.height - 14),
      44,
      5,
      e.hp / e.maxHp,
      "#d33",
    );
  }
}

function drawBanner() {
  if (bannerT <= 0 || state !== "play") return;
  ctx.globalAlpha = Math.min(1, bannerT / 0.5);
  text(bannerText, W / 2, H * 0.3, 28, "#fff", "center");
  ctx.globalAlpha = 1;
}

function drawEnd() {
  if (state === "play") return;
  const a = Math.max(
    0,
    Math.min(1, (endT - (state === "win" ? 0.8 : 0.3)) / 0.5),
  );
  if (a <= 0) return;
  ctx.globalAlpha = a;
  ctx.fillStyle = "rgba(0,0,0,.7)";
  ctx.fillRect(0, 0, W, H);

  const m = Math.floor(gameTime / 60),
    s = String(Math.floor(gameTime % 60)).padStart(2, "0");
  text(
    state === "win" ? "You win" : "You died",
    W / 2,
    H * 0.4,
    40,
    "#fff",
    "center",
  );
  text(
    "Kills: " + kills + "    Time: " + m + ":" + s,
    W / 2,
    H * 0.4 + 40,
    18,
    "#ddd",
    "center",
  );
  if (state === "win")
    text("Score: " + finalScore, W / 2, H * 0.4 + 68, 18, "#ddd", "center");
  text("Press R to play again", W / 2, H * 0.4 + 106, 16, "#aaa", "center");
  ctx.globalAlpha = 1;
}

function drawReport(now) {
  if (!showReport) return;
  if (!problems.length && now > reportStart + 4000) return;
  const lines = (
    problems.length ? report : report.filter((l) => !l.startsWith("MISSING"))
  ).slice(0, 26);
  if (!lines.length) return;
  const lh = 15,
    boxW = 440,
    boxH = lines.length * lh + 14,
    top = 70;
  ctx.fillStyle = "rgba(0,0,0,.75)";

  ctx.fillRect(W - boxW - 10, top, boxW, boxH);

  ctx.font = "12px monospace";
  ctx.textAlign = "left";
  lines.forEach((l, i) => {
    ctx.fillStyle = l.startsWith("OK") ? "#8f8" : "#fa6";
    ctx.fillText(l.slice(0, 66), W - boxW - 2, top + 18 + i * lh);
  });
}
function loop(ts) {
  try {
    const dt = Math.min(0.033, (ts - last) / 1000 || 0);
    last = ts;
    updateGame(dt);
    const cam = player.x - W / 2;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shake > 0) {
      const m = shake * 24;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }
    drawBackground(cam);
    enemies
      .slice()
      .sort((a, b) => a.x - b.x)
      .forEach((e) => e.draw(cam, "#d94"));
    pet.draw(cam, "#4cd964");
    player.draw(cam, "#4aa3ff");
    for (const e of effects) drawEffect(e, cam);
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 3));
      ctx.fillStyle = p.col;
      ctx.fillRect(Math.round(p.x - cam), Math.round(p.y), p.s, p.s);
    }
    ctx.globalAlpha = 1;
    ctx.font = "bold 16px system-ui";
    ctx.textAlign = "center";
    for (const f of floaters) {
      ctx.globalAlpha = Math.max(0, 1 - f.t / 0.9);
      text(f.text, Math.round(f.x - cam), Math.round(f.y), 16, f.col, "center");
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 1.6})`;
      ctx.fillRect(0, 0, W, H);
    }

    drawCinematicOverlay(cam);
    if (showGuide) {
      ctx.fillStyle = "rgba(255,40,40,.8)";
      ctx.fillRect(0, Math.round(GROUND_Y), W, 1);
      ctx.font = "12px monospace";
      ctx.textAlign = "left";
      ctx.fillText(
        "feet line y=" + Math.round(GROUND_Y) + "   [ up   ] down",
        12,
        Math.round(GROUND_Y) - 4,
      );
    }
    drawEnemyBars(cam);
    drawHUD();
    drawBanner();

    drawEnd();
    drawReport(ts);
  } catch (err) {
    console.error(err);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#f66";
    ctx.font = "16px monospace";
    ctx.textAlign = "left";
    ctx.fillText("Error: " + err.message, 20, 40);
    return;
  }
  requestAnimationFrame(loop);
}

async function loadAll(files) {
  report.length = 0;
  problems.length = 0;
  report.push(`files found: ${files.length}`);

  await loadBackground(files);
  swordChar = await loadCharacter(
    "sword",
    files,
    (p) => p.includes("swordsman"),
    "assets/swordsman-character-pack/swordsman",
    SWORD_ANIMS,
    SWORD_HEIGHT,
  );
  petChar = await loadCharacter(
    "pet",
    files,
    (p) => p.includes("slime") && !p.includes("swordsman"),
    "assets/slime-character-pack/slime",
    PET_ANIMS,
    PET_HEIGHT,
  );
  for (const type of Object.keys(ENEMY_TYPES)) {
    enemyChars[type] = await loadCharacter(
      type,
      files,
      (p) => p.includes(type),
      `assets/${type}-character-pack/${type}`,
      ENEMY_ANIMS,
      ENEMY_TYPES[type].height,
    );
  }

  lightningFx = await loadEffect("lightning");
  report.push(
    lightningFx
      ? `OK  lightning effect: ${lightningFx.rects.length} frames`
      : "lightning sprite not found (drawing a simple bolt)",
  );

  console.log(report.join("\n"));
  reportStart = performance.now();
  restart();
  if (!started) {
    started = true;
    requestAnimationFrame(loop);
  }
}

(async function init() {
  try {
    ctx.fillStyle = "#14101c";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    ctx.font = "20px system-ui";
    ctx.textAlign = "left";
    ctx.fillText("Loading...", 20, 40);

    const files = [];
    for (const root of CRAWL_ROOTS) await crawl(root, 0, files);
    await loadAll(files);
  } catch (err) {
    console.error(err);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#f66";
    ctx.font = "16px monospace";
    ctx.fillText("Init error: " + err.message, 20, 40);
  }
})();
