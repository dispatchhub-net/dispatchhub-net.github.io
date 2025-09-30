// 1. DISPEČ TEST/main.js

import { startTimer } from './utils.js';
import { HISTORICAL_STUBS_URL, DRIVER_COUNT_LIVE_URL } from './config.js';
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

const refreshData = async (isInitialLoad = false) => {
    console.log(`%c[REFRESH] Starting data refresh (Initial Load: ${isInitialLoad})...`, 'color: cyan');
    if (!isInitialLoad) {
        appState.isRefreshing = true;
        renderRefreshStatus(); // Show the "Syncing..." indicator in the sidebar
    }

    try {
        console.log('[REFRESH] Kicking off parallel data fetches...');
        const dataFetchTimer = startTimer('All Data Fetching (Parallel)');
        
        // Add individual timers to pinpoint slow fetches
        const historicalTimer = startTimer('fetchAllHistoricalData');
        const profileTimer = startTimer('fetchProfileData');
        const stubsTimer = startTimer('fetchHistoricalStubs');
        const countsTimer = startTimer('fetchLiveDriverCounts');

        await Promise.all([
            fetchAllHistoricalData().then(res => { historicalTimer.stop(); console.log('[REFRESH] ✅ fetchAllHistoricalData finished.'); return res; }),
            fetchProfileData().then(res => { profileTimer.stop(); console.log('[REFRESH] ✅ fetchProfileData finished.'); return res; }),
            fetchHistoricalStubs().then(res => { stubsTimer.stop(); console.log('[REFRESH] ✅ fetchHistoricalStubs finished.'); return res; }),
            fetchLiveDriverCounts().then(res => { countsTimer.stop(); console.log('[REFRESH] ✅ fetchLiveDriverCounts finished.'); return res; })
        ]);

        console.log('[REFRESH] All parallel data fetches have completed.');
        dataFetchTimer.stop();

        if (appState.allHistoricalData.length === 0) {
            console.warn("No historical data for the RANKINGS view was found. The Rankings dashboard may be empty, but other sections will work.");
        }

        console.log('[REFRESH] Starting data processing...');
        const processingTimer = startTimer('Data Processing and UI Setup');
        appState.profiles.fleetHealthCache = {};
        appState.precomputationCache = { dispatcher: {}, team: {} }; // FIX: Clear the stale data cache

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
        
        appState.lastRefreshed = new Date(); // Set the timestamp on successful refresh

    } catch (e) {
        console.error("%c[REFRESH] 🛑 ERROR during data refresh:", 'color: red; font-weight: bold;', e);
        appState.error = "Failed to refresh application data. " + e.message;
    } finally {
        if (!isInitialLoad) {
            appState.isRefreshing = false;
            // FIX: This ensures the sidebar icon is updated back to the checkmark
            // after the refresh cycle completes, regardless of the current view.
            renderRefreshStatus();
        }
        
        console.log(`%c[REFRESH] Refresh cycle finished. Re-rendering UI for view: ${appState.currentView}.`, 'color: cyan');
        // Always re-render the appropriate UI based on the current view
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

    const originalTable = tableContainer.querySelector('table');
    if (!originalTable) return;
    const tableScrollWidth = originalTable.scrollWidth;

    const snapshotWrapper = document.createElement('div');
    const paddingValue = 40;
    snapshotWrapper.style.backgroundColor = '#1f2937';
    snapshotWrapper.style.padding = `${paddingValue}px`;
    
    const totalWidth = tableScrollWidth + (paddingValue * 2);
    snapshotWrapper.style.width = `${totalWidth}px`;

    const titleEl = document.createElement('h2');
    const rankingModeText = appState.rankingMode.charAt(0).toUpperCase() + appState.rankingMode.slice(1);
    const driverTypeText = appState.driverTypeFilter === 'all' ? '' : ` (${appState.driverTypeFilter.toUpperCase()})`;
    titleEl.textContent = `${rankingModeText} Rankings${driverTypeText} for ${appState.selectedDate}`;
    titleEl.style.color = '#e2e8f0';
    titleEl.style.fontSize = '33px';
    titleEl.style.fontWeight = 'bold';
    titleEl.style.textAlign = 'center';
    titleEl.style.marginBottom = '25px';
    snapshotWrapper.appendChild(titleEl);

    const clonedTableContainer = tableContainer.cloneNode(true);
    const clonedTable = clonedTableContainer.querySelector('table');

    if (clonedTable) {
        clonedTableContainer.style.maxHeight = 'none';
        clonedTableContainer.style.overflow = 'visible';

        const stickyCells = clonedTable.querySelectorAll('.sticky');
        stickyCells.forEach(cell => {
            cell.style.position = 'static';
            cell.style.left = '';
            cell.style.right = '';
            cell.style.zIndex = 'auto';
            cell.style.boxShadow = 'none';
        });

        clonedTable.style.borderCollapse = 'collapse';
        const cells = clonedTable.querySelectorAll('th, td');
        const subtleBorderColor = '#333c4a';
        cells.forEach(cell => {
            cell.style.border = 'none';
            cell.style.borderBottom = `1px solid ${subtleBorderColor}`;
        });

        const rows = clonedTable.querySelectorAll('#main-table-body tr');
        rows.forEach((row, index) => {
            const isOddRow = (index % 2 === 1);
            const bgColor = isOddRow ? '#242e3c' : '#1f2937';
            row.style.backgroundColor = bgColor;
            Array.from(row.children).forEach(cell => {
                cell.style.backgroundColor = bgColor;
            });
        });
    }

    snapshotWrapper.appendChild(clonedTableContainer);

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

// --- UI Interaction Logic ---

const initializeUIEventListeners = () => {
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
        "Did you know? The 'Driver Happiness' metric is a combination of Net Pay and Miles Driven, rewarding dispatchers who balance both.",
        "Tip: Use the '4W' columns in the main table to spot long-term performance trends, not just weekly changes.",
        "Fact: 'Company Happiness' focuses on cash flow, but takes into account the truck's depreciation. More miles & higher gross does not equal better ranking performance, if RPM is low.",
        "Hint: You can save your custom filters, column visibility, and sorting settings as a 'View' for quick access later.",
        "Did you know? The 'Low Performers' tracker helps identify consistent underperformance, not just a single bad week.",
        "Tip: Click and drag column headers in the main table to reorder them to your preference.",
        "Fact: The 'Performance Drops' tracker highlights dispatchers whose performance has significantly declined compared to their own historical average.",
        "Tip: In the 'Historical Rank Changes' chart, you can select specific dispatchers to get a clearer view of head-to-head performance."
    ];

    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    shuffleArray(tips);

    let currentTipIndex = 0;
    const tipTextElement = document.getElementById('loading-tip-text');
    const prevBtn = document.getElementById('prev-tip-btn');
    const nextBtn = document.getElementById('next-tip-btn');
    
    function showTip(index) {
        if (tipTextElement) {
            tipTextElement.textContent = tips[index];
        }
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            currentTipIndex = (currentTipIndex - 1 + tips.length) % tips.length;
            showTip(currentTipIndex);
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            currentTipIndex = (currentTipIndex + 1) % tips.length;
            showTip(currentTipIndex);
        });
    }
    
    showTip(currentTipIndex);
    setInterval(() => {
        currentTipIndex = (currentTipIndex + 1) % tips.length;
        showTip(currentTipIndex);
    }, 5000);
    updateNavActiveState();
};

const fetchHistoricalStubs = async () => {
    try {
        const response = await fetch(HISTORICAL_STUBS_URL);
        if (!response.ok) {
            throw new Error(`HTTP error for historical stubs! status: ${response.status}`);
        }
        const result = await response.json();

        if (result.error) {
            throw new Error(result.error);
        }

        appState.loads.historicalStubsData = result.historicalData || [];

    } catch (e) {
        console.error("Error fetching historical stubs:", e);
        appState.error = (appState.error || "") + " Failed to load Historical Stubs. " + e.message;
    }
};

const fetchLiveDriverCounts = async () => {
    try {
        const response = await fetch(DRIVER_COUNT_LIVE_URL);
        if (!response.ok) {
            throw new Error(`HTTP error for live driver counts! status: ${response.status}`);
        }
        const result = await response.json();

        if (result.error) {
            throw new Error(result.error);
        }

        // The endpoint returns an object with a "data" key holding the array
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
