import { HISTORICAL_STUBS_URL } from './config.js';
import { renderStubsUI, initializeStubsEventListeners } from './stubs/stubs_ui.js';
import { renderLoadsUI, initializeLoadsEventListeners, renderLoadsAnalyticsUI, initializeAnalyticsEventListeners } from './loads/loads_ui.js';
import { appState, allColumns, setDraggedColumnId, setDraggedViewName } from './state.js';
import { generateAllColumns } from './config.js';
import {
    fetchAllHistoricalData,
    processDataForMode,
    getOrComputeHistoricalMetrics
} from './rankings/rankings_api.js';
import {
    renderUI,
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
    requestStubsSort
} from './rankings/rankings_ui.js';
import { precomputeAllDriverFlags } from './stubs/stubs_api.js';

// --- Main Application Flow ---

const initializeApp = async () => {
    appState.loading = true;
    renderUI();

    try {
        const savedLoadsSettings = JSON.parse(localStorage.getItem('loadsSettings'));
        if (savedLoadsSettings) {
            Object.assign(appState.loads, savedLoadsSettings);
        }
        await fetchAllHistoricalData();
        await fetchLoadsData();
        await fetchHistoricalStubs();

        // VVVV PASTE THE NEW LINE RIGHT HERE VVVV
        precomputeAllDriverFlags(); // This performs the heavy flag calculations once on load.

        if (appState.allHistoricalData.length === 0) {
            throw new Error("No historical data available after fetch.");
        }
        
        loadDefaultView(); // Load default view settings
        processDataForMode(); // Process data for the default mode
        getOrComputeHistoricalMetrics(); // Pre-compute metrics

        appState.allDispatcherNames = [...new Set(appState.allHistoricalData.map(d => d.dispatcherName).filter(Boolean))].sort();
        appState.allTeamNames = [...new Set(appState.allHistoricalData.map(d => d.dispatcherTeam).filter(Boolean))].sort();
        
        if (appState.data.length > 0 && appState.selectedBumpEntities.length === 0) {
            appState.selectedBumpEntities = appState.data.slice(0, 5).map(d => d.entityName);
        }

    } catch (e) {
        console.error("Error initializing app:", e);
        appState.error = "Failed to initialize application. " + e.message;
    } finally {
        appState.loading = false;
        populateDateDropdown();
        renderUI();
        window.requestStubsSort = requestStubsSort;
        addEventListeners(); // For rankings related listeners
        initializeLoadsEventListeners(); // For loads related listeners
        initializeStubsEventListeners(); // For stubs related listeners
        if (appState.currentView === 'loads') {
            renderLoadsUI(); // Render loads initially if it's the current view
        }
    }
};

const fetchDataAndRender = () => {
    processDataForMode();
    getOrComputeHistoricalMetrics();
    updateDynamicTitles();
    updateDriverTypeSwitcherUI();
    renderUI();
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

    // Remove all active states first
    document.querySelectorAll('.nav-item.active, .sub-nav-item.active').forEach(item => {
        item.classList.remove('active');
    });

    const currentView = appState.currentView;
    let parentMenuItem = null;
    let subMenuItem = null;

    if (currentView.startsWith('loads-')) {
        parentMenuItem = document.getElementById('loads-menu-item');
        subMenuItem = parentMenuItem.querySelector(`[data-view="${currentView}"]`);
    } else if (currentView.startsWith('profiles-')) {
        // Future-proofing for profiles
        parentMenuItem = document.getElementById('profiles-menu-item');
        subMenuItem = parentMenuItem.querySelector(`[data-view="${currentView}"]`);
    } else { // 'rankings' or other top-level views
        parentMenuItem = document.getElementById(`${currentView}-menu-item`);
    }

    if (isMinimized) {
        if (parentMenuItem) {
            parentMenuItem.querySelector('.nav-item').classList.add('active');
        }
    } else {
        if (subMenuItem) {
            subMenuItem.classList.add('active');
            parentMenuItem.querySelector('.nav-item').classList.add('active'); // Also keep parent active
        } else if (parentMenuItem) {
            parentMenuItem.querySelector('.nav-item').classList.add('active');
        }
    }
};


const addEventListeners = () => {
    const sidebar = document.getElementById('sidebar');
    const rankingsMenuItem = document.getElementById('rankings-menu-item');
    const loadsMenuItem = document.getElementById('loads-menu-item');
    const profilesMenuItem = document.getElementById('profiles-menu-item');
    const stubsMenuItem = document.getElementById('stubs-menu-item'); // Get the stubs menu item

    const rankingsContent = document.getElementById('main-content');
    const keyMetricsOverview = document.getElementById('key-metrics-overview');
    const loadsContent = document.getElementById('loads-content');
    const loadsAnalyticsContent = document.getElementById('loads-analytics-content');
    const stubsContent = document.getElementById('stubs-content'); // Get the stubs content div

    const switchView = (view) => {
        appState.currentView = view;

        // Hide all content panels
        rankingsContent.classList.add('hidden');
        keyMetricsOverview.classList.add('hidden');
        loadsContent.classList.add('hidden');
        loadsAnalyticsContent.classList.add('hidden');
        stubsContent.classList.add('hidden'); // Hide stubs content

        // Show the correct content panel
        if (view === 'rankings') {
            rankingsContent.classList.remove('hidden');
            keyMetricsOverview.classList.remove('hidden');
            renderUI();
        } else if (view === 'loads-table') {
            loadsContent.classList.remove('hidden');
            renderLoadsUI();
        } else if (view === 'loads-analytics') {
            loadsAnalyticsContent.classList.remove('hidden');
            // FIX: Delay execution to allow the DOM to update and render the container
            setTimeout(() => {
                renderLoadsAnalyticsUI();
                initializeAnalyticsEventListeners();
            }, 0);
        } else if (view === 'stubs') { // Handle stubs view
            stubsContent.classList.remove('hidden');
            renderStubsUI();
        }

        updateNavActiveState();
    };

    rankingsMenuItem.addEventListener('click', (e) => {
        e.preventDefault();
        switchView('rankings');
        // Close other submenus
        profilesMenuItem.classList.remove('open');
        loadsMenuItem.classList.remove('open');
    });

    stubsMenuItem.addEventListener('click', (e) => {
        e.preventDefault();
        switchView('stubs');
        // Close other submenus
        profilesMenuItem.classList.remove('open');
        loadsMenuItem.classList.remove('open');
    });

    const createSubmenuToggle = (menuItem) => {
        menuItem.querySelector('a.nav-item').addEventListener('click', (e) => {
            e.preventDefault();
            if (sidebar.classList.contains('minimized')) {
                // If minimized, clicking the parent should switch to a default child view
                const firstSubmenuItem = menuItem.querySelector('.sub-nav-item');
                if (firstSubmenuItem) {
                    switchView(firstSubmenuItem.dataset.view);
                }
            } else {
                // If expanded, toggle the submenu
                menuItem.classList.toggle('open');
            }
        });

        menuItem.querySelectorAll('.sub-nav-item').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation(); // Stop click from bubbling to the parent 'a'
                switchView(e.target.dataset.view);
            });
        });
    };

    createSubmenuToggle(profilesMenuItem);
    createSubmenuToggle(loadsMenuItem);

    // --- Debounce Helper Function ---
    const debounce = (func, delay) => {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    };

    // --- Chart Redraw Logic ---
    const redrawAllCharts = async () => {
        const { renderD3BumpChart, renderIndividualEntityChart } = await import('./rankings/rankings_ui.js');
        const { calculateBumpChartData, getFilteredBumpChartEntityNames } = await import('./rankings/rankings_api.js');

        renderD3BumpChart(calculateBumpChartData(), getFilteredBumpChartEntityNames());
        if (appState.isEntityModalOpen) {
            renderIndividualEntityChart();
        }
    };
    const debouncedRedraw = debounce(redrawAllCharts, 25);

    // --- Resize Observer ---
    const mainContentArea = document.getElementById('main-content-area');
    if (mainContentArea) {
        const resizeObserver = new ResizeObserver(debouncedRedraw);
        resizeObserver.observe(mainContentArea);
    }

    // --- Other Event Listeners from the original function ---
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
};

// --- UI Interaction Logic ---

const initializeUIEventListeners = () => {
    const sidebar = document.getElementById('sidebar');
    const toggleButton = document.getElementById('sidebar-toggle');
    
    if (toggleButton && sidebar) {
        toggleButton.addEventListener('click', () => {
            const isOpen = !sidebar.classList.contains('minimized');
            if (isOpen) {
                // If we are closing it, close all submenus
                document.querySelectorAll('#sidebar li.open').forEach(li => li.classList.remove('open'));
            }
            sidebar.classList.toggle('minimized');
            // Re-evaluate active state display after toggling
            updateNavActiveState();
        });
    }

    // Loading Screen Tips Logic
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
    
    showTip(currentTipIndex); // Show the first tip immediately
    setInterval(() => {
        currentTipIndex = (currentTipIndex + 1) % tips.length;
        showTip(currentTipIndex);
    }, 5000);
    // Set initial active state on load
    updateNavActiveState();
};

// This new function will fetch data ONLY for the Loads dashboard
const fetchLoadsData = async () => {
    // This is your new URL specifically for the LOADS data
    const loadsUrl = "https://script.google.com/macros/s/AKfycbws7QzIImo3MaX-5Hf8PoAqrBevHEjzdM8vjyn7mUgQVO5mEinkUkAgyod4JttKxrht/exec";
    
    try {
        const response = await fetch(loadsUrl);
        if (!response.ok) {
            throw new Error(`HTTP error for loads! status: ${response.status}`);
        }
        const result = await response.json();

        if (result.error) {
            throw new Error(result.error);
        }
        
        // Save the live data into the application state
        appState.loads.data = result.loadsData || [];
        appState.loads.spreadsheetTimezone = result.spreadsheetTimezone || 'UTC';

    } catch (e) {
        console.error("Error fetching loads data:", e);
        appState.error = (appState.error || "") + " Failed to load LOADS data. " + e.message;
    }
};

// Fetches the historical stubs data
const fetchHistoricalStubs = async () => {
    try {
        const response = await fetch(HISTORICAL_STUBS_URL); // Uses the config variable
        if (!response.ok) {
            throw new Error(`HTTP error for historical stubs! status: ${response.status}`);
        }
        const result = await response.json();

        if (result.error) {
            throw new Error(result.error);
        }

        appState.historicalStubsData = result.historicalData || [];

    } catch (e) {
        console.error("Error fetching historical stubs:", e);
        appState.error = (appState.error || "") + " Failed to load Historical Stubs. " + e.message;
    }
};

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    initializeUIEventListeners(); 
    initializeApp();
});