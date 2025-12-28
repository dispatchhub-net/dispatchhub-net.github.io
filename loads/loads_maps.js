// DISPATCH TESTER/loads/loads_maps.js
import { appState } from '../state.js';
import { calculateMedian } from '../utils.js';
import { canViewTeam, canViewDispatcher, isAdmin } from '../auth.js';

const getCompositeTeamName = (load) => {
    if (!load || !load.team) return null;
    const specialPrefixes = ['agnius', 'miles', 'uros'];
    const teamLower = load.team.toLowerCase();
    const prefix = specialPrefixes.find(p => teamLower.startsWith(p));
    
    if (prefix && load.company_name) {
        return `${prefix.charAt(0).toUpperCase() + prefix.slice(1)} ${load.company_name}`;
    }
    return load.team;
};

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
                // Add team/dispatcher info for permission checks
                teams: new Set(),
                dispatchers: new Set(),
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
        if (load.team) acc[gridKey].teams.add(load.team);
        if (load.dispatcher) acc[gridKey].dispatchers.add(load.dispatcher);
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
            lon: centroidLon,
            teams: [...cluster.teams], // Convert Set to Array
            dispatchers: [...cluster.dispatchers], // Convert Set to Array
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
    let isMouseOverCanvas = false;
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

    const onWheel = (event) => {
        event.preventDefault();
        const zoomSpeed = 0.5;
        camera.position.z += event.deltaY * zoomSpeed;
        // Add constraints to prevent zooming too far in or out
        camera.position.z = Math.max(150, Math.min(1200, camera.position.z));
    };

    const onClick = (event) => {
        if (intersectedObject) {
            const stateName = intersectedObject.userData.name;
            const stateAbbr = Object.keys(stateAbbrToFullName).find(key => stateAbbrToFullName[key] === stateName);
    
            if (stateAbbr && window.showDeepDive) {
                 const clickedLoads = container.threejs_scene.raw_data.filter(load => {
                    const locField = container.threejs_scene.direction === 'inbound' ? 'do_location' : 'pu_location';
                    const location = load[locField] || '';
                    const stateAbbrMatch = location.match(/,\s*([A-Z]{2})$/);
                    return stateAbbrMatch && stateAbbrMatch[1] === stateAbbr;
                });
    
                window.showDeepDive({
                    type: 'State',
                    name: stateName,
                    data: clickedLoads,
                    definition: {
                        stateAbbr: stateAbbr,
                        direction: container.threejs_scene.direction
                    }
                });
            }
        }
    };

    renderer.domElement.addEventListener('mousemove', onMouseMove, false);
    renderer.domElement.addEventListener('mouseenter', onMouseEnter, false);
    renderer.domElement.addEventListener('mouseleave', onMouseLeave, false);
    renderer.domElement.addEventListener('click', onClick, false);
    renderer.domElement.addEventListener('wheel', onWheel, false);


    const animate = () => {
        animationFrameId = requestAnimationFrame(animate);
        TWEEN.update();
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(stateMeshes);

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
        container.threejs_scene.raw_data = newData;
        container.threejs_scene.direction = newDirection;
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
        renderer.domElement.removeEventListener('click', onClick);
        renderer.domElement.removeEventListener('wheel', onWheel);
        renderer.dispose();
        if (renderer.domElement.parentElement) {
            container.removeChild(renderer.domElement);
        }
    };
    
    container.threejs_scene = { update, destroy, raw_data: data, direction: direction };

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
export function renderClusterMap(container, datasets, clusterSize, direction, metric, tooltip, universalMedian, radiusDivisor = 40) {
    const width = container.clientWidth;
    const height = container.clientHeight;
    const isDispatcherRoleInTeamMode = appState.auth.user?.role === 'Dispatcher' && appState.rankingMode === 'team';

    const svg = d3.select(container).selectAll("svg").data([null]).join("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet");
        
    svg.html('');

    const g = svg.append("g"); // Main group for zooming

    d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json").then(us => {
        const unwantedFips = ["02", "15", "72", "60", "66", "69", "78"];
        const statesGeoJson = topojson.feature(us, us.objects.states);
        statesGeoJson.features = statesGeoJson.features.filter(d => !unwantedFips.includes(d.id));

        const projection = d3.geoAlbersUsa().fitSize([width, height], statesGeoJson);
        const pathGenerator = d3.geoPath().projection(projection);

        const stateLayer = g.append("g").attr("class", "state-layer");
        stateLayer.selectAll(".state-boundary")
            .data(statesGeoJson.features)
            .join("path")
            .attr("class", "state-boundary")
            .attr("d", pathGenerator)
            .attr("fill", "#2d3748");

        const clusterLayer = g.append("g").attr("class", "cluster-layer");
        const flowLayer = g.append("g").attr("class", "flow-layer");

        const backButton = svg.append("g") // Back button is outside the zoomable group
            .attr("class", "back-button")
            .style("display", "none")
            .attr("transform", `translate(20, 20)`)
            .on("click", () => {
                flowLayer.html("");
                clusterLayer.style("display", null);
                backButton.style("display", "none");
                if (window.resetHeatmapDetailsView) window.resetHeatmapDetailsView();
                // Reset zoom on back
                svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
            });

        backButton.append("rect").attr("width", 60).attr("height", 25).attr("rx", 5).attr("ry", 5).style("fill", "#4b5563");
        backButton.append("text").attr("x", 30).attr("y", 17).style("text-anchor", "middle").style("fill", "white").style("font-size", "12px").text("← Back");

        const allClusterDataPromises = datasets.map((datasetInfo, index) => 
            processLoadsForClustering(datasetInfo.data, clusterSize, direction).then(clusters => 
                clusters.map(c => ({ ...c, datasetIndex: index, color: datasetInfo.color }))
            )
        );

        Promise.all(allClusterDataPromises).then(allClustersFlat => {
            const allClusters = allClustersFlat.flat();
            const groupedClusters = allClusters.reduce((acc, cluster) => {
                const key = `${Math.round(cluster.lat / clusterSize) * clusterSize},${Math.round(cluster.lon / clusterSize) * clusterSize}`;
                if (!acc[key]) acc[key] = { lat: cluster.lat, lon: cluster.lon, clusters: [] };
                acc[key].clusters.push(cluster);
                return acc;
            }, {});

            const finalData = Object.values(groupedClusters);
            const radiusMultiplier = d3.scaleLinear().domain([1, 5]).range([1, 2]);
            const minRadius = 3 * radiusMultiplier(clusterSize);
            const maxRadius = (width / radiusDivisor) * radiusMultiplier(clusterSize);
            const maxVolume = d3.max(finalData, d => d3.sum(d.clusters, c => c.loadVolume));
            const volumeScale = d3.scaleLinear().domain([0, maxVolume || 1]).range([minRadius, maxRadius]);
            
            const fixedRange = 0.75;
            const universalMinRpm = (universalMedian || 2.5) - fixedRange;
            const universalMaxRpm = (universalMedian || 2.5) + fixedRange;
            const colorScale = d3.scaleLinear()
                .domain(metric === 'rpm' ? [universalMinRpm, universalMedian || 2.5, universalMaxRpm] : [0, maxVolume || 1])
                .range(metric === 'rpm' ? ["#2563eb", "#9ca3af", "#dc2626"] : ["#dbeafe", "#1e3a8a"]).clamp(true);

            clusterLayer.selectAll(".cluster-node")
                .data(finalData, d => `${d.lat}-${d.lon}`)
                .join("g")
                .attr("class", "cluster-node")
                .attr("transform", d => `translate(${projection([d.lon, d.lat]) || [-100, -100]})`)
                .each(function(d) {
                    const g = d3.select(this);
                    const totalVolume = d3.sum(d.clusters, c => c.loadVolume);
                    const radius = volumeScale(totalVolume);

                    if (d.clusters.length > 1) {
                        const pie = d3.pie().value(() => 1).sort(null);
                        const arc = d3.arc().innerRadius(0).outerRadius(radius);
                        g.selectAll("path")
                            .data(pie(d.clusters))
                            .enter().append("path")
                            .attr("d", arc)
                            .style("fill", (p, i) => p.data.color || colorScale(p.data.avgRPM))
                            .style("stroke", "#1f2937").style("stroke-width", "1px");
                    } else {
                        const cluster = d.clusters[0];
                        g.append("circle")
                            .attr("class", "state-circle")
                            .attr("r", radius)
                            .style("fill", cluster.color || colorScale(metric === 'rpm' ? cluster.avgRPM : cluster.loadVolume));
                    }
                })
                .on("mouseover", function(event, d) {
                    d3.select(this).classed('hovered', true).raise();
                    tooltip.classed('hidden', false);
                    const isComparing = datasets.length > 1;
                    const totalLoads = d3.sum(d.clusters, c => c.loadVolume);
                    let tooltipHtml = `<div class="font-bold text-white">${d.clusters[0].name} (Total: ${totalLoads})</div>`;

                    d.clusters.forEach(c => {
                        const datasetLabel = isComparing ? (c.datasetIndex === 0 ? 'Primary' : 'Comparison') : '';
                        const labelPrefix = isComparing ? `■ ${datasetLabel}:` : '■';
                        
                        const canView = appState.rankingMode === 'team' ? 
                            (c.teams || []).every(canViewTeam) : 
                            (c.dispatchers || []).every(canViewDispatcher);
                        const rpmText = canView && !isDispatcherRoleInTeamMode ? `$${c.avgRPM.toFixed(2)} RPM` : '-';

                        tooltipHtml += `<div class="mt-1"><span class="font-semibold" style="color: ${c.color || 'white'}">${labelPrefix}</span> ${c.loadVolume} loads, ${rpmText}</div>`;
                    });

                    tooltip.html(tooltipHtml)
                           .style("left", (event.pageX + 15) + "px")
                           .style("top", (event.pageY + 15) + "px");
                })
                .on("mouseout", function() {
                    d3.select(this).classed('hovered', false);
                    tooltip.classed('hidden', true);
                })
                .on("click", function(event, d) {
                    clusterLayer.style("display", "none");
                    backButton.style("display", null);
                    flowLayer.html("");

                    const originPoint = projection([d.lon, d.lat]);
                    const allClickedLoads = d.clusters.flatMap(cluster => {
                        const dataset = datasets[cluster.datasetIndex];
                        const loadsInCluster = dataset.data.filter(load => {
                            const latField = direction === 'inbound' ? 'do_latitude' : 'pu_latitude';
                            const lonField = direction === 'inbound' ? 'do_longitude' : 'pu_longitude';
                            if (isNaN(parseFloat(load[latField])) || isNaN(parseFloat(load[lonField]))) return false;
                            const GRID_SIZE = clusterSize;
                            const loadGridKey = `${Math.round(parseFloat(load[latField]) / GRID_SIZE) * GRID_SIZE},${Math.round(parseFloat(load[lonField]) / GRID_SIZE) * GRID_SIZE}`;
                            const clusterGridKey = `${Math.round(cluster.lat / GRID_SIZE) * GRID_SIZE},${Math.round(cluster.lon / GRID_SIZE) * GRID_SIZE}`;
                            return loadGridKey === clusterGridKey;
                        });
                        return loadsInCluster.map(load => ({ ...load, __color: dataset.color }));
                    });

                    if (window.showClusterLoadDetails) {
                        const isComparing = datasets.length > 1;
                        window.showClusterLoadDetails(allClickedLoads, d.clusters[0].name, isComparing);
                    }

                    const destFieldLat = direction === 'inbound' ? 'pu_latitude' : 'do_latitude';
                    const destFieldLon = direction === 'inbound' ? 'pu_longitude' : 'do_longitude';
                    
                    const destinations = allClickedLoads.map(load => {
                        const destLat = parseFloat(load[destFieldLat]);
                        const destLon = parseFloat(load[destFieldLon]);
                        if (!isNaN(destLat) && !isNaN(destLon)) {
                            return {
                                point: projection([destLon, destLat]),
                                color: load.__color
                            };
                        }
                        return null;
                    }).filter(p => p && p.point);

                    flowLayer.selectAll(".flow-line")
                        .data(destinations)
                        .enter().append("line")
                        .attr("class", "flow-line")
                        .attr("x1", originPoint[0])
                        .attr("y1", originPoint[1])
                        .attr("x2", d => d.point[0])
                        .attr("y2", d => d.point[1])
                        .style("stroke", d => d.color || '#f59e0b');

                    flowLayer.selectAll(".flow-marker")
                        .data(destinations)
                        .enter().append("text")
                        .attr("class", "flow-marker")
                        .attr("x", d => d.point[0])
                        .attr("y", d => d.point[1])
                        .text("X")
                        .style("fill", d => d.color || '#ef4444');
                    
                    flowLayer.append("circle")
                        .attr("class", "origin-dot")
                        .attr("cx", originPoint[0])
                        .attr("cy", originPoint[1])
                        .attr("r", 6);
                });
        });

        // Add zoom behavior
        const zoomed = (event) => {
            g.attr("transform", event.transform);
        };

        const zoom = d3.zoom()
            .scaleExtent([1, 8]) // Zoom in up to 8x
            .on("zoom", zoomed);

        svg.call(zoom);
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

export function renderDriverRouteMap(container, loads, direction, tooltip) {
    const width = container.clientWidth;
    const height = container.clientHeight;
    const isDispatcherRoleInTeamMode = appState.auth.user?.role === 'Dispatcher' && appState.rankingMode === 'team';

    const svg = d3.select(container).selectAll("svg").data([null]).join("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet");
        
    svg.html('');

    const g = svg.append("g"); // Main group for zooming

    d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json").then(us => {
        const unwantedFips = ["02", "15", "72", "60", "66", "69", "78"];
        const statesGeoJson = topojson.feature(us, us.objects.states);
        statesGeoJson.features = statesGeoJson.features.filter(d => !unwantedFips.includes(d.id));

        const projection = d3.geoAlbersUsa().fitSize([width, height], statesGeoJson);
        const pathGenerator = d3.geoPath().projection(projection);

        g.append("g").selectAll(".state-boundary")
            .data(statesGeoJson.features)
            .join("path")
            .attr("class", "state-boundary")
            .attr("d", pathGenerator)
            .attr("fill", "#2d3748");

        const points = loads.map((load, index) => {
            const puLat = parseFloat(load.pu_latitude);
            const puLon = parseFloat(load.pu_longitude);
            const delLat = parseFloat(load.do_latitude);
            const delLon = parseFloat(load.do_longitude);

            if (isNaN(puLat) || isNaN(puLon) || isNaN(delLat) || isNaN(delLon)) return null;

            return {
                ...load,
                order: index + 1,
                puCoordinates: projection([puLon, puLat]),
                delCoordinates: projection([delLon, delLat])
            };
        }).filter(p => p && p.puCoordinates && p.delCoordinates);

        if (points.length === 0) {
            g.append("text")
                .attr("x", width / 2)
                .attr("y", height / 2)
                .attr("text-anchor", "middle")
                .attr("fill", "#6b7280")
                .text("No valid load locations for this driver.");
            return;
        }

        const routeData = [];
        for(let i = 0; i < points.length - 1; i++) {
            routeData.push([points[i].puCoordinates, points[i+1].puCoordinates]);
        }
        
        g.append("g").selectAll("path.route")
            .data(routeData)
            .join("path")
            .attr("class", "route")
            .attr("d", d3.line())
            .attr("stroke", "#fde047") // PALE YELLOW
            .attr("stroke-width", 2)
            .attr("fill", "none")
            .attr("stroke-dasharray", "4 4");
            
        if(points.length > 0) {
            const lastPoint = points[points.length - 1];
            g.append("line")
               .attr("x1", lastPoint.puCoordinates[0])
               .attr("y1", lastPoint.puCoordinates[1])
               .attr("x2", lastPoint.delCoordinates[0])
               .attr("y2", lastPoint.delCoordinates[1])
               .attr("stroke", "#5eead4") // PALE TEAL/GREEN
               .attr("stroke-width", 2.5)
               .attr("fill", "none")
               .attr("stroke-dasharray", "5 5");
        }

        const nodes = g.append("g").selectAll("g")
            .data(points)
            .join("g")
            .attr("transform", d => `translate(${d.puCoordinates[0]},${d.puCoordinates[1]})`);

        nodes.append("circle")
            .attr("r", 12)
            .attr("fill", "#111827")
            .attr("stroke", "#fca5a5") // PALE RED
            .attr("stroke-width", 2);

        nodes.append("text")
            .attr("text-anchor", "middle")
            .attr("dy", "0.35em")
            .attr("fill", "white")
            .attr("font-size", "10px")
            .attr("font-weight", "bold")
            .text(d => d.order);
            
        if(points.length > 0) {
             const lastPoint = points[points.length - 1];
             const finalDelNode = g.append("g")
                .attr("transform", `translate(${lastPoint.delCoordinates[0]},${lastPoint.delCoordinates[1]})`);
            
             finalDelNode.append("circle")
                .attr("r", 12)
                .attr("fill", "#042f2e") 
                .attr("stroke", "#5eead4") // PALE TEAL/GREEN
                .attr("stroke-width", 2.5);

             finalDelNode.append("text")
                .attr("text-anchor", "middle")
                .attr("dy", "0.35em")
                .attr("fill", "white")
                .attr("font-size", "10px")
                .attr("font-weight", "bold")
                .text("✓");
        }

        nodes.on("mouseover", function(event, d) {
                tooltip.classed('hidden', false);
                const puDate = d.pu_date ? new Date(d.pu_date).toLocaleDateString('en-US', {month: '2-digit', day: '2-digit'}) : 'N/A';
                const delDate = d.do_date ? new Date(d.do_date).toLocaleDateString('en-US', {month: '2-digit', day: '2-digit'}) : 'N/A';
                
                const compositeTeamName = getCompositeTeamName(d);
                const canView = appState.rankingMode === 'team' ? canViewTeam(compositeTeamName) : canViewDispatcher(d.dispatcher);
                const rateText = canView && !isDispatcherRoleInTeamMode ? `$${(d.price || 0).toLocaleString()}` : '-';
                const rpmText = canView && !isDispatcherRoleInTeamMode ? `$${(d.rpm_all || 0).toFixed(2)}` : '-';

                tooltip.html(`
                    <div class="font-bold text-white">Load #${d.order} (PU: ${puDate})</div>
                    <div><strong>PU:</strong> ${d.pu_location}</div>
                    <div><strong>DO:</strong> ${d.do_location} (DEL: ${delDate})</div>
                    <div><strong>Rate:</strong> ${rateText} | <strong>RPM:</strong> ${rpmText}</div>
                `);
                tooltip.style("left", (event.pageX + 15) + "px").style("top", (event.pageY + 15) + "px");
            })
            .on("mouseout", function() {
                tooltip.classed('hidden', true);
            });

        // Add zoom behavior
        const zoomed = (event) => {
            g.attr("transform", event.transform);
        };

        const zoom = d3.zoom()
            .scaleExtent([1, 8]) // Zoom in up to 8x
            .on("zoom", zoomed);

        svg.call(zoom);
    });
}