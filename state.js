// Flag Design
import { flagDesigns } from './profiles/flag_designs.js';

// DISPATCH TESTER/state.js
import { generateAllColumns } from './config.js';

// Initialize allColumns from config. This can be modified by user actions (reordering).
export let allColumns = generateAllColumns();

// Variables to store the ID of the column or view being dragged.
export let draggedColumnId = null;
export let draggedViewName = null;

// This keeps track of the sorting for the stubs table in the modal.
// It's kept separate from the main appState to not interfere with main table sorting.
export let stubsSortConfig = { key: 'criteria', direction: 'descending' };

// The main application state object.
export let appState = {
    // MODIFIED: Default view is now more specific
    auth: {
        isLoggedIn: false,
        user: null, // { email, role, access, permissions }
        token: null,
    },
    currentView: 'rankings', // 'rankings', 'loads-table', 'loads-analytics', etc.
    isRefreshing: false, // To track background refresh status
    lastRefreshed: null, // To store the timestamp of the last successful refresh
    rankingMode: 'dispatcher', // 'dispatcher' or 'team'
    data: [],
    sortConfig: { key: 'rank', direction: 'ascending' },
    selectedDate: '',
    selectedEntity: null, // Generic for dispatcher or team
    selectedEntities: [], // For multiple entities in modal
    isEntityModalOpen: false, // Generic modal state
    modalSource: null,
    entityModalChartView: 'heatmap', // 'heatmap', 'rank', or 'stubs'
    entityModalHeatmapView: 'cluster', // 'cluster' or 'driver'
    entityModalHeatmapDriver: null, // To store selected driver name
    entityModalHeatmapPeriod: '1w', // '1w' or '4w' for both Cluster and Driver views
    entityModalClusterSize: 1.5,
    entityModalSelectedDriver: null,
    isMainCriteriaModalOpen: false,
    isPerformanceTrackerModalOpen: false,
    isDisplaySettingsModalOpen: false,
    expandedDispatcher: null, // NEW: Tracks the dispatcher whose drivers are shown in the team modal
    tableMaxHeight: 500,
    tableGroupColors: {},
    allHistoricalData: [],
    loading: true,
    error: null,
    selectedBumpEntities: [], // Can hold dispatcher or team names
    bumpMetric: 'mainCriteria',
    weeksBack: 12,
    deviationMetric: 'mainCriteria_4wkAvg',
    deviationThreshold: 20,
    dropHistoryLookback: 'specificWeeks',
    dropHistorySpecificWeeks: 8,
    lowPerformanceMetric: 'rpmAll',
    minLowDaysThreshold: 40,
    lowPerformerThreshold: 30,
    lowPerfHistoryLookback: 'allTime',
    lowPerfHistorySpecificWeeks: 4,
    allDispatcherNames: [],
    allTeamNames: [],
    entityColors: {},
    visibleColumns: new Map(),
    performanceTrackerView: 'alerts', // Default to Alerts
    filters: [],
    minDriverSetting: { type: 'numDrivers', value: 3 },
    precomputedDispatcher4WkAverages: {},
    precomputedTeam4WkAverages: {},
    trendAnalysisMetric: 'overall',
    trendOlderPeriod: 8,
    trendRecentPeriod: 4,
    trendSignificanceThreshold: 10,
    trendMinOlderStubs: 4,
    trendMinRecentStubs: 2,
    precomputationCache: {
        dispatcher: {}, // Cache for dispatcher mode (ALL, OO, LOO)
        team: {}        // Cache for team mode (ALL, OO, LOO)
    },
    unfilteredRanks: new Map(), // For stable ranking in tracker
    alertsFilter: 'all', // NEW: Stores the active alerts filter
    
    // --- Hall of Fame State ---
    isRecordsModalOpen: false,
    recordsFilter: 'ALL', // 'ALL', 'OO' or 'LOO'
    hallOfFameData: {}, // Cache for records
    hallOfFameUpdates: {
        newRecordKeys: [], // Array of record keys that are new
        isFirstTime: false, // Boolean to track first-time onboarding
        hasUnseenChanges: false // Master flag for UI glow
    },
    
    visibleKeyMetrics: [
       
    ],
    driverTypeFilter: 'all', // 'all', 'oo', or 'loo'
    enableHeatmap: false, // Control for heatmap feature
    pinnedLeftColumns: ['rank', 'entityName', 'dispatcherTeam'],
    pinnedRightColumns: ['mainCriteria_current', 'mainCriteria_4wkAvg'],

    // --- NEW: Comparison State ---
    comparisonEntity: null, // Stores the entity object for comparison
    isCompareDropdownOpen: false, // Toggles the comparison dropdown
    chartLineVisibility: new Map(), // Tracks visibility of chart lines in the modal

    // --- NEW: Driver Delegation State ---
    delegation: {
        activeContractFilter: 'OO', // 'OO' or 'LOO'
        activeTeamFilter: 'ALL_TEAMS',
        isSettingsModalOpen: false,
        hideFullCapacity: false, // NEW
       assignments: {}, // { dispatcherName: { pendingCount: 0, note: '', lastUpdated: null, updatedBy: null } }
        capacityMode: 'rank1w', // 'custom', 'rank1w', 'rank4w'
        dispatcherPreferences: {}, // { dispatcherName: { oo: true, loo: true } }
        capacityRules: {
            rank1w: [
                { min: 0.0, max: 0.6, cap: 5 },
                { min: 0.6, max: 0.8, cap: 7 },
                { min: 0.8, max: 1.0, cap: 8 },
            ],
            rank4w: [
                { min: 0.0, max: 0.6, cap: 5 },
                { min: 0.6, max: 0.8, cap: 7 },
                { min: 0.8, max: 1.0, cap: 8 },
            ],
        },
        capacityCustom: {}, // { dispatcherName: 5 } (Default Max Capacity)
        weights: {
            need: 40,       // Missing Drivers (Vacancy)
            rank4w: 30,     // 4-Week Rank
            rank1w: 10,     // 1-Week Rank
            compliance: 20  // Compliance Score
        },
        dispatcherPreferences: {},
        isDispatcherSettingsModalOpen: false
    },

    // --- START ADDITION FOR PROFILES ---
    // --- START ADDITION FOR PROFILES ---
    profiles: {
        isSnapshotOpen: false,
        fleetHealthCache: {},
        liveData: [],
        tuesdayOpenData: [],
        missingPaperworkData: [],
        calculatorActivityData: [],
        trailerDropsData: [],
        rcEntryData: [], // NEW
        liveDriverCountData: [],
        contractStatusData: [],
        currentTeamData: null,
        selectedTeam: 'SMT',
        isKpiSettingsOpen: false,
        selectedDispatcherId: null,
        contractTypeFilter: 'all',
        isContractTypeFilterOpen: false,
        selectedCompany: 'All Companies',
        isCompanyFilterOpen: false,
        selectedFranchise: 'All Franchises',
        isFranchiseFilterOpen: false,
        selectedWeek: 'live',
        isWeekSelectorOpen: false,
        activeDetails: {
            dispatcherId: null,
            metricId: null
        },
        driverFilters: {
            isFilterModalOpen: false,
            activeFilters: [],
            filterLogic: 'AND',
            isSaveModalOpen: false,
            filterToEdit: null,
        },
        savedDriverFilters: [
            { id: 'all_drivers', name: 'All Drivers', isDefault: true, criteria: [], logic: 'AND', color: '#374151' }
        ],
        activeSavedFilterId: 'all_drivers',
        isDriverSettingsModalOpen: false,
        driverDeepDive: {
            isModalOpen: false,
            selectedDriver: null,
            chartView: 'heatmap',
            heatmapDateType: 'del',
            heatmapDirection: 'outbound',
            showCanceledLoads: false,
        },
        dispatcherSearchTerm: '',
        driverSearchTerm: '',
        allProcessedDispatchers: [],
        kpiSettings: {
            allKpis: [
                { id: 'totalGross', label: 'Total Weekly Gross' },
                { id: 'teamRpm', label: 'Team RPM (All)' },
                { id: 'teamMargin', label: 'Team Margin ($)' },
                { id: 'activeTrucks', label: 'Active Trucks' },
                { id: 'medianDropRisk', label: 'Median Drop Risk' },
                { id: 'balance', label: 'Total Balance' },
                { id: 'medianCompliance', label: 'Median Compliance %' },
                { id: 'medianWellness', label: 'Median Wellness %' },
                { id: 'trailerDrops', label: 'Trailer Drops' }, 
                { id: 'dispatchers', label: 'Dispatchers' },
                { id: 'canceledLoads', label: 'Canceled Loads' },
            ],
            visibleKpiIds: [
                'totalGross', 'teamMargin', 'teamRpm', 'activeTrucks', 'balance', 'medianCompliance', 'trailerDrops'
            ]
        },
        dispatchTable: {
            sortConfig: { key: 'complianceScore', direction: 'ascending' },
            columnOrder: [
                'name', 'company', 'team', 'allTrucks', 'ooTrucks', 'looTrucks',
                'dryvan', 'reefer', 'flatbed',
                'rank1w', 'rank4w', 'goodMoves', 'badMoves','retention4w',
                'medianTenureOO', 'medianTenureLOO',
                'calculatorActivity', 'trailerDrops', 'trailerRecoveries',
                'overdueLoads', 'tuesdayOpen', 'missingPaperwork', 'rcEntry',
                'hiddenMiles', 'lowRpm', 'wellness', 'newStarts',
                'canceled', 'complianceScore'
            ],
            visibleColumnIds: [
                'name', 'company', 'ooTrucks', 'looTrucks',
                'rank1w', 'rank4w', 'retention4w',
                'medianTenureOO', 'medianTenureLOO',
                'calculatorActivity', 'trailerDrops', 'trailerRecoveries',
                'overdueLoads', 'rcEntry', 'tuesdayOpen', 'missingPaperwork',
                'hiddenMiles', 'lowRpm', 'wellness', 'newStarts',
                'goodMoves', 'badMoves', 'canceled', 'complianceScore'
            ],
            pinnedLeftColumns: ['name'],
            pinnedRightColumns: ['complianceScore'],
            draggedColumnId: null,
        },
        dispatchTableFlexBasis: null,
      driverTable: {
            sortConfig: { key: 'risk', direction: 'descending' }
        },
        driverSummaryMode: 'median', // 'none', 'median', 'sum', 'avg'
        // --- SETTINGS WILL BE LOADED FROM GOOGLE SHEET ---
        thresholdSettings: {
            isModalOpen: false,
            lowRpm: { default: 1.5, by_contract: {} },
            goodMove: { default: 6000, by_contract: {} },
            medianTenure: { default: 4, by_contract: {} }
        },
        tenureSettings: {
            lookback: { type: 'weeks', value: 12 }
        },
        complianceSettings: {
            isModalOpen: false,
            weights: {}
        },
        driverHealthSettings: {
            activeSettingTab: 'highTolls',
            isModalOpen: false,
            weights: {},
            flags: flagDesigns // <-- THIS IS THE CHANGE
        },
        tempDriverHealthSettings: null,
    },

    liveDriverFlagsCache: {},
    overdueLoadsData: [],

     // --- START ADDITION FOR LOADS ---
     loads: {
        data: [],
        spreadsheetTimezone: 'UTC',
        movedLoadThreshold: 800,
        notClosedDaysThreshold: 7,
        lowRpmThreshold: 1.65,
        goodMoveThresholds: {
            default: 6000,
            by_contract: {
                "MCLOO": 6500,
                "OO": 5500,
                "LOO": 6500,
                "CPM": 6500,
                "LPOO": 6500,
                "POG": 6500
            }
        },
        flagTypes: [
            { id: 'new_start', text: 'New Start' },
            { id: 'moved', text: 'Moved' },
            { id: 'mondays_moved', text: 'Mon. Moved' },
            { id: 'bad_move', text: 'Bad Move' },
            { id: 'good_move', text: 'Good Move' },
            { id: 'hidden_miles', text: 'Hidden Mileage' },
            { id: 'not_closed', text: 'Not Closed' },
            { id: 'low_rpm', text: 'Low RPM' }
        ],
        contractTypes: [
            { id: 'OO', text: 'OO' },
            { id: 'LOO', text: 'LOO' },
            { id: 'MCLOO', text: 'MCLOO' },
            { id: 'POG', text: 'POG' },
            { id: 'CPM', text: 'CPM' },
            { id: 'LPOO', text: 'LPOO' }
        ],
        visibleFilterIds: ['moved_loads', 'late_assign', 'low_rpm', 'hidden_miles', 'not_closed', 'mondays_moved_loads', 'new_start'],
        isSettingsModalOpen: false,
        isCustomFilterModalOpen: false,
        isFilterVisibilityDropdownOpen: false,
        isColumnDropdownOpen: false,
        editingFilterId: null,
        analyticsDashboardView: 'performance',
        analyticsContextualView: 'welcome',
        mapAMode: 'cluster', // 'state' or 'cluster' for the PRIMARY map
        mapAMetric: 'rpm',   // 'volume' or 'rpm' for the PRIMARY map
        mapBMode: 'cluster', // 'state' or 'cluster'
        mapBMetric: 'rpm',   // 'volume' or 'rpm'
        mapAClusterSize: 2.5,
        mapBClusterSize: 2.5,
        mapADirection: 'outbound', // 'outbound' or 'inbound'
        mapBDirection: 'outbound', // 'outbound' or 'inbound'
        isMapAFilterOpen: false,
        isMapBFilterOpen: false,
        mapAStartDate: '',
        mapAEndDate: '',
        mapBStartDate: '',
        mapBEndDate: '',

        /// --- ADDED FOR STUBS DEEP DIVE ---
        isStubsModalOpen: false,
        selectedDriverForModal: null,
        historicalStubsData: [], // <-- To store the new historical data
        stubsModalChartView: 'net_pay', // <-- To track the selected chart metric
        heatmapDateType: 'pu',
        entityModalDayFilter: 'all',
        heatmapDirection: 'outbound',
        mapBEndDate: '',
        deepDiveSelection: null,



        // --- START: MODIFIED/NEW PROPERTIES ---
        activeFilterId: 'moved_loads',
        savedFilters: [ // "Moved Loads" is now a single filter
            { id: 'moved_loads', name: 'Moved Loads', color: 'red', criteria: [] },
            { id: 'late_assign', name: 'All Loads', color: 'orange', criteria: [] }, 
            { id: 'low_rpm', name: 'Low RPM Loads', color: 'yellow', criteria: [] },
            { id: 'hidden_miles', name: 'Hidden Mileage', color: 'purple', criteria: [] },
            { id: 'not_closed', name: 'Not Closed Loads', color: 'green', criteria: [] },
            // NEW: Added Monday's Moved Loads filter
            { id: 'mondays_moved_loads', name: "Monday's Moved Loads", color: 'blue', criteria: [] },
            // NEW: Added NEW START filter
            { id: 'new_start', name: 'New Starts', color: 'white', criteria: [] },
        ],
        // MODIFIED: Added 'mondays_moved_loads'
        filterOrder: ['moved_loads', 'late_assign', 'low_rpm', 'hidden_miles', 'not_closed', 'mondays_moved_loads', 'new_start'],
        draggedFilterId: null,
        loadsInitialized: false,

        // New properties for table management
        sortConfig: { key: 'id', direction: 'descending' },
        // --- FIND AND REPLACE THESE TWO PROPERTIES ---
        columnOrder: [
            'id', 'contract_type','gross_total', 'pu_date', 'pu_location', 'do_location', 
            'do_date', 'trip_miles', 'status', 'driver', 'dispatcher', 'team', 'flags',
            // --- Hidden by default ---
            'start_location','status_modified_dt', 'delivered_at', 'weight', 'commodity', 'load_type', 'pu_type', 'do_type',
            'fuel_surcharge', 'layover_amount', 'detention_amount', 'cut', 'expected_fuel_cost','expected_tolls','truck_days_in_status','driver_days_in_status','price','rpm','deadhead_miles'
        ],
        visibleColumnIds: [
            'id', 'contract_type','gross_total', 'pu_date', 'pu_location', 'do_location', 
            'do_date', 'trip_miles', 'status', 'driver', 'dispatcher', 'team', 'flags',
        ],
        draggedColumnId: null,
        compactFlags: false,
        currentPage: 1,
        rowsPerPage: 25, // You can adjust this number
        searchColumn: 'all',
        movedLoadsSummaryView: 'all',

        
    },
};

// Functions to update the drag-and-drop state.
export function setDraggedColumnId(id) {
    draggedColumnId = id;
}

export function setDraggedViewName(name) {
    draggedViewName = name;
}

export function setStubsSortConfig(config) {
    stubsSortConfig = config;
}

// Add this new state variable for the main stubs table
export let mainStubsSortConfig = { key: 'totalPrice', direction: 'descending' };

// Add this function to update it
export function setMainStubsSortConfig(config) {
    mainStubsSortConfig = config;
}

// --- START ADDITION FOR LOADS ---
export function setDraggedLoadsFilterId(id) {
    appState.loads.draggedFilterId = id;
}

export function setEditingLoadsFilterId(id) {
    appState.loads.editingFilterId = id;
}

export function setLoadsSettingsModalOpen(isOpen) {
    appState.loads.isSettingsModalOpen = isOpen;
}

export function setLoadsCustomFilterModalOpen(isOpen) {
    appState.loads.isCustomFilterModalOpen = isOpen;
}

export function updateLoadsFilterOrder(newOrder) {
    appState.loads.filterOrder = newOrder;
}

export function addOrUpdateLoadsFilter(filter) {
    const index = appState.loads.savedFilters.findIndex(f => f.id === filter.id);
    if (index > -1) {
        appState.loads.savedFilters[index] = filter;
    } else {
        appState.loads.savedFilters.push(filter);
        if (!appState.loads.filterOrder.includes(filter.id)) {
            appState.loads.filterOrder.push(filter.id);
        }
        appState.loads.visibleFilterIds.push(filter.id);
    }
}

export function deleteLoadsFilter(id) {
    appState.loads.savedFilters = appState.loads.savedFilters.filter(f => f.id !== id);
    appState.loads.filterOrder = appState.loads.filterOrder.filter(fId => fId !== id);
}
