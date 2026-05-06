import { appState } from '../state.js';

const REGIONS = {
    'NORTHEAST': ['ME', 'NH', 'MA', 'RI', 'CT', 'VT', 'NY', 'NJ', 'PA', 'DE', 'MD', 'DC', 'WV', 'VA'],
    'SOUTHEAST': ['NC', 'SC', 'GA', 'FL', 'AL', 'MS', 'TN'],
    'MIDWEST': ['MI', 'OH', 'IN', 'IL', 'WI', 'MN', 'IA', 'MO', 'KY', 'NE', 'KS'],
    'SOUTH': ['AR', 'LA', 'OK', 'TX', 'NM'],
    'WEST': ['CA', 'OR', 'WA', 'NV', 'AZ'],
    'MOUNTAIN_WEST': ['CO', 'UT', 'ID', 'WY', 'MT', 'SD', 'ND']
};

export const calculateRegionalPercentages = (entityName, dateString, mode = 'dispatcher') => {
    // Dates are calculated relative to the Pay Date (Thursday)
    const payDate = new Date(dateString);
    if (isNaN(payDate.getTime())) return {};

    // Work Week End (Monday before pay date)
    const workEnd = new Date(payDate);
    workEnd.setUTCDate(payDate.getUTCDate() - 3);
    workEnd.setUTCHours(23, 59, 59, 999);

    // 1WK Start (Tuesday, 6 days before Work End)
    const start1Wk = new Date(workEnd);
    start1Wk.setUTCDate(workEnd.getUTCDate() - 6);
    start1Wk.setUTCHours(0, 0, 0, 0);

    // 4WK Start (21 days before 1WK Start)
    const start4Wk = new Date(start1Wk);
    start4Wk.setUTCDate(start1Wk.getUTCDate() - 21);
    start4Wk.setUTCHours(0, 0, 0, 0);

    // Use Historical Stubs for history AND Live Data for current week
    const allStubs = appState.loads.historicalStubsData || [];
    const liveLoads = appState.profiles.liveData || [];

    const getState = (loc) => {
        if (!loc) return null;
        const match = loc.match(/,\s*([A-Z]{2})$/);
        return match ? match[1] : null;
    };

    // Helper to normalize team names in live data to match rankings (e.g. "Agnius AmongUs")
    const getLiveCompositeTeam = (l) => {
        const teamLower = (l.team || '').toLowerCase().trim();
        const specialPrefixes = ['agnius', 'miles', 'uros', 'wayne', 'mubeen', 'vito'];
        const prefix = specialPrefixes.find(p => teamLower.startsWith(p));
        // Only form composite if the team name is NOT already the full name (heuristic)
        // or if we are matching specific prefixes that denote multi-company teams.
        if (prefix && l.company_name) {
             return `${prefix.charAt(0).toUpperCase() + prefix.slice(1)} ${l.company_name}`;
        }
        return l.team;
    };

    let relevantItems = [];
    const targetNameLower = entityName.trim().toLowerCase();

    // 1. Process Historical Stubs
    allStubs.forEach(s => {
        let isMatch = false;
        if (mode === 'team') {
            const sTeam = (s.stub_team || '').trim().toLowerCase();
            const sComposite = (s.stub_team && s.company_name) ? `${s.stub_team} ${s.company_name}`.toLowerCase() : '';
            // Match against raw team OR potential composite (for history)
            isMatch = (sTeam === targetNameLower || sComposite === targetNameLower);
        } else {
            const sDisp = (s.stub_dispatcher || '').trim().toLowerCase();
            isMatch = (sDisp === targetNameLower);
        }

        if (!isMatch) return;
        
        const state = s.pu_state || getState(s.pu_location);
        if (!state) return;
        if (!s.pay_date) return;
        
        const itemDate = new Date(s.pay_date); 
        itemDate.setUTCDate(itemDate.getUTCDate() - 3);

        relevantItems.push({ date: itemDate, state: state });
    });

    // 2. Process Live Loads
    liveLoads.forEach(l => {
        let isMatch = false;
        if (mode === 'team') {
            const rawTeam = (l.team || '').trim().toLowerCase();
            const composite = getLiveCompositeTeam(l);
            // Match if Composite name matches OR Raw team name matches
            if ((composite && composite.toLowerCase() === targetNameLower) || rawTeam === targetNameLower) {
                isMatch = true;
            }
        } else {
            const lDisp = (l.dispatcher || '').trim().toLowerCase();
            if (lDisp === targetNameLower) isMatch = true;
        }

        if (!isMatch) return;
        if (l.status === 'Canceled' || l.status === 'TONU') return;
        if (!l.do_date) return;
        
        const itemDate = new Date(l.do_date);
        
        if (itemDate >= start4Wk) {
            relevantItems.push({ date: itemDate, state: getState(l.pu_location) });
        }
    });

    // 3. Tally Counts
    let counts1wk = { total: 0 };
    let counts4wk = { total: 0 };
    Object.keys(REGIONS).forEach(r => { counts1wk[r] = 0; counts4wk[r] = 0; });

    relevantItems.forEach(item => {
        if (!item.state) return;
        if (item.date >= start4Wk && item.date <= workEnd) {
            let regionFound = null;
            for (const [region, states] of Object.entries(REGIONS)) {
                if (states.includes(item.state)) {
                    regionFound = region;
                    break;
                }
            }
            if (regionFound) {
                counts4wk.total++;
                counts4wk[regionFound]++;
                if (item.date >= start1Wk) {
                    counts1wk.total++;
                    counts1wk[regionFound]++;
                }
            }
        }
    });

    // 4. Calculate Percentages
    const result = {};
    const keys = {
        'NORTHEAST': 'northeast', 'SOUTHEAST': 'southeast', 'MIDWEST': 'midwest',
        'SOUTH': 'south', 'WEST': 'west', 'MOUNTAIN_WEST': 'mountain_west'
    };

    Object.entries(keys).forEach(([regionName, regionKey]) => {
        result[`region_${regionKey}_1wk`] = counts1wk.total > 0 ? (counts1wk[regionName] / counts1wk.total) : 0;
        result[`region_${regionKey}_4wk`] = counts4wk.total > 0 ? (counts4wk[regionName] / counts4wk.total) : 0;
    });

    return result;
};