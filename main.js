
/* ===== LOGIN CHECK (must be first) ===== */
if (localStorage.getItem('isLoggedIn') !== 'true') {
  window.location.href = 'login.html';
}

/* ---------- Constants & UI refs ---------- */
const SERVICE_UUID = '6e400001-c352-11e5-953d-0002a5d5c51b';
const CHARACTERISTIC_UUID = '6e400003-c352-11e5-953d-0002a5d5c51b';

const cx = 270, cy = 250, r = 190; // gauge geometry used for tick math
const maxRate = 220;

const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const startTrainingBtn = document.getElementById('startTrainingBtn');
const stopTrainingBtn = document.getElementById('stopTrainingBtn');
const downloadBtn = document.getElementById('downloadBtn');
const traineeNameInput = document.getElementById('traineeName');
const nextSessionBtn = document.getElementById('nextSessionBtn');
const statusDot = document.getElementById('statusDot');
const ticksGroup = document.getElementById('ticks');
const needle = document.getElementById('needle');
const needleShadow = document.getElementById('needleShadow');

const depthValueEl = document.getElementById('depthValue');
const depthFill = document.getElementById('depthFill');
const segmentsContainer = document.getElementById('segmentsContainer');
const rateValueEl = document.getElementById('rateValue');

const historyPanel = document.getElementById('historyPanel');
const historyTableContainer = document.getElementById('historyTableContainer');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const closeHistoryBtn = document.getElementById('closeHistoryBtn');
const downloadHistoryAllBtn = document.getElementById('downloadHistoryAllBtn');

let device = null;
let characteristic = null;
let logging = false;
let traineeName = "";
let sessionData = []; // will hold {trainee, time, rate, peaks, depth}

/* ---------- Draw gauge ticks & labels (0..200 every 20) ---------- */
/* ---------- Draw ONLY two ticks at 100 CPM (45°) and 120 CPM (135°) ---------- */
function drawTicks() {
  while (ticksGroup.firstChild) ticksGroup.removeChild(ticksGroup.firstChild);

  // Define specific angles for 100 CPM (45°) and 120 CPM (135°)
  const tickData = [
    { value: 100, angleDeg: 45 },  // 45° from start (180° + 45° = 225° absolute)
    { value: 120, angleDeg: 135 }  // 135° from start (180° + 135° = 315° absolute)
  ];
  
  tickData.forEach(tick => {
    // Convert relative angle to absolute SVG angle
    const absoluteAngleDeg = 180 + tick.angleDeg; // Start at 180°, add the relative angle
    const rad = absoluteAngleDeg * Math.PI / 180;

    const tickOuter = r;
    const tickLen = 28; // Make these ticks longer/more prominent
    const tickInner = r - tickLen;

    const x1 = cx + tickOuter * Math.cos(rad);
    const y1 = cy + tickOuter * Math.sin(rad);
    const x2 = cx + tickInner * Math.cos(rad);
    const y2 = cy + tickInner * Math.sin(rad);

    // Draw the tick line
    const tickLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    tickLine.setAttribute("x1", x1.toFixed(2));
    tickLine.setAttribute("y1", y1.toFixed(2));
    tickLine.setAttribute("x2", x2.toFixed(2));
    tickLine.setAttribute("y2", y2.toFixed(2));
    tickLine.setAttribute("class", "tick-line tick-major");
    ticksGroup.appendChild(tickLine);

    // Add label
    const labelRadius = r - 48;
    const lx = cx + labelRadius * Math.cos(rad);
    const ly = cy + labelRadius * Math.sin(rad);
    const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
    txt.setAttribute("x", lx.toFixed(2));
    txt.setAttribute("y", (ly + 6).toFixed(2));
    txt.setAttribute("class", "tick-label");
    txt.setAttribute("font-weight", "bold");
    txt.textContent = tick.value;
    ticksGroup.appendChild(txt);
  });
}
/* Helper function to draw a single tick */
function drawTick(value, isMajor) {
  const f = value / maxRate;
  const angleDeg = 180 + f * 180;
  const rad = angleDeg * Math.PI / 180;

  const tickOuter = r;
  const tickLen = isMajor ? 24 : 12;
  const tickInner = r - tickLen;

  const x1 = cx + tickOuter * Math.cos(rad);
  const y1 = cy + tickOuter * Math.sin(rad);
  const x2 = cx + tickInner * Math.cos(rad);
  const y2 = cy + tickInner * Math.sin(rad);

  const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
  tick.setAttribute("x1", x1.toFixed(2));
  tick.setAttribute("y1", y1.toFixed(2));
  tick.setAttribute("x2", x2.toFixed(2));
  tick.setAttribute("y2", y2.toFixed(2));
  tick.setAttribute("class", "tick-line");
  if (isMajor) tick.classList.add('tick-major');
  ticksGroup.appendChild(tick);

  // Show labels for major ticks AND for the detailed 100-120 range
  if (isMajor || (value >= 100 && value <= 120)) {
    const labelRadius = r - 48;
    const lx = cx + labelRadius * Math.cos(rad);
    const ly = cy + labelRadius * Math.sin(rad);
    const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
    txt.setAttribute("x", lx.toFixed(2));
    txt.setAttribute("y", (ly + 6).toFixed(2));
    txt.setAttribute("class", "tick-label");
    txt.setAttribute("font-weight", "bold");
    txt.textContent = value;
    ticksGroup.appendChild(txt);
  }
}
/* ---------- Construct segmented depth bar (kept for compatibility) ---------- */
const SEGMENTS = 8;
function buildSegments() {
  if (!segmentsContainer) return;
  segmentsContainer.innerHTML = '';
  for (let i=0;i<SEGMENTS;i++){
    const seg = document.createElement('div');
    seg.className = 'segment';
    const inner = document.createElement('div');
    inner.className = 'segment-inner';
    inner.style.width = '0%';
    seg.appendChild(inner);
    segmentsContainer.appendChild(seg);
  }
}
/* ---------- Needle update with custom angle mapping ---------- */
/* ---------- Needle update with custom angle mapping and status messages ---------- */
function updateNeedle(rate) {
  const limited = Math.max(0, Math.min(rate, maxRate));
  
  // Custom angle mapping:
  // 0-100 CPM maps to 180°-225° (45° range)
  // 100-120 CPM maps to 225°-315° (90° range)
  // 120-200 CPM maps to 315°-360° (45° range)
  
  let angleDeg;
  if (rate <= 100) {
    // 0-100 CPM -> 180°-225°
    angleDeg = 180 + (rate / 100) * 45;
  } else if (rate <= 120) {
    // 100-120 CPM -> 225°-315°
    angleDeg = 225 + ((rate - 100) / 20) * 90;
  } else {
    // 120-200 CPM -> 315°-360°
    angleDeg = 315 + ((rate - 120) / 80) * 45;
  }
  
  const rotation = angleDeg - 270; // transform relative to initial up position
  needle.style.transform = `rotate(${rotation}deg)`;
  needleShadow.style.transform = `rotate(${rotation}deg)`;

  // Determine status based on rate
  let statusText = "";
  let statusClass = "";
  let zoneColor = '#d32f2f'; // Default red for needle
  
  if (rate === 0) {
    statusText = "No CPR detected";
    statusClass = "status-too-slow";
    zoneColor = '#d32f2f';
  } else if (rate < 30) {
    statusText = "TOO SLOW";
    statusClass = "status-too-slow";
    zoneColor = '#b71c1c'; // Darker red for "too slow"
  } else if (rate <= 99) {
    statusText = "SLOW";
    statusClass = "status-slow";
    zoneColor = '#d32f2f'; // Standard red
  } else if (rate >= 100 && rate <= 120) {
    statusText = "GOOD";
    statusClass = "status-good";
    zoneColor = '#388e3c'; // Green
  } else if (rate > 120 && rate < 140) {
    statusText = "FAST";
    statusClass = "status-fast";
    zoneColor = '#f57c00'; // Orange for "fast"
  } else if (rate >= 140) {
    statusText = "TOO FAST";
    statusClass = "status-too-fast";
    zoneColor = '#d32f2f'; // Red for "too fast"
  }
  
  // Update needle color
  needle.setAttribute('stroke', zoneColor);
  
  // Update rate display
  if (rateValueEl) {
    rateValueEl.style.color = zoneColor;
    rateValueEl.textContent = `Rate: ${Number(rate).toFixed(1)} CPM`;
  }
  
  // Update status message
  updateStatusMessage(statusText, statusClass);
}

/* ---------- Function to update status message ---------- */
function updateStatusMessage(message, statusClass) {
  const statusElement = document.getElementById('statusMessage');
  const statusContainer = document.getElementById('rateStatus');
  
  if (statusElement && statusContainer) {
    // Update text
    statusElement.textContent = message;
    
    // Remove all status classes
    statusContainer.classList.remove(
      'status-too-slow', 
      'status-slow', 
      'status-good', 
      'status-fast', 
      'status-too-fast'
    );
    
    // Add the new status class
    if (statusClass) {
      statusContainer.classList.add(statusClass);
    }
  }
}
/* ---------- Map peaks -> depth (remove simulation, just use peaks directly) ---------- */
// function mapPeaksToDepth(peaks) {
//   // NEW: No simulation - map peaks directly to depth (1 peak = ~15mm, 2 peaks = ~30mm, 3+ peaks = ~45-60mm)
//   const p = Math.max(0, Math.min(999, Math.floor(peaks)));
//   let depth = 0;
//   let zone = 'red';
  
//   if (p <= 1) {
//     depth = 15 + Math.random()*10; // 15..25 mm
//     zone = depth <= 40 ? 'red' : 'green';
//   } else if (p === 2) {
//     depth = 30 + Math.random()*10; // 30..40 mm
//     zone = depth <= 40 ? 'red' : 'green';
//   } else {
//     depth = 45 + Math.random()*15; // 45..60 mm
//     zone = depth >= 45 && depth <= 60 ? 'green' : 'red';
//   }
  
//   // Ensure depth stays within 0-60mm range
//   depth = Math.max(0, Math.min(60, depth));
  
//   // Text color based on depth range
//   if (depth <= 40) {
//     zone = 'red';
//   } else if (depth >= 45 && depth <= 60) {
//     zone = 'green';
//   } else {
//     zone = 'red'; // Beyond 60
//   }
  
//   return { depth: parseFloat(depth.toFixed(1)), zone };
// }

function mapPeaksToDepth(peaks) {
  if (peaks === null || peaks === undefined || peaks < 0) {
    return null;
  }
  
  const p = Math.max(0, Math.min(999, Math.floor(peaks)));
  let minDepth = 0, maxDepth = 0, targetDepth = 0;
  
  // Define ranges for each peak count
  if (p < 1) {
    minDepth = maxDepth = targetDepth = 0;
  } else if (p === 1) {
    minDepth = 12; targetDepth = 15; maxDepth = 32;
  } else if (p === 2) {
    minDepth = 32; targetDepth = 35; maxDepth = 38;
  } else if (p === 3) {
    minDepth = 43; targetDepth = 45; maxDepth = 52;
  } else if (p === 4) {
    minDepth = 48; targetDepth = 55; maxDepth = 56;
  } else if (p >= 5) {
    minDepth = 53; targetDepth = 55; maxDepth = 60;
  }
  
  // Generate random depth within range (normal distribution around target)
  let depth;
  if (targetDepth === 0) {
    depth = 0;
  } else {
    // Create normal-ish distribution around target depth
    const stdDev = (maxDepth - minDepth) / 6; // ~99% within range
    let attempts = 0;
    do {
      // Box-Muller transform for normal distribution
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      depth = targetDepth + z * stdDev;
      attempts++;
    } while ((depth < minDepth || depth > maxDepth) && attempts < 10);
    
    // Fallback to uniform if normal fails
    if (depth < minDepth || depth > maxDepth) {
      depth = minDepth + Math.random() * (maxDepth - minDepth);
    }
  }
  
  // Determine zone
  let zone = 'red';
  if (depth >= 50) {
    zone = 'green';
  } else if (depth >= 40) {
    zone = 'yellow';
  }
  
  return { 
    depth: parseFloat(depth.toFixed(1)), 
    zone: zone,
    basePeaks: p
  };
}
/* ---------- Update continuous depth bar from depth ---------- */
function updateDepthBar(depthObj) {
  const depth = depthObj.depth;
  const zone = depthObj.zone || 'red';

  // Update smooth vertical fill (0..60 mm mapped to 0..100%)
  const percent = (depth / 60) * 100;
  depthFill.style.height = percent + '%';

  // NEW: Always use blue for the fill, regardless of zone
  depthFill.style.background = '#2196f3'; // Blue color

  // Text color based on zone
  const textColor = zone === 'green' ? '#388e3c' : '#d32f2f';
  depthValueEl.textContent = `Depth: ${depth.toFixed(1)} mm`;
  depthValueEl.style.color = textColor;

  // Also update legacy segments if present (kept for fallback)
  if (segmentsContainer && segmentsContainer.children.length > 0) {
    const fillSegments = Math.round((depth / 60) * SEGMENTS);
    const segs = Array.from(segmentsContainer.children);
    for (let i=0;i<SEGMENTS;i++){
      const inner = segs[i].firstChild;
      if (i < fillSegments) {
        inner.style.width = '100%';
        inner.style.background = '#2196f3'; // Blue color for segments
        inner.style.boxShadow = `0 4px 10px rgba(33, 150, 243, 0.18)`;
        segs[i].style.transform = 'translateY(-2px)';
      } else {
        inner.style.width = '0%';
        inner.style.background = 'transparent';
        segs[i].style.transform = 'translateY(0px)';
      }
    }
  }
}

/* small helper to get rgba from hex */
function hexToRGBA(hex, alpha){
  hex = hex.replace('#','');
  if (hex.length === 3) hex = hex.split('').map(h=>h+h).join('');
  const r = parseInt(hex.slice(0,2),16);
  const g = parseInt(hex.slice(2,4),16);
  const b = parseInt(hex.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ---------- Bluetooth notification handler (robust) ---------- */
/* Expected example:
   "CPR RATE: 65.0 cpm and Peaks in last 2s: 3"
*/
function handleNotification(raw) {
  if (!raw || typeof raw !== 'string') return;

  // Normalize line endings into spaces
  const norm = raw.split('\r').join('').split('\n').join(' ');
  const up = norm.toUpperCase();

  // Parse rate (look for 'CPR RATE:')
  let rate = null;
  const rateLabel = 'CPR RATE:';
  const ratePos = up.indexOf(rateLabel);
  if (ratePos !== -1) {
    let substr = norm.substring(ratePos + rateLabel.length);
    const cpmPos = substr.toUpperCase().indexOf('CPM');
    if (cpmPos !== -1) substr = substr.substring(0, cpmPos);
    // extract first numeric token (digits and dot)
    let numStr = '';
    for (let i=0;i<substr.length;i++){
      const ch = substr[i];
      if ((ch >= '0' && ch <= '9') || ch === '.') numStr += ch;
      else if (numStr.length > 0) break;
    }
    if (numStr.length > 0) rate = parseFloat(numStr);
  }

  // Parse peaks (look for 'PEAKS IN LAST 2S:')
  let peaks = null;
  const peaksLabel = 'PEAKS IN LAST 2S:';
  const peaksPos = up.indexOf(peaksLabel);
  if (peaksPos !== -1) {
    let substr = norm.substring(peaksPos + peaksLabel.length);
    // extract first integer from substr
    let numStr = '';
    for (let i=0;i<substr.length;i++){
      const ch = substr[i];
      if (ch >= '0' && ch <= '9') numStr += ch;
      else if (numStr.length > 0) break;
    }
    if (numStr.length > 0) peaks = parseInt(numStr, 10);
  }

  if (rate !== null) updateNeedle(rate);
  if (rate !== null && peaks !== null) {
    const depthObj = mapPeaksToDepth(peaks);
    updateDepthBar(depthObj);
    if (logging) {
      sessionData.push({
        trainee: traineeName,
        time: new Date().toISOString(),
        rate: rate,
        peaks: peaks,
        depth: depthObj.depth
      });
      updateStats();
    }
  }
}

/* ---------- BLUETOOTH + training flow ---------- */
connectBtn.addEventListener('click', async () => {
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Proteus' }],
      optionalServices: [SERVICE_UUID]
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

    characteristic.addEventListener('characteristicvaluechanged', event => {
      const raw = new TextDecoder().decode(event.target.value);
      handleNotification(raw);
    });

    await characteristic.startNotifications();

    statusDot.style.background = '#388e3c';
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = 'inline-block';
    traineeNameInput.style.display = 'inline-block';
    startTrainingBtn.style.display = 'inline-block';
    downloadBtn.style.display = 'none';
    stopTrainingBtn.style.display = 'none';

  } catch (err) {
    alert('Bluetooth Error: ' + (err && err.message ? err.message : err));
  }
});

disconnectBtn.addEventListener('click', async () => {
  if (device && device.gatt && device.gatt.connected) {
    await device.gatt.disconnect();
  }
  statusDot.style.background = '#d32f2f';
  connectBtn.style.display = 'inline-block';
  disconnectBtn.style.display = 'none';
  traineeNameInput.style.display = 'none';
  startTrainingBtn.style.display = 'none';
  stopTrainingBtn.style.display = 'none';
  downloadBtn.style.display = 'none';
  logging = false;
  sessionData = [];
});

/* Training flow: start/stop logging (connection remains) */
startTrainingBtn.addEventListener('click', () => {
  const name = traineeNameInput.value.trim();
  if (!name) { alert('Please enter trainee name.'); return; }
  traineeName = name;
  logging = true;
  sessionData = [];             // clear previous session
  traineeNameInput.style.display = 'none';
  startTrainingBtn.style.display = 'none';
  stopTrainingBtn.style.display = 'inline-block';
  downloadBtn.style.display = 'none';
});

stopTrainingBtn.addEventListener('click', () => {
  logging = false;
  stopTrainingBtn.style.display = 'none';
  if (sessionData.length > 0) downloadBtn.style.display = 'inline-block';
  if (sessionData.length > 0) { nextSessionBtn.style.display = 'inline-block'; }

  // Save session summary to localStorage history
  if (sessionData.length > 0) {
    try {
      const rates = sessionData.map(r=>r.rate);
      const depths = sessionData.map(r=>r.depth);
      const avgRate = (rates.reduce((a,b)=>a+b,0)/rates.length).toFixed(1);
      const avgDepth = (depths.reduce((a,b)=>a+b,0)/depths.length).toFixed(1);
      const inTargetCount = sessionData.filter(r=> r.rate>=100 && r.rate<=120).length;
      const pctInTarget = ((inTargetCount/sessionData.length)*100).toFixed(1);

      const history = JSON.parse(localStorage.getItem('cprHistory') || '[]');
      history.push({
        date: new Date().toISOString(),
        trainee: traineeName,
        avgRate: avgRate,
        avgDepth: avgDepth,
        pctInTarget: pctInTarget,
        data: sessionData.slice() // store raw session
      });
      localStorage.setItem('cprHistory', JSON.stringify(history));
      // show history button if available
      if (typeof window.showHistoryButton === 'function') window.showHistoryButton();
    } catch (e) {
      console.warn('Failed to save session history', e);
    }
  }
});

/* CSV export updated to include peaks & depth (fixed escapes) */
downloadBtn.addEventListener('click', () => {
  if (sessionData.length === 0) {
    alert('No data to download.');
    return;
  }

  const newline = '\n';
  // header
  let csv = 'Trainee Name,Time,CPR Rate,Peaks,Depth(mm)' + newline;
  sessionData.forEach(r => {
    csv += `${escapeCsv(r.trainee)},${r.time},${r.rate},${r.peaks},${r.depth}` + newline;
  });

  // summary (rate & depth)
  const rates = sessionData.map(r=>r.rate);
  const depths = sessionData.map(r=>r.depth);
  const avgRate = (rates.reduce((a,b)=>a+b,0)/rates.length).toFixed(2);
  const minRate = Math.min(...rates).toFixed(2);
  const maxRate = Math.max(...rates).toFixed(2);
  const avgDepth = (depths.reduce((a,b)=>a+b,0)/depths.length).toFixed(2);
  const minDepth = Math.min(...depths).toFixed(2);
  const maxDepth = Math.max(...depths).toFixed(2);
  const inTargetCount = sessionData.filter(r=> r.rate>=100 && r.rate<=120).length;
  const pctInTarget = ((inTargetCount/sessionData.length)*100).toFixed(1);

  csv += newline + 'Summary,,,' + newline;
  csv += `Avg Rate,${avgRate},Min Rate,${minRate}` + newline;
  csv += `Max Rate,${maxRate},% In 100-120 CPM,${pctInTarget}%` + newline;
  csv += `Avg Depth,${avgDepth},Min Depth,${minDepth}` + newline;
  csv += `Max Depth,${maxDepth},,` + newline;

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${traineeName || 'trainee'}_cpr_session.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

function escapeCsv(val) {
  if (typeof val !== 'string') return val;
  if (val.indexOf(',') !== -1 || val.indexOf('"') !== -1 || val.indexOf('\n') !== -1) {
    return '"' + val.split('"').join('""') + '"';
  }
  return val;
}

/* ---------- Init UI on load ---------- */
drawTicks();
buildSegments();
updateNeedle(0); // start needle at 0 CPM
if (rateValueEl) rateValueEl.textContent = 'Rate: 0 CPM';

/* ---------- Logout handler (already present in header) ---------- */
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('isLoggedIn');
  window.location.href = 'login.html';
});

/* ---------- Register PWA service worker (unchanged but caches should include login.html too) ---------- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .then(()=>console.log('Service Worker Registered'))
    .catch(err=>console.warn('SW failed', err));
}

/* === Added Features: Past sessions button, history handling === */
document.addEventListener('DOMContentLoaded', () => {
  // create history button and append to header
  const historyBtn = document.createElement('button');
  historyBtn.textContent = 'Past Sessions';
  historyBtn.className = 'btn';
  historyBtn.id = 'historyBtn';
  historyBtn.style.background = '#66bb6a';
  historyBtn.style.color = 'white';
  historyBtn.style.marginLeft = '8px';
  historyBtn.style.display = 'none';
  document.querySelector('.app-header').appendChild(historyBtn);

  // Show if history exists on load
  if (localStorage.getItem('cprHistory') && JSON.parse(localStorage.getItem('cprHistory')).length > 0) {
    historyBtn.style.display = 'inline-block';
  }

  historyBtn.addEventListener('click', () => {
    renderHistoryTable();
    historyPanel.style.display = 'block';
  });

  // Global function for other parts to show button
  window.showHistoryButton = function() {
    historyBtn.style.display = 'inline-block';
  };
});

/* ---------- History rendering and helpers ---------- */
function renderHistoryTable() {
  let history = JSON.parse(localStorage.getItem('cprHistory') || '[]');
  if (history.length === 0) {
    historyTableContainer.innerHTML = '<p>No past sessions found.</p>';
  } else {
    let html = '<table style="width:100%;border-collapse:collapse;">';
    html += '<tr><th>Date</th><th>Trainee</th><th>Avg Rate</th><th>Avg Depth</th><th>% Target</th><th>Download</th></tr>';
    history.forEach((h,i) => {
      html += `<tr>
        <td>${new Date(h.date).toLocaleString()}</td>
        <td>${h.trainee}</td>
        <td>${h.avgRate}</td>
        <td>${h.avgDepth}</td>
        <td>${h.pctInTarget}%</td>
        <td><button class="btn" onclick="downloadHistoryCSV(${i})">CSV</button></td>
      </tr>`;
    });
    html += '</table>';
    historyTableContainer.innerHTML = html;
  }
}

function downloadHistoryCSV(index) {
  const history = JSON.parse(localStorage.getItem('cprHistory') || '[]');
  if (!history[index]) { alert('No session found'); return; }
  const sess = history[index].data || [];
  if (sess.length === 0) { alert('No data inside session'); return; }

  let csv = 'Trainee Name,Time,CPR Rate,Peaks,Depth(mm)\n';
  sess.forEach(r => {
    csv += `${escapeCsv(r.trainee)},${r.time},${r.rate},${r.peaks},${r.depth}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${history[index].trainee || 'trainee'}_cpr_session_${index}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

downloadHistoryAllBtn.addEventListener('click', () => {
  const history = JSON.parse(localStorage.getItem('cprHistory') || '[]');
  if (history.length === 0) { alert('No history'); return; }
  // Create one CSV concatenating all sessions
  let csv = 'Session Date,Trainee,Avg Rate,Avg Depth,% In Target,Time,Rate,Peaks,Depth(mm)\n';
  history.forEach(h => {
    (h.data || []).forEach(r => {
      csv += `${h.date},${escapeCsv(h.trainee)},${h.avgRate},${h.avgDepth},${h.pctInTarget},${r.time},${r.rate},${r.peaks},${r.depth}\n`;
    });
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cpr_all_history.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

clearHistoryBtn.addEventListener('click', () => {
  if (!confirm('Clear all history? This cannot be undone.')) return;
  localStorage.removeItem('cprHistory');
  renderHistoryTable();
  historyPanel.style.display = 'none';
});

closeHistoryBtn.addEventListener('click', () => {
  historyPanel.style.display = 'none';
});

/* ---------- Update live stats shown in the bottom bar ---------- */
function updateStats() {
  if (sessionData.length === 0) return;
  const rates = sessionData.map(r=>r.rate);
  const depths = sessionData.map(r=>r.depth);
  const avgRate = (rates.reduce((a,b)=>a+b,0)/rates.length).toFixed(1);
  const minRate = Math.min(...rates).toFixed(1);
  const maxRate = Math.max(...rates).toFixed(1);
  const avgDepth = (depths.reduce((a,b)=>a+b,0)/depths.length).toFixed(1);
  const minDepth = Math.min(...depths).toFixed(1);
  const maxDepth = Math.max(...depths).toFixed(1);

  function colorForRate(rate) { 
  if (rate>=100&&rate<=120) return 'color-green'; 
  return 'color-red'; 
}
  function colorForDepth(depth) { 
    if (depth>=45 && depth<=60) return 'color-green'; 
    return 'color-red'; 
  }

  [['statAvgRate', avgRate, colorForRate(avgRate)],
   ['statMinRate', minRate, colorForRate(minRate)],
   ['statMaxRate', maxRate, colorForRate(maxRate)],
   ['statAvgDepth', avgDepth, colorForDepth(avgDepth)],
   ['statMinDepth', minDepth, colorForDepth(minDepth)],
   ['statMaxDepth', maxDepth, colorForDepth(maxDepth)]
  ].forEach(([id,val,color]) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = val;
      el.className = color;
    }
  });
}

/* ---------- Start Next Session ---------- */
nextSessionBtn.addEventListener('click', () => {
  sessionData = [];
  traineeName = "";
  traineeNameInput.value = "";
  traineeNameInput.focus();
  traineeNameInput.style.display = 'inline-block';
  startTrainingBtn.style.display = 'inline-block';
  downloadBtn.style.display = 'none';
  nextSessionBtn.style.display = 'none';
});
/* ---------- Init UI on load ---------- */
drawTicks();
buildSegments();
updateNeedle(0); // start needle at 0 CPM
if (rateValueEl) rateValueEl.textContent = 'Rate: 0 CPM';
updateStatusMessage("Waiting for Bluetooth connection...", "status-too-slow");
/* ---------- Logout handler (already present in header) ---------- */
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('isLoggedIn');
  window.location.href = 'login.html';
});

/* ---------- Register PWA service worker (unchanged but caches should include login.html too) ---------- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .then(()=>console.log('Service Worker Registered'))
    .catch(err=>console.warn('SW failed', err));
}