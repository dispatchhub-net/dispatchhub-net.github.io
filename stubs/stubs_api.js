// DISP. TEST/stubs_api.js
import { appState } from '../state.js';

/**
 * Helper function to get the stub week identifier for a given date.
 * @param {Date} date - The date to calculate from.
 * @returns {string} The stub week identifier, e.g., "8/7/2025".
 */
const getStubWeekIdentifierForDate = (date) => {
    const todayUTC = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayOfWeek = todayUTC.getUTCDay();

    let endOfPayPeriod = new Date(todayUTC);
    if (dayOfWeek > 1) {
        const daysUntilMonday = (1 - dayOfWeek + 7) % 7;
        endOfPayPeriod.setUTCDate(todayUTC.getUTCDate() + daysUntilMonday);
    }

    const stubDate = new Date(endOfPayPeriod);
    stubDate.setUTCDate(endOfPayPeriod.getUTCDate() + 3);

    return `${stubDate.getUTCMonth() + 1}/${stubDate.getUTCDate()}/${stubDate.getUTCFullYear()}`;
};

export const getCurrentStubWeekIdentifier = () => {
    return getStubWeekIdentifierForDate(new Date());
};

const getPreviousStubWeekIdentifier = () => {
    const today = new Date();
    today.setDate(today.getDate() - 7);
    return getStubWeekIdentifierForDate(today);
};

const checkMovedMondayLoad = (load) => {
    if (!load.pu_date || !load.do_date) return false;
    const puDate = new Date(load.pu_date);
    const doDate = new Date(load.do_date);
    const isPuMonday = puDate.getUTCDay() === 1;
    const isDoMonday = doDate.getUTCDay() === 1;
    const areSameDate = puDate.toISOString().split('T')[0] === doDate.toISOString().split('T')[0];
    return isPuMonday && isDoMonday && areSameDate;
};

/**
 * This is now a local helper function and is NOT exported.
 * It's called by the pre-computation function.
 */
const calculateLiveFlagsForDriver = (driverName, allHistoricalStubs, weeklyFleetStats) => {
    const flags = [];
    const driverStubs = allHistoricalStubs.filter(s => s.driver_name === driverName);
    if (driverStubs.length < 4) return flags;

    let lowRpmCount = 0, lowGrossCount = 0, lowNetCount = 0, highTollsCount = 0;
    driverStubs.forEach(stub => {
        const dateKey = stub.pay_date.split('T')[0];
        const weekStats = weeklyFleetStats[dateKey];
        if (!weekStats) return;
        if ((stub.rpm_all || 0) < weekStats.rpm_25th) lowRpmCount++;
        if ((stub.driver_gross || 0) < weekStats.gross_25th) lowGrossCount++;
        if ((stub.net_pay || 0) < weekStats.net_25th) lowNetCount++;
        if ((stub.tolls || stub.expected_tolls || 0) > weekStats.tolls_80th && weekStats.tolls_80th > 0) highTollsCount++;
    });

    const stubCount = driverStubs.length;
    if (lowRpmCount / stubCount > 0.4) flags.push({ text: 'Low RPM', color: 'red' });
    if (lowGrossCount / stubCount > 0.4) flags.push({ text: 'Low Gross', color: 'red' });
    if (lowNetCount / stubCount > 0.4) flags.push({ text: 'Low Net', color: 'red' });
    if (highTollsCount / stubCount > 0.4) flags.push({ text: 'High Tolls', color: 'orange' });

    // VVVV  THIS IS THE LINE THAT WAS LIKELY MISSING VVVV
    const allWeights = driverStubs.map(s => s.weight || 0).filter(w => w > 0).sort((a, b) => a - b);
    
    if (allWeights.length > 3 && d3.quantile(allWeights, 0.75) > 42000) {
        flags.push({ text: 'Heavy Loads', color: 'purple' });
    }

    const netPays = driverStubs.map(s => s.net_pay || 0);
    if (netPays.length > 4) {
        const meanNet = d3.mean(netPays);
        const deviation = d3.deviation(netPays);
        if (meanNet > 0 && (deviation / meanNet) > 0.6) {
            flags.push({ text: 'Inconsistent Pay', color: 'yellow' });
        }
    }
    
    const uniqueDispatchers = new Set(driverStubs.map(s => s.stub_dispatcher).filter(Boolean));
    if (uniqueDispatchers.size > 1 && (uniqueDispatchers.size / stubCount) > (1 / 5)) {
        flags.push({ text: 'Dispatcher Hopper', color: 'blue' });
    }

    return flags;
};

/**
 * NEW: This function runs once on app load to calculate all flags and cache them.
 */
export const precomputeAllDriverFlags = () => {
    const allHistoricalStubs = appState.historicalStubsData;
    if (!allHistoricalStubs || allHistoricalStubs.length === 0) return;

    const weeklyFleetStats = allHistoricalStubs.reduce((acc, stub) => {
        const date = stub.pay_date.split('T')[0];
        if (!acc[date]) {
            acc[date] = { rpms: [], grosses: [], nets: [], tolls: [] };
        }
        acc[date].rpms.push(stub.rpm_all || 0);
        acc[date].grosses.push(stub.driver_gross || 0);
        acc[date].nets.push(stub.net_pay || 0);
        acc[date].tolls.push(stub.tolls || stub.expected_tolls || 0);
        return acc;
    }, {});

    for (const date in weeklyFleetStats) {
        const stats = weeklyFleetStats[date];
        stats.rpm_25th = d3.quantile(stats.rpms.sort((a, b) => a - b), 0.25);
        stats.gross_25th = d3.quantile(stats.grosses.sort((a, b) => a - b), 0.25);
        stats.net_25th = d3.quantile(stats.nets.sort((a, b) => a - b), 0.25);
        stats.tolls_80th = d3.quantile(stats.tolls.sort((a, b) => a - b), 0.80);
    }

    const allDrivers = [...new Set(allHistoricalStubs.map(s => s.driver_name))];
    const flagCache = {};
    allDrivers.forEach(driverName => {
        if(driverName) { // Ensure driver name is not empty
            flagCache[driverName] = calculateLiveFlagsForDriver(driverName, allHistoricalStubs, weeklyFleetStats);
        }
    });

    appState.liveDriverFlagsCache = flagCache;
    console.log("Driver flags pre-computation complete.");
};

/**
 * Processes raw loads to generate summarized stubs, now using the pre-computed flags cache.
 */
export const processStubsForCurrentWeek = (allLoads = []) => {
    const currentWeekId = getCurrentStubWeekIdentifier();
    const prevWeekId = getPreviousStubWeekIdentifier();
    const currentDate = new Date();
    const fourWeeksAgo = new Date(Date.UTC(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - 28));
    const eightWeeksAgo = new Date(Date.UTC(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - 56));

    const historicalMovedLoads = allLoads.reduce((acc, load) => {
        // ... (this entire section remains unchanged)
        if (load.status === 'Canceled' || !load.stub_wk_driver || !checkMovedMondayLoad(load)) return acc;
        const [loadStubDate, driverIdentifier] = load.stub_wk_driver.split('_');
        const loadPuDate = new Date(load.pu_date);
        if (!driverIdentifier || loadPuDate > currentDate) return acc;
        const driverName = driverIdentifier.replace(/-/g, ' ');
        if (!acc[driverName]) acc[driverName] = {};
        if (!acc[driverName][loadStubDate]) acc[driverName][loadStubDate] = { weekGross: 0, movedLoads: [] };
        acc[driverName][loadStubDate].weekGross += load.gross_total || 0;
        acc[driverName][loadStubDate].movedLoads.push(load);
        return acc;
    }, {});

    const prevWeekMovedLoadGross = allLoads.reduce((acc, load) => {
        // ... (this entire section remains unchanged)
        if (load.status === 'Canceled' || !load.stub_wk_driver) return acc;
        const [loadStubDate, driverIdentifier] = load.stub_wk_driver.split('_');
        if (loadStubDate === prevWeekId && driverIdentifier && checkMovedMondayLoad(load)) {
            const driverName = driverIdentifier.replace(/-/g, ' ');
            acc[driverName] = (acc[driverName] || 0) + (load.gross_total || 0);
        }
        return acc;
    }, {});

    const stubs = allLoads.reduce((acc, load) => {
        // ... (this entire section remains unchanged)
        if (load.status === 'Canceled' || !load.stub_wk_driver) return acc;
        const [loadStubDate, driverIdentifier] = load.stub_wk_driver.split('_');
        if (loadStubDate === currentWeekId && driverIdentifier) {
            const driverName = driverIdentifier.replace(/-/g, ' ');
            if (!acc[driverName]) {
                acc[driverName] = { driverName, contractType: load.contract_type || 'N/A', loadCount: 0, totalGross: 0, totalPrice: 0, dispatchers: new Set(), teams: new Set(), totalDeadhead: 0, totalTripMiles: 0, totalWeight: 0, weightCount: 0, totalCut: 0, totalTolls: 0, totalFuelCost: 0, grossOut: 0, loads: [] };
            }
            const stub = acc[driverName];
            stub.loadCount++;
            stub.totalGross += load.gross_total || 0;
            stub.totalPrice += load.price || 0;
            if(load.dispatcher) stub.dispatchers.add(load.dispatcher);
            if(load.team) stub.teams.add(load.team);
            stub.totalDeadhead += load.deadhead_miles || 0;
            stub.totalTripMiles += load.trip_miles || 0;
            if(load.weight > 0) {
                stub.totalWeight += load.weight || 0;
                stub.weightCount++;
            }
            stub.totalCut += load.cut || 0;
            stub.totalTolls += load.expected_tolls || 0;
            stub.totalFuelCost += load.expected_fuel_cost || 0;
            stub.loads.push(load);
            if (checkMovedMondayLoad(load)) {
                stub.grossOut += load.gross_total || 0;
            }
        }
        return acc;
    }, {});

    return Object.values(stubs).map(stub => {
        stub.avgWeight = stub.weightCount > 0 ? stub.totalWeight / stub.weightCount : 0;
        stub.driverRpm = stub.totalTripMiles > 0 ? stub.totalPrice / stub.totalTripMiles : 0;
        stub.dispatcherText = [...stub.dispatchers].join(', ');
        stub.teamText = [...stub.teams].join(', ');
        stub.grossIn = prevWeekMovedLoadGross[stub.driverName] || 0;
        stub.adjustedGross = stub.totalPrice - stub.grossOut + stub.grossIn;
        const driverHistory = historicalMovedLoads[stub.driverName] || {};
        stub.fourWeekMovedData = [];
        stub.eightWeekMovedData = [];
        Object.entries(driverHistory).forEach(([weekId, data]) => {
            const weekDate = new Date(weekId.replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2'));
            if (weekDate >= fourWeeksAgo) stub.fourWeekMovedData.push({ weekIdentifier: weekId, ...data });
            if (weekDate >= eightWeeksAgo) stub.eightWeekMovedData.push({ weekIdentifier: weekId, ...data });
        });
        stub.fourWeekMovedLoads = stub.fourWeekMovedData.reduce((sum, week) => sum + week.movedLoads.length, 0);
        stub.eightWeekMovedLoads = stub.eightWeekMovedData.reduce((sum, week) => sum + week.movedLoads.length, 0);
        
        // This is the crucial change: using the fast cache lookup.
        stub.flags = appState.liveDriverFlagsCache[stub.driverName] || [];

        return stub;
    });
};

export const getHistoricalStubsForDriver = (driverName, historicalStubs = []) => {
    // ... (this function remains unchanged)
    const driverData = historicalStubs.filter(stub => stub.driver_name === driverName);
    return driverData.sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));
};