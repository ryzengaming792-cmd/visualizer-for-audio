const bgCanvas = document.getElementById('bgCanvas');
const bgCtx = bgCanvas.getContext('2d');
const visCanvas = document.getElementById('visualizerCanvas');
const visCtx = visCanvas.getContext('2d');

let paths = []; // Stores the generated PCB trace paths
let pulses = []; // Stores active lightning pulses

// Resize canvases and regenerate background
function resizeCanvases() {
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
    visCanvas.width = window.innerWidth;
    visCanvas.height = window.innerHeight;
    generatePCB();
    drawBackground(0); // Initial dark state
}
window.addEventListener('resize', resizeCanvases);

// --- PCB Generation Logic ---
function generatePCB() {
    paths = [];
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const numPaths = 60; // Total number of traces radiating out
    
    // Avoid drawing traces directly under the logo (leave a center hole)
    const minRadius = 150; 
    
    for (let i = 0; i < numPaths; i++) {
        const path = [];
        // Determine starting angle and position
        const angle = (Math.PI * 2 / numPaths) * i + (Math.random() * 0.1);
        let x = centerX + Math.cos(angle) * minRadius;
        let y = centerY + Math.sin(angle) * minRadius;
        
        path.push({x, y});
        
        // Generate segments for the trace
        let currentLength = 0;
        let dirAngle = angle;
        
        // A trace has 3 to 6 segments
        const numSegments = Math.floor(Math.random() * 4) + 3;
        
        for (let s = 0; s < numSegments; s++) {
            // Segments usually travel at 0, 45, or 90 degrees relative to grid
            // Snap direction to nearest 45 degrees
            let snappedAngle = Math.round(dirAngle / (Math.PI/4)) * (Math.PI/4);
            
            // Randomly branch off by 45 degrees occasionally
            if (Math.random() > 0.5) {
                snappedAngle += (Math.random() > 0.5 ? 1 : -1) * (Math.PI/4);
            }
            
            const segLength = 50 + Math.random() * 150;
            x += Math.cos(snappedAngle) * segLength;
            y += Math.sin(snappedAngle) * segLength;
            
            path.push({x, y});
            dirAngle = snappedAngle; // continue mostly in the same direction
            
            // If we go way off screen, stop
            if (x < -100 || x > window.innerWidth+100 || y < -100 || y > window.innerHeight+100) {
                break;
            }
        }
        
        // Calculate total length of path for animation purposes
        let totalLen = 0;
        for (let p = 1; p < path.length; p++) {
            const dx = path[p].x - path[p-1].x;
            const dy = path[p].y - path[p-1].y;
            totalLen += Math.sqrt(dx*dx + dy*dy);
        }
        
        paths.push({ points: path, length: totalLen });
    }
}

function drawBackground(intensity) {
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    
    // Intensity is non-linear now for snappier glowing
    const glowIntensity = Math.pow(intensity, 1.5);
    
    // Lines dim during quiet parts, bright during drops
    const lineOpacity = 0.05 + (glowIntensity * 0.85); 
    
    bgCtx.lineWidth = 2;
    bgCtx.lineCap = 'round';
    bgCtx.lineJoin = 'round';
    
    // --- MASSIVE PERFORMANCE OPTIMIZATION ---
    // Batch all 60 line paths into a single draw call to completely eliminate lag
    bgCtx.beginPath();
    paths.forEach(pathObj => {
        const pts = pathObj.points;
        bgCtx.moveTo(pts[0].x, pts[0].y);
        for(let i=1; i<pts.length; i++) {
            bgCtx.lineTo(pts[i].x, pts[i].y);
        }
    });
    
    bgCtx.strokeStyle = `rgba(${currentDropColorRgb}, ${lineOpacity})`; 
    if (glowIntensity > 0.2) {
        bgCtx.shadowBlur = glowIntensity * 35; // Huge glow radius
        bgCtx.shadowColor = currentDropColor;
    } else {
        bgCtx.shadowBlur = 0;
    }
    bgCtx.stroke(); // Draw all lines at once!
    
    // Batch all vias/pads into a single draw call
    bgCtx.beginPath();
    paths.forEach(pathObj => {
        const pts = pathObj.points;
        const last = pts[pts.length-1];
        bgCtx.rect(last.x - 2, last.y - 2, 4, 4);
    });
    
    bgCtx.fillStyle = `rgba(255, 149, 0, ${0.1 + glowIntensity * 0.9})`;
    bgCtx.shadowBlur = glowIntensity > 0.2 ? 15 : 0;
    bgCtx.shadowColor = '#FF9500';
    bgCtx.fill(); // Draw all dots at once!
    
    // Reset shadow for next frame
    bgCtx.shadowBlur = 0;
}

// Helper to get point at distance D along a path
function getPointAlongPath(pts, dist) {
    let currentDist = 0;
    for (let i = 1; i < pts.length; i++) {
        const p1 = pts[i-1];
        const p2 = pts[i];
        const segLen = Math.sqrt(Math.pow(p2.x-p1.x, 2) + Math.pow(p2.y-p1.y, 2));
        
        if (currentDist + segLen >= dist) {
            const ratio = (dist - currentDist) / segLen;
            return {
                x: p1.x + (p2.x - p1.x) * ratio,
                y: p1.y + (p2.y - p1.y) * ratio
            };
        }
        currentDist += segLen;
    }
    return pts[pts.length-1];
}


// --- Audio Logic ---
let audioCtx;
let analyser;
let source;
let dataArray;
let isAudioSetup = false;
let isPlaying = false;

const audio = new Audio();
audio.crossOrigin = "anonymous";

const btnPlayPause = document.getElementById('btnPlayPause');
const iconPlay = document.getElementById('iconPlay');
const iconPause = document.getElementById('iconPause');
const audioUpload = document.getElementById('audioUpload');
const progressBarFill = document.getElementById('progressBarFill');
const timeCurrent = document.getElementById('timeCurrent');
const timeTotal = document.getElementById('timeTotal');

function setupAudio() {
    if (isAudioSetup) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048; // High resolution for frequency isolation
    analyser.smoothingTimeConstant = 0.4; // Lowered to capture sharp, punchy transients perfectly
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    isAudioSetup = true;
}

let fileSourceNode = null;

audioUpload.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        if (!isAudioSetup) setupAudio();
        
        // Disconnect current source from analyser
        if (source) source.disconnect();
        
        // The Web Audio API only allows creating one MediaElementSource per audio element.
        if (!fileSourceNode) {
            fileSourceNode = audioCtx.createMediaElementSource(audio);
        }
        
        source = fileSourceNode;
        source.connect(analyser);
        analyser.connect(audioCtx.destination); // Play local files through speakers
        
        audio.src = URL.createObjectURL(file);
        document.getElementById('trackTitle').textContent = file.name.replace(/\.[^/.]+$/, "");
        document.getElementById('trackArtist').textContent = "Local File";
        playAudio();
    }
});

document.getElementById('btnSystemAudio').addEventListener('click', async () => {
    try {
        // We MUST disable browser voice-call filters, otherwise it destroys music bass and transients
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true, // Video must be true for most browsers to allow screen share
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });
        
        if (!isAudioSetup) setupAudio();
        
        // Disconnect old source
        if (source) source.disconnect();
        
        source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        // CRITICAL: We do NOT connect analyser to destination here, otherwise we get a massive feedback loop!
        
        document.getElementById('trackTitle').textContent = "Live System Audio";
        document.getElementById('trackArtist').textContent = "Streaming";
        
        // We don't use the audio element for this, so we mock playing
        isPlaying = true;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        iconPlay.style.display = 'none';
        iconPause.style.display = 'block';
        renderFrame();
        
        // Stop stream when user stops sharing
        stream.getVideoTracks()[0].onended = () => {
            isPlaying = false;
            iconPlay.style.display = 'block';
            iconPause.style.display = 'none';
            document.getElementById('trackTitle').textContent = "Stream Ended";
        };
        
    } catch (err) {
        console.error("Error capturing audio: ", err);
        alert("Could not capture audio. Please make sure you selected a tab or screen AND checked the 'Share Audio' box!");
    }
});

btnPlayPause.addEventListener('click', () => {
    if (!audio.src) return;
    if (!isAudioSetup) setupAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    isPlaying ? pauseAudio() : playAudio();
});

const btnRepeat = document.getElementById('btnRepeat');
btnRepeat.addEventListener('click', () => {
    audio.loop = !audio.loop;
    if (audio.loop) {
        btnRepeat.classList.add('active');
    } else {
        btnRepeat.classList.remove('active');
    }
});

function playAudio() {
    audio.play();
    isPlaying = true;
    iconPlay.style.display = 'none';
    iconPause.style.display = 'block';
    renderFrame();
}

function pauseAudio() {
    audio.pause();
    isPlaying = false;
    iconPlay.style.display = 'block';
    iconPause.style.display = 'none';
}

audio.addEventListener('timeupdate', () => {
    if (!isNaN(audio.duration)) {
        progressBarFill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
        timeCurrent.textContent = formatTime(audio.currentTime);
        timeTotal.textContent = formatTime(audio.duration);
    }
});

function formatTime(s) {
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}


const volumeSlider = document.getElementById('volumeSlider');
if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
        audio.volume = e.target.value;
    });
}

// --- Advanced Audio Analysis & Render Loop ---
let lastBeatTime = 0;
let lastSmallBeatTime = 0;
let lastMelodyTime = 0;
let smoothedIntensity = 0; // Tracks smooth glowing

// Professional High-Fidelity Neon RGB Palette
const rgbPalette = [
    { hex: '#FF3B30', rgb: '255, 59, 48' },   // Neon Red
    { hex: '#00F0FF', rgb: '0, 240, 255' },   // Cyber Cyan
    { hex: '#FF0055', rgb: '255, 0, 85' },    // Laser Pink
    { hex: '#B026FF', rgb: '176, 38, 255' },  // Deep Purple
    { hex: '#39FF14', rgb: '57, 255, 20' },   // Acid Green
    { hex: '#0047FF', rgb: '0, 71, 255' }     // Electric Blue
];
let currentDropColor = rgbPalette[0].hex;
let currentDropColorRgb = rgbPalette[0].rgb;

// Decaying Peak Threshold trackers
let bigBeatThreshold = 15;
let smallBeatThreshold = 10;

function renderFrame() {
    if (!isPlaying) return;
    requestAnimationFrame(renderFrame);
    analyser.getByteFrequencyData(dataArray);
    visCtx.clearRect(0, 0, visCanvas.width, visCanvas.height);
    
    // 1. Precise Audio Analysis
    // Bass (bins 1-6) handles heavy drops
    let bass = 0;
    for(let i=1; i<=6; i++) bass += dataArray[i];
    bass /= 6;
    
    // Overall energy (bins 10-150) handles rhythmic elements (snares, hats, synths)
    let overallEnergy = 0;
    for(let i=10; i<=150; i++) overallEnergy += dataArray[i];
    overallEnergy /= 140;
    
    // 2. Dynamic Circuit Lighting 
    // The background completely synchronizes with overall energy smoothly
    let targetIntensity = overallEnergy / 255;
    
    // Smoothly lerp the visual intensity so it breathes perfectly and never flickers
    smoothedIntensity += (targetIntensity - smoothedIntensity) * 0.08;
    drawBackground(smoothedIntensity);
    
    // 3. Perfect Volume-Independent Decaying Thresholds
    // By using a decaying peak tracker, the engine perfectly catches sharp drum hits AND rhythmic 
    // pulses in sustained heavy bass drops, completely independent of the master volume.
    let isBigBeat = false;
    if (bass > bigBeatThreshold && bass > 15) {
        isBigBeat = true;
        bigBeatThreshold = bass * 1.25; // Spike threshold up so it requires a fresh hit to trigger again
    } else {
        bigBeatThreshold -= (bigBeatThreshold - 15) * 0.05; // Smoothly decay back down
    }
    
    let isSmallBeat = false;
    if (overallEnergy > smallBeatThreshold && overallEnergy > 10) {
        isSmallBeat = true;
        smallBeatThreshold = overallEnergy * 1.15;
    } else {
        smallBeatThreshold -= (smallBeatThreshold - 10) * 0.1; // Faster decay for rapid high-hats
    }
    
    const now = Date.now();
    
    // HEAVY BEAT: The Drop
    if (isBigBeat && now - lastBeatTime > 250) {
        
        // Pick a new professional RGB color for this drop
        const dropTheme = rgbPalette[Math.floor(Math.random() * rgbPalette.length)];
        currentDropColor = dropTheme.hex;
        currentDropColorRgb = dropTheme.rgb;
        
        // ALL LINES: Passes through all lines together at once
        for(let i=0; i<paths.length; i++) {
            pulses.push({
                pathIndex: i,
                distance: 0,
                speed: 25 + (targetIntensity * 15), // Extremely fast! 
                length: 120 + (targetIntensity * 40), 
                color: currentDropColor // Dynamic RGB
            });
        }
        lastBeatTime = now;
        document.querySelector('.center-logo').style.filter = `drop-shadow(0 0 50px ${currentDropColor})`;
        
    } 
    // LIGHT BEAT: Rhythmic Elements
    else if (isSmallBeat && now - lastSmallBeatTime > 80) {
        // YELLOW CLUSTER: Fires a pattern of yellow pulses
        const numPulses = Math.floor(Math.random() * 5) + 3; // 3 to 7 random lines
        for(let i=0; i<numPulses; i++) {
            const randomPathIndex = Math.floor(Math.random() * paths.length);
            pulses.push({
                pathIndex: randomPathIndex,
                distance: 0,
                speed: 12 + (Math.random() * 6), // Energetic rhythmic speed
                length: 50 + (Math.random() * 40),
                color: '#FF9500' // Yellow
            });
        }
        lastSmallBeatTime = now;
        document.querySelector('.center-logo').style.filter = `drop-shadow(0 0 20px rgba(255, 149, 0, 0.8))`;
    } 
    else {
        // RESTING Glow
        document.querySelector('.center-logo').style.filter = `drop-shadow(0 0 ${10 + (smoothedIntensity*10)}px rgba(${currentDropColorRgb}, 0.5))`;
    }
    
    // MELODY / REST OF SONG: Continuous Yellow Patterns
    // Even when there is no beat, if music is playing, yellow pulses continuously travel
    if (overallEnergy > 10 && now - lastMelodyTime > (200 - targetIntensity * 100)) {
        pulses.push({
            pathIndex: Math.floor(Math.random() * paths.length),
            distance: 0,
            speed: 8 + (Math.random() * 4), // Smooth minimum speed for patterns
            length: 40 + (Math.random() * 30),
            color: '#FF9500' // Yellow
        });
        lastMelodyTime = now;
    }
    
    // 4. Draw traveling lightning
    for (let i = pulses.length - 1; i >= 0; i--) {
        const pulse = pulses[i];
        pulse.distance += pulse.speed;
        
        const pObj = paths[pulse.pathIndex];
        
        if (pulse.distance - pulse.length > pObj.length) {
            pulses.splice(i, 1);
            continue;
        }

        const trailEndDist = Math.max(0, pulse.distance - pulse.length);
        const trailStartDist = Math.min(pObj.length, pulse.distance);
        
        visCtx.beginPath();
        visCtx.lineCap = 'round';
        visCtx.lineJoin = 'round';
        visCtx.lineWidth = 3;
        visCtx.strokeStyle = pulse.color;
        visCtx.shadowBlur = 20;
        visCtx.shadowColor = pulse.color;
        
        const step = 4; // Distance between interpolated points
        let started = false;
        
        for (let d = trailEndDist; d <= trailStartDist; d += step) {
            const pt = getPointAlongPath(pObj.points, d);
            if (!started) {
                visCtx.moveTo(pt.x, pt.y);
                started = true;
            } else {
                visCtx.lineTo(pt.x, pt.y);
            }
        }
        
        // Draw exactly to the tip
        const tip = getPointAlongPath(pObj.points, trailStartDist);
        if (started && tip) visCtx.lineTo(tip.x, tip.y);
        
        visCtx.stroke();
    }
}

// --- UI Auto-Fade Logic ---
const uiOverlay = document.getElementById('uiOverlay');
let fadeTimeout;

function resetFade() {
    uiOverlay.classList.remove('idle');
    clearTimeout(fadeTimeout);
    fadeTimeout = setTimeout(() => {
        uiOverlay.classList.add('idle');
    }, 3000); // fade out after 3 seconds of inactivity
}

document.addEventListener('mousemove', resetFade);
document.addEventListener('click', resetFade);
document.addEventListener('keydown', resetFade);
resetFade(); // start the timer initially

// Initialize background
resizeCanvases();
