import { ProfileCard } from './profile_card.js';

export const CompareView = {
    attachEvents: function(d, uiContext) {
        const btn = document.getElementById('btn-compare-start');
        if (btn) {
            btn.onclick = (e) => {
                e.stopPropagation();
                this.renderSearchPopup(d, uiContext);
            };
        }
    },

    renderSearchPopup: function(currentDispatcher, uiContext) {
        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'compare-overlay';
        modalOverlay.style.cssText = `position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index: 20000; display:flex; align-items:center; justify-content:center; backdrop-filter: blur(5px);`;
        
        const searchContainer = document.createElement('div');
        searchContainer.id = 'compare-search-container';
        searchContainer.style.cssText = `width: 450px; background: #1f2937; border: 1px solid #374151; border-radius: 12px; box-shadow: 0 25px 50px rgba(0,0,0,0.9); padding: 20px; display:flex; flex-direction:column; gap:10px; animation: modalPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); position:relative;`;

        // X Button
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✕';
        closeBtn.style.cssText = `position: absolute; top: 12px; right: 12px; background: transparent; border: none; color: #9ca3af; font-size: 16px; cursor: pointer; padding: 5px; line-height: 1;`;
        closeBtn.onmouseenter = () => closeBtn.style.color = '#fff';
        closeBtn.onmouseleave = () => closeBtn.style.color = '#9ca3af';
        
        const title = document.createElement('h3');
        title.innerText = 'Compare Dispatchers';
        title.style.cssText = 'color:#fff; font-size:16px; font-weight:800; text-transform:uppercase; margin-bottom:5px; text-align:center; letter-spacing: 1px;';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Type name to compare...';
        input.style.cssText = `width: 100%; background: #111827; border: 1px solid #4b5563; color: #fff; padding: 12px; font-size: 14px; border-radius: 6px; outline: none; text-align:center; font-weight:600;`;
        
        const results = document.createElement('div');
        results.style.cssText = `max-height: 300px; overflow-y: auto; display: none; flex-direction: column; gap: 4px; margin-top: 5px;`;

        searchContainer.appendChild(closeBtn);
        searchContainer.appendChild(title);
        searchContainer.appendChild(input);
        searchContainer.appendChild(results);
        modalOverlay.appendChild(searchContainer);
        document.body.appendChild(modalOverlay);
        
        input.focus();

        const closeSearch = () => { if(modalOverlay) modalOverlay.remove(); };
        
        closeBtn.onclick = closeSearch;
        modalOverlay.onclick = (e) => { if(e.target === modalOverlay) closeSearch(); };

        input.oninput = (e) => {
            const val = e.target.value.toLowerCase().trim();
            results.innerHTML = '';
            if (val.length === 0) {
                results.style.display = 'none';
                return;
            }

            const matches = uiContext.state.dispatchers.filter(x => 
                x.id !== currentDispatcher.id && x.name.toLowerCase().startsWith(val)
            ).slice(0, 10);

            if (matches.length > 0) {
                results.style.display = 'flex';
                matches.forEach(m => {
                    const row = document.createElement('div');
                    row.style.cssText = `padding: 10px; font-size: 13px; color: #d1d5db; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 12px; border: 1px solid transparent; transition: all 0.2s;`;
                    row.innerHTML = `<img src="${m.photo}" style="width:32px; height:32px; border-radius:50%; object-fit:cover;"><span>${m.name}</span>`;
                    row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,0.05)'; row.style.borderColor = '#374151'; };
                    row.onmouseleave = () => { row.style.background = 'transparent'; row.style.borderColor = 'transparent'; };
                    row.onclick = () => {
                        this.renderComparisonView(currentDispatcher, m, uiContext);
                        closeSearch();
                    };
                    results.appendChild(row);
                });
            } else {
                results.style.display = 'none';
            }
        };
    },

    renderComparisonView: function(d1, d2, uiContext) {
        const container = document.getElementById('dispatcher-modal-content');
        if (!container) return;
        
        // Remove All-Star glow from modal wrapper when entering compare view
        const modal = document.getElementById('dispatcher-details-modal');
        if (modal) modal.classList.remove('all-star-profile-glow');

        const allStarIds = new Set();
        ['EFF','VEL','OPS','REV','HLT'].forEach(cat => {
            let max = -1; let best = null;
            uiContext.state.dispatchers.forEach(dx => {
                 const s = uiContext.state.stats[dx.name.trim().toLowerCase()];
                 if(!s) return;
                 const sc = s.scores[cat]||0;
                 if(sc > max) { max = sc; best = dx; }
                 else if(sc === max && best && dx.rating > best.rating) { best = dx; }
            });
            if(best) allStarIds.add(best.id);
        });

        const m1 = ProfileCard.getMetrics(d1.id, uiContext.state);
        const m2 = ProfileCard.getMetrics(d2.id, uiContext.state);

        const color1 = '#009088'; 
        const color2 = '#ef4444'; 

        // Styles for Tooltips
        const compareStyles = `
            <style>
                .hero-trophy::after {
                    content: attr(data-tooltip);
                    position: absolute;
                    bottom: 100%;
                    left: 50%;
                    transform: translateX(-50%) translateY(-5px);
                    background: #111827;
                    border: 1px solid #4b5563;
                    color: #fff;
                    padding: 6px 10px;
                    border-radius: 4px;
                    font-size: 11px;
                    white-space: nowrap;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.2s;
                    z-index: 1000;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.8);
                }
                .hero-trophy:hover::after {
                    opacity: 1;
                }
            </style>
        `;

        // Trophies
        const getTrophies = (stats) => (stats.trophies || []).map(t => 
            `<div class="hero-trophy" data-tooltip="${t.title}${t.desc && t.desc !== 'Holder' ? ': '+t.desc : ''}" style="width:22px; height:22px; font-size:11px; margin: 0 2px; border:1px solid rgba(255,255,255,0.2); background:rgba(255,255,255,0.05); display:flex; align-items:center; justify-content:center; border-radius:3px; cursor:help; position:relative;"><span>${t.icon}</span></div>`
        ).join('');

        const getMiniStats = (d, stats, rankings, isLeft) => {
            const num = (n) => (n || 0).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:1});
            const money = (n) => '$' + (n || 0).toLocaleString('en-US', {maximumFractionDigits: 0});
            const r = rankings[d.name] || {};
            const ms = stats.stats;
            const rowStyle = `display:flex; justify-content:space-between; gap:10px; border-bottom:1px solid rgba(255,255,255,0.08); padding: 3px 0;`;
            
            return `
                <div style="display:flex; flex-direction:column; gap:1px; font-size:11px; color:#9ca3af; font-weight:700; margin-top:4px; width: 100%;">
                    <div style="${rowStyle}"><span>Total Gross:</span><span style="color:#fff; font-size:11px;">${money(r.gross)}</span></div>
                    <div style="${rowStyle}"><span>Total Loads:</span><span style="color:#fff; font-size:11px;">${Math.round(r.loads || 0)}</span></div>
                    <div style="${rowStyle}"><span>Miles:</span><span style="color:#fff; font-size:11px;">${num(ms.totalMiles)}</span></div>
                    <div style="${rowStyle}"><span style="color:#fbbf24;">OO Trucks:</span><span style="color:#fff; font-size:11px;">${d.ooTrucks || 0}</span></div>
                    <div style="${rowStyle}"><span style="color:#60a5fa;">LOO Trucks:</span><span style="color:#fff; font-size:11px;">${d.looTrucks || 0}</span></div>
                </div>
            `;
        };

        const renderHeroSide = (d, stats, mainColor, isLeft) => {
            const bgLogoUrl = d.teamLogo || '';
            const bgLogoDisplay = bgLogoUrl ? 'block' : 'none';
            
            let tierColor = '#cd7f32'; 
            if(stats.stats.overallScore >= 78) tierColor = '#fbbf24'; 
            else if(stats.stats.overallScore >= 60) tierColor = '#e5e7eb';

            const jaggedLeft = `polygon(0 0, 49% 0, 47% 10%, 49% 20%, 46% 30%, 49% 40%, 47% 50%, 49% 60%, 46% 70%, 49% 80%, 47% 90%, 49% 100%, 0 100%)`;
            const jaggedRight = `polygon(51% 0, 100% 0, 100% 100%, 51% 100%, 53% 90%, 51% 80%, 54% 70%, 51% 60%, 53% 50%, 51% 40%, 54% 30%, 51% 20%, 53% 10%)`;

            let bgDiv = '';
            if (isLeft) {
                 bgDiv = `<div style="position:absolute; top:0; left:0; width:100%; height:100%; background:${color1}; opacity:0.15; clip-path: ${jaggedLeft}; z-index:1;"></div>`;
            } else {
                 bgDiv = `<div style="position:absolute; top:0; right:0; width:100%; height:100%; background:${color2}; opacity:0.15; clip-path: ${jaggedRight}; z-index:0;"></div>`;
            }
            
            const isAllStar = allStarIds.has(d.id);
            let imgBorderColor = isAllStar ? '#fbbf24' : (isLeft ? '#009088' : '#ef4444');

            const textAlign = isLeft ? 'right' : 'left';
            const alignItems = isLeft ? 'flex-end' : 'flex-start';
            const contentDir = isLeft ? 'row' : 'row-reverse';
            const padding = isLeft ? 'padding-right: 20px;' : 'padding-left: 20px;'; 

            return `
            <div style="flex: 1; position: relative; overflow: visible; display: flex; align-items: flex-end; justify-content: ${isLeft ? 'flex-end' : 'flex-start'}; ${padding}">
                <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: hidden; z-index: 0;">
                    ${bgDiv}
                    <img src="${bgLogoUrl}" style="position:absolute; top:-40px; ${isLeft ? 'left:-180px; transform:rotate(-15deg);' : 'right:-180px; transform:rotate(15deg);'} height: 130%; width: auto; opacity: 0.2; pointer-events: none; z-index: 0; display:${bgLogoDisplay};">
                </div>

                <div style="display:flex; align-items: flex-end; gap: 10px; z-index: 5; position:relative; flex-direction: ${contentDir}; bottom: 0; height: 100%; padding-bottom: 15px;">
                    
                    <div style="text-align: ${textAlign}; display:flex; flex-direction:column; align-items:${alignItems}; min-width: 140px; justify-content: center; height: 100%;">
                        
                        <div style="display:flex; align-items:flex-end; gap:10px; margin-bottom: 2px; flex-direction:${contentDir};">
                            <h2 style="font-size: 22px; font-weight: 900; color: #fff; margin: 0; text-transform: uppercase; line-height: 1; text-shadow: 0 2px 10px rgba(0,0,0,0.8);">${d.name}</h2>
                        </div>
                        
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom: 4px; flex-direction: ${isLeft ? 'row-reverse' : 'row'};">
                            <span style="font-size: 32px; font-weight: 900; color: ${tierColor}; text-shadow: 0 0 15px ${tierColor}40; line-height:1;">${stats.stats.overallScore}</span>
                            <div style="display:flex; flex-direction:row; gap:1px; justify-content:${alignItems};">${getTrophies(stats.stats)}</div>
                        </div>

                        <div style="font-size: 10px; color: ${mainColor}; font-weight:700; text-transform:uppercase; margin-bottom: 8px;">${d.team}</div>

                        <div style="width: 150px;">
                            ${getMiniStats(d, stats, uiContext.state.rankings, isLeft)}
                        </div>
                    </div>

                    <div style="position:relative; height: 90%; display: flex; align-items: flex-end;">
                        <img src="${d.photo}" style="height: 100%; width: auto; max-width: 160px; object-fit: cover; border: 3px solid ${imgBorderColor} !important; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                    </div>

                </div>
            </div>`;
        };

        const headerHtml = `
            ${compareStyles}
            <div style="display: flex; height: 240px; width: 100%; border-bottom: 1px solid #374151; position: relative; background: #080c14; overflow: visible;">
                ${renderHeroSide(d1, m1, color1, true)}
                
                <div style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 50; width: 90px; height: 90px; background: #fff; border: 4px solid #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: 900; color: #000; box-shadow: 0 0 30px rgba(0,0,0,0.9); text-shadow: 0 2px 4px rgba(0,0,0,0.3);">
                    VS
                </div>
                
                ${renderHeroSide(d2, m2, color2, false)}
                
                <button id="btn-quit-compare" style="position: absolute; top: 10px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.6); color: #9ca3af; border: 1px solid #4b5563; font-size: 9px; font-weight: 700; padding: 4px 10px; border-radius: 20px; cursor: pointer; text-transform: uppercase; z-index: 60; letter-spacing: 1px; backdrop-filter: blur(4px);">Exit</button>
            </div>
        `;

        const renderCompareMetric = (item1, item2) => {
             if (item1.isHeader) {
                return `<div style="font-size: 10px; font-weight: 800; color: #fbbf24; text-transform: uppercase; margin-top: 8px; margin-bottom: 4px; border-bottom: 1px solid #374151; letter-spacing:0.5px; padding-bottom: 3px;">${item1.label}</div>`;
             }
             
             const s1 = item1.score || 0;
             const s2 = item2.score || 0;
             const total = s1 + s2;
             const p1 = total > 0 ? (s1 / total) * 100 : 50;
             const p2 = 100 - p1;

             const c1 = '#009088'; 
             const c2 = '#ef4444';
             const barOp1 = (s1 >= s2) ? 1 : 0.1;
             const barOp2 = (s2 >= s1) ? 1 : 0.1;
             
             const getVal = (i) => {
                if (i.bd) {
                    const parts = [];
                    // Map over all dynamic breakdowns provided by the new data structure
                    Object.keys(i.bd).forEach(k => {
                        if (i.bd[k] !== undefined && i.bd[k] !== null) {
                            parts.push(`<span style="color:#fbbf24; text-transform:uppercase;">${k}:</span> <span style="color:#fff;">${i.fmt(i.bd[k])}</span>`);
                        }
                    });
                    
                    if (parts.length > 0) return parts.join(' <span style="color:#6b7280;">|</span> ');
                }
                
                const valStr = i.label === 'Compliance Score' ? (i.val || 0).toFixed(1) + '%' : i.fmt(i.val);
                return `<span style="color:#fbbf24; font-size:10px;">ALL:</span> <span style="color:#fff;">${valStr}</span>`;
            };

             const val1 = getVal(item1);
             const val2 = getVal(item2);

             return `
                <div class="cmp-row" style="margin-bottom: 3px; padding: 4px 6px; border-radius:4px; transition:background 0.2s; background: rgba(255,255,255,0.02); position: relative; z-index: 5;">
                    <style>
                        .cmp-val-popup { 
                            display: none; 
                            position: absolute; 
                            bottom: 100%; 
                            background: #0f1115; 
                            border: 1px solid #374151; 
                            color: #fff; 
                            padding: 4px 8px; 
                            border-radius: 4px; 
                            font-size: 10px; 
                            white-space: nowrap; 
                            z-index: 9999; 
                            box-shadow: 0 4px 15px rgba(0,0,0,0.8);
                            font-weight: 500;
                            pointer-events: none;
                            margin-bottom: 5px;
                        }
                        .cmp-row:hover { background: rgba(255,255,255,0.08); z-index: 100; }
                        .cmp-row:hover .cmp-val-popup { display: block; }
                        
                        .popup-left { left: -2px; transform: none; }
                        .popup-right { right: -2px; left: auto; transform: none; }
                    </style>
                    
                    <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 800; margin-bottom: 3px;">
                        <div style="color:${c1}; display:flex; align-items:center; min-width: 50px; position: relative;">
                            <span>${s1}</span>
                            <div class="cmp-val-popup popup-left">${val1}</div>
                        </div>
                        
                        <div style="color:#d1d5db; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; opacity:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:120px;">${item1.label}</div>
                        
                        <div style="color:${c2}; display:flex; align-items:center; flex-direction:row-reverse; min-width: 50px; position: relative;">
                            <span>${s2}</span>
                            <div class="cmp-val-popup popup-right">${val2}</div>
                        </div>
                    </div>

                    <div style="height: 5px; width: 100%; background: #111827; display: flex; border-radius: 2px; overflow: hidden;">
                        <div style="width: ${p1}%; background: ${c1}; height: 100%; opacity:${barOp1};"></div>
                        <div style="width: 1px; background: #000;"></div>
                        <div style="width: ${p2}%; background: ${c2}; height: 100%; opacity:${barOp2};"></div>
                    </div>
                </div>
             `;
        };
        // --- FLATTEN AND REDISTRIBUTE METRICS ---
        const allM1 = [...m1.col1, ...m1.col2, ...m1.col3, ...m1.col4];
        const allM2 = [...m2.col1, ...m2.col2, ...m2.col3, ...m2.col4];
        
       const capacity = 11; 
        const cols1 = [allM1.slice(0, capacity), allM1.slice(capacity, capacity*2), allM1.slice(capacity*2, capacity*3), allM1.slice(capacity*3)];
        const cols2 = [allM2.slice(0, capacity), allM2.slice(capacity, capacity*2), allM2.slice(capacity*2, capacity*3), allM2.slice(capacity*3)];

        const renderCol = (c1, c2) => c1.map((itm, idx) => renderCompareMetric(itm, c2[idx])).join('');

        // --- CHART GENERATION (for 4th column) ---
        const genChart = () => {
            const labels = ['REV', 'VEL', 'EFF', 'OPS', 'HLT'];
            const size = 220; 
            const center = size / 2;
            const radius = 80;
            const angleSlice = (Math.PI * 2) / labels.length;

            const getCoords = (val, i) => {
                const r = (val / 100) * radius;
                const angle = i * angleSlice - Math.PI / 2;
                return [center + Math.cos(angle) * r, center + Math.sin(angle) * r];
            };

            const s1 = m1.stats.scores || {};
            const s2 = m2.stats.scores || {};
            const vals1 = labels.map(l => s1[l] || 50);
            const vals2 = labels.map(l => s2[l] || 50);

            const poly1 = vals1.map((v, i) => getCoords(v, i).join(',')).join(' ');
            const poly2 = vals2.map((v, i) => getCoords(v, i).join(',')).join(' ');
            const borderPoints = labels.map((l, i) => getCoords(100, i).join(',')).join(' ');

            const genDots = (vals, name, color) => vals.map((v, i) => {
                 const [x, y] = getCoords(v, i);
                 const label = labels[i];
                 return `<div class="hero-trophy" data-tooltip="${name} - ${label}: ${v}" style="position:absolute; left:${x}px; top:${y}px; width:14px; height:14px; transform:translate(-50%, -50%); border-radius:50%; background:transparent; z-index:10; cursor:help;"></div>`;
            }).join('');

            return `
                <div class="chart-container-hover" style="display:flex; justify-content:center; align-items:center; flex-grow:1; margin-top:auto; padding-top:20px; opacity:1;">
                    <style>
                        .chart-container-hover:hover .hero-trophy { background: rgba(255,255,255,0.1) !important; border: 1px solid rgba(255,255,255,0.5); }
                    </style>
                    <div style="position:relative; width:${size}px; height:${size}px;">
                         <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="position:absolute; top:0; left:0; overflow:visible; z-index:1;">
                            <polygon points="${borderPoints}" fill="rgba(17, 24, 39, 0.5)" stroke="#374151" stroke-width="1" stroke-dasharray="2 2" />
                            <polygon points="${poly1}" fill="rgba(0, 144, 136, 0.4)" stroke="#009088" stroke-width="2" />
                            <polygon points="${poly2}" fill="rgba(239, 68, 68, 0.4)" stroke="#ef4444" stroke-width="2" />
                            ${labels.map((l, i) => {
                                const [x, y] = getCoords(130, i);
                                return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="#9ca3af" font-size="11" font-weight="800">${l}</text>`;
                            }).join('')}
                         </svg>
                         <div style="position:absolute; top:0; left:0; width:100%; height:100%; z-index:20;">
                             ${genDots(vals1, d1.name, '#009088')}
                             ${genDots(vals2, d2.name, '#ef4444')}
                         </div>
                    </div>
                </div>
            `;
        };

        const gridHtml = `
            <div class="ats-container" style="padding: 10px; flex: 1; overflow: visible; display: flex; flex-direction: column; background: #080c14; position: relative; z-index: 10;">
                <div class="ats-grid-wrapper" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; align-items: stretch; height: 100%;">
                    <div class="ats-column" style="padding: 8px; display: flex; flex-direction: column; justify-content: flex-start; gap: 3px; height: 100%; box-sizing: border-box; border: 1px solid #374151; background: #0f1115; border-radius: 6px;">${renderCol(cols1[0], cols2[0])}</div>
                    <div class="ats-column" style="padding: 8px; display: flex; flex-direction: column; justify-content: flex-start; gap: 3px; height: 100%; box-sizing: border-box; border: 1px solid #374151; background: #0f1115; border-radius: 6px;">${renderCol(cols1[1], cols2[1])}</div>
                    <div class="ats-column" style="padding: 8px; display: flex; flex-direction: column; justify-content: flex-start; gap: 3px; height: 100%; box-sizing: border-box; border: 1px solid #374151; background: #0f1115; border-radius: 6px;">${renderCol(cols1[2], cols2[2])}</div>
                    <div class="ats-column" style="padding: 8px; display: flex; flex-direction: column; justify-content: flex-start; gap: 3px; height: 100%; box-sizing: border-box; border: 1px solid #374151; background: #0f1115; border-radius: 6px;">
                        ${renderCol(cols1[3], cols2[3])}
                        ${genChart()}
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = headerHtml + gridHtml;

        document.getElementById('btn-quit-compare').onclick = () => {
            // Re-open modal to restore correct classes (like All-Star glow) and view
            uiContext.openDispatcherModal(d1.id);
        };
    }
};