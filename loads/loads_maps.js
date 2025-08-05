// DISPATCH TESTER/loads/loads_maps.js

import { calculateMedian } from '../utils.js';

// A predefined lookup table for state abbreviations
const stateAbbrToFullName = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
    "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
    "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming"
};

/**
 * Implements geographic grid-based clustering.
 * @param {Array} rawLoads - The array of raw load objects.
 * @returns {Promise<Array>} A promise that resolves to an array of cluster objects.
 */
async function processLoadsForClustering(rawLoads, clusterSize, direction) {
    if (!rawLoads || rawLoads.length === 0) return [];

    const GRID_SIZE = clusterSize;
    const latField = direction === 'inbound' ? 'do_latitude' : 'pu_latitude';
    const lonField = direction === 'inbound' ? 'do_longitude' : 'pu_longitude';
    const locField = direction === 'inbound' ? 'do_location' : 'pu_location';

    // Step 1: Group loads into clusters and collect RPMs.
    const clusters = rawLoads.reduce((acc, load) => {
        const lat = parseFloat(load[latField]);
        const lon = parseFloat(load[lonField]);
        if (isNaN(lat) || isNaN(lon)) return acc;

        const gridKey = `${Math.round(lat / GRID_SIZE) * GRID_SIZE},${Math.round(lon / GRID_SIZE) * GRID_SIZE}`;
        if (!acc[gridKey]) {
            acc[gridKey] = {
                locations: {},
                loadVolume: 0,
                rpms: [], // Use an array to store RPMs
                totalLat: 0,
                totalLon: 0,
            };
        }

        const locationName = load[locField] || 'Unknown';
        acc[gridKey].locations[locationName] = (acc[gridKey].locations[locationName] || 0) + 1;

        acc[gridKey].loadVolume++;
        acc[gridKey].totalLat += lat;
        acc[gridKey].totalLon += lon;
        const rpm = parseFloat(load.rpm_all);
        if (!isNaN(rpm) && rpm > 0) {
            acc[gridKey].rpms.push(rpm); // Add each RPM to the array
        }
        return acc;
    }, {});

    // Step 2: Process each cluster to find the median RPM.
    return Object.values(clusters).map(cluster => {
        let mostFrequentLocation = 'Unknown';
        let maxCount = 0;
        for (const location in cluster.locations) {
            if (cluster.locations[location] > maxCount) {
                maxCount = cluster.locations[location];
                mostFrequentLocation = location;
            }
        }

        const medianRPM = calculateMedian(cluster.rpms); // Calculate median
        const centroidLat = cluster.totalLat / cluster.loadVolume;
        const centroidLon = cluster.totalLon / cluster.loadVolume;

        return {
            ...cluster,
            name: mostFrequentLocation,
            avgRPM: medianRPM, // Use median RPM here
            lat: centroidLat,
            lon: centroidLon
        };
    });
}

/**
 * Processes raw load data for state-based view.
 * @param {Array} rawLoads - The array of raw load objects.
 * @returns {Array} An array of objects for each state with aggregated data.
 */
function processLoadsForStateView(rawLoads, direction) {
    if (!rawLoads || rawLoads.length === 0) return [];

    const locField = direction === 'inbound' ? 'do_location' : 'pu_location';

    const stateData = rawLoads.reduce((acc, load) => {
        const location = load[locField] || '';
        const stateAbbrMatch = location.match(/,\s*([A-Z]{2})$/);
        if (!stateAbbrMatch) return acc;
        const stateAbbr = stateAbbrMatch[1];

        if (!acc[stateAbbr]) {
            acc[stateAbbr] = { state: stateAbbr, loadVolume: 0, rpms: [] };
        }

        acc[stateAbbr].loadVolume++;
        const rpm = parseFloat(load.rpm_all);
        if (!isNaN(rpm) && rpm > 0) {
            acc[stateAbbr].rpms.push(rpm); // Add each RPM to an array
        }
        return acc;
    }, {});

    return Object.values(stateData).map(state => ({
        ...state,
        avgRPM: calculateMedian(state.rpms) // Calculate median RPM for the state
    }));
}

/**
 * Renders a map, handling both state and cluster modes.
 * @param {HTMLElement} container - The container element to render the map in.
 * @param {Array} data - The dataset to visualize.
 * @param {string} mode - The visualization mode ('state' or 'cluster').
 * @param {string} metric - The metric to visualize ('rpm' or 'volume').
 */

function renderMap(container, data, mode, metric, clusterSize, direction, universalMedian) {
    // --- Universal Tooltip (Reverted to correct global selection) ---
    const tooltip = d3.select("#loads-tooltip");

    // --- Cleanup existing map elements before switching ---
    if (container.threejs_scene && mode !== 'state') {
        container.threejs_scene.destroy();
        container.threejs_scene = null;
    }
    if (container.querySelector('svg') && mode !== 'cluster') {
        container.querySelector('svg').remove();
    }

    // --- Render based on mode ---
    if (mode === 'state') {
        if (container.threejs_scene) {
            container.threejs_scene.update(data, direction);
        } else {
            initializeThreeJsMap(container, data, direction, tooltip);
        }
    } else {
        renderClusterMap(container, data, clusterSize, direction, metric, tooltip, universalMedian);
    }
}

// 🟢 REPLACE the entire initializeThreeJsMap function in DISP. TEST/loads/loads_maps.js with this new version.

// --- HELPER: Initialize 3D Map ---
function initializeThreeJsMap(container, data, direction, tooltip) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 10000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
    directionalLight.position.set(200, 500, 300);
    scene.add(directionalLight);

    camera.position.set(0, -container.clientHeight * 0.7, 500);
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    const projection = d3.geoAlbersUsa().scale(container.clientWidth * 1.2).translate([0, 0]);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const mousePosition = { x: 0, y: 0 };
    let intersectedObject = null;
    const stateMeshes = [];
    let hasMouseMoved = false;
    let isMouseOverCanvas = false; // <<< KEY ADDITION: Track mouse presence
    let animationFrameId;

    const group = new THREE.Group();
    scene.add(group);

    // --- MOUSE EVENT LISTENERS ---
    const onMouseMove = (event) => {
        hasMouseMoved = true;
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        mousePosition.x = event.clientX;
        mousePosition.y = event.clientY;
    };
    const onMouseEnter = () => { isMouseOverCanvas = true; };
    const onMouseLeave = () => { isMouseOverCanvas = false; };

    renderer.domElement.addEventListener('mousemove', onMouseMove, false);
    renderer.domElement.addEventListener('mouseenter', onMouseEnter, false);
    renderer.domElement.addEventListener('mouseleave', onMouseLeave, false);


    const animate = () => {
        animationFrameId = requestAnimationFrame(animate);
        TWEEN.update();
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(stateMeshes);

        // Only manage tooltip if the mouse is over this specific canvas
        if (isMouseOverCanvas) {
            if (intersects.length > 0 && hasMouseMoved) {
                const newIntersect = intersects[0].object;
                if (intersectedObject !== newIntersect) {
                    if (intersectedObject) {
                        new TWEEN.Tween(intersectedObject.material.color)
                            .to(new THREE.Color(intersectedObject.userData.originalColor), 150).start();
                    }
                    intersectedObject = newIntersect;
                    stateMeshes.forEach(mesh => {
                        if (mesh !== intersectedObject) {
                            new TWEEN.Tween(mesh.material).to({ opacity: 0.25 }, 200).start();
                        } else {
                            new TWEEN.Tween(mesh.material).to({ opacity: 1.0 }, 200).start();
                            new TWEEN.Tween(mesh.material.color).to(new THREE.Color(0xffffff), 150).start();
                        }
                    });
                }
                tooltip.classed('hidden', false);
                tooltip.html(`<div class="font-bold text-white">${intersectedObject.userData.name}</div>
                             <div><span class="font-semibold">Avg RPM:</span> $${intersectedObject.userData.rpm.toFixed(2)}</div>
                             <div><span class="font-semibold">Load Volume:</span> ${intersectedObject.userData.volume.toFixed(0)}</div>`);
                tooltip.style("left", `${mousePosition.x + 15}px`).style("top", `${mousePosition.y}px`);
            } else {
                if (intersectedObject) {
                    stateMeshes.forEach(mesh => {
                        new TWEEN.Tween(mesh.material).to({ opacity: 1.0 }, 200).start();
                        if (mesh === intersectedObject) {
                            new TWEEN.Tween(mesh.material.color)
                                .to(new THREE.Color(mesh.userData.originalColor), 150).start();
                        }
                    });
                }
                intersectedObject = null;
                tooltip.classed('hidden', true);
            }
        } else {
             // If mouse is NOT over this canvas, ensure any lingering highlights are removed
            if (intersectedObject) {
                 stateMeshes.forEach(mesh => {
                    new TWEEN.Tween(mesh.material).to({ opacity: 1.0 }, 200).start();
                     if (mesh === intersectedObject) {
                        new TWEEN.Tween(mesh.material.color)
                            .to(new THREE.Color(mesh.userData.originalColor), 150).start();
                    }
                });
                intersectedObject = null;
            }
        }
        renderer.render(scene, camera);
    };

    const update = (newData, newDirection) => {
        const processedData = processLoadsForStateView(newData, newDirection);
        const stateDataMap = new Map(processedData.map(d => [stateAbbrToFullName[d.state.toUpperCase()], d]));

        const rpmValues = processedData.map(d => d.avgRPM).filter(rpm => rpm > 0).sort((a, b) => a - b);
        const minRpm = rpmValues.length > 0 ? rpmValues[0] : 1.5;
        const maxRpm = rpmValues.length > 0 ? rpmValues[rpmValues.length - 1] : 3.5;
        const medianRpm = d3.median(rpmValues) || 2.5;

        const volumeDomain = d3.extent(processedData, d => d.loadVolume);

        const rpmColorScale = d3.scaleLinear().domain([minRpm, medianRpm, maxRpm]).range(["#2563eb", "#9ca3af", "#dc2626"]);
        const volumeHeightScale = d3.scaleLinear().domain(volumeDomain[0] > 0 ? volumeDomain : [0, 1]).range([1, 100]);

        stateMeshes.forEach(mesh => {
            const stateData = stateDataMap.get(mesh.userData.name);
            const color = stateData ? rpmColorScale(stateData.avgRPM) : 0x2d3748;
            const height = stateData ? volumeHeightScale(stateData.loadVolume) : 1;

            new TWEEN.Tween(mesh.material.color)
                .to(new THREE.Color(color), 300)
                .easing(TWEEN.Easing.Quadratic.InOut)
                .start();

            new TWEEN.Tween(mesh.scale)
                .to({ z: height }, 300)
                .easing(TWEEN.Easing.Quadratic.InOut)
                .start();

            mesh.userData.rpm = stateData ? stateData.avgRPM : 0;
            mesh.userData.volume = stateData ? stateData.loadVolume : 0;
            mesh.userData.originalColor = new THREE.Color(color).getHex();
        });
    };

    const destroy = () => {
        cancelAnimationFrame(animationFrameId);
        renderer.domElement.removeEventListener('mousemove', onMouseMove);
        renderer.domElement.removeEventListener('mouseenter', onMouseEnter);
        renderer.domElement.removeEventListener('mouseleave', onMouseLeave);
        renderer.dispose();
        if (renderer.domElement.parentElement) {
            container.removeChild(renderer.domElement);
        }
    };
    
    container.threejs_scene = { update, destroy };

    d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json").then(us => {
        const unwantedFips = ["02", "15", "72", "60", "66", "69", "78"];
        const states = topojson.feature(us, us.objects.states).features.filter(d => !unwantedFips.includes(d.id));

        states.forEach(feature => {
            const material = new THREE.MeshLambertMaterial({ transparent: true, opacity: 1.0 });
            const shapes = d3.geoPath().projection(projection)(feature);
            if (!shapes) return;
            const shape3d = transformSVGPath(shapes);
            const extrudeSettings = { depth: 1, bevelEnabled: false };
            const geometry = new THREE.ExtrudeGeometry(shape3d, extrudeSettings);
            const mesh = new THREE.Mesh(geometry, material);

            mesh.userData = { name: feature.properties.name };
            group.add(mesh);
            stateMeshes.push(mesh);
        });

        const box = new THREE.Box3().setFromObject(group);
        const center = box.getCenter(new THREE.Vector3());
        group.position.sub(center);

        update(data, direction);
        animate();
    });
}

// --- NEW HELPER: Render 2D Cluster Map ---
function renderClusterMap(container, data, clusterSize, direction, metric, tooltip, universalMedian) {
    const width = container.clientWidth;
    const height = container.clientHeight;

    const svg = d3.select(container).selectAll("svg").data([null]).join("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .on("mouseleave", () => { // <<< ADD THIS EVENT LISTENER
            tooltip.classed('hidden', true);
        });

    // Load the map geometry first to fit the projection
    d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json").then(us => {
        const unwantedFips = ["02", "15", "72", "60", "66", "69", "78"];
        const statesGeoJson = topojson.feature(us, us.objects.states);
        statesGeoJson.features = statesGeoJson.features.filter(d => !unwantedFips.includes(d.id));

        const projection = d3.geoAlbersUsa()
            .fitSize([width, height], statesGeoJson);

        const pathGenerator = d3.geoPath().projection(projection);

        const stateLayer = svg.selectAll(".state-layer").data([null]).join("g").attr("class", "state-layer");
        stateLayer.selectAll(".state-boundary")
            .data(statesGeoJson.features)
            .join("path")
            .attr("class", "state-boundary")
            .attr("d", pathGenerator)
            .attr("fill", "#2d3748");

        processLoadsForClustering(data, clusterSize, direction).then(clusterData => {
            const radiusMultiplier = d3.scaleLinear().domain([1, 5]).range([1, 2]);
            const minRadius = 4 * radiusMultiplier(clusterSize);
            const maxRadius = (width / 40) * radiusMultiplier(clusterSize);
            const volumeScale = d3.scaleSqrt()
                .domain([0, d3.max(clusterData, d => d.loadVolume)])
                .range([minRadius, maxRadius]);
            
                const fixedRange = 0.75; // <-- You can adjust this value ($0.75 RPM spread)
                const universalMinRpm = (universalMedian || 2.5) - fixedRange;
                const universalMaxRpm = (universalMedian || 2.5) + fixedRange;
                
                const colorScale = d3.scaleLinear()
                    .domain(metric === 'rpm' ? [universalMinRpm, universalMedian || 2.5, universalMaxRpm] : d3.extent(clusterData, d => d.loadVolume))
                    .range(metric === 'rpm' ? ["#2563eb", "#9ca3af", "#dc2626"] : ["#dbeafe", "#1e3a8a"])
                    .clamp(true);

            const clusterLayer = svg.selectAll(".cluster-layer").data([null]).join("g").attr("class", "cluster-layer");
            clusterLayer.selectAll(".state-circle")
                .data(clusterData, d => `${d.lat}-${d.lon}`)
                .join(
                    enter => enter.append("circle")
                        .attr("class", "state-circle")
                        .attr("transform", d => `translate(${projection([d.lon, d.lat]) || [-100, -100]})`)
                        .attr("r", 0)
                        .style("fill", d => colorScale(metric === 'rpm' ? d.avgRPM : d.loadVolume))
                        .call(enter => enter.transition().duration(500).attr("r", d => volumeScale(d.loadVolume))),
                    update => update
                        .call(update => update.transition().duration(500)
                            .attr("transform", d => `translate(${projection([d.lon, d.lat]) || [-100, -100]})`)
                            .style("fill", d => colorScale(metric === 'rpm' ? d.avgRPM : d.loadVolume))
                            .attr("r", d => volumeScale(d.loadVolume))),
                    exit => exit
                        .call(exit => exit.transition().duration(500).attr("r", 0).remove())
                )
                .on("mouseover", function(event, d) {
                    d3.select(this).classed('hovered', true).raise();
                    tooltip.classed('hidden', false)
                           .html(`<div class="font-bold text-white">${d.name}</div><div><span class="font-semibold">Load Volume:</span> ${d.loadVolume}</div><div><span class="font-semibold">Avg RPM:</span> $${d.avgRPM.toFixed(2)}</div>`)
                           .style("left", (event.pageX + 15) + "px")
                           .style("top", (event.pageY - 28) + "px");
                }).on("mouseout", function() {
                    d3.select(this).classed('hovered', false);
                    tooltip.classed('hidden', true);
                });
        });
    });
}

function transformSVGPath(path) {
    const shapes = [];
    const pathCommands = path.match(/[mzlhvcsqta][^mzlhvcsqta]*/ig);
    if (!pathCommands) return shapes;
    
    let shape;
    pathCommands.forEach(commandString => {
        let command = commandString[0];
        let points = commandString.slice(1).trim().split(/[\s,]+/).map(parseFloat).filter(v => !isNaN(v));

        if (command === 'M') {
            shape = new THREE.Shape();
            shapes.push(shape);
            shape.moveTo(points[0], -points[1]);
            // Handle implicit lineto commands that can follow M
            for (let i = 2; i < points.length; i += 2) {
                shape.lineTo(points[i], -points[i+1]);
            }
        } else if (command === 'L') {
            if(shape) {
                // Handle multiple lineto segments
                for (let i = 0; i < points.length; i += 2) {
                    shape.lineTo(points[i], -points[i+1]);
                }
            }
        } else if (command === 'Z' || command === 'z') {
            if (shape) shape.closePath();
        }
    });
    return shapes;
}

export async function renderPrimaryMap(container, data, universalMedian) {
    const { appState } = await import('../state.js');
    const { mapAStartDate, mapAEndDate } = appState.loads;
    let filteredData = data;

    if (mapAStartDate && mapAEndDate) {
        filteredData = data.filter(load => {
            if (!load.pu_date) return false;
            const loadPuDateString = load.pu_date.split('T')[0];
            return loadPuDateString >= mapAStartDate && loadPuDateString <= mapAEndDate;
        });
    }

    renderMap(container, filteredData, appState.loads.mapAMode, appState.loads.mapAMetric, appState.loads.mapAClusterSize, appState.loads.mapADirection, universalMedian);
}

export async function renderComparisonMap(container, data, universalMedian) {
    const { appState } = await import('../state.js');
    const { mapBStartDate, mapBEndDate } = appState.loads;
    let filteredData = data;

    if (mapBStartDate && mapBEndDate) {
        filteredData = data.filter(load => {
            if (!load.pu_date) return false;
            const loadPuDateString = load.pu_date.split('T')[0];
            return loadPuDateString >= mapBStartDate && loadPuDateString <= mapBEndDate;
        });
    }

    renderMap(container, filteredData, appState.loads.mapBMode, appState.loads.mapBMetric, appState.loads.mapBClusterSize, appState.loads.mapBDirection, universalMedian);
}