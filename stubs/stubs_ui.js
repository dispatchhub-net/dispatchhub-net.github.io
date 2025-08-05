// DISP. TEST/stubs_ui.js
import { appState, mainStubsSortConfig, setMainStubsSortConfig } from '../state.js';
import { processStubsForCurrentWeek, getCurrentStubWeekIdentifier, getHistoricalStubsForDriver } from './stubs_api.js';


// --- MAIN RENDER FUNCTION ---
export const renderStubsUI = () => {
    const allLoads = appState.loads.data || [];
    const stubsData = processStubsForCurrentWeek(allLoads);
    renderStubsHeader();
    renderStubsKpis(stubsData);
    renderStubsTable(stubsData);
    // Also render the modal in case it's open
    renderDriverDeepDiveModal();
};

// --- LIVE STUBS DASHBOARD COMPONENTS ---

// Renders the header with the live badge, search, and action icons
function renderStubsHeader() {
    const header = document.getElementById('stubs-main-header');
    if (!header) return;
    const currentWeekIdentifier = getCurrentStubWeekIdentifier();
    const date = new Date(currentWeekIdentifier.replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2'));
    const formattedDate = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const weekText = `Week Ending: ${formattedDate}`;

    header.innerHTML = `
        <div class="w-1/3">
            <div class="live-badge"><div class="live-badge-dot"></div><span>Live</span></div>
        </div>
        <div class="w-1/3 flex justify-center">
            <input type="text" id="stubs-search-input" placeholder="Search by Driver Name..." class="toolbar-input w-full max-w-xs text-center">
        </div>
        <div class="w-1/3 flex justify-end items-center gap-x-2">
             <button id="stubs-filters-btn" class="toolbar-btn" title="Filters"><svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.572a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" /></svg></button>
            <button id="stubs-settings-btn" class="toolbar-btn" title="Settings"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924-1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg></button>
        </div>
    `;
}

// Renders the four KPI cards
function renderStubsKpis(stubsData) {
    const kpiContainer = document.getElementById('stubs-kpi-container');
    if (!kpiContainer) return;

    const totalGross = stubsData.reduce((sum, stub) => sum + stub.totalGross, 0);
    const totalMiles = stubsData.reduce((sum, stub) => sum + stub.totalTripMiles, 0);
    const totalLoads = stubsData.reduce((sum, stub) => sum + stub.loadCount, 0);
    const fleetRpm = totalMiles > 0 ? totalGross / totalMiles : 0;

    const kpis = [
        { label: 'Total Gross Revenue', value: `$${totalGross.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
        { label: 'Total Miles Driven', value: totalMiles.toLocaleString('en-US') },
        { label: 'Total Loads Completed', value: totalLoads.toLocaleString('en-US') },
        { label: 'Fleet Average RPM', value: `$${fleetRpm.toFixed(2)}` }
    ];

    kpiContainer.innerHTML = kpis.map(kpi => `
        <div class="bg-gray-800 border border-gray-700 rounded-lg p-2 text-center">
            <h4 class="text-xs text-gray-400 uppercase font-semibold">${kpi.label}</h4>
            <p class="text-xl font-bold text-teal-400 mt-0.5">${kpi.value}</p>
        </div>
    `).join('');
}

// Renders the main, scrollable table of driver stubs
function renderStubsTable(stubsData) {
    const tableContainer = document.getElementById('stubs-table-container');
    if (!tableContainer) return;

    const searchTerm = document.getElementById('stubs-search-input')?.value.toLowerCase() || '';

    const filteredData = searchTerm
        ? stubsData.filter(stub => stub.driverName.toLowerCase().includes(searchTerm))
        : stubsData;

    const { key: sortKey, direction: sortDir } = mainStubsSortConfig;

    const sortedData = [...filteredData].sort((a, b) => {
        let valA = a[sortKey];
        let valB = b[sortKey];
        if (sortKey === 'flags') {
            valA = a.flags?.length || 0;
            valB = b.flags?.length || 0;
        }
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        if (typeof valA === 'string') {
            return sortDir === 'ascending' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else {
            return sortDir === 'ascending' ? valA - valB : valB - valA;
        }
    });

    const getSortIcon = (key) => {
        if (sortKey !== key) return '';
        return sortDir === 'ascending' ? ' ▲' : ' ▼';
    };
    
    const headers = [
        { key: 'flags', label: 'Flags', class: 'text-left w-56' }, // Increased width
        { key: 'driverName', label: 'Driver Name' },
        { key: 'dispatcherText', label: 'Dispatcher' },
        { key: 'teamText', label: 'Team' },
        { key: 'loadCount', label: 'Load Count', class: 'text-center' },
        { key: 'totalDeadhead', label: 'Deadhead', class: 'text-center' },
        { key: 'totalTripMiles', label: 'Trip Miles', class: 'text-center' },
        { key: 'avgWeight', label: 'Avg Weight', class: 'text-center' },
        { key: 'totalCut', label: 'Cut', class: 'text-center' },
        { key: 'totalTolls', label: 'Tolls', class: 'text-center' },
        { key: 'totalFuelCost', label: 'Fuel Cost', class: 'text-center' },
        { key: 'totalPrice', label: 'Live Gross', class: 'text-center' },
        { key: 'adjustedGross', label: 'Adjusted Gross', class: 'text-center' },
        { key: 'driverRpm', label: 'Driver RPM', class: 'text-center' },
        { key: 'fourWeekMovedLoads', label: '4W Moved', class: 'text-center' },
        { key: 'eightWeekMovedLoads', label: '8W Moved', class: 'text-center' }
    ];

    const tableHTML = `
        <table class="w-full text-sm text-left text-gray-400">
            <thead class="text-xs text-gray-300 uppercase">
                <tr>${headers.map(h => `<th scope="col" class="px-4 py-2 cursor-pointer select-none ${h.class || ''}" onclick="requestMainStubsSort('${h.key}')">${h.label}${getSortIcon(h.key)}</th>`).join('')}</tr>
            </thead>
            <tbody class="divide-y divide-gray-700">
                ${sortedData.length > 0 ? sortedData.map(stub => {
                    const flagsHTML = `<div class="flex items-start gap-1 flex-wrap">${(stub.flags || []).map(flag => 
                        `<span class="stub-flag flag-${flag.color}">${flag.text}</span>`
                    ).join('')}</div>`;

                    const liveGrossTooltip = generateLoadsTooltipHTML(stub.loads).replace(/'/g, "&apos;");
                    let adjustedGrossTooltip = 'Base: $' + stub.totalPrice.toFixed(2);
                    if (stub.grossIn > 0 || stub.grossOut > 0) adjustedGrossTooltip += `<hr class="border-gray-600 my-1">`;
                    if (stub.grossIn > 0) adjustedGrossTooltip += `<br><span class='text-green-400'>IN: +$${stub.grossIn.toFixed(2)}</span> (From Previous Week)`;
                    if (stub.grossOut > 0) adjustedGrossTooltip += `<br><span class='text-red-400'>OUT: -$${stub.grossOut.toFixed(2)}</span> (Moved to Next Week)`;
                    adjustedGrossTooltip = adjustedGrossTooltip.replace(/'/g, "&apos;");
                    const fourWeekTooltip = generateMovedLoadsTooltipHTML(stub.fourWeekMovedData).replace(/'/g, "&apos;");
                    const eightWeekTooltip = generateMovedLoadsTooltipHTML(stub.eightWeekMovedData).replace(/'/g, "&apos;");

                    return `
                        <tr class="hover:bg-gray-700/50 cursor-pointer" data-driver-name="${stub.driverName}">
                            <td class="px-2 py-2 min-h-[50px]">${flagsHTML}</td>
                            <td class="px-4 py-1 font-medium text-gray-200 whitespace-nowrap">${stub.driverName}</td>
                            <td class="px-4 py-1 whitespace-nowrap">${stub.dispatcherText}</td>
                            <td class="px-4 py-1 whitespace-nowrap">${stub.teamText}</td>
                            <td class="px-4 py-1 text-center whitespace-nowrap">${stub.loadCount}</td>
                            <td class="px-4 py-1 text-center whitespace-nowrap">${stub.totalDeadhead.toLocaleString()}</td>
                            <td class="px-4 py-1 text-center whitespace-nowrap">${stub.totalTripMiles.toLocaleString()}</td>
                            <td class="px-4 py-1 text-center whitespace-nowrap">${stub.avgWeight.toFixed(0)} lbs</td>
                            <td class="px-4 py-1 text-center whitespace-nowrap">$${stub.totalCut.toFixed(2)}</td>
                            <td class="px-4 py-1 text-center whitespace-nowrap">$${stub.totalTolls.toFixed(2)}</td>
                            <td class="px-4 py-1 text-center whitespace-nowrap">$${stub.totalFuelCost.toFixed(2)}</td>
                            <td class="px-4 py-1 text-center whitespace-nowrap font-semibold text-blue-400 flag-tooltip-container" data-tooltip-html='${liveGrossTooltip}'>$${stub.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td class="px-4 py-1 text-center whitespace-nowrap font-semibold text-green-400 flag-tooltip-container" data-tooltip-html='${adjustedGrossTooltip}'>$${stub.adjustedGross.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td class="px-4 py-1 text-center whitespace-nowrap font-semibold text-teal-400">$${stub.driverRpm.toFixed(2)}</td>
                            <td class="px-4 py-1 text-center whitespace-nowrap flag-tooltip-container" data-tooltip-html='${fourWeekTooltip}'>${stub.fourWeekMovedLoads}</td>
                            <td class="px-4 py-1 text-center whitespace-nowrap flag-tooltip-container" data-tooltip-html='${eightWeekTooltip}'>${stub.eightWeekMovedLoads}</td>
                        </tr>
                    `;
                }).join('') : `
                    <tr><td colspan="${headers.length}" class="text-center py-8 text-gray-500">No stubs found for the current week.</td></tr>
                `}
            </tbody>
        </table>
    `;
    tableContainer.innerHTML = tableHTML;
}


// --- DEEP DIVE MODAL COMPONENTS ---

function renderDriverDeepDiveModal() {
    const modal = document.getElementById('stubs-deep-dive-modal');
    if (!modal) return;
    modal.classList.toggle('hidden', !appState.isStubsModalOpen);

    if (appState.isStubsModalOpen && appState.selectedDriverForModal) {
        const driverName = appState.selectedDriverForModal;
        const historicalStubs = getHistoricalStubsForDriver(driverName, appState.historicalStubsData);
        const allCurrentStubs = processStubsForCurrentWeek(appState.loads.data || []);
        const currentDriverStub = allCurrentStubs.find(stub => stub.driverName === driverName);
        
        renderModalHeader(driverName, historicalStubs);
        renderModalKpis(historicalStubs);
        renderModalHistoricalTable(historicalStubs); // This function no longer needs historicalFlags
        renderModalChart(historicalStubs, currentDriverStub?.eightWeekMovedData || []);
    }
}

// Add this new function to the end of stubs_ui.js

function renderMovedLoadsChart(movedData) {
    const chartContainer = d3.select("#stubs-modal-moved-loads-chart-container");
    chartContainer.html(""); // Clear previous chart

    // Add a title
    chartContainer.append('h4')
        .attr('class', 'text-center text-xs text-gray-400 uppercase font-semibold mb-2')
        .text('Moved Loads / Week');

    if (!movedData || movedData.length === 0) {
        chartContainer.append('div')
            .attr('class', 'flex items-center justify-center h-full text-gray-500 text-sm')
            .text('No moved loads in the last 8 weeks.');
        return;
    }

    const chartData = movedData.map(d => ({
        date: new Date(d.weekIdentifier.replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2')),
        count: d.movedLoads.length
    })).sort((a, b) => a.date - b.date);

    const margin = { top: 10, right: 10, bottom: 20, left: 25 };
    const width = chartContainer.node().getBoundingClientRect().width - margin.left - margin.right;
    const height = chartContainer.node().getBoundingClientRect().height - 40 - margin.top - margin.bottom;

    const svg = chartContainer.append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
        .domain(chartData.map(d => d.date))
        .range([0, width])
        .padding(0.4);

    const y = d3.scaleLinear()
        .domain([0, d3.max(chartData, d => d.count) || 1])
        .range([height, 0]);

    svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x).tickFormat(d3.timeFormat("%b %d")).tickSizeOuter(0))
        .attr("class", "axis-style");

    svg.append("g")
        .call(d3.axisLeft(y).ticks(Math.min(5, d3.max(chartData, d => d.count))).tickFormat(d3.format('d')).tickSizeOuter(0))
        .attr("class", "axis-style");
        
    svg.selectAll(".domain").remove();
    svg.selectAll(".tick line").attr("stroke", "#4b5563");
    svg.selectAll(".tick text").attr("fill", "#9ca3af").attr("font-size", "10px");

    svg.selectAll(".bar")
        .data(chartData)
        .join("rect")
        .attr("class", "bar")
        .attr("x", d => x(d.date))
        .attr("y", d => y(d.count))
        .attr("width", x.bandwidth())
        .attr("height", d => height - y(d.count))
        .attr("fill", "#2dd4bf"); // Teal color
}

function renderModalHeader(driverName, historicalStubs) {
    const headerContent = document.getElementById('stubs-modal-header-content');
    const mostRecentStub = historicalStubs.length > 0 ? historicalStubs[0] : null;

    const currentDispatch = mostRecentStub?.stub_dispatcher || 'N/A';
    const currentTeam = mostRecentStub?.stub_team || 'N/A';
    const currentCompany = mostRecentStub?.company_name || 'N/A';

    headerContent.innerHTML = `
        <div class="flex items-center justify-between w-full relative h-12">
            <div class="w-1/3 text-left">
                <h2 class="text-2xl font-bold text-white whitespace-nowrap">${driverName}</h2>
                <p class="text-sm text-gray-400 mt-1">
                    Total Stubs: <span class="font-semibold text-gray-300">${historicalStubs.length}</span>
                </p>
            </div>

            <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <div class="risk-badge-medium">Risk: Medium</div>
            </div>

            <div class="w-1/3 text-right text-sm text-gray-400 leading-snug">
                <p>Company: <span class="font-semibold text-gray-200">${currentCompany}</span></p>
                <p>Team: <span class="font-semibold text-gray-200">${currentTeam}</span></p>
                <p>Dispatch: <span class="font-semibold text-gray-200">${currentDispatch}</span></p>
            </div>
        </div>
    `;
}

function renderModalKpis(historicalStubs) {
    const kpiContainer = document.getElementById('stubs-modal-kpi-container');
    const totalStubs = historicalStubs.length;
    if (totalStubs === 0) {
        kpiContainer.innerHTML = '<p class="text-gray-500 col-span-2 text-center">No historical data for KPIs.</p>';
        return;
    }

    const avgNetPay = historicalStubs.reduce((sum, s) => sum + (s.net_pay || 0), 0) / totalStubs;
    const avgRpm = historicalStubs.reduce((sum, s) => sum + (s.rpm_all || 0), 0) / totalStubs;
    const avgMiles = historicalStubs.reduce((sum, s) => sum + (s.total_miles || 0), 0) / totalStubs;
    const avgGross = historicalStubs.reduce((sum, s) => sum + (s.driver_gross || 0), 0) / totalStubs;

    const kpis = [
        { label: 'Avg Weekly Net', value: `$${avgNetPay.toLocaleString('en-US', {maximumFractionDigits: 0})}` },
        { label: 'Avg Weekly Gross', value: `$${avgGross.toLocaleString('en-US', {maximumFractionDigits: 0})}` },
        { label: 'All-Time Avg RPM', value: `$${avgRpm.toFixed(2)}` },
        { label: 'Avg Miles / Week', value: `${avgMiles.toLocaleString('en-US', {maximumFractionDigits: 0})}` },
    ];
    
    kpiContainer.innerHTML = kpis.map(kpi => `
    <div class="bg-gray-800/50 border border-gray-700/50 rounded-lg p-2 text-center flex flex-col justify-center">
        <h4 class="text-xs text-gray-400 uppercase font-semibold">${kpi.label}</h4>
        <p class="text-xl font-bold text-teal-400 mt-0.5">${kpi.value}</p>
    </div>
    `).join('');
}

function renderModalHistoricalTable(historicalStubs) {
    const tableContainer = document.getElementById('stubs-modal-table-container');
    if (historicalStubs.length === 0) {
        tableContainer.innerHTML = '<p class="p-4 text-center text-gray-500">No historical stubs found for this driver.</p>';
        return;
    }

    // This is the original, correct set of headers for the modal
    const headers = [
        { label: 'Pay Date', key: 'pay_date', format: (d) => new Date(d).toLocaleDateString() },
        { label: 'Gross', key: 'driver_gross', format: (d) => `$${(d || 0).toLocaleString()}`, class: 'text-blue-400' },
        { label: 'Net', key: 'net_pay', format: (d) => `$${(d || 0).toLocaleString()}`, class: 'text-green-400' },
        { label: 'Margin', key: 'margin', format: (d) => `$${(d || 0).toFixed(0)}` },
        { label: 'Miles', key: 'total_miles', format: (d) => (d || 0).toLocaleString() },
        { label: 'DH', key: 'dh', format: (d) => `${(d || 0)}%` },
        { label: 'RPM', key: 'rpm_all', format: (d) => `$${(d || 0).toFixed(2)}` },
        { label: 'Dispatch', key: 'stub_dispatcher' },
        { label: 'Team', key: 'stub_team' },
        { label: 'Balance', key: 'balance', format: (d) => `$${(d || 0).toFixed(2)}` },
        { label: 'Bal. Settle', key: 'balance_settle', format: (d) => `$${(d || 0).toFixed(2)}` },
        { label: 'Escrow', key: 'escrow_deduct', format: (d) => `$${(d || 0).toFixed(2)}` },
        { label: 'PO Settle', key: 'po_settle', format: (d) => `$${(d || 0).toFixed(2)}` },
        { label: 'Other', key: 'other', format: (d) => `$${(d || 0).toFixed(2)}` },
    ];

    tableContainer.innerHTML = `
        <table class="w-full text-xs text-left text-gray-400 stubs-deep-dive-table">
            <thead class="text-xs text-gray-300 uppercase bg-gray-900 sticky top-0">
                <tr>
                    ${headers.map(h => `<th class="px-3 py-2 text-center whitespace-nowrap">${h.label}</th>`).join('')}
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-800">
                ${historicalStubs.map(stub => `
                    <tr class="hover:bg-gray-700/50">
                        ${headers.map(h => {
                            const value = stub[h.key] ?? '-';
                            const displayValue = h.format ? h.format(value) : value;
                            return `<td class="px-3 py-1.5 whitespace-nowrap text-center font-mono ${h.class || ''}">${displayValue}</td>`;
                        }).join('')}
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderModalChart(historicalStubs, movedData) {
    const chartContainer = d3.select("#stubs-modal-chart-container");
    chartContainer.html("");

    const metrics = [
        { key: 'net_pay', label: 'Net Pay', format: d3.format("$,.0f"), color: "#4ade80", negativeColor: "#f87171" },
        { key: 'driver_gross', label: 'Gross', format: d3.format("$,.0f"), color: "#60a5fa", negativeColor: "#f87171" },
        { key: 'rpm_all', label: 'RPM', format: d3.format("$.2f"), color: "#f87171", negativeColor: "#f87171" },
        { key: 'total_miles', label: 'Miles', format: d3.format(",.0f"), color: "#fbbf24", negativeColor: "#f87171" },
        { key: 'moved_loads', label: 'Moved Loads', format: d3.format("d"), color: "#2dd4bf" }
    ];
    
    const switcher = chartContainer.append('div').attr('class', 'p-2 text-center');
    metrics.forEach(metric => {
        switcher.append('button')
            .attr('class', `px-3 py-1 text-xs rounded-md mx-1 font-semibold ${appState.stubsModalChartView === metric.key ? 'bg-teal-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`)
            .text(metric.label)
            .on('click', () => {
                appState.stubsModalChartView = metric.key;
                renderModalChart(historicalStubs, movedData);
            });
    });

    const activeMetric = metrics.find(m => m.key === appState.stubsModalChartView);
    const isMovedLoadsView = activeMetric.key === 'moved_loads';

    const chartData = isMovedLoadsView 
        ? movedData.map(d => ({ date: new Date(d.weekIdentifier.replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2')), value: d.movedLoads.length })).sort((a, b) => a.date - b.date)
        : historicalStubs.map(d => ({ date: new Date(d.pay_date), value: d[activeMetric.key] || 0 })).sort((a, b) => a.date - b.date);

    if (chartData.length < 1 && isMovedLoadsView) {
        chartContainer.append('div').attr('class', 'flex items-center justify-center h-full text-gray-500 text-sm').text('No moved loads in the last 8 weeks.');
        return;
    }
    if (chartData.length < 2 && !isMovedLoadsView) {
        chartContainer.append('div').attr('class', 'flex items-center justify-center h-full text-gray-500 text-sm').text('Not enough data for a trend line.');
        return;
    }
    
    const margin = { top: 30, right: 40, bottom: 30, left: 60 };
    const width = chartContainer.node().getBoundingClientRect().width - margin.left - margin.right;
    const height = chartContainer.node().getBoundingClientRect().height - 80 - margin.top - margin.bottom;

    const svg = chartContainer.append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = isMovedLoadsView 
        ? d3.scaleBand().domain(chartData.map(d => d.date)).range([0, width]).padding(0.4)
        : d3.scaleTime().domain(d3.extent(chartData, d => d.date)).range([0, width]);

    const yDomain = d3.extent(chartData, d => d.value);
    const yMin = yDomain[0] > 0 ? 0 : yDomain[0] * 1.2;
    const yMax = yDomain[1] < 0 ? 0 : yDomain[1] * 1.2;
    const y = d3.scaleLinear().domain([yMin, yMax]).range([height, 0]).nice();

    // Axes
    svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(5).tickFormat(d3.timeFormat("%b %d")).tickSizeOuter(0)).attr("class", "axis-style");
    svg.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(activeMetric.format).tickSizeOuter(0)).attr("class", "axis-style");
    svg.selectAll(".domain").attr("stroke", "#6b7280").attr("stroke-width", 1.5);
    svg.selectAll(".tick line").attr("stroke", "#4b5563");
    svg.selectAll(".tick text").attr("fill", "#d1d5db").attr("font-size", "11px").attr("font-weight", "500");

    // Chart content
    if (isMovedLoadsView) {
        svg.selectAll(".bar")
            .data(chartData)
            .join("rect")
            .attr("x", d => x(d.date))
            .attr("y", d => y(d.value))
            .attr("width", x.bandwidth())
            .attr("height", d => height - y(d.value))
            .attr("fill", activeMetric.color);
    } else {
        svg.append("defs").append("clipPath").attr("id", "clip-above").append("rect").attr("width", width).attr("height", y(0));
        svg.append("defs").append("clipPath").attr("id", "clip-below").append("rect").attr("width", width).attr("height", height - y(0)).attr("y", y(0));
        const area = d3.area().x(d => x(d.date)).y0(y(0)).y1(d => y(d.value));
        svg.append("path").datum(chartData).attr("clip-path", "url(#clip-above)").attr("fill", activeMetric.color).style("opacity", 0.4).attr("d", area);
        svg.append("path").datum(chartData).attr("clip-path", "url(#clip-below)").attr("fill", activeMetric.negativeColor).style("opacity", 0.4).attr("d", area);
        if (yMin < 0 && yMax > 0) svg.append("line").attr("x1", 0).attr("x2", width).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", "#6b7280").attr("stroke-width", 1.5).attr("stroke-dasharray", "3,3");
        svg.append("path").datum(chartData).attr("fill", "none").attr("stroke", activeMetric.color).attr("stroke-width", 2.5).attr("d", d3.line().x(d => x(d.date)).y(d => y(d.value)));
    }
    
    // --- Tooltip Logic (Restored and Unified) ---
    const tooltip = d3.select("#stubs-modal-container").selectAll(".d3-tooltip").data([null]).join("div").attr("class", "d3-tooltip hidden");
    const focus = svg.append("g").attr("class", "focus").style("display", "none");
    focus.append("line").attr("class", "y-hover-line").attr("stroke", "#9ca3af").attr("stroke-width", 1).attr("stroke-dasharray", "3,3").attr("y1", -height).attr("y2", 0);
    focus.append("circle").attr("r", 5).attr("stroke", "white").attr("stroke-width", 2);

    svg.append("rect")
        .attr("width", width)
        .attr("height", height)
        .style("fill", "none")
        .style("pointer-events", "all")
        .on("mouseover", () => { focus.style("display", null); tooltip.classed('hidden', false); })
        .on("mouseout", () => { focus.style("display", "none"); tooltip.classed('hidden', true); })
        .on("mousemove", (event) => {
            const bisectDate = d3.bisector(d => d.date).left;
            const x0 = x.invert(d3.pointer(event)[0]);
            let i;
            if (isMovedLoadsView) {
                // For bar charts, find the band index
                const eachBand = x.step();
                i = Math.floor((d3.pointer(event)[0] / eachBand));
                i = Math.min(i, chartData.length - 1);
            } else {
                // For line charts, bisect
                i = bisectDate(chartData, x0, 1);
            }
            const d0 = chartData[i - 1], d1 = chartData[i];
            const d = (d1 && (x0 - d0?.date > d1?.date - x0)) ? d1 : (d0 || d1);
            if (!d) return;

            const focusX = isMovedLoadsView ? x(d.date) + x.bandwidth() / 2 : x(d.date);
            const focusY = y(d.value);
            
            focus.attr("transform", `translate(${focusX},${focusY})`);
            focus.select("circle").attr("fill", activeMetric.color);
            tooltip.html(`<strong>${d.date.toLocaleDateString()}</strong><br/>${activeMetric.label}: ${activeMetric.format(d.value)}`)
                .style("left", `${event.pageX + 15}px`)
                .style("top", `${event.pageY - 15}px`);
        });
}


// --- EVENT LISTENERS AND HELPERS ---
function openStubsModalForDriver(driverName) {
    appState.selectedDriverForModal = driverName;
    appState.isStubsModalOpen = true;
    appState.stubsModalChartView = 'net_pay'; // Set default view here
    renderDriverDeepDiveModal();
}

// Request a sort on the main stubs table
function requestMainStubsSort(key) {
    let direction = 'descending';
    if (mainStubsSortConfig.key === key && mainStubsSortConfig.direction === 'descending') {
        direction = 'ascending';
    }
    setMainStubsSortConfig({ key, direction });
    renderStubsUI();
}

function generateLoadsTooltipHTML(loads) {
    if (!loads || loads.length === 0) return 'No loads in this calculation.';
    const sortedLoads = loads.sort((a, b) => new Date(a.pu_date) - new Date(b.pu_date));
    return sortedLoads.map((load, index) => {
        const puDate = new Date(load.pu_date);
        const doDate = new Date(load.do_date);
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayRange = `<span class="tooltip-day-range">${days[puDate.getUTCDay()]}–${days[doDate.getUTCDay()]}</span>`;
        const origin = (load.pu_location || 'N/A').split(',')[1]?.trim() || 'N/A';
        const dest = (load.do_location || 'N/A').split(',')[1]?.trim() || 'N/A';
        const miles = load.trip_miles || 0;
        const price = load.price || 0;
        const formattedPrice = `<span class="tooltip-rate">$${price.toLocaleString()}</span>`;
        const rpm = (load.trip_miles > 0 ? (load.price / load.trip_miles) : 0).toFixed(2);
        return `${index + 1}. ${dayRange} | ${origin} → ${dest} | ${miles} mi | ${formattedPrice} | $${rpm}/mi`;
    }).join('<br>');
}

function generateMovedLoadsTooltipHTML(weeklyData) {
    if (!weeklyData || weeklyData.length === 0) return 'No moved loads in this period.';
    const sortedWeeks = weeklyData.sort((a, b) => new Date(a.weekIdentifier) - new Date(b.weekIdentifier));
    let html = '';
    sortedWeeks.forEach(week => {
        html += `<div class="font-bold text-amber-400">Week of ${week.weekIdentifier} Gross: $${week.weekGross.toLocaleString()}</div>`;
        week.movedLoads.forEach(load => {
            const origin = (load.pu_location || 'N/A').split(',')[1]?.trim() || 'N/A';
            const dest = (load.do_location || 'N/A').split(',')[1]?.trim() || 'N/A';
            html += `<div class="pl-2 text-xs">↳ ${origin} → ${dest} ($${(load.gross_total || 0).toLocaleString()})</div>`;
        });
    });
    return html;
}

const debounce = (func, delay) => {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
};

// Initialize event listeners for this view
export const initializeStubsEventListeners = () => {
    const searchInput = document.getElementById('stubs-search-input');
    if (searchInput && !searchInput._listenerAttached) {
        searchInput.addEventListener('focus', () => searchInput.classList.add('text-left'));
        searchInput.addEventListener('blur', () => { if (!searchInput.value) searchInput.classList.remove('text-left'); });
        searchInput.addEventListener('input', debounce(() => {
            renderStubsUI();
        }, 300));
        searchInput._listenerAttached = true;
    }

    const tableWrapper = document.getElementById('stubs-table-wrapper');
    const tooltip = document.getElementById('loads-tooltip');
    if (tableWrapper && !tableWrapper._listenersAttached) {
        tableWrapper.addEventListener('click', (e) => {
            const row = e.target.closest('tr');
            if (row && row.dataset.driverName) {
                openStubsModalForDriver(row.dataset.driverName);
            }
        });

        tableWrapper.addEventListener('mouseover', (e) => {
            const target = e.target.closest('.flag-tooltip-container');
            if (!target || !target.dataset.tooltipHtml) return;
            tooltip.innerHTML = target.dataset.tooltipHtml;
            tooltip.classList.remove('hidden');
        });
        tableWrapper.addEventListener('mousemove', (e) => {
            const target = e.target.closest('.flag-tooltip-container');
            if (target && !tooltip.classList.contains('hidden')) {
                tooltip.style.left = `${e.pageX - tooltip.offsetWidth - 15}px`;
                tooltip.style.top = `${e.pageY + 15}px`;
            }
        });
        tableWrapper.addEventListener('mouseout', (e) => {
            const target = e.target.closest('.flag-tooltip-container');
            if (target) tooltip.classList.add('hidden');
        });
        tableWrapper._listenersAttached = true;
    }
    
   // Listener for closing the modal with the ESC key
   if (!document.body._escListenerAttached) {
    document.body.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && appState.isStubsModalOpen) {
            appState.isStubsModalOpen = false;
            appState.selectedDriverForModal = null;
            renderDriverDeepDiveModal();
        }
    });
    document.body._escListenerAttached = true;
}
};