// 1. DISPEČ TEST/main.js

import { startTimer, fetchWithRetry } from './utils.js'; // <-- Import fetchWithRetry
import { HISTORICAL_STUBS_URLS, DRIVER_COUNT_LIVE_URL } from './config.js';
import { renderLoadsAnalyticsUI, initializeAnalyticsEventListeners } from './loads/loads_ui.js';
import { appState, allColumns, setDraggedColumnId, setDraggedViewName } from './state.js';
import { generateAllColumns } from './config.js';
import { renderTeamProfileUI } from './profiles/profiles_ui.js';
import { fetchProfileData } from './profiles/profiles_api.js';
import {
    fetchAllHistoricalData,
    processDataForMode,
    getOrComputeHistoricalMetrics
} from './rankings/rankings_api.js';
import {
    renderUI,
    renderRefreshStatus,
    renderViewDropdown,
    populateDateDropdown,
    handleCloseEntityModal,
    handleCloseMainCriteriaModal,
    handleCloseDisplaySettingsModal,
    handleClosePerformanceTrackerSettingsModal,
    saveView,
    loadDefaultView,
    updateDynamicTitles,
    updateDriverTypeSwitcherUI,
    requestStubsSort,
    renderModalContent
} from './rankings/rankings_ui.js';

// --- NEW: Data Refresh Function ---

const updateProgressBar = (percentage) => {
    const progressBar = document.getElementById('loading-progress-bar');
    const finalPercentage = Math.min(100, Math.round(percentage));

    if (progressBar) {
        progressBar.style.width = `${finalPercentage}%`;
    }
};

const refreshData = async (isInitialLoad = false) => {
    console.log(`%c[REFRESH] Starting data refresh (Initial Load: ${isInitialLoad})...`, 'color: cyan');
    if (isInitialLoad) {
        updateProgressBar(5); // Start with a small amount of progress
    }
    if (!isInitialLoad) {
        appState.isRefreshing = true;
        renderRefreshStatus();
    }

    try {
        console.log('[REFRESH] Kicking off parallel data fetches...');
        const dataFetchTimer = startTimer('All Data Fetching (Parallel)');
        
        // --- START: Progress tracking logic ---
        let loadedCount = 0;
        const totalFetches = 4; // We have 4 main data sources
        const updateProgress = () => {
            loadedCount++;
            // We start at 5% and the fetches make up the next 90%
            const percentage = 5 + (loadedCount / totalFetches) * 90;
            updateProgressBar(percentage);
        };
        // --- END: Progress tracking logic ---

        const historicalTimer = startTimer('fetchAllHistoricalData');
        const profileTimer = startTimer('fetchProfileData');
        const stubsTimer = startTimer('fetchHistoricalStubs');
        const countsTimer = startTimer('fetchLiveDriverCounts');

        await Promise.all([
            // Each fetch now calls updateProgress() when it completes
            fetchAllHistoricalData().then(res => { historicalTimer.stop(); updateProgress(); console.log('[REFRESH] ✅ fetchAllHistoricalData finished.'); return res; }),
            fetchProfileData().then(res => { profileTimer.stop(); updateProgress(); console.log('[REFRESH] ✅ fetchProfileData finished.'); return res; }),
            fetchHistoricalStubs().then(res => { stubsTimer.stop(); updateProgress(); console.log('[REFRESH] ✅ fetchHistoricalStubs finished.'); return res; }),
            fetchLiveDriverCounts().then(res => { countsTimer.stop(); updateProgress(); console.log('[REFRESH] ✅ fetchLiveDriverCounts finished.'); return res; })
        ]);

        console.log('[REFRESH] All parallel data fetches have completed.');
        dataFetchTimer.stop();

        if (appState.allHistoricalData.length === 0) {
            console.warn("No historical data for the RANKINGS view was found. The Rankings dashboard may be empty, but other sections will work.");
        }

        console.log('[REFRESH] Starting data processing...');
        const processingTimer = startTimer('Data Processing and UI Setup');
        appState.profiles.fleetHealthCache = {};
        appState.precomputationCache = { dispatcher: {}, team: {} };

        if (isInitialLoad) {
            loadDefaultView();
        }
        
        processDataForMode();
        getOrComputeHistoricalMetrics();

        const excludedNames = [
            'cletus spuckler',
            'ralph wiggum',
            'seymour skinner',
            'med disp disp'
        ];

        appState.allDispatcherNames = [...new Set(appState.allHistoricalData.map(d => d.dispatcherName).filter(Boolean))]
            .filter(name => !excludedNames.includes(name.toLowerCase()))
            .sort();

        appState.allTeamNames = [...new Set(appState.allHistoricalData.map(d => d.dispatcherTeam).filter(Boolean))]
            .filter(name => !excludedNames.includes(name.toLowerCase()))
            .sort();
        
        if (appState.data.length > 0 && appState.selectedBumpEntities.length === 0) {
            appState.selectedBumpEntities = appState.data.slice(0, 5).map(d => d.entityName);
        }
        console.log('[REFRESH] Data processing finished.');
        processingTimer.stop();
        
        appState.lastRefreshed = new Date();

    } catch (e) {
        console.error("%c[REFRESH] 🛑 ERROR during data refresh:", 'color: red; font-weight: bold;', e);
        appState.error = "Failed to refresh application data. " + e.message;
    } finally {
        if (isInitialLoad) {
            updateProgressBar(100); // Set to 100% when all processing is done
        }
        if (!isInitialLoad) {
            appState.isRefreshing = false;
            renderRefreshStatus();
        }
        
        console.log(`%c[REFRESH] Refresh cycle finished. Re-rendering UI for view: ${appState.currentView}.`, 'color: cyan');
        switch (appState.currentView) {
            case 'rankings':
                renderUI();
                break;
            case 'loads':
                renderLoadsAnalyticsUI();
                initializeAnalyticsEventListeners();
                break;
            case 'fleet-health':
                renderTeamProfileUI();
                break;
        }
    }
};

// --- Main Application Flow ---

const showForceRefreshPopup = () => {
    const modal = document.getElementById('force-refresh-modal');
    const nextRefreshTimeEl = document.getElementById('next-refresh-time');
    if (!modal || !nextRefreshTimeEl) return;

    const nextRefreshDate = new Date(appState.lastRefreshed.getTime() + 60 * 60 * 1000);
    nextRefreshTimeEl.textContent = nextRefreshDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    modal.classList.remove('hidden');

    document.getElementById('confirm-force-refresh-btn').onclick = () => {
        modal.classList.add('hidden');
        refreshData();
    };
    document.getElementById('cancel-force-refresh-btn').onclick = () => {
        modal.classList.add('hidden');
    };
};


const initializeApp = async () => {
    const appLoadTimer = startTimer('Total App Initialization');
    appState.loading = true;
    renderUI(); // This will show the full-page loader

    try {
        await refreshData(true); // Perform the initial data load
        
        // Set up the hourly refresh interval AFTER the first successful load
        const ONE_HOUR = 60 * 60 * 1000;
        setInterval(refreshData, ONE_HOUR);

    } catch (e) {
        console.error("Error initializing app:", e);
        appState.error = "Failed to initialize application. " + e.message;
    } finally {
        appState.loading = false;
        populateDateDropdown(); // Populate dropdown once with all dates
        renderUI(); // Hide loader, show app content
        window.requestStubsSort = requestStubsSort;
        addEventListeners(); // Add event listeners only once
        appLoadTimer.stop();
    }
};

const fetchDataAndRender = () => {
    const renderTimer = startTimer('fetchDataAndRender');
    processDataForMode();
    getOrComputeHistoricalMetrics();
    updateDynamicTitles();
    updateDriverTypeSwitcherUI();
    renderUI();
    renderTimer.stop();
};

const handleSnapshotClick = () => {
    const snapshotBtn = document.getElementById('title-snapshot-btn');
    const tableContainer = document.getElementById('main-table-container');

    if (!tableContainer || !snapshotBtn) {
        console.error('Snapshot target or button not found.');
        return;
    }

    const snapshotWrapper = document.createElement('div');
    snapshotWrapper.style.backgroundColor = '#1f2937'; // gray-800
    snapshotWrapper.style.padding = '40px';
    snapshotWrapper.style.display = 'inline-block'; // Shrink to content

    const titleEl = document.createElement('h2');
    const rankingModeText = appState.rankingMode.charAt(0).toUpperCase() + appState.rankingMode.slice(1);
    const driverTypeText = appState.driverTypeFilter === 'all' ? '' : ` (${appState.driverTypeFilter.toUpperCase()})`;
    titleEl.textContent = `${rankingModeText} Rankings${driverTypeText} for ${appState.selectedDate}`;
    titleEl.style.color = '#e2e8f0';
    titleEl.style.fontSize = '28px';
    titleEl.style.fontWeight = 'bold';
    titleEl.style.textAlign = 'center';
    titleEl.style.marginBottom = '25px';
    snapshotWrapper.appendChild(titleEl);

    const clonedTable = tableContainer.querySelector('table').cloneNode(true);

    if (clonedTable) {
        clonedTable.style.width = 'auto';
        clonedTable.style.borderCollapse = 'collapse';

        // --- Header Styling ---
        clonedTable.querySelectorAll('thead th').forEach(th => {
            th.className = ''; // Remove Tailwind classes
            Object.assign(th.style, {
                padding: '8px 10px', // Reduced from 12px
                borderBottom: '2px solid #4a5568',
                color: '#cbd5e1',
                fontWeight: 'bold',
                textAlign: 'center',
                verticalAlign: 'middle',
                whiteSpace: 'nowrap',
            });
        });

        // --- Body Cell Styling ---
        clonedTable.querySelectorAll('tbody td').forEach(td => {
            td.className = ''; // Remove Tailwind classes
            Object.assign(td.style, {
                padding: '5px 1px', // Reduced from 10px
                borderBottom: '1px solid #374151',
                textAlign: 'center',
                verticalAlign: 'middle',
                whiteSpace: 'nowrap',
                fontSize: '14px',
            });
        });
        
        // --- Alignment Overrides & Zebra Striping ---
        clonedTable.querySelectorAll('tr').forEach((row, rowIndex) => {
            // Left-align the first two columns
            if (row.children[0]) row.children[0].style.textAlign = 'left';
            if (row.children[1]) row.children[1].style.textAlign = 'left';

            // Apply zebra striping to body rows
            if (row.closest('tbody') && rowIndex % 2 === 1) {
                Array.from(row.children).forEach(cell => {
                    cell.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
                });
            }
        });
    }

    snapshotWrapper.appendChild(clonedTable);
    snapshotWrapper.style.position = 'absolute';
    snapshotWrapper.style.left = '-9999px';
    document.body.appendChild(snapshotWrapper);

    const originalContent = snapshotBtn.innerHTML;
    snapshotBtn.innerHTML = `
        <svg class="animate-spin h-6 w-6 text-sky-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
    `;
    snapshotBtn.disabled = true;

    html2canvas(snapshotWrapper, { scale: 2, useCORS: true }).then(canvas => {
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/jpeg', 0.9);
        const today = new Date().toISOString().split('T')[0];
        link.download = `table-snapshot-${today}.jpg`;
        link.click();
    }).catch(err => {
        console.error('Error generating snapshot:', err);
        alert('Sorry, there was an error creating the snapshot.');
    }).finally(() => {
        snapshotBtn.innerHTML = originalContent;
        snapshotBtn.disabled = false;
        document.body.removeChild(snapshotWrapper);
    });
};

// --- Event Listeners and Observers Setup ---

const updateNavActiveState = () => {
    const sidebar = document.getElementById('sidebar');
    const isMinimized = sidebar.classList.contains('minimized');

    document.querySelectorAll('.nav-item.active, .sub-nav-item.active').forEach(item => {
        item.classList.remove('active');
    });

    const currentView = appState.currentView;
    let parentMenuItem = null;

    if (currentView.startsWith('profiles-')) {
        parentMenuItem = document.getElementById('profiles-menu-item');
    } else {
        parentMenuItem = document.getElementById(`${currentView}-menu-item`);
    }
    
    if (parentMenuItem) {
        parentMenuItem.querySelector('.nav-item').classList.add('active');
    }
};


const addEventListeners = () => {
    const sidebar = document.getElementById('sidebar');
    const rankingsMenuItem = document.getElementById('rankings-menu-item');
    const loadsMenuItem = document.getElementById('loads-menu-item');
    const fleetHealthMenuItem = document.getElementById('fleet-health-menu-item');

    const switchView = async (view) => {
        appState.currentView = view;
    
        document.getElementById('main-content').classList.add('hidden');
        document.getElementById('key-metrics-overview').classList.add('hidden');
        document.getElementById('loads-analytics-content').classList.add('hidden');
        document.getElementById('profiles-content').classList.add('hidden');
    
        // This logic now correctly shows the button on the Fleet Health page.
        // The specific show/hide logic will be handled by the render function for that page.
        const snapshotTrigger = document.getElementById('snapshot-trigger');
        if (snapshotTrigger) {
            snapshotTrigger.style.display = view === 'fleet-health' ? 'flex' : 'none';
        }
    
        if (view === 'rankings') {
            document.getElementById('main-content').classList.remove('hidden');
            document.getElementById('key-metrics-overview').classList.remove('hidden');
            renderUI();
        } else if (view === 'loads') {
            document.getElementById('loads-analytics-content').classList.remove('hidden');
            setTimeout(() => {
                renderLoadsAnalyticsUI();
                initializeAnalyticsEventListeners();
            }, 0);
        } else if (view === 'fleet-health') {
            document.getElementById('profiles-content').classList.remove('hidden');
            renderTeamProfileUI();
        }
    
        updateNavActiveState();
        renderRefreshStatus();
    };

    rankingsMenuItem.addEventListener('click', (e) => {
        e.preventDefault();
        switchView('rankings');
    });

    loadsMenuItem.addEventListener('click', (e) => {
        e.preventDefault();
        switchView('loads');
    });

    fleetHealthMenuItem.addEventListener('click', (e) => {
        e.preventDefault();
        switchView('fleet-health');
    });

    const debounce = (func, delay) => {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    };

    const redrawAllCharts = async () => {
        const { renderD3BumpChart, renderIndividualEntityChart } = await import('./rankings/rankings_ui.js');
        const { calculateBumpChartData, getFilteredBumpChartEntityNames } = await import('./rankings/rankings_api.js');

        renderD3BumpChart(calculateBumpChartData(), getFilteredBumpChartEntityNames());
        if (appState.isEntityModalOpen) {
            renderIndividualEntityChart();
        }
    };
    const debouncedRedraw = debounce(redrawAllCharts, 25);

    const mainContentArea = document.getElementById('main-content-area');
    if (mainContentArea) {
        const resizeObserver = new ResizeObserver(debouncedRedraw);
        resizeObserver.observe(mainContentArea);
    }

    document.querySelectorAll('.ranking-mode-option').forEach(option => {
        option.addEventListener('click', (e) => {
            e.preventDefault();
            const newMode = e.currentTarget.dataset.mode;
            if (newMode && newMode !== appState.rankingMode) {
                appState.rankingMode = newMode;
                appState.selectedBumpEntities = [];
                appState.sortConfig = { key: 'rank', direction: 'ascending' };
                if (newMode === 'team') {
                    appState.visibleColumns.set('numDispatchers', true);
                }
                fetchDataAndRender();
            }
        });
    });

    document.getElementById('date-selector')?.addEventListener('change', (e) => {
        appState.selectedDate = e.target.value;
        fetchDataAndRender();
    });

    document.getElementById('driver-type-switcher')?.addEventListener('click', (e) => {
        const type = e.target.dataset.type;
        if (type) {
            appState.driverTypeFilter = type;
            fetchDataAndRender();
        }
    });

    document.getElementById('show-low-performers')?.addEventListener('click', () => {
        appState.performanceTrackerView = 'lowPerformers';
        renderUI();
    });

    document.getElementById('show-performance-drops')?.addEventListener('click', () => {
        appState.performanceTrackerView = 'performanceDrops';
        renderUI();
    });

    document.getElementById('show-trending')?.addEventListener('click', () => {
        appState.performanceTrackerView = 'trending';
        renderUI();
    });

    document.getElementById('min-drivers-filter-type')?.addEventListener('change', (e) => {
        appState.minDriverSetting.type = e.target.value;
        renderUI();
    });

    document.getElementById('min-drivers-filter-value')?.addEventListener('input', (e) => {
        appState.minDriverSetting.value = Math.max(0, parseInt(e.target.value, 10) || 0);
    });

    document.getElementById('apply-min-drivers-filter-btn')?.addEventListener('click', () => {
        appState.minDriverSetting.value = Math.max(0, parseInt(document.getElementById('min-drivers-filter-value').value, 10) || 0);
        renderUI();
    });

    document.getElementById('close-dispatcher-modal-btn')?.addEventListener('click', handleCloseEntityModal);
    document.getElementById('close-main-criteria-modal-btn')?.addEventListener('click', handleCloseMainCriteriaModal);
    document.getElementById('close-performance-tracker-modal-btn')?.addEventListener('click', handleClosePerformanceTrackerSettingsModal);
    document.getElementById('toggle-display-settings-btn')?.addEventListener('click', () => {
        appState.isDisplaySettingsModalOpen = true;
        renderUI();
    });
    document.getElementById('close-display-settings-modal-btn')?.addEventListener('click', handleCloseDisplaySettingsModal);

    document.getElementById('performance-tracker-settings-btn')?.addEventListener('click', () => {
        appState.isPerformanceTrackerModalOpen = true;
        renderUI();
    });

    document.getElementById('add-filter-btn')?.addEventListener('click', () => {
        const columnId = document.getElementById('filter-column-select').value;
        const operator = document.getElementById('filter-operator-select').value;
        const value = document.getElementById('filter-value-input').value;
        if (columnId && operator && value) {
            appState.filters.push({ columnId, operator, value });
            document.getElementById('filter-column-select').value = ''; 
            document.getElementById('filter-operator-select').innerHTML = '<option value="">Select Operator</option>'; 
            document.getElementById('filter-value-input').value = ''; 
            renderUI();
        }
    });

    document.getElementById('bump-metric-select')?.addEventListener('change', (e) => {
        appState.bumpMetric = e.target.value;
        renderUI();
    });

    document.getElementById('weeks-back-input')?.addEventListener('input', (e) => {
        appState.weeksBack = Math.max(1, parseInt(e.target.value, 10) || 12);
        renderUI();
    });

    document.getElementById('modal-chart-switcher')?.addEventListener('click', (e) => {
        const view = e.target.dataset.view;
        if (view) {
            appState.entityModalChartView = view;
            renderUI();
        }
    });

    document.getElementById('save-view-btn')?.addEventListener('click', () => {
        const viewNameInput = document.getElementById('save-view-name-input');
        saveView(viewNameInput.value.trim());
        viewNameInput.value = '';
    });

    document.getElementById('title-snapshot-btn')?.addEventListener('click', handleSnapshotClick);

    document.getElementById('sidebar-refresh-status')?.addEventListener('click', () => {
        if (!appState.isRefreshing) {
            showForceRefreshPopup();
        }
    });
};


// In 1. DISP TEST/main.js

const initializeParticles = () => {
    if (typeof particlesJS !== 'undefined') {
        particlesJS('particles-js', {
            "particles": {
                "number": { "value": 60, "density": { "enable": true, "value_area": 800 } },
                "color": { "value": "#38bdf8" }, // A nice bluish color
                "shape": { "type": "circle" },
                "opacity": { "value": 0.5, "random": true },
                "size": { "value": 2, "random": true },
                "line_linked": { "enable": false },
                "move": {
                    "enable": true, "speed": 0.4, "direction": "none",
                    "random": true, "straight": false, "out_mode": "out", "bounce": false
                }
            },
            "interactivity": { "detect_on": "canvas", "events": { "onhover": { "enable": false }, "onclick": { "enable": false } } },
            "retina_detect": true
        });
    }
};


// --- UI Interaction Logic ---

const initializeUIEventListeners = () => {
    // --- START: New Loader-Specific Logic ---
    const loader = document.getElementById('full-page-loader');
    if (loader && !loader.classList.contains('hidden')) {
        initializeParticles();
        const background = document.getElementById('loader-background');
        const cursorDot = document.getElementById('cursor-dot');
        const cursorOutline = document.getElementById('cursor-outline');

        // --- THIS IS THE CORRECTED MOUSEMOVE LOGIC ---
        const onMouseMove = (e) => {
            const { clientX, clientY } = e;
            // Update CSS variables for the gradient
            if (background) {
                background.style.setProperty('--mouse-x', `${clientX}px`);
                background.style.setProperty('--mouse-y', `${clientY}px`);
            }
            // Directly update the style. The CSS transition will handle the animation.
            if (cursorDot) {
                cursorDot.style.transform = `translate(${clientX}px, ${clientY}px)`;
            }
            if (cursorOutline) {
                cursorOutline.style.transform = `translate(${clientX}px, ${clientY}px)`;
            }
        };
        window.addEventListener('mousemove', onMouseMove);
    }
    // --- END: New Loader-Specific Logic ---

    const sidebar = document.getElementById('sidebar');
    const toggleButton = document.getElementById('sidebar-toggle');
    
    if (toggleButton && sidebar) {
        toggleButton.addEventListener('click', () => {
            const isOpen = !sidebar.classList.contains('minimized');
            if (isOpen) {
                document.querySelectorAll('#sidebar li.open').forEach(li => li.classList.remove('open'));
            }
            sidebar.classList.toggle('minimized');
            updateNavActiveState();
        });
    }

    const tips = [
        "'Driver Happiness' combines Net Pay and Miles Driven to reward balance.",
        "Use '4W' columns to track long-term trends, not just weekly changes.",
        "'Company Happiness' tracks cash flow and truck depreciation; high miles don’t always mean better ranking.",
        "Save filters, column visibility, and sorting as a 'View' for quick access.",
        "'Low Performers' spots consistent underperformance, not single bad weeks.",
        "Drag column headers to reorder the table.",
        "'Performance Drops' shows dispatchers falling vs their historical average.",
        "In 'Historical Rank Changes', select dispatchers to compare performance."
    ];
    
    let currentTipIndex = 0;
    const tipTextElement = document.getElementById('loading-tip-text');
    
    function showNextTip() {
        if (!tipTextElement) return;
        
        tipTextElement.classList.add('tip-fade-exit', 'tip-fade-exit-active');
        
        setTimeout(() => {
            currentTipIndex = (currentTipIndex + 1) % tips.length;
            tipTextElement.textContent = tips[currentTipIndex];
            
            tipTextElement.classList.remove('tip-fade-exit', 'tip-fade-exit-active');
            tipTextElement.classList.add('tip-fade-enter');
            
            requestAnimationFrame(() => {
                tipTextElement.classList.remove('tip-fade-enter');
            });
        }, 450);
    }

    if (tipTextElement) {
        tipTextElement.textContent = tips[currentTipIndex];
        setInterval(showNextTip, 5000);
    }
    
    updateNavActiveState();
};

const fetchHistoricalStubs = async () => {
    try {
        // Use the new fetchWithRetry function for each URL
        const fetchPromises = HISTORICAL_STUBS_URLS.map(url => 
            fetchWithRetry(url).then(res => res.json()) // Use it here
        );

        const results = await Promise.all(fetchPromises);
        let combinedHistoricalData = [];

        for (const result of results) {
            if (result.error) throw new Error(result.error);
            if (result.historicalData) combinedHistoricalData.push(...result.historicalData);
        }
        appState.loads.historicalStubsData = combinedHistoricalData;
    } catch (e) {
        console.error("Error fetching historical stubs from multiple sources:", e);
        appState.error = (appState.error || "") + " Failed to load Historical Stubs. " + e.message;
    }
};

const fetchLiveDriverCounts = async () => {
    try {
        // Use the new fetchWithRetry for the single URL
        const response = await fetchWithRetry(DRIVER_COUNT_LIVE_URL); // Use it here
        const result = await response.json();

        if (result.error) {
            throw new Error(result.error);
        }
        appState.profiles.liveDriverCountData = result || [];
    } catch (e) {
        console.error("Error fetching live driver counts:", e);
        appState.error = (appState.error || "") + " Failed to load Live Driver Counts. " + e.message;
    }
};

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    initializeUIEventListeners(); 
    initializeApp();
});


document.addEventListener('click', (e) => {
    const comparisonContainer = document.getElementById('comparison-container');
    if (comparisonContainer && !comparisonContainer.contains(e.target)) {
        if (appState.isCompareDropdownOpen) {
            appState.isCompareDropdownOpen = false;
            renderModalContent();
        }
    }
    
    if (e.target.closest('#add-comparison-btn')) {
        e.stopPropagation();
        appState.isCompareDropdownOpen = !appState.isCompareDropdownOpen;
        renderModalContent();
    }

    if (e.target.closest('#remove-comparison-btn')) {
        appState.comparisonEntity = null;
        renderModalContent();
    }
});
