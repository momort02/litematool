const ATLAS_W = 2048, ATLAS_H = 1520;
let atlasTexture = null;  // THREE.Texture loaded from atlas.png
let atlasMaterials = {};  // block_name -> THREE.MeshLambertMaterial

// jsDelivr CDN first (always works), local fallback for offline use
const ATLAS_URLS = [
  'https://cdn.jsdelivr.net/gh/EndingCredits/litematic-viewer@main/resource/atlas.png',
  'atlas.png'
];

// loadAtlas removed - replaced by loadAtlasImage

// Canvas used to extract tiles from atlas image
let atlasImg = null; // raw HTMLImageElement

function loadAtlasImage() {
  return new Promise((resolve) => {
    function tryUrl(i) {
      if (i >= ATLAS_URLS.length) {
        console.warn('All atlas URLs failed');
        resolve(false);
        return;
      }
      const url = ATLAS_URLS[i];
      console.log('Trying atlas:', url);
      fetch(url)
        .then(r => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.blob();
        })
        .then(blob => {
          const blobUrl = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            atlasImg = img;
            console.log('Atlas OK:', url, img.width + 'x' + img.height);
            resolve(true);
          };
          img.onerror = () => { tryUrl(i + 1); };
          img.src = blobUrl;
        })
        .catch(e => {
          console.warn('Atlas fetch failed:', url, e.message);
          tryUrl(i + 1);
        });
    }
    tryUrl(0);
  });
}

function loadAtlasFromFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => { atlasImg = img; resolve(true); };
      img.onerror = () => resolve(false);
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function makeTile(px, py) {
  if (!atlasImg) return null;
  try {
    // Use regular canvas for max browser/mobile compatibility
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const ctx = c.getContext('2d');
    ctx.drawImage(atlasImg, px, py, 16, 16, 0, 0, 16, 16);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    return t;
  } catch(e) {
    console.warn('makeTile failed:', e);
    return null;
  }
}

function getBlockMaterial(blockName, transparent, leaves) {
  const key = blockName + (transparent?'_t':'') + (leaves?'_l':'');
  if (atlasMaterials[key]) return atlasMaterials[key];

  const info = BLOCK_GEOMS[blockName] || ((BLOCK_GEOMS[blockName]?.uv) ? { g:'cube', uv: (BLOCK_GEOMS[blockName]?.uv) } : null);
  const uvCoords = info ? info.uv : null;
  let mat;

  const tex = (uvCoords && atlasImg) ? makeTile(uvCoords[0], uvCoords[1]) : null;
  if (tex) {
    mat = new THREE.MeshLambertMaterial({
      map: tex,
      transparent: transparent || leaves,
      opacity: transparent ? 0.75 : 1.0,
      alphaTest: leaves ? 0.1 : 0.0,
      side: (transparent || leaves) ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: !transparent,
    });
  } else {
    // Fallback: solid color (atlas not loaded or tile failed)
    const col = colorForBlock(blockName);
    mat = new THREE.MeshLambertMaterial({
      color: col !== null ? col : 0x888888,
      transparent: transparent,
      opacity: transparent ? 0.75 : 1.0,
      side: (transparent || leaves) ? THREE.DoubleSide : THREE.FrontSide,
    });
  }
  atlasMaterials[key] = mat;
  return mat;
}

// --- Geometry builders --------------------------------------------------------
const GEO_CACHE = {};
function getCachedGeo(key, factory) {
  if (!GEO_CACHE[key]) GEO_CACHE[key] = factory();
  return GEO_CACHE[key];
}

function buildBlockMesh(name, x, y, z, sx, sz) {
  const info = BLOCK_GEOMS[name] || { g: 'cube', uv: (BLOCK_GEOMS[name]?.uv) };
  const geom_type = info.g;
  const isTransparent = TRANSPARENT_SET.has(name);
  const isLeaves = LEAVES_SET.has(name);
  const mat = getBlockMaterial(name, isTransparent, isLeaves);
  const px = x - sx/2 + 0.5, py = y, pz = z - sz/2 + 0.5;

  switch(geom_type) {
    case 'slab':
    case 'slab_top': {
      const geo = getCachedGeo('slab', () => new THREE.BoxGeometry(1, 0.5, 1));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(px, py + (geom_type === 'slab_top' ? 0.75 : 0.25), pz);
      return mesh;
    }
    case 'stairs': {
      const g = new THREE.Group();
      const geoBottom = getCachedGeo('slab', () => new THREE.BoxGeometry(1, 0.5, 1));
      const geoTop = getCachedGeo('stair_top', () => new THREE.BoxGeometry(0.5, 0.5, 1));
      const mBottom = new THREE.Mesh(geoBottom, mat);
      mBottom.position.set(px, py + 0.25, pz);
      const mTop = new THREE.Mesh(geoTop, mat);
      mTop.position.set(px + 0.25, py + 0.75, pz);
      g.add(mBottom, mTop);
      return g;
    }
    case 'carpet':
    case 'snow_layer':
    case 'pressure_plate': {
      const h = geom_type === 'pressure_plate' ? 0.0625 : 0.0625;
      const geo = getCachedGeo(geom_type, () => new THREE.BoxGeometry(1, h, 1));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(px, py + h/2, pz);
      return mesh;
    }
    case 'fence': {
      const g = new THREE.Group();
      const post = getCachedGeo('fence_post', () => new THREE.BoxGeometry(0.25, 1, 0.25));
      const rail = getCachedGeo('fence_rail', () => new THREE.BoxGeometry(0.125, 0.1875, 0.75));
      const pm = new THREE.Mesh(post, mat);
      pm.position.set(px, py + 0.5, pz);
      const r1 = new THREE.Mesh(rail, mat);
      r1.position.set(px, py + 0.75, pz);
      r1.rotation.y = Math.PI/2;
      const r2 = new THREE.Mesh(rail, mat);
      r2.position.set(px, py + 0.375, pz);
      r2.rotation.y = Math.PI/2;
      g.add(pm, r1, r2);
      return g;
    }
    case 'fence_gate': {
      const g = new THREE.Group();
      const post1 = getCachedGeo('gate_post', () => new THREE.BoxGeometry(0.25, 1, 0.25));
      const bar = getCachedGeo('gate_bar', () => new THREE.BoxGeometry(0.25, 0.125, 0.5));
      const p1 = new THREE.Mesh(post1, mat); p1.position.set(px - 0.375, py + 0.5, pz);
      const p2 = new THREE.Mesh(post1, mat); p2.position.set(px + 0.375, py + 0.5, pz);
      const b1 = new THREE.Mesh(bar, mat); b1.position.set(px, py + 0.75, pz);
      const b2 = new THREE.Mesh(bar, mat); b2.position.set(px, py + 0.4375, pz);
      g.add(p1, p2, b1, b2);
      return g;
    }
    case 'wall': {
      const g = new THREE.Group();
      const post = getCachedGeo('wall_post', () => new THREE.BoxGeometry(0.5, 1, 0.5));
      const pm = new THREE.Mesh(post, mat);
      pm.position.set(px, py + 0.5, pz);
      g.add(pm);
      return g;
    }
    case 'door': {
      const geo = getCachedGeo('door', () => new THREE.BoxGeometry(0.875, 1, 0.1875));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(px, py + 0.5, pz);
      return mesh;
    }
    case 'trapdoor':
    case 'trapdoor_vertical': {
      if (geom_type === 'trapdoor_vertical') {
        const geo = getCachedGeo('trapdoor_v', () => new THREE.BoxGeometry(1, 1, 0.1875));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(px, py + 0.5, pz + 0.40625);
        return mesh;
      }
      const geo = getCachedGeo('trapdoor', () => new THREE.BoxGeometry(1, 0.1875, 1));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(px, py + 0.09375, pz);
      return mesh;
    }
    case 'pane': {
      const g = new THREE.Group();
      const thin = getCachedGeo('pane_thin', () => new THREE.BoxGeometry(0.125, 1, 0.125));
      const rail1 = getCachedGeo('pane_rail', () => new THREE.BoxGeometry(0.0625, 1, 1));
      const center = new THREE.Mesh(thin, mat);
      center.position.set(px, py + 0.5, pz);
      const rail = new THREE.Mesh(rail1, mat);
      rail.position.set(px, py + 0.5, pz);
      g.add(center, rail);
      return g;
    }
    case 'torch': {
      const g = new THREE.Group();
      const stick = getCachedGeo('torch_stick', () => new THREE.BoxGeometry(0.125, 0.625, 0.125));
      const head = getCachedGeo('torch_head', () => new THREE.BoxGeometry(0.25, 0.25, 0.25));
      const sm = new THREE.Mesh(stick, mat);
      sm.position.set(px, py + 0.3125, pz);
      const hm = new THREE.Mesh(head, mat);
      hm.position.set(px, py + 0.6875, pz);
      g.add(sm, hm);
      return g;
    }
    case 'cross': {
      // Two intersecting planes
      const g = new THREE.Group();
      const plane = getCachedGeo('cross_plane', () => new THREE.PlaneGeometry(0.85, 0.85));
      const m1 = new THREE.Mesh(plane, mat); m1.rotation.y = Math.PI/4;
      const m2 = new THREE.Mesh(plane, mat); m2.rotation.y = -Math.PI/4;
      m1.position.set(px, py + 0.5, pz);
      m2.position.set(px, py + 0.5, pz);
      g.add(m1, m2);
      return g;
    }
    case 'button': {
      const geo = getCachedGeo('button', () => new THREE.BoxGeometry(0.375, 0.25, 0.25));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(px, py + 0.125, pz + 0.5 - 0.0625);
      return mesh;
    }
    case 'flat_face': {
      const plane = getCachedGeo('flat_face', () => new THREE.PlaneGeometry(1, 1));
      const mesh = new THREE.Mesh(plane, mat);
      mesh.position.set(px, py + 0.5, pz - 0.4375);
      return mesh;
    }
    case 'chain': {
      const geo = getCachedGeo('chain', () => new THREE.BoxGeometry(0.125, 1, 0.125));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(px, py + 0.5, pz);
      return mesh;
    }
    case 'rail': {
      // Flat tile on ground
      const geo = getCachedGeo('rail', () => new THREE.PlaneGeometry(1, 1));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(px, py + 0.02, pz);
      return mesh;
    }
    case 'repeater': {
      // Flat slab-like component on ground
      const geo = getCachedGeo('repeater_geo', () => new THREE.BoxGeometry(1, 0.125, 1));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(px, py + 0.0625, pz);
      return mesh;
    }
    case 'rod': {
      // Lightning rod / tripwire hook - thin vertical rod
      const geo = getCachedGeo('rod', () => new THREE.BoxGeometry(0.125, 1, 0.125));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(px, py + 0.5, pz);
      return mesh;
    }
    case 'hopper': {
      const g = new THREE.Group();
      // Top box
      const top = getCachedGeo('hopper_top', () => new THREE.BoxGeometry(1, 0.625, 1));
      const mt = new THREE.Mesh(top, mat);
      mt.position.set(px, py + 0.6875, pz);
      // Funnel bottom
      const bot = getCachedGeo('hopper_bot', () => new THREE.BoxGeometry(0.375, 0.375, 0.375));
      const mb = new THREE.Mesh(bot, mat);
      mb.position.set(px, py + 0.1875, pz);
      g.add(mt, mb);
      return g;
    }
    case 'piston': {
      const g = new THREE.Group();
      const body = getCachedGeo('piston_body', () => new THREE.BoxGeometry(1, 0.75, 1));
      const face = getCachedGeo('piston_face', () => new THREE.BoxGeometry(1, 0.25, 1));
      const mb = new THREE.Mesh(body, mat);
      mb.position.set(px, py + 0.375, pz);
      const mf = new THREE.Mesh(face, mat);
      mf.position.set(px, py + 0.875, pz);
      g.add(mb, mf);
      return g;
    }
    case 'piston_head': {
      const geo = getCachedGeo('piston_head_geo', () => new THREE.BoxGeometry(1, 0.25, 1));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(px, py + 0.125, pz);
      return mesh;
    }
    case 'lever': {
      const g = new THREE.Group();
      const base = getCachedGeo('lever_base', () => new THREE.BoxGeometry(0.5, 0.125, 0.5));
      const stick = getCachedGeo('lever_stick', () => new THREE.BoxGeometry(0.125, 0.5, 0.125));
      const mb = new THREE.Mesh(base, mat);
      mb.position.set(px, py + 0.0625, pz);
      const ms = new THREE.Mesh(stick, mat);
      ms.position.set(px, py + 0.375, pz);
      ms.rotation.z = 0.4;
      g.add(mb, ms);
      return g;
    }
    case 'bell': {
      const g = new THREE.Group();
      const frame = getCachedGeo('bell_frame', () => new THREE.BoxGeometry(1, 0.25, 1));
      const bell_body = getCachedGeo('bell_body', () => new THREE.BoxGeometry(0.5, 0.5, 0.5));
      const mf = new THREE.Mesh(frame, mat);
      mf.position.set(px, py + 0.875, pz);
      const mb = new THREE.Mesh(bell_body, mat);
      mb.position.set(px, py + 0.5, pz);
      g.add(mf, mb);
      return g;
    }
    case 'leaves': {
      const geo = getCachedGeo('cube', () => new THREE.BoxGeometry(1, 1, 1));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(px, py + 0.5, pz);
      return mesh;
    }
    default: {
      // cube
      const geo = getCachedGeo('cube', () => new THREE.BoxGeometry(1, 1, 1));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(px, py + 0.5, pz);
      return mesh;
    }
  }
}

// --- Three.js setup ---------------------------------------------------------
const canvas = document.getElementById('threeCanvas');
const renderer = new THREE.WebGLRenderer({canvas, antialias:false});
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.setClearColor(0x0a0a1a);
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0a0a1a, 80, 200);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);

// Lighting
const ambient = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(1,2,1.5);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x4488ff, 0.3);
fill.position.set(-1,-1,-1);
scene.add(fill);

// Grid
const grid = new THREE.GridHelper(200,200,0x222244,0x151530);
scene.add(grid);

// --- Camera controls --------------------------------------------------------
let camState = {
  target: new THREE.Vector3(0,0,0),
  phi: Math.PI/4, theta: Math.PI/4, radius: 40,
  isDragging:false, isMiddle:false,
  lastX:0, lastY:0,
  lastDist:0
};

function updateCamera() {
  const t = camState.target;
  camera.position.set(
    t.x + camState.radius * Math.sin(camState.phi) * Math.cos(camState.theta),
    t.y + camState.radius * Math.cos(camState.phi),
    t.z + camState.radius * Math.sin(camState.phi) * Math.sin(camState.theta)
  );
  camera.lookAt(t);
}

canvas.addEventListener('mousedown', e=>{
  camState.isDragging=true; camState.isMiddle=(e.button===1||e.button===2);
  camState.lastX=e.clientX; camState.lastY=e.clientY; e.preventDefault();
});
window.addEventListener('mouseup',()=>camState.isDragging=false);
window.addEventListener('mousemove',e=>{
  if(!camState.isDragging)return;
  const dx=e.clientX-camState.lastX, dy=e.clientY-camState.lastY;
  camState.lastX=e.clientX; camState.lastY=e.clientY;
  if(camState.isMiddle){
    const right=new THREE.Vector3(); camera.getWorldDirection(right);
    const up=new THREE.Vector3(0,1,0);
    right.cross(up).normalize();
    camState.target.addScaledVector(right,-dx*0.03);
    camState.target.y+=dy*0.03;
  } else {
    camState.theta -= dx*0.008;
    camState.phi = Math.max(0.05, Math.min(Math.PI-0.05, camState.phi+dy*0.008));
  }
  updateCamera();
});
canvas.addEventListener('wheel',e=>{
  camState.radius=Math.max(3,Math.min(200,camState.radius+e.deltaY*0.05));
  updateCamera(); e.preventDefault();
},{passive:false});
canvas.addEventListener('contextmenu',e=>e.preventDefault());

// Touch
canvas.addEventListener('touchstart',e=>{
  if(e.touches.length===1){
    camState.isDragging=true; camState.isMiddle=false;
    camState.lastX=e.touches[0].clientX; camState.lastY=e.touches[0].clientY;
  } else if(e.touches.length===2){
    camState.isDragging=false;
    camState.lastDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
  }
  e.preventDefault();
},{passive:false});
canvas.addEventListener('touchend',()=>camState.isDragging=false);
canvas.addEventListener('touchmove',e=>{
  if(e.touches.length===1&&camState.isDragging){
    const dx=e.touches[0].clientX-camState.lastX, dy=e.touches[0].clientY-camState.lastY;
    camState.lastX=e.touches[0].clientX; camState.lastY=e.touches[0].clientY;
    camState.theta-=dx*0.008;
    camState.phi=Math.max(0.05,Math.min(Math.PI-0.05,camState.phi+dy*0.008));
  } else if(e.touches.length===2){
    const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    camState.radius=Math.max(3,Math.min(200,camState.radius-(d-camState.lastDist)*0.1));
    camState.lastDist=d;
  }
  updateCamera(); e.preventDefault();
},{passive:false});

// Resize
function resize(){
  const w=canvas.parentElement.clientWidth, h=canvas.parentElement.clientHeight;
  renderer.setSize(w,h,false);
  camera.aspect=w/h; camera.updateProjectionMatrix();
}
window.addEventListener('resize',resize); resize();

// --- Render loop ------------------------------------------------------------
function animate(){ requestAnimationFrame(animate); renderer.render(scene,camera); }
animate();
updateCamera();

// --- Litematic loader -------------------------------------------------------
let loadedMesh = null;
let worldData = null; // { blocks:[{x,y,z,color}], sx,sy,sz }
let layerMin=0, layerMax=255;

function setProgress(pct,msg){
  document.getElementById('progressFill').style.width=pct+'%';
  if(msg) document.getElementById('loadingStatus').textContent=msg;
}

async function loadLitematic(file) {
  document.getElementById('upload-overlay').style.display='none';
  const lo=document.getElementById('loading-overlay');
  lo.classList.add('show'); setProgress(5,'Lecture du fichier...');

  try {
    // Load atlas first if not already loaded
    if(!atlasImg){
      setProgress(8,'Chargement des textures...');
      const atlasOk = await loadAtlasImage();
      if (!atlasOk) {
        document.getElementById('loadingStatus').textContent = 'Atlas indisponible - rendu couleur';
      }
    }
    const buf = await file.arrayBuffer();
    setProgress(15,'Decompression...');
    await tick();
    const dec = pako.inflate(new Uint8Array(buf));
    setProgress(30,'Lecture NBT...');
    await tick();
    const nbt = readNBT(dec.buffer);
    setProgress(45,'Extraction des blocs...');
    await tick();

    const regObj = nbtGet(nbt,'Regions') || {};
    const regionKeys = Object.keys(regObj).filter(k=>k!=='_compound');
    if(!regionKeys.length) throw new Error('Aucune region trouvee');
    // Take first region
    const region = regObj[regionKeys[0]];
    const paletteList = nbtGet(region,'BlockStatePalette');
    const palette = nbtList(paletteList);
    const statesObj = nbtGet(region,'BlockStates');
    if(!palette.length||!statesObj) throw new Error('Palette ou etats manquants');

    const sizeObj = nbtGet(region,'Size');
    const sx=Math.abs(nbtInt(nbtGet(sizeObj,'x')));
    const sy=Math.abs(nbtInt(nbtGet(sizeObj,'y')));
    const sz=Math.abs(nbtInt(nbtGet(sizeObj,'z')));
    const total=sx*sy*sz;

    const longs = statesObj._longArray ? statesObj.data : [];
    const bpb = Math.max(2,Math.ceil(Math.log2(palette.length)));
    const mask=(1n<<BigInt(bpb))-1n;

    // Decode block indices
    setProgress(55,'Decodage des blocs...');
    await tick();

    const indices = new Uint16Array(total);
    let bitPos=0n;
    for(let i=0;i<total;i++){
      const li=Number(bitPos/64n), bo=bitPos%64n;
      if(li>=longs.length){break;}
      const cur=nbtLongToBI(longs[li]);
      let val;
      if(bo+BigInt(bpb)<=64n){
        val=(cur>>bo)&mask;
      } else {
        const nxt=li+1<longs.length?nbtLongToBI(longs[li+1]):0n;
        const cu=cur<0n?cur+0x10000000000000000n:cur;
        const nu=nxt<0n?nxt+0x10000000000000000n:nxt;
        val=((cu|(nu<<64n))>>bo)&mask;
      }
      bitPos+=BigInt(bpb);
      indices[i]=Number(val);
    }

    setProgress(70,'Calcul des couleurs...');
    await tick();

    // Map palette to block names (skip air)
    const paletteNames = palette.map(e => {
      const fullName = nbtStr(nbtGet(e,'Name'));
      const name = fullName.replace('minecraft:','');
      return (name === 'air' || name === 'void_air' || name === 'cave_air') ? null : name;
    });

    // Collect all non-air blocks
    const blocks=[];
    let totalNonAir=0;
    for(let y=0;y<sy;y++) for(let z=0;z<sz;z++) for(let x=0;x<sx;x++){
      const idx=indices[y*sz*sx+z*sx+x];
      const name=paletteNames[idx];
      if(name !== null && name !== undefined){
        totalNonAir++;
        blocks.push({x,y,z,name,color:colorForBlock(name)});
      }
    }

    setProgress(80,'Construction du mesh...');
    await tick();

    worldData={blocks,sx,sy,sz,totalNonAir,regionName:regionKeys[0],fileName:file.name};

    // Update layer range
    document.getElementById('layerMin').max=sy-1;
    document.getElementById('layerMax').max=sy-1;
    document.getElementById('layerMax').value=sy-1;
    layerMin=0; layerMax=sy-1;
    document.getElementById('layerMinVal').textContent='0';
    document.getElementById('layerMaxVal').textContent=sy-1;

    buildMesh();

    // Update info
    document.getElementById('schemaName').textContent=' '+file.name.replace('.litematic','');
    document.getElementById('infoBlocks').textContent=totalNonAir.toLocaleString();
    document.getElementById('infoTypes').textContent=paletteNames.filter(n=>n!==null).length;
    document.getElementById('infoX').textContent=sx;
    document.getElementById('infoY').textContent=sy;
    document.getElementById('infoZ').textContent=sz;

    // Show UI
    lo.classList.remove('show');
    document.getElementById('hud').classList.add('show');
    document.getElementById('info-panel').classList.add('show');
    document.getElementById('layer-panel').classList.add('show');
    document.getElementById('toolbar').classList.add('show');
    document.getElementById('controls-hint').classList.add('show');
    document.getElementById('loadNewBtn').style.display='inline-block';
    document.getElementById('fullscreenBtn').style.display='inline-block';

    // Apply active replacements from litematic.html
    const repls = typeof sharedLoadReplacements === 'function' ? sharedLoadReplacements() : {};
    if (Object.keys(repls).length > 0) {
      const remap = {};
      for (const [from, to] of Object.entries(repls)) {
        remap[from.replace('minecraft:','')] = to.replace('minecraft:','');
      }
      for (const b of worldData.blocks) {
        if (remap[b.name]) b.name = remap[b.name];
      }
      buildMesh();
    }

    // Center camera
    resetCamera();
    setProgress(100,'');

  } catch(e){
    console.error(e);
    lo.classList.remove('show');
    document.getElementById('upload-overlay').style.display='flex';
    toast('Erreur : '+e.message);
  }
}

function tick(){ return new Promise(r=>setTimeout(r,0)); }

function buildMesh(){
  if(loadedMesh){
    scene.remove(loadedMesh);
    // Don't dispose geometries - they're cached in GEO_CACHE and reused
    loadedMesh = null;
  }
  if(!worldData) return;
  console.log('[buildMesh] blocks:', worldData.blocks.length, 'atlasImg:', !!atlasImg, 'layerMin:', layerMin, 'layerMax:', layerMax);

  const {blocks, sx, sy, sz} = worldData;
  const visible = blocks.filter(b => b.y >= layerMin && b.y <= layerMax);
  const group = new THREE.Group();

  // Separate cubes (instanced) vs non-cubes (individual meshes)
  const cubeGroups = {};   // name -> [blocks]
  const nonCubeBlocks = []; // {block, geom_type}

  for (const b of visible) {
    const info = BLOCK_GEOMS[b.name] || { g: 'cube' };
    if (info.g === 'cube' || info.g === 'leaves') {
      if (!cubeGroups[b.name]) cubeGroups[b.name] = [];
      cubeGroups[b.name].push(b);
    } else {
      nonCubeBlocks.push(b);
    }
  }

  // Instanced rendering for cubes (fast)
  const cubeGeo = getCachedGeo('cube', () => new THREE.BoxGeometry(1,1,1));
  const dummy = new THREE.Object3D();
  for (const [name, bList] of Object.entries(cubeGroups)) {
    const info = BLOCK_GEOMS[name] || { g: 'cube', uv: (BLOCK_GEOMS[name]?.uv) };
    const isLeaves = info.g === 'leaves';
    const isTransparent = TRANSPARENT_SET.has(name);
    const mat = getBlockMaterial(name, isTransparent, isLeaves);
    const mesh = new THREE.InstancedMesh(cubeGeo, mat, bList.length);
    mesh.frustumCulled = false;
    for (let i = 0; i < bList.length; i++) {
      const b = bList[i];
      dummy.position.set(b.x - sx/2 + 0.5, b.y + 0.5, b.z - sz/2 + 0.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  // Individual meshes for non-cube blocks
  for (const b of nonCubeBlocks) {
    const obj = buildBlockMesh(b.name, b.x, b.y, b.z, sx, sz);
    if (obj) group.add(obj);
  }

  loadedMesh = group;
  scene.add(group);
  grid.position.set(0, -0.5, 0);
  console.log('[buildMesh] done. Group children:', group.children.length);
}

function updateLayers(){
  layerMin=parseInt(document.getElementById('layerMin').value);
  layerMax=parseInt(document.getElementById('layerMax').value);
  if(layerMin>layerMax){ layerMin=layerMax; document.getElementById('layerMin').value=layerMin; }
  document.getElementById('layerMinVal').textContent=layerMin;
  document.getElementById('layerMaxVal').textContent=layerMax;
  buildMesh();
}

function resetCamera(){
  if(!worldData){ camState.target.set(0,0,0); camState.radius=40; camState.phi=Math.PI/4; camState.theta=Math.PI/4; updateCamera(); return; }
  const {sx,sy,sz}=worldData;
  camState.target.set(0,sy/2,0);
  camState.radius=Math.max(sx,sy,sz)*1.8;
  camState.phi=Math.PI/4; camState.theta=Math.PI/4;
  updateCamera();
}

function toggleLayers(){
  const lp=document.getElementById('layer-panel');
  lp.classList.toggle('show');
}

function resetViewer(){
  if(loadedMesh){scene.remove(loadedMesh); loadedMesh.geometry.dispose(); loadedMesh=null;}
  worldData=null;
  document.getElementById('upload-overlay').style.display='flex';
  document.getElementById('hud').classList.remove('show');
  document.getElementById('info-panel').classList.remove('show');
  document.getElementById('layer-panel').classList.remove('show');
  document.getElementById('toolbar').classList.remove('show');
  document.getElementById('controls-hint').classList.remove('show');
  document.getElementById('loadNewBtn').style.display='none';
  document.getElementById('fullscreenBtn').style.display='none';
  resetCamera();
}

function toggleFullscreen(){
  if(!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
}

function toast(msg){
  const t=document.createElement('div');
  t.className='toast'; t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),3000);
}

// --- File handling -----------------------------------------------------------
document.getElementById('fileInput').addEventListener('change',e=>{
  if(e.target.files[0]) loadLitematic(e.target.files[0]);
});

// Auto-load from shared storage
(async function autoLoadViewer() {
  const shared = sharedLoadFile();
  if (shared) {
    document.getElementById('navFileName').textContent = shared.name;
    const file = new File([shared.buffer], shared.name, {type:'application/octet-stream'});
    await loadLitematic(file);
  }
})();

// Listen for replacement changes from litematic.html
sharedOnReplacementsChange(async (repls) => {
  if (!worldData) return;
  const shared = sharedLoadFile();
  if (!shared) return;
  const file = new File([shared.buffer], shared.name, {type:'application/octet-stream'});
  toast('Mise a jour des remplacements...');
  await loadLitematic(file);
});
document.getElementById('atlasInput').addEventListener('change', async e => {
  if (!e.target.files[0]) return;
  const ok = await loadAtlasFromFile(e.target.files[0]);
  if (ok) {
    atlasMaterials = {}; // clear material cache
    document.getElementById('atlasInput').parentElement.querySelector('div').textContent = 'OK atlas.png charge !';
    document.getElementById('atlasInput').parentElement.querySelector('div').style.color = '#5D9E3F';
    if (worldData) buildMesh(); // rebuild with textures if already loaded
  }
});
const dz=document.getElementById('dropZone');
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag');});
dz.addEventListener('dragleave',()=>dz.classList.remove('drag'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag');if(e.dataTransfer.files[0])loadLitematic(e.dataTransfer.files[0]);});
